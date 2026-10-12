# Implementation Plan: Ciclo de Vida da Sala — Layout Mobile, Encerrar, Sair e Voltar do Lobby

**Branch**: `005-room-lifecycle-exit` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Especificação de reordenação mobile da letra sorteada, encerramento destrutivo da sala pelo host, saída de participantes com auto-pódio, e voltar do Lobby deletando rascunho.

---

## 1. Summary

Este plano detalha a implementação do ciclo de vida explícito da sala: comandos `room:leave` / `room:close`, evento `room:closed`, modal de confirmação acessível, botões de Sair/Encerrar/Voltar nas telas de Lobby–Resultados, limpeza de resume token no cliente, `room:close` no lobby com purge vs em partida com `finishGame`+pódio, regra de `finishGame` quando restar ≤1 jogador ativo após leave, e reordenação do `GameScreen` no mobile para exibir a letra sorteada antes da barra da rodada.

---

## 2. Technical Context

- **Frontend**: React 19, TypeScript, Tailwind CSS, Vitest + React Testing Library.
- **Backend**: Cloudflare Workers + Durable Object `GameRoom` (já possui `purge()`, `finishGame()`, `ensureActiveHost()`, soft-disconnect).
- **Contratos**: `shared/types.ts` (`ClientCommand`, `ServerEvent`, `GamePhase`, `RoomState`).
- **Sessão cliente**: `clearResumeToken(roomCode)` em `frontend/src/hooks/useGameSocket.ts` (sessionStorage).
- **Acessibilidade**: modal com `role="dialog"`, `aria-modal`, focus trap, Escape = cancelar.

---

## 3. Decisions & Architecture

### 3.1 Protocolo (`shared/types.ts`)

```typescript
// ClientCommand
| ({ type: 'room:leave' } & CommandRequest)
| ({ type: 'room:close' } & CommandRequest)

// ServerEvent
| {
    type: 'room:closed';
    reason: 'host_closed' | 'empty' | 'purged';
    requestId?: string;
  }
```

- `room:close` → `HOST_ONLY_COMMANDS`.
- `room:leave` / `room:close` **não** entram em `MUTATION_PHASES` (mapa 1:1 fase). Validar com set de fases permitidas:
  - `CONFIGURING` | `WAITING_PLAYERS` | `ROUND_ACTIVE` | `CATEGORY_REVIEW` | `ROUND_RESULTS`
  - Fora disso → `INVALID_PHASE` (ex.: após `GAME_OVER` / pós-purge).

### 3.2 Backend (`game-room.ts`)

#### `handleRoomClose(socket, playerId, cmd)`
1. Validar jogador ativo + host.
2. **Se fase de lobby** (`CONFIGURING` | `WAITING_PLAYERS`):
   - `broadcast({ type: 'room:closed', reason: 'host_closed', requestId })`.
   - `command:ack` + `purge({ closeCode: 1000, closeReason: 'Room closed by host' })`.
3. **Se fase de partida** (`ROUND_ACTIVE` | `CATEGORY_REVIEW` | `ROUND_RESULTS`):
   - Limpar `roundDeadline` / `reviewDeadline` e alarmes.
   - `finishGame()` → `game:final_results` + fase `GAME_OVER`.
   - Ack via `processCommand` (sem `room:closed`, sem purge imediato; TTL de completed permanece).

#### `handleRoomLeave(socket, playerId, cmd)`
1. Validar jogador ativo.
2. Remover o jogador do array `room.players` (remoção dura — sem `session:resume` daquele token).
3. Apagar credenciais de resume desse `playerId`.
4. Fechar apenas o socket do jogador que saiu (ou deixar o cliente desconectar após ack).
5. Se era host → `ensureActiveHost()`.
6. `broadcast` `room:state` (e `player:presence` se ainda fizer sentido para compatibilidade).
7. `command:ack` → cliente do leaver limpa UI.
8. Chamar `evaluateRoomAfterLeave()`.

#### `evaluateRoomAfterLeave()`
| Condição | Ação |
|----------|------|
| Fase lobby (`CONFIGURING` / `WAITING_PLAYERS`) e `activeCount === 0` | `broadcast room:closed reason:'empty'` (se ainda houver sockets) + `purge()` |
| Fase de partida (`ROUND_ACTIVE` \| `CATEGORY_REVIEW` \| `ROUND_RESULTS`) e `activeCount <= 1` | Cancelar alarmes de rodada/revisão se necessário → `finishGame()` → `game:final_results` |
| Caso contrário | Persistir e seguir |

**Importante**: soft-disconnect (`webSocketClose`) **não** chama `evaluateRoomAfterLeave` com a regra de ≤1 — apenas leave/close explícitos.

### 3.3 Frontend — Modal (`ConfirmDialog.tsx`)

Novo componente em `frontend/src/components/ConfirmDialog.tsx`:
- Props: `open`, `title`, `description`, `confirmLabel`, `cancelLabel`, `tone?: 'danger' | 'default'`, `onConfirm`, `onCancel`, `busy?: boolean`.
- A11y: foco inicial no **Cancelar**; retornar foco ao botão acionador; `Escape` / clique no backdrop → cancelar; `aria-labelledby` / `aria-describedby`.
- Testes em `ConfirmDialog.test.tsx`.

### 3.4 Frontend — Orquestração (`App.tsx`)

| Handler | Fluxo |
|---------|--------|
| `handleLeaveRoom` | `send({ type: 'room:leave', requestId })` → no `command:ack` do leave, reset home + `clearResumeToken` (`lifecycleExitRef` bloqueia pódio) |
| `handleCloseRoom` | Após confirmação do modal → `send({ type: 'room:close', requestId })` — **não** setar `lifecycleExitRef` (partida precisa ir ao pódio) |
| `onEvent` + `room:closed` | Lobby/empty: `clearResumeToken` + `handleBackToHome()` |
| `onEvent` + close ack | Limpar `lifecycleBusy` / pending; **não** ir para início (lobby usa `room:closed`; partida usa `game:final_results`) |
| `onEvent` + `game:final_results` | Navegar ao pódio se ainda houver `roomCode`/`myPlayerId` e não estiver em leave (`lifecycleExitRef`) |

Estender `handleBackToHome` para sempre limpar resume token quando `roomCode` existir.

Passar callbacks para `LobbyScreen`, `GameScreen`, `ResultsScreen`:
- `onLeaveRoom`, `onCloseRoom` (host), e flags `isHost` / `canCloseRoom` conforme necessário.

### 3.5 Frontend — Telas

#### `LobbyScreen.tsx`
- Botão `"Voltar ao início"` no topo.
  - Host → abre `ConfirmDialog` (copy de rascunho) → `onCloseRoom`.
  - Convidado → `onLeaveRoom` (sem modal destrutivo; opcional confirm leve “Sair da sala?”).
- Botão `"Encerrar sala"` (host) e `"Sair"` (todos) — Encerrar pode reutilizar o mesmo `onCloseRoom` com copy de “Encerrar e deletar”.
- Evitar duplicar três botões confusos: no Lobby, host usa **Voltar ao início** (deleta rascunho) + opcionalmente o mesmo fluxo rotulado; convidado usa **Sair** / **Voltar ao início** = leave. Durante partida, host vê **Encerrar sala** + **Sair**.

#### `GameScreen.tsx` / `ResultsScreen.tsx`
- Barra de ações compacta (mobile-first): `"Sair"` para todos; `"Encerrar sala"` só host (abre modal com copy de **finalizar + pódio**).
- Touch targets `min-h-[44px]`.
- Após confirm do encerrar em partida, aguardar `game:final_results` (não redirecionar à home no ack).

#### `GameScreen.tsx` — ordem mobile (US1)
- Envolver layout em container flex/grid com `order`:
  1. Card letra: `order-1 lg:order-none` (ou equivalente na coluna lateral).
  2. Barra da rodada: `order-2`.
  3. Categorias + STOP: `order-3`.
  4. Placar: `order-4`.
- Alternativa aceitável: bloco da letra com `lg:hidden` no topo + `hidden lg:block` na sidebar, compartilhando o mesmo markup via componente interno `LetterCard`.
- Desktop `lg+` permanece com sidebar (letra + placar) à direita.

### 3.6 Copy (PT-BR) — referência rápida

Ver tabela na [spec §3.4](./spec.md). Usar textos da spec sem alterar significado.

---

## 4. Implementation Steps

### Fase 1: Contratos e Backend
1. Estender `ClientCommand` / `ServerEvent` em `shared/types.ts`.
2. Registrar dispatch de `room:leave` / `room:close` em `game-room.ts` (`HOST_ONLY` só para close; validação multi-fase).
3. Implementar `handleRoomClose` (lobby→purge / partida→finishGame), `handleRoomLeave`, `evaluateRoomAfterLeave`; ajustar `purge` para motivo de fechamento.
4. Testes em `backend/src/test/game-room.test.ts` (close lobby + close partida).

### Fase 2: Modal e limpeza de sessão no cliente
1. Criar `ConfirmDialog` + testes.
2. Estender `handleBackToHome` com `clearResumeToken`.
3. Handlers `handleLeaveRoom` / `handleCloseRoom` e listener `room:closed` em `App.tsx`.

### Fase 3: Lobby — Voltar / Sair / Encerrar
1. Props e botões em `LobbyScreen`.
2. Modal de descarte de rascunho (host) vs leave (convidado).
3. Testes `LobbyScreen.test.tsx` (+ cobertura em `App.test.tsx` se necessário).

### Fase 4: Game + Results — Sair / Encerrar
1. Botões nas telas de jogo e resultados.
2. Encerrar com modal de “finalizar + pódio”; Sair sem deletar (exceto regra server-side ≤1).
3. App: close ack não manda para início; `game:final_results` abre pódio.
4. Testes das screens / App.

### Fase 5: Layout mobile da letra
1. Reordenar `GameScreen` (letra antes da rodada em `<lg`).
2. Teste de estrutura/ordem (RTL: posição no DOM ou classes `order-*`).

### Fase 6: Validação final
1. Suites frontend e backend 100% verdes.
2. Checklist da Definition of Done da spec.

---

## 5. Risks & Mitigations

| Risco | Mitigação |
|-------|-----------|
| `MUTATION_PHASES` de fase única bloqueia leave/close | Validação dedicada com set de fases |
| Race leave + `round:stop` / vote | Serializar no DO (já single-threaded); revalidar fase/ativos no handler |
| Cliente recebe `game:final_results` após já ter dado leave | Reset home no ack do leave antes; ignorar eventos se `roomCode === null` |
| `purge` fecha sockets antes do cliente ler `room:closed` | Broadcast `room:closed` **antes** de fechar sockets; pequeno yield se necessário |
| Confusão UX Voltar vs Encerrar vs Sair no Lobby | Copy distinta + um modal só para ações destrutivas do host |

---

## 6. Out of Scope

- Soft-disconnect virando leave automático.
- Kick individual de jogadores.
- Alterar TTLs / cron da Feature 3.
- Encerrar a partir do Pódio (já existe “Voltar ao Início” cliente-side; purge segue TTL `GAME_OVER`).

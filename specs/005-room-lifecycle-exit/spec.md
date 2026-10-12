# Feature Specification: Ciclo de Vida da Sala — Layout Mobile, Encerrar, Sair e Voltar do Lobby

**Feature Branch**: `005-room-lifecycle-exit`  
**Created**: 2026-10-12  
**Status**: Draft  
**Input**: Ajustes solicitados após a Feature 4 — (1) ordem mobile da letra sorteada vs. barra da rodada; (2) botão de encerrar sala para o anfitrião com modal de confirmação; (3) botão de sair para participantes com encerramento automático e pódio quando restar 1 jogador; (4) botão de voltar no Lobby deletando a sala em rascunho.

---

## 1. Contexto e Avaliação Técnica

### 1.1 Diagnóstico do Estado Atual

| Necessidade | Situação atual | Lacuna |
|-------------|----------------|--------|
| Letra sorteada primeiro no mobile | Em `GameScreen`, a barra da rodada vem no DOM antes do card “Letra Sorteada”; no breakpoint `<lg` a coluna única empilha nessa ordem | Reordenar visualmente no mobile (letra → rodada → categorias/STOP → placar) sem quebrar o layout desktop (`lg:grid-cols-3`) |
| Encerrar sala (host) | Existe `purge()` interno e TTL de idle/completed; **não** há comando de cliente nem UI | Comando host-only: no lobby deleta a sala; em partida finaliza com pontuação acumulada e pódio |
| Sair do jogo | `webSocketClose` apenas marca `disconnected` (soft); jogador permanece no roster e pode `session:resume` | Remoção efetiva do participante; regra de “≤1 ativo em partida → `finishGame` + pódio” |
| Voltar do Lobby | `handleBackToHome` é só reset de cliente; a sala em `CONFIGURING` permanece até TTL de 24h | Comando que purge a sala rascunho e limpe sessão/token no cliente |

**Arquivos centrais**:
- Protocolo: `shared/types.ts` (`ClientCommand`, `ServerEvent`, `GamePhase`)
- Backend: `backend/src/game-room.ts` (`finishGame`, `purge`, `ensureActiveHost`, `webSocketClose`)
- Frontend: `App.tsx`, `LobbyScreen.tsx`, `GameScreen.tsx`, `ResultsScreen.tsx`, `PodiumScreen.tsx`
- Componente reutilizável existente (ainda não montado no App): `components/Header.tsx` (`onExit` / “Sair”)

### 1.2 Requisitos Arquiteturais para Implementação

1. **Contrato em tempo real** (`shared/types.ts`):
   - Novos comandos: `room:leave`, `room:close`.
   - Novo evento: `room:closed` (motivo tipado) para todos os sockets ainda conectados.
   - Reutilizar `game:final_results` + fase `GAME_OVER` quando a saída antecipar o fim da partida.
2. **Backend (`GameRoom`)**:
   - `handleRoomLeave`: remove o jogador do roster (ou marca saída definitiva sem retomada), promove host se necessário, avalia contagem de ativos.
   - `handleRoomClose`: host-only; **bifurcado por fase**:
     - Lobby (`CONFIGURING` / `WAITING_PLAYERS`): `room:closed` + `purge()` (deleta a sala).
     - Partida (`ROUND_ACTIVE` | `CATEGORY_REVIEW` | `ROUND_RESULTS`): cancela alarmes da rodada/revisão → `finishGame()` com pontuação já acumulada → `game:final_results` (pódio). **Não** emite `room:closed` nem faz purge imediato (TTL de `GAME_OVER` segue vigente).
   - Regra de leave antecipado: se a fase for de partida e, após a saída, restar **≤ 1** jogador `active`, chamar `finishGame()` e emitir `game:final_results`.
   - Em `CONFIGURING` / `WAITING_PLAYERS`: se a sala ficar sem ativos após leave → `purge()`.
3. **Frontend**:
   - Modal de confirmação acessível (foco preso, `role="dialog"`, Escape cancela) para “Encerrar sala” / descarte de rascunho.
   - Botões “Sair” (todos) e “Encerrar sala” (host) nas telas de Lobby / Jogo / Resultados (e Header, se montado).
   - “Voltar ao início” no `LobbyScreen` = fluxo de exclusão de rascunho (`room:close` pelo host; convidado usa “Sair”/`room:leave` sem deletar sozinho a sala se ainda houver host).
   - Em `room:closed` (só lobby/empty): limpar estado local, token de resume e navegar para `'início'`.
   - Em `game:final_results` (leave com ≤1 ativo **ou** host encerrou a partida): quem permanece / todos os ainda na sala vão ao **pódio**; quem já deu leave está em `'início'`.
4. **Layout mobile (`GameScreen`)**:
   - Reordenar com utilitários Tailwind (`order-*` / estrutura condicional) para que, em viewports `< lg`, o card da letra sorteada apareça **antes** da barra da rodada (e do bloco de categorias).

### 1.3 Decisões de Produto (padrões adotados nesta spec)

1. **“Encerrar sala”** (anfitrião ativo):
   - **Lobby**: ação destrutiva — deleta o rascunho (`room:closed` + purge).
   - **Jogo / Resultados**: finaliza a partida com o placar acumulado até o momento e exibe o **pódio** para todos os participantes ainda na sala (`finishGame` + `game:final_results`). Não deleta a sala imediatamente.
   - Não disponível no pódio (`GAME_OVER`), onde o host usa “Voltar ao Início”.
2. **“Sair”** remove o jogador atual da partida. Não deleta a sala se ainda houver outros ativos (exceto quando a regra de ≤1 ativo dispara o fim com pódio, ou a sala de configuração fica vazia).
3. **“Voltar” no Lobby** (rascunho):
   - Se o usuário for o **host**: equivale a encerrar/deletar a sala em `CONFIGURING` (com confirmação, pois deleta o rascunho e desconecta convidados).
   - Se o usuário for **convidado**: sai da sala (`room:leave`) sem deletá-la; o host permanece no lobby.
4. Jogador que sai via **Sair** **não** vê o pódio; quem permanece (leave com ≤1 ativo) ou quem ainda está na sala quando o host **encerra a partida** vê o pódio.
5. Soft-disconnect (queda de rede) **não** muda nesta feature: continua permitindo `session:resume`. A remoção permanente ocorre só via `room:leave` / `room:close` (lobby).

---

## 2. User Scenarios & Acceptance Criteria

### User Story 1 — Ordem Mobile: Letra antes da Rodada (Priority: P1)

Como jogador no celular, quero ver primeiro a letra sorteada da vez e só então as informações da rodada, para orientar imediatamente o preenchimento das categorias.

**Acceptance Criteria**:
1. **Given** viewport mobile (`< lg`, tipicamente 320–480px), **When** a `GameScreen` está na fase jogável, **Then** o card “Letra Sorteada da Vez” é renderizado visualmente **acima** da barra superior da rodada (número da rodada / timer).
2. **Given** viewport desktop (`lg+`), **When** a mesma tela é exibida, **Then** o layout em duas colunas permanece coerente (letra/placar na coluna lateral; categorias + STOP na coluna principal) sem regressão visual.
3. **Given** leitores de tela, **When** a ordem visual muda no mobile, **Then** a ordem de foco/leitura acompanha a ordem visual (letra antes da barra da rodada).

---

### User Story 2 — Encerrar Sala (Anfitrião) (Priority: P1)

Como anfitrião, quero encerrar a sala com confirmação: no lobby para deletar o rascunho; durante a partida para finalizar com o placar até ali e mostrar o pódio.

**Acceptance Criteria**:
1. **Given** que o usuário é anfitrião ativo na Lobby, Jogo ou Resultados, **When** a UI é renderizada, **Then** o botão `"Encerrar sala"` está visível apenas para ele.
2. **Given** o host no **Lobby** (`CONFIGURING` / `WAITING_PLAYERS`) aciona `"Encerrar sala"` (ou `"Voltar ao início"`), **When** confirma no modal de descarte/exclusão, **Then**:
   - O cliente envia `room:close`.
   - O servidor emite `room:closed` (`host_closed`), fecha os WebSockets e executa `purge()`.
   - Todos os clientes navegam para `'início'` com estado limpo (inclui limpeza do token de resume).
3. **Given** o host em **Jogo ou Resultados** (`ROUND_ACTIVE` | `CATEGORY_REVIEW` | `ROUND_RESULTS`) aciona `"Encerrar sala"`, **When** confirma no modal, **Then**:
   - O cliente envia `room:close`.
   - O servidor cancela alarmes da rodada/revisão, calcula o ranking com a pontuação **já acumulada** (`finishGame` / `buildFinalRanking`), emite `game:final_results` e passa a fase para `GAME_OVER`.
   - **Não** emite `room:closed` nem faz purge imediato.
   - Todos os clientes ainda na sala navegam para o **pódio**.
4. **Given** um convidado (não-host), **When** a UI é renderizada, **Then** o botão `"Encerrar sala"` **não** é exibido; tentativa via protocolo responde `NOT_HOST`.

---

### User Story 3 — Sair da Partida (Todos os Participantes) (Priority: P1)

Como participante, quero sair da sala/partida e ser removido do jogo, para abandonar sem precisar fechar o navegador; se eu for o penúltimo a sair, a partida deve terminar com pódio para quem restou.

**Acceptance Criteria**:
1. **Given** qualquer participante ativo (host ou convidado) em Lobby, Jogo ou Resultados, **When** a UI é renderizada, **Then** há um botão `"Sair"` disponível.
2. **Given** o clique em `"Sair"`, **When** o comando `room:leave` é aceito, **Then**:
   - O jogador é removido da partida (não permanece elegível a voto/score futuros nem a `session:resume` daquela sessão).
   - O cliente do jogador que saiu limpa o estado local e retorna à tela inicial.
   - Os demais recebem `room:state` atualizado sem esse jogador (ou com evento equivalente de saída).
3. **Given** uma partida em andamento (`ROUND_ACTIVE`, `CATEGORY_REVIEW` ou `ROUND_RESULTS`) com 2 ativos, **When** um deles sai, **Then** resta 1 ativo e o servidor:
   - Calcula o ranking final com as pontuações já acumuladas (`buildFinalRanking` / `finishGame`).
   - Emite `game:final_results` e fase `GAME_OVER`.
   - O jogador remanescente é direcionado ao **pódio**.
4. **Given** o host sai e ainda há ≥ 2 ativos, **When** `room:leave` é processado, **Then** um novo anfitrião ativo é promovido (`ensureActiveHost`) e a partida continua.
5. **Given** saída durante `CONFIGURING` deixando a sala sem jogadores ativos, **When** o leave completa, **Then** a sala é purgada (não permanece como rascunho órfão).

---

### User Story 4 — Voltar ao Início no Lobby (Rascunho) (Priority: P1)

Como anfitrião na tela de configuração, quero um botão para voltar à tela inicial que delete a sala em rascunho, para não deixar salas abandonadas ocupando código/recursos.

**Acceptance Criteria**:
1. **Given** a `LobbyScreen` em fase `CONFIGURING`, **When** a UI é renderizada, **Then** existe botão `"Voltar ao início"` (ou rótulo equivalente claro).
2. **Given** que o usuário é o **host**, **When** aciona `"Voltar ao início"`, **Then** é exibida confirmação de que a sala em rascunho será **deletada**; ao confirmar, envia `room:close`, todos os clientes voltam ao início e a sala deixa de existir.
3. **Given** que o usuário é **convidado** no lobby, **When** aciona `"Voltar ao início"` / `"Sair"`, **Then** envia `room:leave`, ele volta ao início e a sala permanece para o host (e demais convidados).
4. **Given** o fluxo de voltar/encerrar no lobby, **When** a operação conclui, **Then** o cliente não mantém `roomCode` nem token de resume da sala deletada/abandonada.

---

## 3. Requisitos Técnicos e Arquitetura de Componentes

### 3.1 Protocolo (`shared/types.ts`)

```typescript
// ClientCommand (adições)
| ({ type: 'room:leave' } & CommandRequest)
| ({ type: 'room:close' } & CommandRequest)

// ServerEvent (adição)
| {
    type: 'room:closed';
    reason: 'host_closed' | 'empty' | 'purged';
    requestId?: string;
  }
```

- `room:close`: somente anfitrião ativo; válido em `CONFIGURING`, `WAITING_PLAYERS`, `ROUND_ACTIVE`, `CATEGORY_REVIEW`, `ROUND_RESULTS` (não necessário em `GAME_OVER` — sala já finalizada).
- `room:leave`: qualquer jogador ativo da sala; válido nas mesmas fases (exceto pós-`room:closed`).
- Erros esperados: `NOT_HOST`, `NOT_ELIGIBLE`, `INVALID_PHASE` (se aplicável), reutilizando o canal `error` + `command:ack`.

### 3.2 Backend (`backend/src/game-room.ts`)

| Handler | Comportamento |
|---------|----------------|
| `handleRoomClose` | Valida host ativo. **Lobby**: broadcast `room:closed` → `purge()`. **Partida**: limpa alarmes → `finishGame()` → `game:final_results` (sem `room:closed` / sem purge imediato). |
| `handleRoomLeave` | Remove jogador + credenciais de resume associadas → `player:presence`/`room:state` → se host saiu, `ensureActiveHost()` → `evaluateRoomAfterLeave()` |
| `evaluateRoomAfterLeave` | `CONFIGURING`/`WAITING_PLAYERS` + 0 ativos → `purge` (+ `room:closed` reason `empty`). Partida ativa + ativos ≤ 1 → `finishGame()` + `game:final_results`. Caso contrário, continua. |

Testes automatizados em `backend/src/test/game-room.test.ts`:
- Host fecha sala no **lobby** → todos recebem `room:closed` e storage limpo.
- Host fecha sala em **partida** → `GAME_OVER` + `game:final_results` (pódio); sem `room:closed` / sem purge imediato.
- Guest leave mantém sala; host leave promove novo host.
- Leave com 2→1 em `ROUND_ACTIVE` → `GAME_OVER` + `game:final_results`.
- Leave do último jogador no lobby → sala purgada.
- Não-host enviando `room:close` → `NOT_HOST`.

### 3.3 Frontend

#### `GameScreen.tsx` (US1)
- Extrair o card “Letra Sorteada” para posição no fluxo mobile anterior à barra da rodada.
- Abordagem preferida: um único card de letra com classes `order-first lg:order-none` (ou bloco duplicado com `lg:hidden` / `hidden lg:block` se a grade de 3 colunas exigir), mantendo uma fonte de verdade de markup quando possível.
- Garantir que o placar ao vivo continue após categorias/STOP no mobile.

#### Modal de confirmação (novo componente, ex.: `ConfirmDialog.tsx`)
- Props: `title`, `description`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel`, `open`.
- Acessibilidade: `role="dialog"`, `aria-modal="true"`, foco inicial no cancelar (ação segura), retorno de foco ao acionador ao fechar, `Escape` cancela.
- Textos: Encerrar sala / Voltar e deletar rascunho.

#### `LobbyScreen.tsx`
- Botão `"Voltar ao início"` no topo.
- Host: abre modal → `onCloseRoom()`.
- Convidado: `onLeaveRoom()` (sem deletar a sala).
- Manter botões de configuração existentes.

#### `App.tsx` + telas de partida
- Handlers:
  - `handleLeaveRoom` → envia `room:leave` → no ack, `handleBackToHome()` (com limpeza de resume token).
  - `handleCloseRoom` → envia `room:close` após modal.
    - Se vier `room:closed` (lobby) → `handleBackToHome()`.
    - Se vier `game:final_results` (partida) → navegar ao pódio; **não** resetar para início no ack do close.
- Escutar `room:closed` mesmo quando o fechamento foi iniciado por outro cliente.
- Exibir `"Encerrar sala"` (host) e `"Sair"` (todos) em Lobby, Game e Results (Header opcional se for montado nesta feature).
- Ao receber `game:final_results` por leave/encerrar partida, ir ao pódio **somente** se o cliente ainda tiver `roomCode`/`myPlayerId`; quem saiu já deve ter sido resetado.

#### Limpeza de sessão no cliente
- Estender `handleBackToHome` para limpar token de resume (`clearResumeToken` / equivalente já usado no fluxo de `SESSION_INVALID`).

### 3.4 UI Copy (PT-BR)

| Elemento | Texto sugerido |
|----------|----------------|
| Botão host | Encerrar sala |
| Botão todos | Sair |
| Botão lobby | Voltar ao início |
| Título modal close (lobby) | Encerrar e deletar sala? |
| Corpo modal close (lobby) | Esta ação apaga a sala permanentemente. Todos os participantes serão desconectados e o código deixará de funcionar. |
| Confirmar close (lobby) | Encerrar e deletar |
| Título modal close (partida) | Encerrar a partida agora? |
| Corpo modal close (partida) | A partida será finalizada com a pontuação acumulada até aqui e o pódio será exibido para todos. |
| Confirmar close (partida) | Encerrar e ver pódio |
| Cancelar | Cancelar |
| Título modal lobby host | Descartar sala em rascunho? |
| Corpo modal lobby host | A sala de configuração será deletada. Convidados conectados serão enviados à tela inicial. |

---

## 4. Edge Cases e Tratamento de Erros

1. **Host encerra durante revisão/votação ou rodada ativa**: finaliza com placar acumulado e pódio (não deleta a sala na hora).
2. **Sair vs Encerrar**: sair com 2+ ativos não deleta nem finaliza; encerrar no lobby deleta; encerrar em partida finaliza com pódio.
3. **Último ativo após leave em partida**: gera pódio; se o último também sair em seguida, `purge` da sala em `GAME_OVER` pode seguir TTL existente (1h) ou leave pós-pódio apenas limpa o cliente — fora do escopo obrigatório deletar no pódio.
4. **Duplo clique / rede lenta**: desabilitar botões após envio até `command:ack`, `room:closed` ou `error`.
5. **Comando após sala já fechada**: ignorar / `error` sem quebrar o cliente; cliente já em `'início'`.
6. **Convidado tenta `room:close`**: `NOT_HOST`; UI não oferece o botão.
7. **Partida com 1 jogador ativo por desconexões soft (não leave)**: **não** alterar nesta feature — apenas `room:leave`/`room:close` disparam as novas regras (evita finalizar partida por queda transitória de rede).
8. **Acessibilidade do modal**: backdrop clica = cancelar; foco não vaza para o conteúdo atrás (`inert` ou trap de foco).
9. **Mobile letter-first e overlay de intro**: a reordenação aplica-se ao layout da rodada ativa; o overlay de sorteio/contagem permanece fullscreen como hoje.

---

## 5. Escopo Fora Desta Feature

- Alterar TTL idle/completed ou cron da Feature 3.
- Transformar soft-disconnect em leave automático.
- Chat, kick individual de jogador pelo host (além de encerrar a sala inteira).
- Persistência de histórico de partidas abandonadas.

---

## 6. Critérios de Pronto (Definition of Done)

- [x] US1: ordem mobile letra → rodada validada (DOM: `LetterCard` `lg:hidden` antes da barra; desktop `hidden lg:flex` na sidebar).
- [x] US2: modal + `room:close` — lobby → home/purge; partida → pódio; testes backend cobrindo ambos.
- [x] US3: `room:leave` + promoção de host + auto-pódio com ≤1 ativo; testes backend e frontend.
- [x] US4: voltar no Lobby deleta rascunho (host) / sai sem deletar (convidado).
- [x] Suites `frontend/` e `backend/` 100% verdes.
- [x] Tasks detalhadas em `tasks.md` e plano técnico em `plan.md`.

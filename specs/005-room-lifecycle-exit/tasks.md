# Tasks: Ciclo de Vida da Sala — Layout Mobile, Encerrar, Sair e Voltar do Lobby

**Branch**: `005-room-lifecycle-exit` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Task Checklist

### Fase 1: Contratos e Backend
- [x] **T-1.1**: Adicionar `room:leave` e `room:close` em `ClientCommand` e o evento `room:closed` em `ServerEvent` em `shared/types.ts`.
- [x] **T-1.2**: Registrar `room:close` em `HOST_ONLY_COMMANDS` e validação multi-fase para leave/close (fora de `MUTATION_PHASES` 1:1) em `backend/src/game-room.ts`.
- [x] **T-1.3**: Implementar `handleRoomClose` — no lobby: broadcast `room:closed` (`host_closed`) + `purge()`; em partida: `finishGame()` + `game:final_results` (sem purge imediato).
- [x] **T-1.3b**: Adequar `handleRoomClose` para fase de partida (`ROUND_ACTIVE` / `CATEGORY_REVIEW` / `ROUND_RESULTS`) finalizar com placar acumulado e pódio; manter purge só no lobby. Teste backend dedicado.
- [x] **T-1.4**: Implementar `handleRoomLeave` — remoção dura do jogador, limpeza de resume credentials, promoção de host se necessário, `room:state` e ack.
- [x] **T-1.5**: Implementar `evaluateRoomAfterLeave` — lobby vazio → purge (`empty`); partida com ≤1 ativo → `finishGame()` + `game:final_results`.
- [x] **T-1.6**: Garantir que soft-disconnect (`webSocketClose`) **não** dispare a regra de auto-pódio por ≤1 ativo.
- [x] **T-1.7**: Testes em `backend/src/test/game-room.test.ts` cobrindo: close por host, `NOT_HOST` no close, leave de guest, leave de host com promoção, leave 2→1 em partida → pódio, leave do último no lobby → purge.

### Fase 2: Modal e Orquestração no Cliente (`App.tsx`)
- [x] **T-2.1**: Criar componente acessível `frontend/src/components/ConfirmDialog.tsx` (`role="dialog"`, focus trap, Escape/backdrop cancelam).
- [x] **T-2.2**: Adicionar testes unitários em `frontend/src/components/ConfirmDialog.test.tsx`.
- [x] **T-2.3**: Estender `handleBackToHome` em `frontend/src/App.tsx` para chamar `clearResumeToken(roomCode)` sempre que houver sala ativa.
- [x] **T-2.4**: Implementar `handleLeaveRoom` e `handleCloseRoom` enviando `room:leave` / `room:close` com `requestId`.
- [x] **T-2.5**: Tratar evento `room:closed` em `onEvent` redirecionando todos os clientes para `'início'` com estado limpo.
- [x] **T-2.6**: Ignorar `game:final_results` / navegação ao pódio quando o cliente local já tiver saído (`roomCode === null` ou `myPlayerId` ausente).
- [x] **T-2.7**: No ack de `room:close`, não navegar para `'início'` (lobby usa `room:closed`; partida usa `game:final_results` → pódio). Não setar `lifecycleExitRef` no close.

### Fase 3: Lobby — Voltar / Sair / Encerrar (`LobbyScreen`)
- [x] **T-3.1**: Adicionar botão `"Voltar ao início"` em `frontend/src/screens/LobbyScreen.tsx`.
- [x] **T-3.2**: Host: `"Voltar ao início"` abre modal de descarte de rascunho e dispara `onCloseRoom`.
- [x] **T-3.3**: Convidado: `"Voltar ao início"` / `"Sair"` dispara `onLeaveRoom` sem deletar a sala.
- [x] **T-3.4**: Exibir `"Encerrar sala"` apenas para host ativo (pode reutilizar o fluxo de close com copy de encerramento).
- [x] **T-3.5**: Atualizar testes em `frontend/src/screens/LobbyScreen.test.tsx` (visibilidade host/convidado, callbacks de leave/close).

### Fase 4: Jogo e Resultados — Sair / Encerrar
- [x] **T-4.1**: Adicionar botões `"Sair"` (todos) e `"Encerrar sala"` (host) em `frontend/src/screens/GameScreen.tsx`, com `min-h-[44px]` e modal de confirmação (**copy de finalizar + pódio**).
- [x] **T-4.2**: Adicionar os mesmos botões / modal em `frontend/src/screens/ResultsScreen.tsx`.
- [x] **T-4.3**: Wire props/callbacks a partir de `App.tsx` para Game e Results; close em partida → pódio (não home).
- [x] **T-4.4**: Atualizar testes em `GameScreen.test.tsx`, `ResultsScreen.test.tsx` e/ou `App.test.tsx` cobrindo leave, close→pódio e close lobby→home.

### Fase 5: Layout Mobile — Letra antes da Rodada (`GameScreen`)
- [x] **T-5.1**: Extrair card “Letra Sorteada da Vez” para componente interno reutilizável (evitar markup duplicado inconsistente).
- [x] **T-5.2**: Em viewports `<lg`, renderizar a letra **antes** da barra superior da rodada (utilitários `order-*` ou bloco `lg:hidden` / `hidden lg:block`).
- [x] **T-5.3**: Preservar layout desktop (`lg+`) com letra/placar na coluna lateral e categorias + STOP na coluna principal.
- [x] **T-5.4**: Atualizar testes em `frontend/src/screens/GameScreen.test.tsx` validando a ordem no DOM/mobile.

### Fase 6: Validação Final
- [x] **T-6.1**: Executar a suíte completa de testes no frontend (`npm test` em `frontend/`) garantindo 100% de aprovação.
- [x] **T-6.2**: Executar a suíte completa de testes no backend (`npm test` em `backend/`) garantindo 100% de aprovação.
- [x] **T-6.3**: Revisar Definition of Done da [spec.md](./spec.md) e marcar critérios atendidos.

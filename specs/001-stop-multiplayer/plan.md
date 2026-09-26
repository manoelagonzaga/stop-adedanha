# Implementation Plan: Stop Multiplayer

**Branch**: `001-stop-multiplayer` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from [spec.md](./spec.md)

## Summary

Construir um jogo Stop multiplayer para até 20 participantes por sala, com código compartilhável, nickname temporário, configuração de categorias, rodadas sincronizadas, encerramento por Stop ou tempo, votação de invalidação e ranking por partida. O frontend React/Vite será publicado no GitHub Pages e se conectará a um Cloudflare Worker TypeScript por WebSocket. Cada sala será um Durable Object com estado autoritativo e SQLite temporário.

## Technical Context

**Language/Version**: TypeScript 5.8+, browser runtime e Cloudflare Workers runtime

**Primary Dependencies**: React 19, Vite 6, Cloudflare Workers WebSocket API, Durable Objects, Wrangler, Vitest, Playwright

**Storage**: SQLite-backed Durable Objects, com uma instância por sala e limpeza por alarm ao encerrar ou expirar a sessão

**Testing**: Vitest para domínio e pontuação; testes locais com Wrangler; Playwright para múltiplos navegadores e GitHub Pages preview

**Target Platform**: GitHub Pages para frontend e Cloudflare Workers para backend realtime

**Project Type**: Aplicação web multiplayer serverless com Worker autoritativo

**Performance Goals**: Propagar mudanças de sala e encerramento global para 20 jogadores em até 3 segundos; publicar resultado em até 5 segundos; manter a interface responsiva durante o cronômetro; manter uma conexão WebSocket por jogador

**Constraints**: O Worker deve validar identidade temporária, capacidade, autoria e fase; o Durable Object é a autoridade para relógio, Stop, votos e pontuação; o frontend não contém credenciais secretas; WebSocket exige HTTPS/WSS; salas expiram e não são recuperáveis

**Scale/Scope**: MVP com até 20 jogadores por sala, múltiplas salas no mesmo Worker, uma partida ativa por sala e sem ranking global

## UX and Accessibility Direction

The supplied prototype and updated rules establish the visual direction for the implementation: a light warm
background, large soft geometric forms with slow ambient motion, elevated light surfaces, navy
primary actions, orange emphasis for the drawn letter and leading player, compact uppercase labels,
and a clear linear hierarchy from room entry to active round, sequential review, and final results.

Key UX & Layout Directives:
1. **Room Configuration (Lobby):** The scoreboard and the player list MUST NOT be displayed on this screen, as this data is not yet consolidated prior to match start. Focus remains exclusively on room code, round quantity, category management, and the Start Game action.
2. **Active Round Screen:**
   - The **STOP button MUST be positioned immediately after the categories section**.
   - The **drawn letter MUST be positioned on the right side, directly above the scoreboard section**.
   - Main content (left column on desktop) houses round header, timer, category input form, followed by the STOP button.
3. **Sequential Category-by-Category Review:**
   - Validation occurs **one category at a time**.
   - For each active category, all submitted terms are displayed simultaneously for peer invalidation.
   - When all players finish voting or the category timer expires, points for that category are computed and consolidated.
   - During the entire category evaluation phase, the **scoreboard MUST remain on the right side, reflecting the calculated scores in real time**.
   - The system automatically transitions to the next category until all categories of the round have been validated.
4. **Final Results Screen:**
   - The **scoreboard MUST be prominently centered** on the screen (not relegated to a sidebar).
   - The **1st, 2nd, and 3rd place players MUST be highlighted in a podium format** (gold, silver, bronze).
   - Remaining participants (4th place onward) MUST be displayed in a clean list format below the podium.
   - **All positions (podium and list) MUST display the total points** accumulated by the participant.

Visible animation MUST never be the only state signal. The letter draw, Stop transition, category progression, and podium reveal MAY animate, while `prefers-reduced-motion: reduce` MUST simplify or remove those animations and decorative background movement. Status changes MUST be announced through accessible text/live regions without stealing focus.

## Prototype Alignment

The provided Lovable preview URL redirected to an authentication bridge, but supplied screenshots
verify the visual direction described above. The screenshots are treated as a UX reference only;
the functional specification remains the source of truth for multiplayer behavior.

Required follow-up for visual alignment:

- Capture any missing lobby and review states if the prototype evolves.
- Record typography, color tokens, spacing, responsive breakpoints, and primary control hierarchy.
- Map each visual state to the WebSocket states in `contracts/realtime-events.md`.
- Add visual regression coverage for the letter draw, Stop transition, responsive scoreboard, and reduced-motion mode.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A constituição ratificada exige clean code, testes, separação de responsabilidades e backend autoritativo. O scaffold mantém esses gates com domínio TypeScript isolado, contratos WebSocket e testes Vitest. Cloudflare Pages hospeda o frontend e Workers hospeda o backend.

## Project Structure

### Documentation (this feature)

```text
specs/001-stop-multiplayer/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── app/
├── features/stop/
│   ├── components/
│   ├── state/
│   ├── scoring/
│   └── realtime/
└── shared/

backend/
├── src/
│   ├── index.ts
│   ├── game-room.ts
│   └── domain/
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── README.md

.github/workflows/
├── deploy-pages.yml
└── deploy-worker.yml

tests/
├── integration/
└── e2e/
```

**Structure Decision**: Manter o frontend na raiz e adicionar `backend/` como Worker Cloudflare TypeScript independente. O workflow `deploy-pages.yml` publica o frontend; `deploy-worker.yml` executa `wrangler deploy`. O Worker roteia conexões WebSocket para Durable Objects; cada Durable Object representa uma sala e persiste a sessão em SQLite. O pacote `domain` concentra regras puras e `game-room.ts` concentra estado serializado e transporte.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Nenhuma | N/A | O Worker e o Durable Object são o backend autoritativo necessário para uma partida multiplayer confiável. |

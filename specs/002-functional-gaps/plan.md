# Implementation Plan: Functional Gaps for Stop Multiplayer

**Branch**: `develop` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Functional gap assessment in [spec.md](./spec.md), based on the current implementation and the original Stop multiplayer requirements.

## Summary

Close the end-to-end gaps preventing a reliable multiplayer game: establish one room identity from creation through joining, restore a room-scoped player session on reconnect, make configuration and round progression server-authoritative, validate responses and votes consistently, persist active-round state across Durable Object restarts, and surface server outcomes in the UI. Keep the existing React/Vite frontend, Cloudflare Worker/Durable Object backend, and shared TypeScript contracts. The host explicitly confirms each intermediate next round; all timing, voting, scoring, and phase transitions remain authoritative in the room Durable Object.

## Technical Context

**Language/Version**: TypeScript 5.8+, React 19, browser runtime and Cloudflare Workers runtime

**Primary Dependencies**: React 19, Vite 6, Cloudflare Workers/Durable Objects, Wrangler 4, Vitest 5, `@cloudflare/vitest-plugin`, React Testing Library, and Playwright for browser-level multiplayer validation

**Storage**: SQLite-backed Durable Object storage; persist room configuration, temporary room-scoped player credentials, current round answers/votes, deadlines, idempotent transition state, last activity, and expiration deadline

**Testing**: Vitest for scoring/domain and Worker/contract behavior; Wrangler local runtime for Durable Object integration; Playwright with two isolated browser contexts for end-to-end flows; keyboard and reduced-motion checks

**Target Platform**: Static React/Vite application on GitHub Pages; Cloudflare Worker with one SQLite-backed Durable Object per room

**Project Type**: Multiplayer web application with a server-authoritative realtime backend

**Performance Goals**: Broadcast a room/phase change to all room members within 3 seconds; keep room state consistent for up to 20 active players

**Constraints**: Durable Object is authoritative for identity, host rights, phase, deadlines, answers, votes, scoring, and ranking; frontend contains no server credentials; player identity is temporary and scoped to one room; room capacity is 20 active players; protocol changes require explicit compatibility behavior; no global accounts or ranking

**Scale/Scope**: One active game per room, up to 20 active players, 12 functional-gap items, two application packages (`frontend/`, `backend/`) and shared wire types in `shared/`

## Decisions and Assumptions

- Use the existing Worker `POST /rooms` as the single room-code allocator. The Worker routes the create command to the Durable Object keyed by that code; the room uses that same code and rejects joins if it has not been initialized. Remove the second, conflicting code generation in the room.
- Use an opaque temporary resume credential scoped to the room and player. Issue it only to that player, store its verifier in Durable Object storage, and have the client explicitly resume after opening a new WebSocket. Do not use nickname as an identity or put credentials in URLs.
- Interpret lobby duration choices as 60, 90, 120 seconds, or no deadline (`0`); no-deadline rounds end only through STOP. The server sends an optional absolute deadline and schedules no round alarm when time is unlimited.
- Keep category review at the existing 30-second deadline per category. Unstarted/inactive rooms expire after 24 hours without valid activity; completed rooms expire one hour after `GAME_OVER`. Active-round and review deadlines are not overridden by idle expiration.
- Validate nicknames at 24 Unicode code points, category names at 40 Unicode code points, and allow 1-20 categories; apply the same limits on client and server.
- Default allowed letters to A-Z and apply host exclusions server-side; never permit an empty allowed-letter set.
- Apply the constitution's scoring rule: valid unique answers earn 10 points; valid repeated answers earn 5; empty/wrong-letter answers earn 0; invalidation between 10% and 50% inclusive halves the otherwise-earned category score; more than 50% invalidation earns 0. Exclude the answer author from the eligible-voter denominator. Keep the score numeric so a halved duplicate score can be represented exactly.
- A round result remains visible until the host sends the authorized next-round command. The server alone creates the next round; the final round transitions directly to final results.
- Use the existing `shared/types.ts` as the canonical command/event contract and eliminate drift from backend-local mirrors. Require `session:hello` with protocol version 1 before room mutations. Existing clients with incompatible message shapes are rejected with a stable protocol error and must reconnect using the deployed client; do not attempt silent semantic fallback.
- Reject WebSocket command payloads larger than 16 KiB before JSON parsing or state mutation. Keep a bounded cache of the most recent 4,096 request IDs per room; command semantics must also be idempotent or safely rejected after cache eviction.
- Persist serializable round state as plain records/arrays rather than relying on in-memory `Map`/`Set` state. Persist score application/transition markers so alarms, retries, and reconnections cannot apply a category or round twice.
- Keep tests focused on existing packages. Reuse backend Vitest; add only the test dependencies/configuration needed for Worker integration and frontend/browser validation (Playwright is required for the two-context E2E scenarios).

## Constitution Check

| Principle / gate | Plan compliance |
|---|---|
| Clean code and clear boundaries | Pass. Pure validation/scoring remains in backend domain modules; Worker routing, room state, shared contracts, and React presentation stay separated. |
| Testable behavior first | Pass. Each state-changing behavior has contract/domain coverage; multiplayer flows use two independent browser contexts. |
| Server-authoritative multiplayer | Pass. Client requests actions; only the Durable Object validates and commits phase, deadline, votes, score, and ranking. Commands are request-correlated, idempotent or safely rejected. |
| Secure and minimal data handling | Pass. Resume credentials are temporary, room-scoped, private to the owner, and excluded from URLs/logs. Validate payload sizes, nickname/category limits, ownership, phase, and capacity. |
| Simplicity and observable delivery | Pass. Preserve the current deployment topology and add no global service or account system. Stable safe errors, structured logs, and repeatable package builds/tests are included. |
| Platform and scale constraints | Pass. Keep GitHub Pages + Worker + SQLite-backed Durable Objects, WSS in production, one game per room, max 20 active players. |
| Scoring policy | Pass. The constitution resolves the earlier ambiguity in the gap assessment: half-score at 10%-50% inclusive, zero above 50%. |

**Gate result**: PASS. The one product decision required by the gap assessment—who advances an intermediate round—was answered for this plan: the host confirms the next round.

## Implementation Approach

Implement in dependency order:

1. Canonicalize shared protocol and room creation/join identity.
2. Add temporary player resume credentials and authoritative snapshots after reconnect.
3. Make lobby settings authoritative, including rounds, time, and allowed letters.
4. Validate answer submissions and make Stop/deadline a single server-side cutoff.
5. Replace ambiguous invalidation toggles with explicit votes, compute eligibility and threshold from the constitution, and synchronize category completion and incremental scores.
6. Add host-confirmed next-round command, final-round completion, and idempotent phase transitions.
7. Persist/restore in-progress round data and alarms; apply host succession and complete phase/role guards.
8. Wire request acknowledgements/errors and loading/confirmed UI state; remove demo fallbacks from active game screens.
9. Add unit, contract, Worker integration, two-client E2E, keyboard, and reduced-motion coverage.

Deliver each stage with focused tests before moving to the next. Protocol/schema changes are introduced before their consumers; server behavior is completed before UI depends on new events.

## Project Structure

### Documentation (this feature)

```text
specs/002-functional-gaps/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── realtime-events.md
```

### Source Code (repository root)

```text
shared/
└── types.ts                         # Canonical realtime commands/events and shared entities

backend/
├── src/
│   ├── index.ts                     # Worker HTTP and room-code routing
│   ├── game-room.ts                 # Durable Object lifecycle, commands, alarms and broadcasts
│   ├── scoring.ts                   # Pure validation, invalidation and score calculations
│   ├── types.ts                     # Compatibility re-exports or removal after shared adoption
│   ├── domain/
│   │   └── game-room.ts             # Pure domain rules where independently testable
│   └── test/
│       ├── scoring.test.ts
│       ├── game-room.test.ts
│       └── contracts.test.ts
└── package.json

frontend/
├── src/
│   ├── App.tsx                      # Screen orchestration and command callbacks
│   ├── hooks/useGameSocket.ts       # Connection, resume, request correlation and event state
│   ├── types.ts                     # Re-export canonical shared types
│   └── screens/                     # Entry, lobby, game, review and final result UI
├── e2e/
│   └── multiplayer.spec.ts          # Two independent browser contexts
└── package.json
```

**Structure Decision**: Preserve the actual two-package application layout and current deploy topology. `shared/types.ts` becomes the single source of truth for transport types. Domain behavior remains testable outside the Durable Object runtime; Durable Object persistence/alarms and frontend integration receive separate tests.

## Constitution Check (Post-Design)

- Shared event and command changes are specified before implementation; unsupported old payloads receive explicit protocol errors.
- The room Durable Object is the only source of truth; client-only optimistic progression and client-side scoring are removed.
- Persistence contains only temporary room/game state and scoped session verifiers; no global profile or ranking is introduced.
- Test scope covers pure scoring, transport contracts, DO restart/alarms, and the full two-player path.
- No constitution violations or additional architectural project are introduced.

**Post-design gate result**: PASS.

## Complexity Tracking

No constitution violations. Adding a room-scoped resume credential and serializable round snapshot is necessary to meet reconnection and Durable Object recovery requirements; a global identity service or external database was rejected as unnecessary for the MVP.

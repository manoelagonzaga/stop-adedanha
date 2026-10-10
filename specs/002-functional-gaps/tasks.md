---
description: "Executable implementation task list for the functional gaps feature"
---

# Tasks: Functional Gaps for Stop Multiplayer

**Input**: Design documents from `specs/002-functional-gaps/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/realtime-events.md](./contracts/realtime-events.md), [quickstart.md](./quickstart.md)

**Organization**: The 12 gaps in the feature spec are mapped to twelve implementation stories (US1-US12). Work is ordered by dependency first; where a P0 gap depends on a P1 prerequisite (for example, authoritative settings before timed rounds), the prerequisite is scheduled first.

**Tests**: Included because the constitution requires automated coverage for new behavior, scoring/phase boundaries, contract changes, and multiplayer flows.

## Phase 1: Setup

**Purpose**: Make the existing package-level test commands executable and establish test configuration before feature work.

- [X] T001 [P] Configure backend `test` and `lint` scripts, Vitest with the Cloudflare Workers pool for Durable Object tests, and ESLint for TypeScript in `backend/package.json`, `backend/package-lock.json`, `backend/vitest.config.ts`, and `backend/eslint.config.js`
- [X] T002 [P] Configure frontend `test` and `test:e2e` scripts, Vitest/React test setup, and Playwright for browser tests in `frontend/package.json`, `frontend/package-lock.json`, `frontend/vitest.config.ts`, and `frontend/playwright.config.ts`

---

## Phase 2: Foundational

**Purpose**: Establish the canonical protocol, validation, errors, and request correlation needed by every user story.

- [X] T003 Define the version-1 WebSocket command/event unions, request/ack/error shapes, room settings and session event types in `shared/types.ts`; make `frontend/src/types.ts` and `backend/src/types.ts` re-export the canonical definitions; align `specs/002-functional-gaps/spec.md` with the resolved scoring rule (author excluded; 10%-50% half score; above 50% zero) and correct its references to local artifacts
- [X] T004 [P] Add contract tests for protocol-version negotiation, unknown commands, malformed/oversized payloads, stable error codes, and requestId correlation in `backend/src/test/contracts.test.ts`
- [X] T005 Implement `session:hello`, protocol-version enforcement, 16 KiB maximum command payload, safe error responses, and bounded per-player requestId deduplication in `backend/src/game-room.ts`

**Checkpoint**: Shared contract and executable backend tests are ready; no feature command may mutate a room before protocol negotiation.

---

## Phase 3: User Story 1 — Unificar criação e ingresso na mesma sala (Priority: P0)

**Goal**: A displayed room code always routes host and joiners to the same initialized Durable Object; unknown codes fail instead of creating empty rooms.

**Independent Test**: Create a room in one client, join its exact displayed code from a second client, then attempt a random code and verify an explicit `ROOM_NOT_FOUND`.

### Tests for User Story 1

- [X] T006 [P] [US1] Add Worker/room tests for room allocation, code normalization, create-code identity, duplicate creation, successful join, and uninitialized-code rejection in `backend/src/test/game-room.test.ts`

### Implementation for User Story 1

- [X] T007 [US1] Make `POST /rooms` allocate a code, detect an already-initialized Durable Object and retry allocation on collision, initialize using the same routing key, and return the canonical code in `backend/src/index.ts`
- [X] T008 [US1] Store the URL room code on create, reject create collisions, and return `ROOM_NOT_FOUND` when `room:join` targets an uninitialized room in `backend/src/game-room.ts`
- [X] T009 [US1] Replace the frontend temporary-code flow with `POST /rooms` followed by WebSocket create, and show/share only the server-allocated code in `frontend/src/App.tsx`
- [X] T010 [US1] Handle allocation and `ROOM_NOT_FOUND` errors with recoverable feedback and preserve the submitted nickname/code in `frontend/src/screens/EntryScreen.tsx`

**Checkpoint**: Two clients join one room by code; random room codes do not silently initialize joinable rooms.

---

## Phase 4: User Story 2 — Preservar identidade ao reconectar (Priority: P0)

**Goal**: A reconnect restores the same player and complete authoritative room/round state without creating a duplicate seat.

**Independent Test**: Disconnect and reconnect a client in lobby, active round, and category review; verify player ID, score, permissions, answers, active phase, and deadline are restored.

### Tests for User Story 2

- [X] T011 [P] [US2] Add tests for private token delivery, invalid/expired token rejection, token rotation, duplicate-session handling, and same-player resume in `backend/src/test/game-room.test.ts`

### Implementation for User Story 2

- [X] T012 [US2] Issue cryptographically random room-scoped resume tokens, persist only verifiers with owner/expiry metadata, and emit private `room:joined` or `session:resumed` events in `backend/src/game-room.ts`
- [X] T013 [US2] Rebind a resumed WebSocket to the existing player and replay the phase-specific round/review/results event after sending the authoritative snapshot in `backend/src/game-room.ts`
- [X] T014 [US2] Save and rotate the resume credential per room, send `session:hello` and `session:resume` on reconnect, and restore the player state in `frontend/src/hooks/useGameSocket.ts`
- [X] T015 [US2] Add reconnect UI state and recoverable invalid-session handling without creating a second player in `frontend/src/App.tsx`

**Checkpoint**: Repeated reconnects retain one room-scoped identity and do not lose in-progress game state.

---

## Phase 5: User Story 3 — Tornar configurações básicas autoritativas (Priority: P1)

**Goal**: The server validates host-only categories and round count and refuses invalid starts.

**Independent Test**: Change categories and rounds as host and observe matching snapshots; attempt invalid/duplicate configuration and start from a non-host or with fewer than two active players.

### Tests for User Story 3

- [X] T016 [P] [US3] Add tests for host/phase validation, round bounds, category normalization/uniqueness, and the two-active-player start minimum in `backend/src/test/game-room.test.ts`

### Implementation for User Story 3

- [X] T017 [US3] Enforce category limits (1-20 categories; trimmed non-empty names up to 40 Unicode code points, unique case-insensitively) and nickname limit (24 Unicode code points) in `backend/src/game-room.ts`
- [X] T018 [US3] Validate `lobby:rounds:update` as an integer from 1 through 20, allow it only for the host in `CONFIGURING`, and require two active players plus valid configuration in `backend/src/game-room.ts`
- [X] T019 [US3] Send round-count changes to the server and remove the local-only optimistic value in `frontend/src/App.tsx`
- [X] T020 [US3] Render configuration from confirmed room snapshots and show validation errors without reporting rejected settings as saved in `frontend/src/screens/LobbyScreen.tsx`

**Checkpoint**: Host-only validated settings are shared; invalid settings cannot start a game even through a crafted socket command.

---

## Phase 6: User Story 4 — Aplicar tempo e letras permitidas no servidor (Priority: P1)

**Goal**: Lobby time and allowed-letter settings are persisted and used consistently by the backend and all clients.

**Independent Test**: Select each duration and exclude letters; start a round and verify all clients receive the same letter/deadline and excluded letters are never selected.

### Tests for User Story 4

- [X] T021 [P] [US4] Add tests for allowed duration values (60, 90, 120, 0), A-Z defaults, non-empty allowed-letter validation, server letter draw, absent deadline for unlimited mode, and the 30-second review deadline per category in `backend/src/test/game-room.test.ts`

### Implementation for User Story 4

- [X] T022 [US4] Persist `roundDurationSeconds` and `allowedLetters`, validate host-only updates in `CONFIGURING`, and draw from the resulting A-Z set in `backend/src/game-room.ts`
- [X] T023 [US4] Include duration and allowed letters in room creation/update commands, and remove local-only letter rerolls from `frontend/src/App.tsx` and `frontend/src/screens/GameScreen.tsx`
- [X] T024 [US4] Initialize Lobby controls from authoritative settings and send updates instead of keeping unsynced component-only values in `frontend/src/screens/LobbyScreen.tsx`
- [X] T025 [US4] Derive countdown display from the server deadline and support no-deadline rounds without starting a local timeout in `frontend/src/screens/GameScreen.tsx`

**Checkpoint**: Duration and allowed-letter policies cannot diverge between host, participants, and server.

---

## Phase 7: User Story 5 — Validar respostas e corte de Stop/timeout (Priority: P0)

**Goal**: The backend validates every answer and defines one deterministic cutoff when Stop or the configured deadline closes submissions.

**Independent Test**: Submit valid, blank, wrong-letter, stale-round, unknown-category, inactive-player, and late answers; race final submission against Stop and verify one authoritative transition.

### Tests for User Story 5

- [X] T026 [P] [US5] Add tests for `passesLetterCheck`, empty/wrong-letter scoring, player/round/category validation, deadline boundaries, and Stop-versus-submit ordering in `backend/src/test/scoring.test.ts` and `backend/src/test/game-room.test.ts`

### Implementation for User Story 5

- [X] T027 [US5] Validate player status, active phase, exact round ID, allowed category IDs, and server deadline before storing normalized answers in `backend/src/game-room.ts`
- [X] T028 [US5] Set automatic validity with `passesLetterCheck`, reject edits after the single Stop/timeout cutoff, and make Stop/timeout transition idempotently to review in `backend/src/game-room.ts`
- [X] T029 [US5] Flush answer snapshots as they change and before Stop, disable further editing after local Stop, and use the server deadline instead of a client timeout in `frontend/src/screens/GameScreen.tsx`

**Checkpoint**: Blank/wrong-letter answers score zero, late/foreign commands cannot mutate the round, and clients agree on the closure point.

---

## Phase 8: User Story 6 — Corrigir voto e regra de invalidação (Priority: P0)

**Goal**: Votes target an unambiguous answer, exclude its author, and use the constitution's percentage scoring thresholds.

**Independent Test**: Exercise below 10%, exactly 10%, exactly 50%, and above 50% invalidation ratios with the author excluded; confirm 10/5 base scoring then half/zero outcomes.

### Tests for User Story 6

- [X] T030 [P] [US6] Add scoring tests for 10/5/0 base points, duplicate normalization, invalidation ratios below 10%, 10%, 50%, above 50%, and author exclusion in `backend/src/test/scoring.test.ts`
- [X] T031 [P] [US6] Add room-command tests for hyphenated player IDs, self-vote rejection, voter eligibility, wrong-category rejection, and repeated requestId behavior in `backend/src/test/game-room.test.ts`

### Implementation for User Story 6

- [X] T032 [US6] Replace majority-only invalidation with eligible-voter ratio scoring: half score at 10%-50% inclusive and zero above 50%, excluding the author, in `backend/src/scoring.ts`
- [X] T033 [US6] Replace delimiter-parsed `answer:invalidate` with explicit `answer:vote` target fields and validate active category, author, eligibility, and request idempotency in `backend/src/game-room.ts`
- [X] T034 [US6] Render per-answer vote decisions, disable self-voting, and send explicit `valid`/`invalidate` decisions without client-side final scoring in `frontend/src/screens/ResultsScreen.tsx`

**Checkpoint**: Vote identity is unambiguous for UUIDs; server score boundaries match the constitution and unit tests.

---

## Phase 9: User Story 7 — Sincronizar avaliação por categoria e placar parcial (Priority: P1)

**Goal**: All clients follow the server's active category and receive committed cumulative scores exactly once per category.

**Independent Test**: Reach each category on two clients, finish voting early and via timeout, and verify both active index/deadline and the same incrementally updated score.

### Tests for User Story 7

- [X] T035 [P] [US7] Add tests for category completion when all eligible decisions arrive, timeout completion with missing votes treated as agreement, sequential event order, and once-only score commits in `backend/src/test/game-room.test.ts`

### Implementation for User Story 7

- [X] T036 [US7] Persist explicit decisions and eligible voters, advance only when all required decisions arrive or the category deadline expires, and broadcast the next category from `backend/src/game-room.ts`
- [X] T037 [US7] Commit category points once and include per-category deltas plus authoritative cumulative scoreboard in `round:review:score_update` from `backend/src/game-room.ts`
- [X] T038 [US7] Update client review state only from server events and remove local category-tab navigation and duplicate cumulative score calculation in `frontend/src/hooks/useGameSocket.ts` and `frontend/src/screens/ResultsScreen.tsx`
- [X] T039 [US7] Render confirmed partial ranking and current category/deadline from server-provided state in `frontend/src/screens/ResultsScreen.tsx`

**Checkpoint**: No client can skip categories or derive a conflicting leaderboard; score updates are committed once.

---

## Phase 10: User Story 8 — Avançar rodadas com confirmação do anfitrião (Priority: P0)

**Goal**: Intermediate results remain visible until the host requests the next round; the server starts the next round once and finishes after the final round.

**Independent Test**: Complete an intermediate round, verify non-host advance is rejected and host advance starts one shared next round, then complete the final round and verify all clients see final results.

### Tests for User Story 8

- [X] T040 [P] [US8] Add tests for `ROUND_RESULTS` host-only advancement, non-host rejection, duplicate/concurrent `round:next`, round numbering, and final-round completion in `backend/src/test/game-room.test.ts`

### Implementation for User Story 8

- [X] T041 [US8] Add `round:next` command and idempotent host/phase/round checks; create the next round or final ranking from the server in `backend/src/game-room.ts`
- [X] T042 [US8] Add the authorized next-round command to canonical shared types and preserve the `ROUND_RESULTS`/`GAME_OVER` event data in `frontend/src/hooks/useGameSocket.ts`
- [X] T043 [US8] Show and enable “Próxima Rodada” only for the host after authoritative results; send the command instead of changing screen locally in `frontend/src/screens/ResultsScreen.tsx` and `frontend/src/App.tsx`

**Checkpoint**: Multi-round matches progress only through host confirmation and cannot skip or double-start a round.

---

## Phase 11: User Story 9 — Recuperar rodada após reinício do Durable Object (Priority: P1)

**Goal**: A Durable Object restart preserves active round, answers, votes, deadlines, and exactly-once scoring.

**Independent Test**: Recreate the local Durable Object during answer and review phases, then verify restored state, alarm behavior, and unchanged cumulative score.

### Tests for User Story 9

- [X] T044 [P] [US9] Add storage-recreation tests for round answers/votes/stopper, review and round deadlines, scored-category markers, and expired-alarm replay in `backend/src/test/game-room.test.ts`

### Implementation for User Story 9

- [X] T045 [US9] Replace volatile-only round Maps/Sets with a serializable persisted round snapshot and once-only score/transition markers in `backend/src/game-room.ts`
- [X] T046 [US9] Restore room and round snapshot under `blockConcurrencyWhile` before processing socket commands or alarms, then reconcile expired deadlines once in `backend/src/game-room.ts`
- [X] T047 [US9] Restore the active UI view from post-restart authoritative snapshots and phase-specific events in `frontend/src/hooks/useGameSocket.ts`

**Checkpoint**: Eviction/restart cannot erase in-progress answers or double-apply a category/round score.

---

## Phase 12: User Story 10 — Tratar saída do anfitrião e permissões (Priority: P2)

**Goal**: Host departure promotes the oldest active player; all commands consistently enforce membership, role, phase, and active status.

**Independent Test**: Disconnect the host in lobby and between rounds; verify deterministic promotion and rejection of privileged commands from disconnected/non-host players.

### Tests for User Story 10

- [X] T048 [P] [US10] Add tests for host succession by `joinedAt`, no-active-player behavior, and phase/status guards across state-changing commands in `backend/src/test/game-room.test.ts`

### Implementation for User Story 10

- [X] T049 [US10] Track stable join order and promote the oldest eligible active player on host departure; if none is active, keep host-only commands blocked until a player resumes or the room expires; broadcast the authoritative host change in `backend/src/game-room.ts`
- [X] T050 [US10] Apply a shared command guard for player membership, active status, host role, and allowed phase before each mutation in `backend/src/game-room.ts`
- [X] T051 [US10] Reflect host changes and suspended/disabled actions in the lobby and results views using room snapshots in `frontend/src/screens/LobbyScreen.tsx` and `frontend/src/screens/ResultsScreen.tsx`

**Checkpoint**: Every room mutation has explicit authority and phase rules; host loss does not strand the lobby.

---

## Phase 13: User Story 11 — Exibir erros e confirmações reais (Priority: P2)

**Goal**: Rejected or unsent commands are visible and never appear as successful UI state; active screens contain no demo data.

**Independent Test**: Trigger room/configuration/permission errors and disconnect during a state-changing action; verify visible feedback and no false “saved” state or fabricated game screen.

### Tests for User Story 11

- [ ] T052 [P] [US11] Add frontend tests for pending request correlation, server error display, disconnected send behavior, and absence of mock active-game data in `frontend/src/App.test.tsx` and `frontend/src/hooks/useGameSocket.test.ts`

### Implementation for User Story 11

- [ ] T053 [US11] Track pending request IDs, return explicit send success/failure, and dispatch ack/error events into application state in `frontend/src/hooks/useGameSocket.ts`
- [ ] T054 [US11] Remove optimistic settings and demo fallback values; render loading, confirmed room state, or recoverable error instead in `frontend/src/App.tsx`
- [ ] T055 [US11] Replace unconditional “saved” feedback with pending/confirmed/rejected states and show safe server messages in `frontend/src/screens/LobbyScreen.tsx` and `frontend/src/screens/EntryScreen.tsx`

**Checkpoint**: All significant actions have truthful feedback; no screen presents placeholder game data as live state.

---

## Phase 14: User Story 12 — Cobrir fluxo completo e acessibilidade (Priority: P2)

**Goal**: Automated tests exercise the complete multi-client match and accessibility essentials; documented commands run real checks.

**Independent Test**: Run package tests, typechecks, lint, builds, and two-context E2E; navigate the game using keyboard and reduced-motion preference.

### Tests for User Story 12

- [ ] T056 [P] [US12] Add a two-browser-context E2E for room creation/join, settings, answers, Stop, sequential review, host-confirmed next round, and final podium in `frontend/e2e/multiplayer.spec.ts`
- [ ] T057 [P] [US12] Add browser accessibility assertions for keyboard focus after Stop/category/result transitions and `prefers-reduced-motion` behavior in `frontend/e2e/accessibility.spec.ts`

### Implementation for User Story 12

- [ ] T058 [US12] Add any missing E2E fixtures/selectors and stable accessible status announcements for realtime phase changes in `frontend/src/App.tsx`, `frontend/src/screens/GameScreen.tsx`, `frontend/src/screens/ResultsScreen.tsx`, and `frontend/src/screens/PodiumScreen.tsx`
- [ ] T059 [US12] Complete Worker integration scenarios for two clients, reconnect, alarm expiry, and Durable Object restoration in `backend/src/test/game-room.test.ts`
- [ ] T060 [US12] Update the runnable test/build commands and expected outcomes to match the implemented scripts in `specs/002-functional-gaps/quickstart.md`

**Checkpoint**: The complete feature is reproducibly validated with real package scripts and two independent clients.

---

## Phase 15: Polish & Cross-Cutting Concerns

**Purpose**: Verify the integrated system against all design artifacts and quality gates.

- [ ] T061 [P] Add room-expiration tests for idle unstarted rooms and completed games, ensuring active round alarms take precedence, in `backend/src/test/game-room.test.ts`
- [ ] T062 Implement room idle/completion expiration and multiplex room-expiry alarms with round/review deadlines in `backend/src/game-room.ts`
- [ ] T063 Document the room lifetime policy and expiration validation scenario in `specs/002-functional-gaps/data-model.md` and `specs/002-functional-gaps/quickstart.md`
- [ ] T064 [P] Run backend tests, lint, typecheck, and build; resolve failures caused by the implementation in `backend/package.json` and `backend/src/`
- [ ] T065 [P] Run frontend tests, lint, and production build; resolve failures caused by the implementation in `frontend/package.json` and `frontend/src/`
- [ ] T066 Run the complete `specs/002-functional-gaps/quickstart.md` validation, confirm all 12 independent test criteria, and reconcile contracts/model/spec with final behavior in `specs/002-functional-gaps/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 and T002 can run in parallel; no feature behavior depends on either package-specific test configuration.
- **Foundational (Phase 2)**: Depends on Setup. T003 establishes shared types; T004 defines protocol tests and T005 implements the tested session guard. Blocks all user stories.
- **User Stories (Phases 3-14)**: Depend on Foundational. Execute in dependency order; P0 work follows any explicitly required configuration/session prerequisite.
- **Polish (Phase 15)**: Depends on all desired stories being complete.

### User Story Dependencies

- **US1 (P0)**: No story dependency after Foundation; establishes canonical room identity.
- **US2 (P0)**: Depends on US1 for stable room/player association and connection flow.
- **US3 (P1)**: Depends on US1 for initialized rooms; host identity is stable for the lifetime of a socket, while US2 adds reconnect continuity.
- **US4 (P1)**: Depends on US3's authoritative configuration commands.
- **US5 (P0)**: Depends on US3/US4 for valid settings and deadline; starts server-authoritative rounds.
- **US6 (P0)**: Depends on US5's validated answers and round identity.
- **US7 (P1)**: Depends on US6's explicit vote/score semantics.
- **US8 (P0)**: Depends on US7's committed round result.
- **US9 (P1)**: Depends on the persisted-state shape from US5-US8.
- **US10 (P2)**: Depends on stable player/session/command guards from US2-US3.
- **US11 (P2)**: Depends on request/ack/error contracts from Foundation and command flows from US1-US10.
- **US12 (P2)**: Depends on all user-visible flows and scripts in prior phases.

### Dependency Graph

```text
Setup (T001, T002)
  -> Foundation (T003 -> T004 -> T005)
    -> US1 (T006 -> T007 -> T008 -> T009, T010)
      ├─> US2 (T011 -> T012 -> T013 -> T014, T015)
      └─> US3 (T016 -> T017, T018 -> T019, T020)
            -> US4 (T021 -> T022 -> T023, T024, T025)
              -> US5 (T026 -> T027, T028 -> T029)
                -> US6 (T030, T031 -> T032 -> T033 -> T034)
                  -> US7 (T035 -> T036 -> T037 -> T038 -> T039)
                    -> US8 (T040 -> T041 -> T042 -> T043)
                      -> US9 (T044 -> T045 -> T046 -> T047)
    US10 (T048 -> T049, T050 -> T051) after US2/US3
    US11 (T052 -> T053 -> T054, T055) after Foundation and command flows
    US12 (T056, T057 -> T058, T059 -> T060)
    Polish (T061 -> T062 -> T063 -> T064, T065 -> T066) after US9
```

### Parallel Opportunities

- Setup: T001 and T002 modify separate package manifests/configs.
- Shared contracts: T004 contract tests can be authored independently after T003; implementation tasks that touch the same `game-room.ts` are intentionally sequential.
- US6: T030 pure scoring tests and T031 command validation tests use separate test files and can run in parallel.
- US12: T056 multiplayer E2E and T057 accessibility E2E use separate test files and can be authored/run in parallel once feature flows exist.
- Room lifecycle: T061 expiration tests precede T062's alarm/TTL implementation; T063 documents the policy after the durable round-alarm work in US9.
- Polish: T064 backend and T065 frontend validations run in parallel; T066 is the final cross-artifact verification.

## Implementation Strategy

### MVP First

Because the feature repairs an existing incomplete game, the smallest useful playable slice is **Foundation + US1 + US3 + US4 + US5 + US6 + US7 + US8**: two clients can create/join one room, configure it, play and validate a round, and complete a host-confirmed multi-round match. US2 reconnect and US9 crash recovery are required for reliability before production release, even though they are not prerequisites for the first local demo.

### Incremental Delivery

1. Complete Setup and Foundation; verify both package test commands execute.
2. Complete US1; prove create/join room identity with two clients.
3. Complete US3-US8; prove the entire online match and authoritative scoring.
4. Complete US2 and US9; prove reconnection and Durable Object recovery.
5. Complete US10-US12; finish host-loss behavior, honest UI feedback, E2E, accessibility, and room expiration.
6. Complete Polish; run all documented gates.

### Notes

- [P] means the task uses separate files and does not depend on an unfinished task in its phase.
- Every user-story task includes its story label and concrete workspace path.
- Tests are specified before the corresponding implementation tasks.
- No tests are implied to pass until the implementation phase runs the listed package commands.

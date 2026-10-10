# Research: Functional Gaps for Stop Multiplayer

## Decision 1 — One canonical room identifier

**Decision:** Keep `POST /rooms` as the Worker-side room-code allocator, use the allocated code as the Durable Object name, and carry that same code into room initialization. A Durable Object with no initialized room must reject a join rather than creating an empty room.

**Rationale:** The current Worker already allocates a code for `POST /rooms`, while the Durable Object independently generates another one during `room:create`. Reusing the Worker code removes the collision between two authorities and preserves the current URL shape. An uninitialized object can distinguish an unknown code from a real room by checking its persisted room state.

**Alternatives considered:** Generate a second code inside the Durable Object (current behavior; rejected because it disagrees with the routing key); introduce a global room registry (rejected as extra storage/service not needed for this MVP).

## Decision 2 — Room-scoped reconnect credential

**Decision:** Issue an opaque temporary credential after successful create/join, scoped to a room and player. Keep the credential out of the URL, persist a verifier in the room Durable Object, and require an explicit resume command after reconnect.

**Rationale:** The current server creates a new random player ID for every WebSocket and the frontend reconnects without rejoining. A private room-scoped credential lets the room restore the existing player without relying on a mutable nickname or introducing accounts.

**Alternatives considered:** Treat the WebSocket connection ID as the player identity (rejected; it changes on reconnect); use nickname as identity (rejected; it is user-controlled and non-secret); place the credential in a query string (rejected because URLs are commonly logged).

## Decision 3 — Authoritative configuration and deadlines

**Decision:** Store round count, selected round duration, and allowed-letter exclusions in room state. Accept only the existing UI choices (3/5/8/10 rounds; 60/90/120 seconds or no limit) and validate them again in the Durable Object. The default allowed-letter set is A-Z; exclusions are applied by the server. Send an absolute deadline when a timer is enabled; omit it for no-limit games. Keep the current 30-second review deadline per category.

**Rationale:** The current lobby already exposes these choices, but time and letter selection are component-local and the server uses a separate fixed duration/letter set. Restricting values to choices already in the UI avoids inventing new product options. A missing deadline gives “Sem Fim” a direct, deterministic meaning; STOP still ends the round.

**Alternatives considered:** Arbitrary numeric times (rejected for this plan because no UI/requirements define bounds); client timer authority (rejected by the constitution); treat no-limit as a very long timeout (rejected because it is not semantically unlimited); changing the review timer (rejected because the current implementation already defines 30 seconds and no requirement requests a different value).

## Decision 4 — Input and configuration bounds

**Decision:** Limit nicknames to 24 Unicode code points, category names to 40 Unicode code points, and categories to 1-20 per game. Trim before validation; compare nicknames and categories case-insensitively where uniqueness applies.

**Rationale:** The constitution requires server-side message, nickname, and category limits, while the existing product documents no numeric limits. These conservative bounds are compatible with the current UI and keep room broadcasts predictable. Enforce the same bounds in the frontend for feedback and in the backend for authority.

**Alternatives considered:** Rely on client-only validation (rejected because clients can be bypassed); leave payloads unbounded (rejected by the constitution); impose a larger schema or per-room tuning (rejected as unnecessary configurability).

## Decision 5 — Invalidation threshold and score

**Decision:** Follow the constitution's scoring thresholds: invalidation ratio from 10% through 50% inclusive halves the category score; above 50% gives zero. Count only eligible active voters and exclude the answer author, who is not permitted to vote. Empty or wrong-letter responses have zero before invalidation.

**Rationale:** The gap spec and original data model conflict on partial invalidation, but the constitution is explicit on the score thresholds and governs implementation. The data model excludes the author from the eligible-voter denominator, consistent with the self-vote prohibition. This also replaces the prior majority-only helper. Store eligible voters and votes so threshold computation is deterministic for that category.

**Alternatives considered:** Binary majority invalidation (rejected because it conflicts with constitution); apply a percentage to uniqueness after all scoring (rejected because constitution defines the effect on category score); count the author in the denominator (rejected because the author cannot vote and is not eligible).

## Decision 6 — Explicit vote records and deterministic category completion

**Decision:** Model each eligible player's choice as an explicit per-answer decision (`valid` or `invalidate`) for the active category. A category completes when all eligible voters have decided or its deadline expires; missing decisions count as agreement. The server emits category state and committed scores, then advances sequentially.

**Rationale:** The existing UI only sends invalidation toggles. It cannot distinguish “not voted yet” from “concord by omission” while all-vote completion is required. Explicit decisions make completion, self-vote rejection, and retries testable.

**Alternatives considered:** Keep a list of invalidation toggles and wait only for timeout (rejected because players cannot complete review early); count each click as a vote without a decision record (rejected because duplicate/retried commands are ambiguous).

## Decision 7 — Host-confirmed intermediate round transition

**Decision:** After an intermediate round is fully scored, show the round result and wait for an authorized host command to start the next round. The final round transitions to final results automatically after scoring.

**Rationale:** The gap assessment identified this as a product decision. The user selected host confirmation. It aligns with the existing UI's “Próxima Rodada” action while retaining server authority and avoiding different clients starting duplicated rounds.

**Alternatives considered:** Automatically start the next round immediately (rejected by the user's selection); allow any player to advance (rejected because it creates competing requests and does not match host-only start/configuration).

## Decision 8 — Durable Object recovery and idempotency

**Decision:** Persist current round data in a serializable snapshot and persist score/transition completion markers. Restore state before accepting commands; reconcile an elapsed alarm once and broadcast the resulting authoritative snapshot.

**Rationale:** Current room phase is persisted, but answers, votes, and stopper data exist only in memory. SQLite-backed Durable Object storage survives instance eviction, while serializable data structures are straightforward to restore and test. Markers prevent alarm retries or duplicate commands from scoring twice.

**Alternatives considered:** Reconstruct round state from room phase alone (rejected because answers/votes are lost); rely on the in-memory Maps and Sets (rejected because they do not survive object recreation); add an external database (rejected as unnecessary).

## Decision 9 — Shared contract and compatibility

**Decision:** Make `shared/types.ts` canonical. The first command is `session:hello` with `protocolVersion: 1`; the server rejects unsupported versions before room mutations. Reject command payloads over 16 KiB before parsing. Keep a bounded cache of the 4,096 most recent request IDs per room; commands must remain idempotent or safely rejected after an ID is evicted.

**Rationale:** Current frontend, shared, and backend event unions already drift (`session:ready` exists only in runtime behavior, and `lobby:rounds:update` is absent from the shared command union). A single contract module prevents silent divergence. Explicitly rejecting unsupported payloads is safer than accepting old semantics.

**Alternatives considered:** Maintain separate mirrored type files (rejected because they already diverged); silently accept old and new payloads (rejected because scoring/phase semantics change).

## Decision 10 — Test layers

**Decision:** Use Vitest for domain and contract tests, a Cloudflare-compatible local Worker/Durable Object test harness for persistence/alarms, and Playwright with two isolated contexts for browser-level multiplayer. Validate keyboard flows and reduced-motion behavior in browser tests.

**Rationale:** Backend already has Vitest installed and scoring tests. The feature spans protocol, Durable Object lifecycle, and multiple clients, so pure unit tests alone cannot prove synchronization. Playwright is identified in existing project documentation but is not wired in the frontend package yet.

**Alternatives considered:** Manual testing only (rejected by the constitution); test only scoring functions (rejected because it misses transport/reconnect/phase bugs); one browser page with mocked room state (rejected because it does not test multiplayer synchronization).

## Decision 11 — Room expiration

**Decision:** Expire unstarted/inactive rooms after 24 hours without a valid room activity. Expire completed games one hour after `GAME_OVER`. Active-round and category-review deadlines continue to take precedence and are not shortened by idle expiration.

**Rationale:** The constitution requires room expiration after inactivity or completion, but does not prescribe durations. These fixed MVP defaults provide cleanup without adding per-room configuration; one hour preserves time to view final results, while a 24-hour idle window accommodates delayed lobby starts.

**Alternatives considered:** Never expire rooms (rejected by the constitution); expire immediately after final scoring (rejected because players need time to see results); add a configurable TTL (rejected as unnecessary product complexity for the MVP).

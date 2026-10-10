# Realtime Contract: Functional Gaps

This contract supersedes conflicting examples in the original realtime document for the new client/server protocol. Transport remains a WebSocket per room through the Cloudflare Worker, backed by one Durable Object per room. `shared/types.ts` is the canonical TypeScript contract.

## Protocol rules

- Every command/event uses a stable `type` discriminant.
- Every mutating client command includes a unique `requestId`.
- WebSocket command payloads are limited to 16 KiB and oversized messages are rejected before parsing or mutation.
- The room retains the 4,096 most recent request IDs; mutation semantics remain idempotent or safely rejected after older IDs are evicted.
- Server validation is authoritative for identity, room membership, phase, permissions, deadlines, voting, scoring, and transition.
- A command is either committed once, safely rejected, or acknowledged as already processed; retries must not duplicate state changes.
- The first command is `session:hello` with protocol version 1. Unsupported versions receive `PROTOCOL_UNSUPPORTED`; mutations before successful negotiation receive `PROTOCOL_REQUIRED`.
- Errors include a stable `code`, safe user-facing `message`, and the originating `requestId` when available.
- Resume credentials are private to one player and must not appear in URLs, room snapshots, or broadcasts.
- Resume credentials expire 30 days after issue. A successful resume rotates the credential and revokes its predecessor.

## HTTP boundary

### `POST /rooms`

Allocates a canonical room code for a new room. The code is used as the Durable Object name and returned as JSON:

```json
{ "code": "AB12CD" }
```

The client connects to `/rooms/AB12CD` and sends `room:create`. Initialization records exactly `AB12CD` in the room. A collision or already-initialized room is rejected; the allocator may retry with a new code.

### `GET /rooms/:code` (WebSocket upgrade)

Routes the socket to the Durable Object identified by the normalized room code. A socket to an uninitialized code may connect at the transport layer but cannot join; `room:join` returns `ROOM_NOT_FOUND`.

## Client commands

### `session:hello`

Starts protocol negotiation and receives the connection/session status. This must be the first command on a socket; no room mutation is accepted before it succeeds.

```json
{ "type": "session:hello", "requestId": "h1", "protocolVersion": 1 }
```

### `room:create`

```json
{
  "type": "room:create",
  "requestId": "r1",
  "protocolVersion": 1,
  "nickname": "Ana",
  "totalRounds": 5,
  "roundDurationSeconds": 90,
  "allowedLetters": ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]
}
```

Creates the room in the Durable Object selected by the URL code, adds the sender as host, and returns a private resume credential.

### `room:join`

```json
{ "type": "room:join", "requestId": "r2", "protocolVersion": 1, "code": "AB12CD", "nickname": "Bia" }
```

Joins an initialized room during `CONFIGURING`. Reject unknown/closed rooms, duplicate nicknames, capacity overflow, or invalid phase. Mid-game return uses `session:resume`, not a new join. The response contains a private resume credential.

### `session:resume`

```json
{ "type": "session:resume", "requestId": "r3", "protocolVersion": 1, "resumeToken": "<opaque-room-scoped-token>" }
```

Rebinds the new WebSocket to the existing player, rotates/renews the credential as appropriate, and returns a complete authoritative snapshot for the current phase.

After `session:resumed`, the server replays the phase-specific event (`round:started`, `round:review:category`, or `round:results`) so the client receives current answers, category, and deadline without exposing those details in the general room snapshot.

### `lobby:categories:update`

```json
{ "type": "lobby:categories:update", "requestId": "r4", "categories": ["Nome", "Animal", "Comida"] }
```

Host-only during configuration. Names are trimmed, non-empty, unique case-insensitively, at most 40 Unicode code points, and the resulting list contains 1-20 categories.

### `lobby:rounds:update`

```json
{ "type": "lobby:rounds:update", "requestId": "r5", "totalRounds": 5 }
```

Host-only during configuration. Value is an integer from 1 through 20. Existing UI presets remain 3, 5, 8, and 10.

### `lobby:options:update`

```json
{ "type": "lobby:options:update", "requestId": "r6", "roundDurationSeconds": 90, "allowedLetters": ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"] }
```

Host-only during configuration. Duration is 60 (the default), 90, 120, or 0 (unlimited). `allowedLetters` must contain at least one unique uppercase letter from A-Z; the default is A-Z.

### `game:start`

```json
{ "type": "game:start", "requestId": "r7" }
```

Host-only. Requires at least two active players and valid categories/options. Server creates the first round, draws the letter, and sets an optional deadline.

### `answer:submit`

```json
{ "type": "answer:submit", "requestId": "r8", "roundId": "round-1", "answers": { "cat-0": "Ana", "cat-1": "Arara" } }
```

Clients may send incremental answer snapshots while a round is active. The server validates active membership, exact current round, known categories, text values, and the exclusive server deadline; it trims and uppercases each answer and marks it valid only when it is non-empty and starts with the round letter. Unknown categories or malformed values return `INVALID_ANSWER`; submissions for a stale/closed round or at/after the deadline return `ROUND_CLOSED`. A rejected snapshot is atomic and does not partially replace prior answers.

### `round:stop`

```json
{ "type": "round:stop", "requestId": "r9", "roundId": "round-1" }
```

Any active player may request Stop during `ROUND_ACTIVE`. The first serialized request before the deadline wins the bonus; the server closes submissions once and begins review. A submission processed before Stop is retained; submissions processed after the cutoff are rejected. If Stop arrives at/after the deadline, the server begins timeout review without awarding the Stop bonus.

### `answer:vote`

```json
{ "type": "answer:vote", "requestId": "r10", "roundId": "round-1", "categoryId": "cat-0", "answerPlayerId": "player-2", "decision": "invalidate" }
```

An eligible active voter sets an explicit `valid` or `invalidate` decision for a response in the active category. The author cannot vote on their response. Repeating the same request is idempotent; changing a vote is allowed only while that category remains active.

### `round:next`

```json
{ "type": "round:next", "requestId": "r11", "roundId": "round-1" }
```

Host-only after `ROUND_RESULTS` for a non-final round. The server starts exactly one next round; on the final round this command is rejected because the game has already finished.

## Server events

### `session:ready`

Confirms the negotiated protocol version and connection status. It does not yet grant room membership.

### `room:joined`

Private response to a successful create/join. Contains `requestId`, stable `playerId`, and an opaque resume token for that player only. The room snapshot is sent separately.

### `session:resumed`

Private response to a successful resume. Contains `requestId`, stable `playerId`, rotated resume token, and authoritative room snapshot. The phase-specific event is replayed immediately afterward.

### `room:state`

Authoritative room snapshot including phase, settings, player statuses/scores, current round metadata, category index and applicable deadline. Tokens and private answer/vote details are excluded.

### `command:ack`

Confirms a committed command with its `requestId`. The UI marks pending controls as saved only after this acknowledgement or a corresponding authoritative snapshot.

### `round:started`

Contains the stable round ID, round number, letter, category snapshot, and optional deadline. All clients receive the same values.

### `round:review:category`

Contains active category index/total, category, all players' answers for the category, current vote state relevant to the client, eligible-voter count, and optional deadline. Does not include private credentials.

### `round:review:score_update`

Contains category index, per-player category points, and authoritative accumulated scoreboard after that category is committed. A score update is emitted once per committed category; provisional client calculations are not authoritative.

### `round:results`

Contains all round answers, round points, and the accumulated ranking. For non-final rounds, phase becomes `ROUND_RESULTS` and the host may request the next round.

### `game:final_results`

Contains the authoritative top-three podium and remaining ranking list after the last round's scores have been committed.

### `player:presence`

Contains player ID, nickname, and `active`/`disconnected` status. Host succession is reflected through `room:state`.

### `error`

```json
{ "type": "error", "requestId": "r11", "code": "NOT_HOST", "message": "Somente o anfitrião pode iniciar a próxima rodada." }
```

## Error codes

At minimum: `INVALID_JSON`, `PROTOCOL_REQUIRED`, `PROTOCOL_UNSUPPORTED`, `INVALID_NICKNAME`, `ROOM_NOT_FOUND`, `ROOM_ALREADY_EXISTS`, `ROOM_FULL`, `DUPLICATE_NICKNAME`, `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `INVALID_CONFIGURATION`, `INVALID_PHASE`, `ROUND_CLOSED`, `INVALID_ANSWER`, `INVALID_VOTE`, `SELF_VOTE`, `ALREADY_PROCESSED`, and `SESSION_INVALID`.

## Contract invariants

- Only the server advances phases and computes deadlines, validity, score, and ranking.
- Lobby snapshots do not expose a live scoreboard or player list in the configuration UI.
- Game/review/final-result content is sourced from real server snapshots/events, never local demo fallbacks.
- Review proceeds in category order. Missing decisions count as agreement at timeout.
- Eligible-voter denominator excludes the author. Invalidation ratios from 10% through 50% inclusive halve category points; ratios above 50% score zero.
- The host confirms the next intermediate round; all clients observe the resulting `round:started`.
- Reconnect restores the same player and complete current room/round state.
- Unstarted/inactive rooms expire after 24 hours without valid activity; completed rooms expire one hour after `GAME_OVER`. Active round/review alarms take precedence.

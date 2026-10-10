# Data Model: Functional Gaps for Stop Multiplayer

This model extends the existing shared shapes in `shared/types.ts` and Durable Object storage. The Durable Object remains the sole authority. Persisted structures must be serializable and safe to restore after eviction.

## Room

Fields:

- `code`: canonical room code and Durable Object name.
- `phase`: `WAITING_PLAYERS`, `CONFIGURING`, `ROUND_ACTIVE`, `CATEGORY_REVIEW`, `ROUND_RESULTS`, or `GAME_OVER`.
- `hostPlayerId`: player authorized to configure and start/advance the game.
- `players`: room-scoped players and accumulated scores.
- `categories`: validated category snapshot used by the game.
- `totalRounds`: integer from 1 through 20; the current lobby exposes 3, 5, 8, and 10.
- `roundDurationSeconds`: one of 60 (default), 90, 120, or 0 (unlimited).
- `allowedLetters`: non-empty set of letters eligible for server-side draws; defaults to A-Z.
- `currentRound`: zero before start; otherwise 1 through `totalRounds`.
- `currentLetter`, `roundDeadline`: current active round fields; deadline is absent for unlimited time.
- `currentReviewCategoryIndex`, `reviewDeadline`: present during sequential review.
- `lastActivityAt`: timestamp updated by valid player activity.
- `expiresAt`: next room cleanup deadline.

Rules:

- At most 20 active players may participate.
- Nicknames are trimmed (maximum 24 Unicode code points) and unique case-insensitively within a room.
- Configuration and host changes are accepted only in `CONFIGURING`.
- If the host disconnects, the active player with the earliest `joinedAt` becomes host; equal timestamps are resolved by room player order. If no active player remains, the room has no host and host-only actions stay blocked until an existing player resumes or the room expires.
- Only an active room member may mutate game state. Host-only actions additionally require the active host role and the command's allowed phase.
- A game requires at least two active players and 1-20 unique, non-empty categories (maximum 40 Unicode code points per category name).
- A room code routes to one Durable Object; uninitialized codes are not joinable rooms.
- Unstarted/inactive rooms expire after 24 hours without valid activity; completed rooms expire one hour after `GAME_OVER`.
- Round and review deadlines take precedence over idle expiry while a game is active.

## Player and Resume Credential

Player fields:

- `id`: stable, random identifier within the room; not a global account.
- `nickname`: display name.
- `isHost`: whether `id` equals the current `hostPlayerId`.
- `status`: `active` or `disconnected`.
- `score`: numeric accumulated score, including possible half-points.
- `joinedAt`: stable join ordering used for host succession.

Credential fields (private storage; never broadcast):

- `tokenVerifier`: verifier for an opaque random resume token.
- `playerId`: credential owner.
- `issuedAt`, `expiresAt` or revocation state.

Rules:

- Credentials are scoped to one room and player and delivered only to the owner.
- Resume credentials expire 30 days after issue and are rotated after every successful resume.
- A reconnect restores the existing player; it does not add another seat or create a second score.
- Credentials are not placed in URLs or logs.

## Round Snapshot

Fields:

- `id`: stable identifier, e.g. `round-<number>`.
- `number`: current round ordinal.
- `letter`: authoritative selected letter.
- `categories`: immutable ordered snapshot of room categories for this round.
- `phase`: `ROUND_ACTIVE`, `CATEGORY_REVIEW`, or `ROUND_RESULTS`.
- `roundDeadline`: optional absolute timestamp; absent when duration is unlimited.
- `stopperId`: first active player whose Stop command was serialized; nullable on timeout.
- `currentReviewCategoryIndex`, `reviewDeadline`: current category and optional deadline.
- `answers`: records keyed by player/category, including normalized value and automatic validity.
- `eligibleVoterIds`: voter set captured for each category, excluding each answer's author.
- `votes`: per-answer map of voter ID to explicit `valid` or `invalidate` decision.
- `scoredCategoryIndexes`: category indices whose points have been applied.
- `roundScoreApplied`: marker that round completion/bonus has been applied exactly once.
- `nextRoundStarted`: transition marker or terminal status to reject duplicate advancement.

Rules:

- One answer per player/category; values are normalized server-side.
- Blank or wrong-letter values are automatically invalid and score zero.
- Submissions are accepted only from active players, for the current round/categories, before STOP/deadline.
- A response after the cutoff cannot alter stored answers.
- Round snapshots are persisted as plain records/arrays. Reconstruct maps/sets only in memory after restore if needed.

## Answer and Vote

Answer fields:

- `playerId`, `categoryId`, `value`.
- `automaticValidity`: `valid` or `invalid`.
- `votes`: eligible voter decisions, not including the author.
- `invalidationRatio`: invalidation decisions / eligible voters for this answer.
- `baseScore`: 10 unique, 5 repeated, 0 blank/wrong-letter.
- `finalScore`: base score, half base for invalidation ratio `>= 0.10` and `<= 0.50`, or zero above `0.50`.

Rules:

- Equality for duplicate detection is case-insensitive after trim and normalization.
- Only automatically valid non-empty answers contribute to duplicate frequency.
- The author cannot vote on their answer.
- Missing vote is treated as agreement when the category completes.
- A category completes after every eligible voter has decided on all eligible answers, or when its deadline expires.
- Score is numeric to represent half of a repeated answer (2.5).
- Category score is committed once and transmitted as an authoritative accumulated scoreboard.

## State Transitions

```text
WAITING_PLAYERS -> CONFIGURING
CONFIGURING -- host game:start --> ROUND_ACTIVE
ROUND_ACTIVE -- first Stop or round deadline --> CATEGORY_REVIEW[0]
CATEGORY_REVIEW[i] -- all decisions or category deadline --> CATEGORY_REVIEW[i+1]
CATEGORY_REVIEW[last] -- score commit --> ROUND_RESULTS (intermediate round)
ROUND_RESULTS -- host round:next --> ROUND_ACTIVE (next round)
CATEGORY_REVIEW[last] -- score commit on final round --> GAME_OVER
```

All state-changing transitions execute in the Durable Object. A repeated command/alarm is idempotently ignored or returns a stable already-completed error.

## Protocol Request Identity

Every mutating command has:

- `requestId`: unique identifier from client, used to correlate an error/acknowledgement and deduplicate safe retries.
- `type`: discriminant for the command.

Request deduplication is scoped to room and bounded storage; it must not allow a request ID from one command/player to replay another player's action.

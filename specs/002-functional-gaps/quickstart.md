# Quickstart: Validate Functional Gaps

This guide validates the completed implementation of [spec.md](./spec.md) locally. Run package commands from their respective directories; the repository currently has separate frontend and backend packages.

## Prerequisites

- Node.js 20+
- npm 9+
- Wrangler 4 (use the backend package's installed version or `npx wrangler`)
- A current Chromium browser for Playwright E2E

## Start locally

Terminal 1 — Worker and Durable Objects:

```powershell
Set-Location backend
npm run dev
```

The Worker should listen at `http://localhost:8787`.

Terminal 2 — Frontend:

```powershell
Set-Location frontend
npm run start
```

Open the Vite URL printed in the terminal. The development proxy forwards `/rooms` and WebSocket upgrades to the Worker.

## Automated checks

Run backend unit, contract, and Worker/Durable Object tests:

```powershell
Set-Location backend
npm run test
npm run typecheck
npm run build
```

Run frontend unit, lint, and production build checks:

```powershell
Set-Location frontend
npm run test
npm run lint
npm run build
```

Run the two-client browser scenarios:

```powershell
Set-Location frontend
npm run test:e2e
```

The test scripts/configuration are part of this feature's implementation; a missing script is a failure, not a successful no-op.

## End-to-end scenarios

1. Open two independent browser contexts. Create a room in context A and join the displayed code in context B. Both clients must show the same room; entering a random code must produce `ROOM_NOT_FOUND`.
2. Verify the configuration view does not show the player list or scoreboard. As host, change categories, round count, duration, and allowed letters. Confirm both clients receive authoritative settings; attempt the same commands from context B and confirm rejection.
3. Start with two active players. Confirm both clients receive identical letter, category snapshot, and deadline. Submit valid, blank, and wrong-letter answers; wrong-letter/blank values must score zero.
4. Send concurrent Stop commands and answer updates. Confirm one stopper is recorded, submissions close once, and the same category review begins on both clients.
5. Test votes with the author excluded and verify score boundaries at below 10%, 10%, 50%, and above 50%. Confirm duplicate answers halve from 5 to 2.5 at the partial-invalidation threshold and score zero above 50%.
6. Finish all eligible votes before the timer expires. Confirm server-driven category advancement, one committed score update per category, and no duplicate scoring after retry/reconnect.
7. Finish an intermediate round. Confirm it remains on results until the host chooses “Próxima Rodada”; non-host attempts are rejected. On the final round, confirm final ranking follows the last committed scores.
8. Reconnect a browser during answering and during review. Confirm the same player identity, score, answers, active category, and deadline are restored.
9. Restart/evict the local Durable Object during an active round and review phase. Confirm persisted state restores and elapsed alarms advance once without losing answers or duplicating scores.
10. Disconnect the host in the lobby. Confirm the next eligible active player is promoted and receives host-only controls.
11. Verify an unstarted room expires after 24 hours of inactivity and a completed room remains viewable for one hour before cleanup; active round/review alarms must not be shortened by idle expiry.
12. Attempt keyboard-only navigation and check focus after Stop, category changes, and final results. Enable reduced motion and confirm the game remains fully understandable without decorative animation.

## Expected outcome

Both package builds and lint checks pass; test commands run real suites; two independent clients complete a full multi-round match with host-confirmed intermediate progression; invalid or stale commands return explicit errors; reconnection and Durable Object recovery preserve authoritative state.

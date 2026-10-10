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
npm run lint
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

Install Chromium once before the first E2E run:

```powershell
Set-Location frontend
npx playwright install chromium
```

Run the two-client browser scenarios (this command starts the local Worker and Vite development server on ports 8787 and 4173):

```powershell
Set-Location frontend
npm run test:e2e
```

The Playwright configuration starts both services and polls the Worker health endpoint. The browser suite uses separate contexts to complete a three-round match, checks host-controlled progression, exercises keyboard Stop/focus behavior, and verifies reduced-motion styling. A missing script or browser binary is a failure, not a successful no-op.

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
11. Run `npm test -- src/test/game-room.test.ts` from `backend` to verify idle expiry at 24 hours, completed-room expiry at one hour, and that an active-round deadline takes precedence over an old idle deadline. The Durable Object deletes persisted room/game/round/resume data when expiration fires.
12. Run `npm run test:e2e` from `frontend` to verify keyboard-triggered Stop, focus transfer to the current phase heading, and removal of decorative background animation when reduced motion is requested.

## Expected outcome

Both packages' tests, typechecks/builds, and lint checks run as real suites. The Playwright suite completes a multi-round match using two independent contexts and verifies accessibility essentials. Backend lifecycle tests cover room expiry and alarm precedence; reconnection and Durable Object recovery preserve authoritative state.

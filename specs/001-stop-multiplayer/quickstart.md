# Quickstart: Stop Multiplayer

## Prerequisites

- npm 9+
- Node.js 20+
- Wrangler instalado ou executado via `npx`
- Two browser windows or Playwright

## Development

Install dependencies at the repository root:

```bash
npm install
```

Start the frontend and the local Cloudflare Worker:

```bash
npm run dev
npx wrangler dev --config backend/wrangler.jsonc
```

The frontend should be available at the Vite URL and connect to the local Worker WebSocket. Configure the local API URL through `VITE_API_URL`.

For production, configure the GitHub Pages build with `VITE_API_URL=wss://<worker-domain>/rooms` and deploy the Worker with Wrangler. The Pages workflow builds and publishes `dist/`; Cloudflare credentials must remain in protected repository secrets.

## Manual validation scenarios

1. Open two browser windows.
2. In window A, enter a nickname and create a room.
3. Copy the room code and join from window B with a different nickname.
4. Confirm both players see the same lobby and that a duplicate nickname is rejected.
5. As host, select suggested categories, add a custom category, edit one and remove one.
6. Set the number of rounds, start with at least two categories and confirm both windows receive the same round count, letter, categories and deadline.
7. Submit answers from both windows. Confirm a second submission is rejected.
8. Press Stop from one window and confirm both windows move to review immediately.
9. In review, invalidate another player's answer from one window. Leave another answer without a vote and confirm omission counts as agreement.
10. Confirm the voting phase ends when all eligible players vote or after 30 seconds.
11. Verify base scores: 10 for valid unique, 5 for valid duplicate and 0 for empty/wrong initial letter.
12. Verify invalidation thresholds at 0%, 10%, 50% and above 50%, including uniqueness and final ranking.
13. Complete a match with multiple configured rounds and confirm it ends exactly after the configured final round.
14. Navigate the complete flow with keyboard only and verify logical focus order, accessible status text, and no color-only meaning.
15. Enable reduced motion in the browser and confirm letter-draw, Stop, and background animations are removed or simplified without losing information.
16. Verify the scoreboard occupies a vertical desktop sidebar and moves below the game content on narrow screens without overlap.

## Automated validation

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
npx wrangler dev --config backend/wrangler.jsonc --test-scheduled
```

The domain tests must cover scoring, automatic validation, duplicate answers, invalidation ratios, self-invalidation rejection, timeout and Stop transitions. Worker tests must cover temporary identity, host permissions, room capacity, WebSocket reconnects and phase deadlines. Integration tests must cover Durable Object serialization and snapshots. E2E tests must use at least two browser contexts.

## References

- Data and state transitions: [data-model.md](./data-model.md)
- Realtime WebSocket schemas: [contracts/realtime-events.md](./contracts/realtime-events.md)
- Decisions and alternatives: [research.md](./research.md)

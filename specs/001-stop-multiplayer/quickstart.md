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
4. Confirm both players see the configuration screen without scoreboard and without player list.
5. As host, select suggested categories, add a custom category, and set the number of rounds.
6. Start the game and confirm on both windows:
   - The drawn letter is on the right side, directly above the scoreboard section.
   - The categories form is in the main area.
   - The STOP button is located immediately after the categories section.
7. Submit answers from both windows (or press Stop). Confirm pressing Stop ends answering immediately for all.
8. Confirm the game enters sequential review, starting at Category 1, displaying all submitted terms for that theme.
9. Vote on Category 1 terms. Confirm that when all vote (or timer expires), Category 1 score is computed and immediately reflected on the right-side scoreboard.
10. Confirm automatic transition to Category 2, repeating the review and score update process until the final category of the round.
11. If there are more rounds, advance to the next round with updated accumulated scores.
12. At the end of the final round, confirm the Final Results screen:
    - Scoreboard is prominently centered on the screen.
    - 1st, 2nd, and 3rd place players are highlighted in podium format.
    - Remaining players are displayed in a clean list format below the podium.
    - All positions display the total points earned by each participant.
13. Navigate the complete flow with keyboard only and verify logical focus order and accessible labels.
14. Enable reduced motion and confirm letter-draw, Stop, category transitions, and podium animations are simplified or removed without losing information.

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

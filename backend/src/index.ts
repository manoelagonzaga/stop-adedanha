import { GameRoom } from './game-room';

export { GameRoom };

type Env = {
  GAME_ROOM: DurableObjectNamespace;
};

// ── CORS helper ──────────────────────────────────────────────────────────────

function cors(origin: string | null): Record<string, string> {
  const allowed = origin ?? '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
  };
}

// ── Main Worker ───────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // Handle CORS pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // Route: POST /rooms  → create a new room (returns room code)
    if (request.method === 'POST' && url.pathname === '/rooms') {
      const roomCode = generateCode();
      const roomId = env.GAME_ROOM.idFromName(roomCode);
      // Ping the DO to initialize it
      const resp = await env.GAME_ROOM.get(roomId).fetch(
        new Request(`${url.origin}/rooms/${roomCode}`, { headers: request.headers })
      );
      if (resp.status === 426) {
        // Expected — DO requires WS; just return the code
        return Response.json({ code: roomCode }, { headers: cors(origin) });
      }
      return Response.json({ code: roomCode }, { headers: cors(origin) });
    }

    // Route: GET/WS /rooms/:code  → join room (WebSocket upgrade)
    const roomMatch = url.pathname.match(/^\/rooms\/([A-Za-z0-9-]+)\/?$/);
    if (roomMatch) {
      const roomCode = roomMatch[1].toUpperCase();
      const roomId = env.GAME_ROOM.idFromName(roomCode);
      const doResp = await env.GAME_ROOM.get(roomId).fetch(request);

      // Pass through CORS headers for non-WS responses
      if (doResp.status !== 101) {
        const headers = new Headers(doResp.headers);
        for (const [k, v] of Object.entries(cors(origin))) {
          headers.set(k, v);
        }
        return new Response(doResp.body, { status: doResp.status, headers });
      }

      return doResp;
    }

    return Response.json(
      { error: 'NOT_FOUND', hint: 'Use POST /rooms or WS /rooms/:code' },
      { status: 404, headers: cors(origin) }
    );
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXY23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

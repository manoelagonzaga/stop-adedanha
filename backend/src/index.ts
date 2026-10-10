import { GameRoom } from './game-room';
import { addRoomToRegistry, purgeAllRooms } from './cleanup';

export { GameRoom };
export * from './cleanup';

export type Env = {
  GAME_ROOM: DurableObjectNamespace;
  ADMIN_SECRET?: string;
};

const MAX_ROOM_ALLOCATION_ATTEMPTS = 5;

// ── CORS helper ──────────────────────────────────────────────────────────────

function cors(origin: string | null): Record<string, string> {
  const allowed = origin ?? '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection, Authorization',
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

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok' }, { headers: cors(origin) });
    }

    // Route: POST /admin/cleanup → acionamento manual da rotina de limpeza
    if (request.method === 'POST' && url.pathname === '/admin/cleanup') {
      const authHeader = request.headers.get('Authorization');
      const expectedSecret = env.ADMIN_SECRET;

      if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
        return Response.json(
          { error: 'UNAUTHORIZED', message: 'Token de autorização inválido ou ausente' },
          { status: 401, headers: cors(origin) },
        );
      }

      const report = await purgeAllRooms(env, true);
      return Response.json(report, { status: 200, headers: cors(origin) });
    }

    // Route: POST /rooms → reserve a canonical room code in its Durable Object
    if (request.method === 'POST' && url.pathname === '/rooms') {
      for (let attempt = 0; attempt < MAX_ROOM_ALLOCATION_ATTEMPTS; attempt += 1) {
        const roomCode = generateCode();
        const roomId = env.GAME_ROOM.idFromName(roomCode);
        const allocation = await env.GAME_ROOM.get(roomId).fetch(
          new Request('https://room.internal/__allocate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: roomCode }),
          }),
        );

        if (allocation.status === 201) {
          await addRoomToRegistry(env, roomCode);
          return Response.json({ code: roomCode }, { status: 201, headers: cors(origin) });
        }
        if (allocation.status !== 409) {
          return Response.json(
            { error: 'ROOM_ALLOCATION_FAILED', message: 'Could not allocate a room code' },
            { status: 502, headers: cors(origin) },
          );
        }
      }
      return Response.json(
        { error: 'ROOM_ALLOCATION_FAILED', message: 'Could not allocate a unique room code' },
        { status: 503, headers: cors(origin) },
      );
    }

    // Route: GET/WS /rooms/:code → connect to the Durable Object for a room
    const roomMatch = url.pathname.match(/^\/rooms\/([A-Za-z0-9-]+)\/?$/);
    if (roomMatch && request.method === 'GET') {
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
      {
        error: roomMatch ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
        hint: 'Use POST /rooms or WS /rooms/:code',
      },
      { status: roomMatch ? 405 : 404, headers: cors(origin) }
    );
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(
      `[Scheduled] Disparo de limpeza periódica: cron=${controller.cron}, time=${new Date(controller.scheduledTime).toISOString()}`,
    );
    ctx.waitUntil(
      purgeAllRooms(env, true).catch((error) => {
        console.error('[Scheduled] Erro na limpeza periódica:', error);
      }),
    );
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXY23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

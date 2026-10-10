import { describe, expect, it, vi } from 'vitest';
import worker, { GameRoom } from '../index';
import {
  LEGACY_ROOM_IDS,
  addRoomToRegistry,
  clearRegistry,
  listRoomsFromRegistry,
  purgeAllRooms,
  removeRoomFromRegistry,
} from '../cleanup';

function makeMockDurableObject() {
  const serverSockets: WebSocket[] = [];
  const persisted = new Map<string, unknown>();

  const storage = {
    get: vi.fn(async (key: string) => {
      if (key === 'activeRooms') {
        const val = persisted.get(key);
        return val ? structuredClone(val) : [];
      }
      return structuredClone(persisted.get(key));
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      persisted.set(key, structuredClone(value));
    }),
    delete: vi.fn(async (key: string) => persisted.delete(key)),
    deleteAll: vi.fn(async () => persisted.clear()),
    setAlarm: vi.fn(async () => undefined),
    deleteAlarm: vi.fn(async () => undefined),
  };

  const state = {
    storage,
    blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => callback()),
    acceptWebSocket: vi.fn((socket: WebSocket) => {
      serverSockets.push(socket);
      socket.accept();
    }),
    getWebSockets: vi.fn(() => serverSockets),
    getTags: vi.fn(() => []),
  } as unknown as DurableObjectState;

  const room = new GameRoom(state);
  return { room, state, storage, persisted, serverSockets };
}

function makeMockEnvironment() {
  const instances = new Map<string, ReturnType<typeof makeMockDurableObject>>();

  function getOrCreate(name: string) {
    if (!instances.has(name)) {
      instances.set(name, makeMockDurableObject());
    }
    return instances.get(name)!;
  }

  const namespace = {
    idFromName: vi.fn((name: string) => ({ toString: () => name, name })),
    idFromString: vi.fn((hex: string) => ({ toString: () => hex, name: hex })),
    get: vi.fn((id: { name: string; toString: () => string }) => {
      const name = id.name ?? id.toString();
      const mock = getOrCreate(name);
      return {
        fetch: vi.fn((req: Request) => mock.room.fetch(req)),
      } as unknown as DurableObjectStub;
    }),
  } as unknown as DurableObjectNamespace;

  return { env: { GAME_ROOM: namespace, ADMIN_SECRET: 'test-secret-123' }, instances };
}

describe('Feature 03: Scheduled Cleanup & Durable Objects Purge', () => {
  it('T-3.1 a T-3.4: GameRoom __purge executa deleteAll, cancela alarmes e fecha WebSockets', async () => {
    const { room, storage, persisted } = makeMockDurableObject();

    // Simula dados persistidos na sala
    persisted.set('room', { code: 'ABC123', phase: 'CONFIGURING', players: [] });
    persisted.set('gameState', { score: 100 });

    // Cria um par WebSocket conectado
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    client.accept();
    server.accept();
    const closeSpy = vi.spyOn(server, 'close');

    // Registra socket na sala via acceptWebSocket simulado
    (room as unknown as { state: { getWebSockets: () => WebSocket[] } }).state.getWebSockets = () => [server];

    // Aciona a rota interna de purga
    const response = await room.fetch(
      new Request('https://room.internal/__purge', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ ok: true, code: '' });

    // Validações
    expect(storage.deleteAll).toHaveBeenCalledTimes(1);
    expect(storage.deleteAlarm).toHaveBeenCalledTimes(1);
    expect(persisted.size).toBe(0);
    expect(closeSpy).toHaveBeenCalledWith(1001, 'Manutenção periódica programada');
  });

  it('T-2.1 a T-2.3: Room Registry gerencia catálogo de salas (adicionar, listar, remover, limpar)', async () => {
    const { env } = makeMockEnvironment();

    // Adiciona salas
    await addRoomToRegistry(env, 'ROOM01');
    await addRoomToRegistry(env, 'ROOM02');
    await addRoomToRegistry(env, 'ROOM02'); // Duplicata não deve duplicar

    let list = await listRoomsFromRegistry(env);
    expect(list).toContain('ROOM01');
    expect(list).toContain('ROOM02');
    expect(list.filter((c) => c === 'ROOM02').length).toBe(1);

    // Remove uma sala
    await removeRoomFromRegistry(env, 'ROOM01');
    list = await listRoomsFromRegistry(env);
    expect(list).not.toContain('ROOM01');
    expect(list).toContain('ROOM02');

    // Limpa catálogo
    await clearRegistry(env);
    list = await listRoomsFromRegistry(env);
    expect(list).toEqual([]);
  });

  it('T-1.1, T-2.2: POST /rooms registra o código da sala no catálogo automaticamente', async () => {
    const { env } = makeMockEnvironment();

    const response = await worker.fetch(
      new Request('https://stop.internal/rooms', { method: 'POST' }),
      env,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBeDefined();

    // Verifica que a sala foi registrada no catálogo
    const activeRooms = await listRoomsFromRegistry(env);
    expect(activeRooms).toContain(body.code);
  });

  it('T-4.1, T-5.2: purgeAllRooms expurga todas as salas catalogadas e esvazia o catálogo', async () => {
    const { env } = makeMockEnvironment();

    // Cadastra 3 salas
    await addRoomToRegistry(env, 'SALA01');
    await addRoomToRegistry(env, 'SALA02');
    await addRoomToRegistry(env, 'SALA03');

    // Popula storage simulado para as 3 salas
    for (const code of ['SALA01', 'SALA02', 'SALA03']) {
      const roomInstance = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
      await roomInstance.fetch(
        new Request('https://room.internal/__allocate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }),
      );
    }

    // Executa a purga (sem legacy para testar apenas as 3)
    const report = await purgeAllRooms(env, false);

    expect(report.totalRooms).toBe(3);
    expect(report.purgedCount).toBe(3);
    expect(report.failedCount).toBe(0);

    // Confirma que o registro foi esvaziado
    const remainingRooms = await listRoomsFromRegistry(env);
    expect(remainingRooms).toEqual([]);
  });

  it('T-4.5, T-5.5: Inclui as 27 instâncias legadas no primeiro expurgo', async () => {
    const { env } = makeMockEnvironment();

    expect(LEGACY_ROOM_IDS.length).toBe(27);
    expect(LEGACY_ROOM_IDS).toContain('J8FGR9');
    expect(LEGACY_ROOM_IDS).toContain('STP948');
    expect(LEGACY_ROOM_IDS).toContain('999999');
    expect(LEGACY_ROOM_IDS).toContain(
      'cb70738f59e44df0434969976c3758f562f5f04b65bbf851fea8dd4cbdb1ef53',
    );

    // Executa purgeAllRooms com includeLegacy = true (padrão)
    const report = await purgeAllRooms(env, true);

    expect(report.legacyIncluded).toBe(true);
    expect(report.totalRooms).toBeGreaterThanOrEqual(27);
    expect(report.purgedCount).toBe(report.totalRooms);
    expect(report.failedCount).toBe(0);
  });

  it('T-4.3, T-5.4: POST /admin/cleanup exige autenticação quando configurada e executa com sucesso', async () => {
    const { env } = makeMockEnvironment();

    // 1. Chamada sem autenticação
    const unauthResponse = await worker.fetch(
      new Request('https://stop.internal/admin/cleanup', { method: 'POST' }),
      env,
    );
    expect(unauthResponse.status).toBe(401);
    const unauthBody = await unauthResponse.json();
    expect(unauthBody).toMatchObject({ error: 'UNAUTHORIZED' });

    // 2. Chamada com autenticação incorreta
    const badAuthResponse = await worker.fetch(
      new Request('https://stop.internal/admin/cleanup', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-secret' },
      }),
      env,
    );
    expect(badAuthResponse.status).toBe(401);

    // 3. Chamada com autenticação correta
    const authResponse = await worker.fetch(
      new Request('https://stop.internal/admin/cleanup', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-secret-123' },
      }),
      env,
    );
    expect(authResponse.status).toBe(200);
    const report = await authResponse.json();
    expect(report).toMatchObject({
      totalRooms: expect.any(Number),
      purgedCount: expect.any(Number),
      failedCount: 0,
      durationMs: expect.any(Number),
      legacyIncluded: true,
    });
  });

  it('T-4.2: Export scheduled executa a limpeza periódica e aguarda conclusão via ctx.waitUntil', async () => {
    const { env } = makeMockEnvironment();

    const waitUntilMock = vi.fn();
    const ctx = {
      waitUntil: waitUntilMock,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const controller = {
      cron: '0 4 */2 * *',
      scheduledTime: Date.now(),
      noRetry: vi.fn(),
    } as unknown as ScheduledController;

    await worker.scheduled(controller, env, ctx);

    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    // Aguarda a promise enviada para waitUntil resolver sem erros
    const promise = waitUntilMock.mock.calls[0][0];
    await expect(promise).resolves.toMatchObject({ totalRooms: expect.any(Number) });
  });

  it('T-5.3: purgeAllRooms isola erros e contabiliza falhas sem interromper o lote', async () => {
    const { env } = makeMockEnvironment();

    // Cadastra 2 salas
    await addRoomToRegistry(env, 'GOOD_ROOM');
    await addRoomToRegistry(env, 'FAIL_ROOM');

    // Faz a sala FAIL_ROOM falhar intencionalmente
    const originalGet = env.GAME_ROOM.get.bind(env.GAME_ROOM);
    (env.GAME_ROOM as { get: unknown }).get = vi.fn((id: DurableObjectId) => {
      const name = (id && typeof id === 'object' && 'name' in id)
        ? (id as { name?: string }).name ?? id.toString()
        : id.toString();
      if (name === 'FAIL_ROOM') {
        return {
          fetch: vi.fn(async () => new Response('Internal error', { status: 500 })),
        } as unknown as DurableObjectStub;
      }
      return originalGet(id);
    });

    const report = await purgeAllRooms(env, false);

    expect(report.totalRooms).toBe(2);
    expect(report.purgedCount).toBe(1);
    expect(report.failedCount).toBe(1);
  });
});

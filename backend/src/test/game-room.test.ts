import { describe, expect, it, vi } from 'vitest';
import worker, { GameRoom } from '../index';
import type { Player, RoomState, ServerEvent } from '../types';

function makeDurableObjectState() {
  const serverSockets: WebSocket[] = [];
  const socketTags = new Map<WebSocket, string[]>();
  const persisted = new Map<string, unknown>();
  const state = {
    storage: {
      get: vi.fn(async (key: string) => structuredClone(persisted.get(key))),
      put: vi.fn(async (key: string, value: unknown) => {
        persisted.set(key, structuredClone(value));
      }),
      delete: vi.fn(async (key: string) => persisted.delete(key)),
      deleteAll: vi.fn(async () => persisted.clear()),
      setAlarm: vi.fn(async (timestamp: number) => {
        void timestamp;
      }),
      deleteAlarm: vi.fn(async () => undefined),
    },
    blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => callback()),
    acceptWebSocket: vi.fn((socket: WebSocket, tags: string[] = []) => {
      serverSockets.push(socket);
      socketTags.set(socket, tags);
      socket.accept();
    }),
    getWebSockets: vi.fn(() => serverSockets),
    getTags: vi.fn((socket: WebSocket) => socketTags.get(socket) ?? []),
  } as unknown as DurableObjectState;

  return { state, persisted };
}

async function connect(
  room: GameRoom,
  roomCode: string,
  events: ServerEvent[],
): Promise<WebSocket> {
  const response = await room.fetch(
    new Request(`https://room.example/rooms/${roomCode}`, {
      headers: { Upgrade: 'websocket' },
    }),
  );
  const client = response.webSocket;
  const state = (room as unknown as { state: DurableObjectState }).state;
  const server = state.getWebSockets()[state.getWebSockets().length - 1];
  if (!client || !server) throw new Error('Expected an accepted WebSocket pair');
  client.accept();
  client.addEventListener('message', (message) => {
    events.push(JSON.parse(String(message.data)) as ServerEvent);
  });
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'session:ready')).toBe(true);
  });
  return server;
}

async function nextEvent<T extends ServerEvent['type']>(
  events: ServerEvent[],
  type: T,
): Promise<Extract<ServerEvent, { type: T }>> {
  let event: Extract<ServerEvent, { type: T }> | undefined;
  await vi.waitFor(() => {
    const index = events.findIndex((candidate) => candidate.type === type);
    if (index < 0) throw new Error(`Expected ${type} event`);
    event = events.splice(index, 1)[0] as Extract<ServerEvent, { type: T }>;
  });
  if (!event) throw new Error(`Expected ${type} event`);
  return event;
}

async function negotiate(room: GameRoom, socket: WebSocket, events: ServerEvent[], id: string) {
  room.webSocketMessage(
    socket,
    JSON.stringify({ type: 'session:hello', requestId: id, protocolVersion: 1 }),
  );
  await nextEvent(events, 'session:ready');
  await nextEvent(events, 'command:ack');
}

async function joinActivePlayer(room: GameRoom, roomCode: string, nickname: string): Promise<WebSocket> {
  const events: ServerEvent[] = [];
  const socket = await connect(room, roomCode, events);
  await negotiate(room, socket, events, `hello-${nickname}`);
  room.webSocketMessage(
    socket,
    JSON.stringify({
      type: 'room:join',
      requestId: `join-${nickname}`,
      code: roomCode,
      nickname,
    }),
  );
  await nextEvent(events, 'room:state');
  await nextEvent(events, 'command:ack');
  return socket;
}

async function allocate(room: GameRoom, code: string) {
  return room.fetch(
    new Request('https://room.internal/__allocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }),
  );
}

describe('room allocation and identity', () => {
  it('exposes a health endpoint for local Worker readiness checks', async () => {
    const response = await worker.fetch(new Request('https://game.example/health'), {} as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('retries allocation collisions and returns the successfully reserved code', async () => {
    const allocatedCodes: string[] = [];
    let attempt = 0;
    const env = {
      GAME_ROOM: {
        idFromName: (name: string) => name,
        get: (id: string) => ({
          fetch: async (req?: Request) => {
            const url = req instanceof Request ? req.url : String(req ?? '');
            if (url.includes('/__registry')) {
              return new Response(JSON.stringify({ ok: true }));
            }
            allocatedCodes.push(id);
            attempt += 1;
            return new Response(null, { status: attempt === 1 ? 409 : 201 });
          },
        }),
      },
    };

    const response = await worker.fetch(
      new Request('https://game.example/rooms', { method: 'POST' }),
      env as never,
    );
    const result = (await response.json()) as { code: string };

    expect(response.status).toBe(201);
    expect(result.code).toBe(allocatedCodes[1]);
    expect(allocatedCodes).toHaveLength(2);
    expect(allocatedCodes[0]).not.toBe(allocatedCodes[1]);
  });

  describe('authoritative lobby configuration', () => {
    async function createRoom(nickname = 'Host', avatar?: Player['avatar']) {
      const { state } = makeDurableObjectState();
      const room = new GameRoom(state);
      await allocate(room, 'ABC234');
      const events: ServerEvent[] = [];
      const host = await connect(room, 'ABC234', events);
      await negotiate(room, host, events, 'hello-config-host');
      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'room:create',
          requestId: 'create-config-host',
          nickname,
          ...(avatar ? { avatar } : {}),
        }),
      );
      await nextEvent(events, 'room:joined');
      await nextEvent(events, 'room:state');
      await nextEvent(events, 'command:ack');
      return { room, host, events, state };
    }

    async function joinGuest(room: GameRoom, avatar?: Player['avatar']) {
      const events: ServerEvent[] = [];
      const guest = await connect(room, 'ABC234', events);
      await negotiate(room, guest, events, 'hello-config-guest');
      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'room:join',
          requestId: 'join-config-guest',
          code: 'ABC234',
          nickname: 'Guest',
          ...(avatar ? { avatar } : {}),
        }),
      );
      const joinedState = await nextEvent(events, 'room:state');
      await nextEvent(events, 'command:ack');
      return { guest, events, joinedState };
    }

    it('serializes rapid host configuration commands and acknowledges each committed update', async () => {
      const { room, host, events } = await createRoom();

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:categories:update',
          requestId: 'categories-queued',
          categories: ['Nome', 'Cidade'],
        }),
      );
      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:options:update',
          requestId: 'options-queued',
          roundDurationSeconds: 90,
          allowedLetters: ['A', 'B'],
        }),
      );

      const firstState = await nextEvent(events, 'room:state');
      expect(firstState.state.categories.map((category) => category.name)).toEqual(['Nome', 'Cidade']);
      expect((await nextEvent(events, 'command:ack')).requestId).toBe('categories-queued');

      const secondState = await nextEvent(events, 'room:state');
      expect(secondState.state).toMatchObject({
        roundDurationSeconds: 90,
        allowedLetters: ['A', 'B'],
      });
      expect((await nextEvent(events, 'command:ack')).requestId).toBe('options-queued');
      expect((room as unknown as {
        room: { categories: Array<{ name: string }>; roundDurationSeconds: number; allowedLetters: string[] };
      }).room).toMatchObject({
        categories: [{ name: 'Nome' }, { name: 'Cidade' }],
        roundDurationSeconds: 90,
        allowedLetters: ['A', 'B'],
      });
    });

    it('stores selected avatars for hosts and guests in the authoritative room state', async () => {
      const { room, events } = await createRoom('Host', '🐼');
      const { joinedState } = await joinGuest(room, '🐸');

      const hostSnapshot = (room as unknown as { room: RoomState }).room;
      expect(hostSnapshot.players.map((player) => player.avatar)).toEqual(['🐼', '🐸']);
      expect(joinedState.state.players.map((player) => player.avatar)).toEqual(['🐼', '🐸']);
      expect(events.some((event) => event.type === 'room:state')).toBe(true);
    });

    it('persists and broadcasts host configuration changes after a guest joins', async () => {
      const { room, host, events: hostEvents } = await createRoom();
      const { events: guestEvents } = await joinGuest(room);

      await nextEvent(hostEvents, 'player:presence');
      await nextEvent(hostEvents, 'room:state');
      await nextEvent(guestEvents, 'player:presence');
      await nextEvent(guestEvents, 'room:state');

      const updates = [
        {
          type: 'lobby:categories:update',
          requestId: 'joined-categories-update',
          categories: ['Nome', 'Cidade', 'Animal'],
        },
        {
          type: 'lobby:rounds:update',
          requestId: 'joined-rounds-update',
          totalRounds: 8,
        },
        {
          type: 'lobby:options:update',
          requestId: 'joined-options-update',
          roundDurationSeconds: 90,
          allowedLetters: ['A', 'B', 'C'],
        },
      ] as const;

      for (const update of updates) {
        await room.webSocketMessage(host, JSON.stringify(update));
        const hostState = await nextEvent(hostEvents, 'room:state');
        const guestState = await nextEvent(guestEvents, 'room:state');
        expect(guestState.state).toEqual(hostState.state);
        expect((await nextEvent(hostEvents, 'command:ack')).requestId).toBe(update.requestId);
      }

      expect((room as unknown as {
        room: {
          categories: Array<{ name: string }>;
          totalRounds: number;
          roundDurationSeconds: number;
          allowedLetters: string[];
        };
      }).room).toMatchObject({
        categories: [{ name: 'Nome' }, { name: 'Cidade' }, { name: 'Animal' }],
        totalRounds: 8,
        roundDurationSeconds: 90,
        allowedLetters: ['A', 'B', 'C'],
      });
    });

    it('returns an explicit error when a command arrives on an inactive WebSocket session', async () => {
      const { room, host, events } = await createRoom();
      (room as unknown as { sessions: Map<WebSocket, string> }).sessions.delete(host);

      await room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:options:update',
          requestId: 'inactive-session-options',
          roundDurationSeconds: 90,
          allowedLetters: ['A'],
        }),
      );

      expect(await nextEvent(events, 'error')).toMatchObject({
        code: 'SESSION_INVALID',
        requestId: 'inactive-session-options',
      });
    });

    it('restores hibernated WebSocket sessions before processing lobby changes', async () => {
      const { room, host, events, state } = await createRoom();
      const { events: guestEvents } = await joinGuest(room);
      await nextEvent(events, 'player:presence');
      await nextEvent(events, 'room:state');
      await nextEvent(guestEvents, 'player:presence');
      await nextEvent(guestEvents, 'room:state');
      const reactivatedRoom = new GameRoom(state);

      await reactivatedRoom.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:options:update',
          requestId: 'hibernated-options-update',
          roundDurationSeconds: 90,
          allowedLetters: ['A', 'B'],
        }),
      );

      const hostState = await nextEvent(events, 'room:state');
      expect(hostState).toMatchObject({
        state: { roundDurationSeconds: 90, allowedLetters: ['A', 'B'] },
      });
      expect(await nextEvent(guestEvents, 'room:state')).toEqual(hostState);
      expect(await nextEvent(events, 'command:ack')).toMatchObject({
        requestId: 'hibernated-options-update',
        status: 'committed',
      });
      expect((reactivatedRoom as unknown as { sessions: Map<WebSocket, string> }).sessions.get(host))
        .toBe((room as unknown as { sessions: Map<WebSocket, string> }).sessions.get(host));
    });

    it('trims category names and rejects empty, duplicate, oversized, and out-of-range lists', async () => {
      const { room, host, events } = await createRoom();

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:categories:update',
          requestId: 'categories-normalized',
          categories: [' Nome ', 'Cidade', 'Animal'],
        }),
      );
      const normalized = await nextEvent(events, 'room:state');
      expect(normalized.state.categories.map((category) => category.name)).toEqual([
        'Nome',
        'Cidade',
        'Animal',
      ]);
      await nextEvent(events, 'command:ack');

      const invalidLists = [
        [],
        ['Nome', '  '],
        ['Nome', 'nome'],
        ['x'.repeat(41)],
        Array.from({ length: 21 }, (_, index) => `Categoria ${index}`),
      ];
      for (const [index, categories] of invalidLists.entries()) {
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:categories:update',
            requestId: `categories-invalid-${index}`,
            categories,
          }),
        );
        expect(await nextEvent(events, 'error')).toMatchObject({
          code: 'INVALID_CONFIGURATION',
          requestId: `categories-invalid-${index}`,
        });
      }
      expect((room as unknown as { room: { categories: Array<{ name: string }> } }).room.categories)
        .toHaveLength(3);
    });

    it('counts Unicode code points for category and nickname limits', async () => {
      const { room, host, events } = await createRoom();
      const fortyCodePoints = '😀'.repeat(40);
      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:categories:update',
          requestId: 'categories-unicode-boundary',
          categories: [fortyCodePoints],
        }),
      );
      expect((await nextEvent(events, 'room:state')).state.categories[0].name).toBe(fortyCodePoints);
      await nextEvent(events, 'command:ack');

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:categories:update',
          requestId: 'categories-unicode-over-limit',
          categories: ['😀'.repeat(41)],
        }),
      );
      expect(await nextEvent(events, 'error')).toMatchObject({
        code: 'INVALID_CONFIGURATION',
        requestId: 'categories-unicode-over-limit',
      });

      const { room: validNicknameRoom } = await createRoom('😀'.repeat(24));
      expect((validNicknameRoom as unknown as { room: { players: Array<{ nickname: string }> } })
        .room.players[0].nickname).toBe('😀'.repeat(24));

      const invalidRoom = new GameRoom(makeDurableObjectState().state);
      await allocate(invalidRoom, 'DEF234');
      const invalidEvents: ServerEvent[] = [];
      const invalidHost = await connect(invalidRoom, 'DEF234', invalidEvents);
      await negotiate(invalidRoom, invalidHost, invalidEvents, 'hello-long-nickname');
      invalidRoom.webSocketMessage(
        invalidHost,
        JSON.stringify({
          type: 'room:create',
          requestId: 'create-long-nickname',
          nickname: '😀'.repeat(25),
        }),
      );
      expect(await nextEvent(invalidEvents, 'error')).toMatchObject({
        code: 'INVALID_NICKNAME',
        requestId: 'create-long-nickname',
      });
    });

    it('enforces host and CONFIGURING-only updates and requires integer round counts from 1 to 20', async () => {
      const { room, host, events } = await createRoom();
      const { guest, events: guestEvents } = await joinGuest(room);
      await nextEvent(events, 'room:state');

      for (const [requestId, totalRounds] of [
        ['rounds-fraction', 2.5],
        ['rounds-low', 0],
        ['rounds-high', 21],
      ] as const) {
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'lobby:rounds:update', requestId, totalRounds }),
        );
        expect(await nextEvent(events, 'error')).toMatchObject({
          code: 'INVALID_CONFIGURATION',
          requestId,
        });
      }

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'lobby:rounds:update',
          requestId: 'rounds-not-host',
          totalRounds: 8,
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'NOT_HOST',
        requestId: 'rounds-not-host',
      });

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'lobby:rounds:update', requestId: 'rounds-valid', totalRounds: 20 }),
      );
      expect((await nextEvent(events, 'room:state')).state.totalRounds).toBe(20);
      await nextEvent(events, 'command:ack');

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'game:start', requestId: 'start-with-two' }),
      );
      await nextEvent(events, 'round:started');
      await nextEvent(events, 'command:ack');
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'lobby:rounds:update', requestId: 'rounds-after-start', totalRounds: 8 }),
      );
      expect(await nextEvent(events, 'error')).toMatchObject({
        code: 'INVALID_PHASE',
        requestId: 'rounds-after-start',
      });
    });

    it('rejects starts with fewer than two active players or invalid categories', async () => {
      const { room, host, events } = await createRoom();
      room.webSocketMessage(host, JSON.stringify({ type: 'game:start', requestId: 'start-one-player' }));
      expect(await nextEvent(events, 'error')).toMatchObject({
        code: 'NOT_ENOUGH_PLAYERS',
        requestId: 'start-one-player',
      });

      await joinGuest(room);
      await nextEvent(events, 'room:state');
      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:categories:update',
          requestId: 'categories-empty-before-start',
          categories: [],
        }),
      );
      expect(await nextEvent(events, 'error')).toMatchObject({
        code: 'INVALID_CONFIGURATION',
        requestId: 'categories-empty-before-start',
      });
      (room as unknown as { room: { categories: Array<{ id: string; name: string }> } })
        .room.categories = [];
      room.webSocketMessage(host, JSON.stringify({ type: 'game:start', requestId: 'start-invalid-categories' }));
      expect(await nextEvent(events, 'error')).toMatchObject({
        code: 'INVALID_CONFIGURATION',
        requestId: 'start-invalid-categories',
      });
    });
  });

  describe('authoritative duration and letter settings', () => {
    const alphabet = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

    function getRoomSettings(room: GameRoom) {
      return (room as unknown as {
        room: { roundDurationSeconds?: number; allowedLetters?: string[]; phase: string };
      }).room;
    }

    it('defaults to 60 seconds and all A-Z letters, then accepts only supported host settings', async () => {
      const { room, host, events, persisted } = await (async () => {
        const { state, persisted } = makeDurableObjectState();
        const room = new GameRoom(state);
        await allocate(room, 'ABC234');
        const events: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', events);
        await negotiate(room, host, events, 'hello-options-host');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-options-host', nickname: 'Host' }),
        );
        await nextEvent(events, 'room:joined');
        await nextEvent(events, 'room:state');
        await nextEvent(events, 'command:ack');
        return { room, host, events, persisted };
      })();

      expect(getRoomSettings(room)).toMatchObject({
        roundDurationSeconds: 60,
        allowedLetters: alphabet,
      });
      expect(persisted.get('room')).toMatchObject({
        roundDurationSeconds: 60,
        allowedLetters: alphabet,
      });

      for (const [index, duration] of [60, 90, 120, 0].entries()) {
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:options:update',
            requestId: `options-duration-${index}`,
            roundDurationSeconds: duration,
            allowedLetters: ['A', 'Z'],
          }),
        );
        expect((await nextEvent(events, 'room:state')).state).toMatchObject({
          roundDurationSeconds: duration,
          allowedLetters: ['A', 'Z'],
        });
        await nextEvent(events, 'command:ack');
      }

      for (const [index, allowedLetters] of [
        [],
        ['a'],
        ['AA'],
        ['1'],
        ['A', 'A'],
      ].entries()) {
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:options:update',
            requestId: `options-invalid-${index}`,
            roundDurationSeconds: 90,
            allowedLetters,
          }),
        );
        expect(await nextEvent(events, 'error')).toMatchObject({
          code: 'INVALID_CONFIGURATION',
          requestId: `options-invalid-${index}`,
        });
      }
      for (const [index, duration] of [-1, 45, 121].entries()) {
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:options:update',
            requestId: `options-invalid-duration-${index}`,
            roundDurationSeconds: duration,
            allowedLetters: ['A'],
          }),
        );
        expect(await nextEvent(events, 'error')).toMatchObject({
          code: 'INVALID_CONFIGURATION',
          requestId: `options-invalid-duration-${index}`,
        });
      }
      expect(getRoomSettings(room)).toMatchObject({
        roundDurationSeconds: 0,
        allowedLetters: ['A', 'Z'],
      });
      expect(persisted.get('room')).toMatchObject({
        roundDurationSeconds: 0,
        allowedLetters: ['A', 'Z'],
      });

      const { guest, events: guestEvents } = await (async () => {
        const events: ServerEvent[] = [];
        const guest = await connect(room, 'ABC234', events);
        await negotiate(room, guest, events, 'hello-options-guest');
        room.webSocketMessage(
          guest,
          JSON.stringify({
            type: 'room:join',
            requestId: 'join-options-guest',
            code: 'ABC234',
            nickname: 'Guest',
          }),
        );
        await nextEvent(events, 'room:state');
        await nextEvent(events, 'command:ack');
        await nextEvent(events, 'room:state');
        return { guest, events };
      })();
      await nextEvent(events, 'room:state');
      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'lobby:options:update',
          requestId: 'options-not-host',
          roundDurationSeconds: 60,
          allowedLetters: ['A'],
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'NOT_HOST',
        requestId: 'options-not-host',
      });

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:options:update',
          requestId: 'options-valid-for-start',
          roundDurationSeconds: 120,
          allowedLetters: ['Q', 'Z'],
        }),
      );
      await nextEvent(events, 'room:state');
      await nextEvent(guestEvents, 'room:state');
      expect(getRoomSettings(room)).toMatchObject({
        roundDurationSeconds: 120,
        allowedLetters: ['Q', 'Z'],
      });
      await nextEvent(events, 'command:ack');
      room.webSocketMessage(host, JSON.stringify({ type: 'game:start', requestId: 'start-options' }));
      const hostRound = await nextEvent(events, 'round:started');
      const guestRound = await nextEvent(guestEvents, 'round:started');
      expect(hostRound.roundNumber).toBe(1);
      expect(['Q', 'Z']).toContain(hostRound.letter);
      expect(guestRound).toEqual(hostRound);
      expect(Math.abs(hostRound.deadline! - Date.now() - 120_000)).toBeLessThan(1_000);
      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'lobby:options:update',
          requestId: 'options-after-start',
          roundDurationSeconds: 60,
          allowedLetters: ['A'],
        }),
      );
      expect(await nextEvent(events, 'error')).toMatchObject({
        code: 'INVALID_PHASE',
        requestId: 'options-after-start',
      });
    });

    it('omits the round deadline for unlimited mode and assigns 30 seconds to each review category', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
        const state = makeDurableObjectState().state;
        const room = new GameRoom(state);
        await allocate(room, 'ABC234');
        const events: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', events);
        await negotiate(room, host, events, 'hello-unlimited-host');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-unlimited-host', nickname: 'Host' }),
        );
        await nextEvent(events, 'room:joined');
        await nextEvent(events, 'room:state');
        await nextEvent(events, 'command:ack');
        await joinActivePlayer(room, 'ABC234', 'Guest');
        await nextEvent(events, 'room:state');

        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:options:update',
            requestId: 'options-unlimited',
            roundDurationSeconds: 0,
            allowedLetters: ['A'],
          }),
        );
        await nextEvent(events, 'room:state');
        await nextEvent(events, 'command:ack');

        const alarm = (state.storage.setAlarm as ReturnType<typeof vi.fn>);
        alarm.mockClear();
        room.webSocketMessage(host, JSON.stringify({ type: 'game:start', requestId: 'start-unlimited' }));
        const started = await nextEvent(events, 'round:started');
        await nextEvent(events, 'command:ack');
        expect(started.letter).toBe('A');
        expect(started.deadline).toBeUndefined();
        expect(getRoomSettings(room).phase).toBe('ROUND_ACTIVE');
        expect(alarm).not.toHaveBeenCalled();

        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'round:stop',
            requestId: 'stop-unlimited',
            roundId: started.id,
          }),
        );
        const firstReview = await nextEvent(events, 'round:review:category');
        await nextEvent(events, 'command:ack');
        expect(Math.abs(firstReview.deadline! - Date.now() - 30_000)).toBeLessThan(1_000);

        vi.setSystemTime(firstReview.deadline! + 1);
        await room.alarm();
        const secondReview = await nextEvent(events, 'round:review:category');
        expect(secondReview.categoryIndex).toBe(1);
        expect(Math.abs(secondReview.deadline! - Date.now() - 30_000)).toBeLessThan(1_000);
        expect(secondReview.deadline! - firstReview.deadline!).toBeGreaterThanOrEqual(30_001);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('authoritative answer submission and round cutoff', () => {
    async function startRound(categories?: string[], totalRounds?: number) {
      const room = new GameRoom(makeDurableObjectState().state);
      await allocate(room, 'ABC234');
      const hostEvents: ServerEvent[] = [];
      const host = await connect(room, 'ABC234', hostEvents);
      await negotiate(room, host, hostEvents, 'hello-answer-host');
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'room:create', requestId: 'create-answer-host', nickname: 'Host' }),
      );
      await nextEvent(hostEvents, 'room:joined');
      await nextEvent(hostEvents, 'room:state');
      await nextEvent(hostEvents, 'command:ack');

      const guestEvents: ServerEvent[] = [];
      const guest = await connect(room, 'ABC234', guestEvents);
      await negotiate(room, guest, guestEvents, 'hello-answer-guest');
      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'room:join',
          requestId: 'join-answer-guest',
          code: 'ABC234',
          nickname: 'Guest',
        }),
      );
      await nextEvent(guestEvents, 'room:state');
      await nextEvent(guestEvents, 'command:ack');
      await nextEvent(hostEvents, 'room:state');

      if (categories) {
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:categories:update',
            requestId: 'configure-answer-categories',
            categories,
          }),
        );
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(guestEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
      }
      if (totalRounds !== undefined) {
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:rounds:update',
            requestId: 'configure-answer-round-count',
            totalRounds,
          }),
        );
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(guestEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
      }

      room.webSocketMessage(host, JSON.stringify({ type: 'game:start', requestId: 'start-answer-round' }));
      const started = await nextEvent(hostEvents, 'round:started');
      await nextEvent(guestEvents, 'round:started');
      await nextEvent(hostEvents, 'command:ack');
      return { room, host, guest, hostEvents, guestEvents, started };
    }

    function getRound(room: GameRoom) {
      return (room as unknown as {
        currentRoundData: {
          answers: Map<string, { value: string; isValid: boolean }>;
          stopperId: string | null;
        } | null;
        room: { phase: string; roundDeadline?: number };
      });
    }

    it('normalizes answers and computes automatic validity from the server letter', async () => {
      const { room, host, started, hostEvents } = await startRound();
      const categories = (room as unknown as { room: { categories: Array<{ id: string }> } })
        .room.categories;
      const wrongLetter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.replace(started.letter, '')[0];
      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-normalized-answers',
          roundId: started.id,
          answers: {
            [categories[0].id]: `  ${started.letter.toLowerCase()}na  `,
            [categories[1].id]: `${wrongLetter}rong Letter`,
            [categories[2].id]: '   ',
          },
        }),
      );
      await nextEvent(hostEvents, 'command:ack');
      const answers = Array.from(getRound(room).currentRoundData!.answers.values());
      expect(answers).toHaveLength(3);
      expect(answers.map((answer) => answer.isValid)).toEqual([
        true,
        false,
        false,
      ]);
      expect(answers.map((answer) => answer.value)).toEqual([
        `${started.letter}NA`,
        `${wrongLetter}RONG LETTER`,
        '',
      ]);
    });

    it('rejects foreign categories, stale rounds, and inactive players without mutating answers', async () => {
      const { room, guest, started, guestEvents } = await startRound();
      const roomPlayers = (room as unknown as {
        room: { players: Array<{ id: string; isHost: boolean; status: string }> };
      }).room.players;
      const guestId = roomPlayers.find((player) => !player.isHost)?.id;
      const answersBefore = getRound(room).currentRoundData?.answers.size;

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-unknown-category',
          roundId: started.id,
          answers: { 'cat-0': 'Valid category', 'cat-unknown': 'Invalid category' },
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'INVALID_ANSWER',
        requestId: 'submit-unknown-category',
      });

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-stale-round',
          roundId: 'round-999',
          answers: { 'cat-0': 'Test' },
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'ROUND_CLOSED',
        requestId: 'submit-stale-round',
      });
      if (guestId) {
        const player = roomPlayers.find((entry) => entry.id === guestId);
        if (player) player.status = 'disconnected';
      }
      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-inactive-player',
          roundId: started.id,
          answers: { 'cat-0': 'Test' },
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'NOT_ELIGIBLE',
        requestId: 'submit-inactive-player',
      });
      expect(getRound(room).currentRoundData?.answers.size).toBe(answersBefore);
    });

    it('includes a submission serialized before STOP and rejects submissions after the cutoff', async () => {
      const { room, host, started, hostEvents } = await startRound();
      const playerId = (room as unknown as { room: { players: Array<{ id: string; isHost: boolean }> } })
        .room.players.find((player) => player.isHost)!.id;
      const categoryId = (room as unknown as { room: { categories: Array<{ id: string }> } })
        .room.categories[0].id;
      const answer = `${started.letter}na`;

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-before-stop',
          roundId: started.id,
          answers: { [categoryId]: answer },
        }),
      );
      await nextEvent(hostEvents, 'command:ack');
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:stop', requestId: 'stop-after-submit', roundId: started.id }),
      );
      const review = await nextEvent(hostEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');
      expect(review.answers.find((item) => item.playerId === playerId)).toMatchObject({
        categoryId,
        value: answer.toUpperCase(),
        isValid: true,
      });
      expect(getRound(room).room.phase).toBe('CATEGORY_REVIEW');

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-after-stop',
          roundId: started.id,
          answers: { [categoryId]: 'Changed' },
        }),
      );
      expect(await nextEvent(hostEvents, 'error')).toMatchObject({
        code: 'ROUND_CLOSED',
        requestId: 'submit-after-stop',
      });
      expect(getRound(room).currentRoundData?.answers.get(`${playerId}:${categoryId}`)?.value)
        .toBe(answer.toUpperCase());

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'round:stop',
          requestId: 'duplicate-stop-after-cutoff',
          roundId: started.id,
        }),
      );
      expect(await nextEvent(hostEvents, 'error')).toMatchObject({
        code: 'ROUND_CLOSED',
        requestId: 'duplicate-stop-after-cutoff',
      });
      expect(hostEvents.filter((event) => event.type === 'round:review:category')).toHaveLength(0);
    });

    it('uses an exclusive server deadline for late submissions and closes the round once', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
        const { room, guest, started, guestEvents, hostEvents } = await startRound();
        const deadline = started.deadline!;
        const guestId = (room as unknown as {
          room: { players: Array<{ id: string; isHost: boolean }> };
        }).room.players.find((player) => !player.isHost)!.id;
        vi.setSystemTime(deadline - 1);
        room.webSocketMessage(
          guest,
          JSON.stringify({
            type: 'answer:submit',
            requestId: 'submit-before-deadline',
            roundId: started.id,
            answers: { 'cat-0': `${started.letter}te` },
          }),
        );
        await nextEvent(guestEvents, 'command:ack');

        vi.setSystemTime(deadline);
        room.webSocketMessage(
          guest,
          JSON.stringify({
            type: 'answer:submit',
            requestId: 'submit-at-deadline',
            roundId: started.id,
            answers: { 'cat-0': `${started.letter}changed` },
          }),
        );
        expect(await nextEvent(guestEvents, 'error')).toMatchObject({
          code: 'ROUND_CLOSED',
          requestId: 'submit-at-deadline',
        });
        const hostReview = await nextEvent(hostEvents, 'round:review:category');
        const guestReview = await nextEvent(guestEvents, 'round:review:category');
        expect(hostReview).toMatchObject({
          categoryIndex: 0,
        });
        expect(guestReview).toEqual(hostReview);
        expect(hostReview.answers.find((answer) => answer.playerId === guestId)).toMatchObject({
          value: `${started.letter}TE`,
          isValid: true,
        });
        expect(getRound(room).room.phase).toBe('CATEGORY_REVIEW');

        await room.alarm();
        expect(getRound(room).room.phase).toBe('CATEGORY_REVIEW');
        expect(hostEvents.filter((event) => event.type === 'round:review:category')).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('routes explicit votes to hyphenated player IDs and rejects self, ineligible, wrong-category, and duplicate votes', async () => {
      const { room, host, guest, started, hostEvents, guestEvents } = await startRound();
      const roomState = (room as unknown as {
        room: { players: Array<{ id: string; isHost: boolean; status: string }>; categories: Array<{ id: string }> };
      }).room;
      const hostId = roomState.players.find((player) => player.isHost)!.id;
      const guestId = roomState.players.find((player) => !player.isHost)!.id;
      const activeCategoryId = roomState.categories[0].id;
      expect(hostId).toContain('-');
      expect(guestId).toContain('-');

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-vote-guest',
          roundId: started.id,
          answers: { [activeCategoryId]: `${started.letter}rango` },
        }),
      );
      await nextEvent(guestEvents, 'command:ack');
      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-vote-host',
          roundId: started.id,
          answers: { [activeCategoryId]: `${started.letter}osa` },
        }),
      );
      await nextEvent(hostEvents, 'command:ack');

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:stop', requestId: 'stop-before-votes', roundId: started.id }),
      );
      await nextEvent(hostEvents, 'round:review:category');
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-own-answer',
          roundId: started.id,
          categoryId: activeCategoryId,
          answerPlayerId: guestId,
          decision: 'invalidate',
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'SELF_VOTE',
        requestId: 'vote-own-answer',
      });

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-wrong-category',
          roundId: started.id,
          categoryId: roomState.categories[1].id,
          answerPlayerId: hostId,
          decision: 'invalidate',
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'INVALID_VOTE',
        requestId: 'vote-wrong-category',
      });

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-hyphenated-author',
          roundId: started.id,
          categoryId: activeCategoryId,
          answerPlayerId: guestId,
          decision: 'invalidate',
        }),
      );
      const hostUpdate = await nextEvent(hostEvents, 'round:review:category');
      const guestUpdate = await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');
      expect(guestUpdate).toEqual(hostUpdate);
      expect(hostUpdate.answers.find((answer) => answer.playerId === guestId)).toMatchObject({
        votes: { [hostId]: 'invalidate' },
        invalidations: [hostId],
      });

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-hyphenated-author',
          roundId: started.id,
          categoryId: activeCategoryId,
          answerPlayerId: guestId,
          decision: 'valid',
        }),
      );
      expect(await nextEvent(hostEvents, 'error')).toMatchObject({
        code: 'ALREADY_PROCESSED',
        requestId: 'vote-hyphenated-author',
      });

      const spectatorEvents: ServerEvent[] = [];
      const spectator = await connect(room, 'ABC234', spectatorEvents);
      await negotiate(room, spectator, spectatorEvents, 'hello-spectator-vote');
      room.webSocketMessage(
        spectator,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-ineligible',
          roundId: started.id,
          categoryId: activeCategoryId,
          answerPlayerId: guestId,
          decision: 'valid',
        }),
      );
      expect(await nextEvent(spectatorEvents, 'error')).toMatchObject({
        code: 'NOT_ELIGIBLE',
        requestId: 'vote-ineligible',
      });
    });

    it('commits each category once after all votes and broadcasts score/category events in order', async () => {
      const { room, host, guest, started, hostEvents, guestEvents } = await startRound([
        'Animal',
        'Cidade',
      ]);
      const roomState = (room as unknown as {
        room: { players: Array<{ id: string; isHost: boolean }>; categories: Array<{ id: string }> };
      }).room;
      const hostId = roomState.players.find((player) => player.isHost)!.id;
      const guestId = roomState.players.find((player) => !player.isHost)!.id;
      const [animal, city] = roomState.categories;
      const hostAnimal = `${started.letter}A`;
      const guestAnimal = `${started.letter}B`;
      const hostCity = `${started.letter}C`;
      const guestCity = `${started.letter}D`;

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-all-host-categories',
          roundId: started.id,
          answers: { [animal.id]: hostAnimal, [city.id]: hostCity },
        }),
      );
      await nextEvent(hostEvents, 'command:ack');
      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-all-guest-categories',
          roundId: started.id,
          answers: { [animal.id]: guestAnimal, [city.id]: guestCity },
        }),
      );
      await nextEvent(guestEvents, 'command:ack');

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:stop', requestId: 'stop-review-all-votes', roundId: started.id }),
      );
      expect(await nextEvent(hostEvents, 'round:review:category')).toMatchObject({ categoryIndex: 0 });
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-guest-animal-valid',
          roundId: started.id,
          categoryId: animal.id,
          answerPlayerId: guestId,
          decision: 'valid',
        }),
      );
      await nextEvent(hostEvents, 'round:review:category');
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-host-animal-valid',
          roundId: started.id,
          categoryId: animal.id,
          answerPlayerId: hostId,
          decision: 'valid',
        }),
      );
      const completedCategory = await nextEvent(hostEvents, 'round:review:category');
      const categoryZeroScore = await nextEvent(hostEvents, 'round:review:score_update');
      const categoryOne = await nextEvent(hostEvents, 'round:review:category');
      expect(completedCategory.categoryIndex).toBe(0);
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(guestEvents, 'round:review:score_update');
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(guestEvents, 'command:ack');

      expect(categoryZeroScore).toMatchObject({
        categoryIndex: 0,
        categoryScores: { [hostId]: 10, [guestId]: 10 },
        scoreboard: [
          expect.objectContaining({ id: hostId, score: 10 }),
          expect.objectContaining({ id: guestId, score: 10 }),
        ],
      });
      expect(categoryOne).toMatchObject({ categoryIndex: 1, category: city });

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-guest-city-valid',
          roundId: started.id,
          categoryId: city.id,
          answerPlayerId: guestId,
          decision: 'valid',
        }),
      );
      await nextEvent(hostEvents, 'round:review:category');
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:vote',
          requestId: 'vote-host-city-valid',
          roundId: started.id,
          categoryId: city.id,
          answerPlayerId: hostId,
          decision: 'valid',
        }),
      );
      const secondCategoryScore = await nextEvent(hostEvents, 'round:review:score_update');
      const results = await nextEvent(hostEvents, 'round:results');
      await nextEvent(guestEvents, 'round:review:score_update');
      await nextEvent(guestEvents, 'round:results');
      await nextEvent(guestEvents, 'command:ack');

      expect(secondCategoryScore).toMatchObject({
        categoryIndex: 1,
        categoryScores: { [hostId]: 10, [guestId]: 10 },
        scoreboard: expect.arrayContaining([
          expect.objectContaining({ id: hostId, score: 20 }),
          expect.objectContaining({ id: guestId, score: 20 }),
        ]),
      });
      expect(results.ranking).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: hostId, score: 30 }),
        expect.objectContaining({ id: guestId, score: 20 }),
      ]));

      await room.alarm();
      expect(hostEvents.filter((event) => event.type === 'round:review:score_update')).toHaveLength(0);
      expect(getRound(room).room.phase).toBe('ROUND_RESULTS');
    });

    it('commits full points for missing votes when the category deadline expires', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
        const { room, host, started, hostEvents } = await startRound(['Animal']);
        const hostId = (room as unknown as {
          room: { players: Array<{ id: string; isHost: boolean }>; categories: Array<{ id: string }> };
        }).room.players.find((player) => player.isHost)!.id;
        const categoryId = (room as unknown as {
          room: { categories: Array<{ id: string }> };
        }).room.categories[0].id;

        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'answer:submit',
            requestId: 'submit-for-review-timeout',
            roundId: started.id,
            answers: { [categoryId]: `${started.letter}na` },
          }),
        );
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'round:stop', requestId: 'stop-for-review-timeout', roundId: started.id }),
        );
        const review = await nextEvent(hostEvents, 'round:review:category');
        await nextEvent(hostEvents, 'command:ack');
        expect(review.deadline).toBeGreaterThan(Date.now());

        vi.setSystemTime(review.deadline! + 1);
        await room.alarm();
        const scoreUpdate = await nextEvent(hostEvents, 'round:review:score_update');
        const results = await nextEvent(hostEvents, 'round:results');

        expect(scoreUpdate).toMatchObject({
          categoryIndex: 0,
          categoryScores: { [hostId]: 10 },
          scoreboard: expect.arrayContaining([expect.objectContaining({ id: hostId, score: 10 })]),
        });
        expect(results.ranking).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: hostId, score: 20 }),
        ]));
        expect(getRound(room).room.phase).toBe('ROUND_RESULTS');
      } finally {
        vi.useRealTimers();
      }
    });

    it('allows the active host to advance category review manually via round:review:next', async () => {
      const { room, host, guest, started, hostEvents, guestEvents } = await startRound([
        'Animal',
        'Cidade',
      ]);
      const roomState = (room as unknown as {
        room: { players: Array<{ id: string; isHost: boolean }>; categories: Array<{ id: string }> };
      }).room;
      const hostId = roomState.players.find((player) => player.isHost)!.id;
      const guestId = roomState.players.find((player) => !player.isHost)!.id;
      const [animal, city] = roomState.categories;

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-host-manual-review',
          roundId: started.id,
          answers: {
            [animal.id]: `${started.letter}A`,
            [city.id]: `${started.letter}C`,
          },
        }),
      );
      await nextEvent(hostEvents, 'command:ack');
      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'answer:submit',
          requestId: 'submit-guest-manual-review',
          roundId: started.id,
          answers: {
            [animal.id]: `${started.letter}B`,
            [city.id]: `${started.letter}D`,
          },
        }),
      );
      await nextEvent(guestEvents, 'command:ack');

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:stop', requestId: 'stop-manual-review', roundId: started.id }),
      );
      expect(await nextEvent(hostEvents, 'round:review:category')).toMatchObject({ categoryIndex: 0 });
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');
      expect(getRound(room).room.phase).toBe('CATEGORY_REVIEW');

      room.webSocketMessage(
        guest,
        JSON.stringify({
          type: 'round:review:next',
          requestId: 'guest-manual-review-next',
          roundId: started.id,
        }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'NOT_HOST',
        requestId: 'guest-manual-review-next',
      });
      expect(getRound(room).room.phase).toBe('CATEGORY_REVIEW');
      expect(getRound(room).room.currentReviewCategoryIndex).toBe(0);

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'round:review:next',
          requestId: 'host-manual-review-next-0',
          roundId: started.id,
        }),
      );
      const categoryZeroScore = await nextEvent(hostEvents, 'round:review:score_update');
      const categoryOne = await nextEvent(hostEvents, 'round:review:category');
      await nextEvent(guestEvents, 'round:review:score_update');
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');

      expect(categoryZeroScore).toMatchObject({
        categoryIndex: 0,
        categoryScores: { [hostId]: 10, [guestId]: 10 },
      });
      expect(categoryOne).toMatchObject({ categoryIndex: 1, category: city });
      expect(getRound(room).room.currentReviewCategoryIndex).toBe(1);

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'round:review:next',
          requestId: 'host-manual-review-next-1',
          roundId: started.id,
        }),
      );
      const categoryOneScore = await nextEvent(hostEvents, 'round:review:score_update');
      const results = await nextEvent(hostEvents, 'round:results');
      await nextEvent(guestEvents, 'round:review:score_update');
      await nextEvent(guestEvents, 'round:results');
      await nextEvent(hostEvents, 'command:ack');

      expect(categoryOneScore).toMatchObject({ categoryIndex: 1 });
      expect(results.ranking).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: hostId }),
        expect.objectContaining({ id: guestId }),
      ]));
      expect(getRound(room).room.phase).toBe('ROUND_RESULTS');

      room.webSocketMessage(
        host,
        JSON.stringify({
          type: 'round:review:next',
          requestId: 'host-manual-review-after-results',
          roundId: started.id,
        }),
      );
      expect(await nextEvent(hostEvents, 'error')).toMatchObject({
        code: 'INVALID_PHASE',
        requestId: 'host-manual-review-after-results',
      });
    });

    it('allows only the host to advance results and rejects stale or repeated next-round requests', async () => {
      const { room, host, guest, started, hostEvents, guestEvents } = await startRound(['Animal']);
      const roomState = (room as unknown as {
        room: { players: Array<{ id: string; isHost: boolean }>; categories: Array<{ id: string }> };
      }).room;
      const hostId = roomState.players.find((player) => player.isHost)!.id;
      const guestId = roomState.players.find((player) => !player.isHost)!.id;
      const categoryId = roomState.categories[0].id;

      for (const [socket, events, requestId, value] of [
        [host, hostEvents, 'submit-next-host-answer', `${started.letter}A`],
        [guest, guestEvents, 'submit-next-guest-answer', `${started.letter}B`],
      ] as const) {
        room.webSocketMessage(
          socket,
          JSON.stringify({
            type: 'answer:submit',
            requestId,
            roundId: started.id,
            answers: { [categoryId]: value },
          }),
        );
        await nextEvent(events, 'command:ack');
      }

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:stop', requestId: 'stop-before-next', roundId: started.id }),
      );
      await nextEvent(hostEvents, 'round:review:category');
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');
      for (const [socket, events, requestId, answerPlayerId] of [
        [host, hostEvents, 'vote-guest-before-next', guestId],
        [guest, guestEvents, 'vote-host-before-next', hostId],
      ] as const) {
        room.webSocketMessage(
          socket,
          JSON.stringify({
            type: 'answer:vote',
            requestId,
            roundId: started.id,
            categoryId,
            answerPlayerId,
            decision: 'valid',
          }),
        );
        await nextEvent(events, 'command:ack');
      }
      await nextEvent(hostEvents, 'round:review:category');
      const results = await nextEvent(hostEvents, 'round:results');
      await nextEvent(guestEvents, 'round:results');
      expect(results.ranking).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: hostId, score: 20 }),
        expect.objectContaining({ id: guestId, score: 10 }),
      ]));
      expect((room as unknown as { room: { phase: string } }).room.phase).toBe('ROUND_RESULTS');

      room.webSocketMessage(
        guest,
        JSON.stringify({ type: 'round:next', requestId: 'guest-next-round', roundId: started.id }),
      );
      expect(await nextEvent(guestEvents, 'error')).toMatchObject({
        code: 'NOT_HOST',
        requestId: 'guest-next-round',
      });

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:next', requestId: 'host-next-round', roundId: 'stale-round' }),
      );
      expect(await nextEvent(hostEvents, 'error')).toMatchObject({
        code: 'ROUND_CLOSED',
        requestId: 'host-next-round',
      });

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:next', requestId: 'advance-round-1', roundId: started.id }),
      );
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:next', requestId: 'concurrent-next-round', roundId: started.id }),
      );
      const nextHostRound = await nextEvent(hostEvents, 'round:started');
      const nextGuestRound = await nextEvent(guestEvents, 'round:started');
      expect(await nextEvent(hostEvents, 'error')).toMatchObject({
        code: 'ROUND_CLOSED',
        requestId: 'concurrent-next-round',
      });
      expect(nextHostRound).toMatchObject({ id: 'round-2', roundNumber: 2 });
      expect(nextGuestRound).toEqual(nextHostRound);
      expect((room as unknown as { room: { currentRound: number; phase: string } }).room)
        .toMatchObject({ currentRound: 2, phase: 'ROUND_ACTIVE' });
      await nextEvent(hostEvents, 'command:ack');
    });

    it('finishes the final round without waiting for a next-round command', async () => {
      const { room, host, guest, started, hostEvents, guestEvents } = await startRound(['Animal'], 1);
      const roomState = (room as unknown as {
        room: { players: Array<{ id: string; isHost: boolean }>; categories: Array<{ id: string }> };
      }).room;
      const hostId = roomState.players.find((player) => player.isHost)!.id;
      const guestId = roomState.players.find((player) => !player.isHost)!.id;
      const categoryId = roomState.categories[0].id;

      for (const [socket, events, requestId, value] of [
        [host, hostEvents, 'submit-final-host', `${started.letter}A`],
        [guest, guestEvents, 'submit-final-guest', `${started.letter}B`],
      ] as const) {
        room.webSocketMessage(
          socket,
          JSON.stringify({
            type: 'answer:submit',
            requestId,
            roundId: started.id,
            answers: { [categoryId]: value },
          }),
        );
        await nextEvent(events, 'command:ack');
      }
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:stop', requestId: 'stop-final-round', roundId: started.id }),
      );
      await nextEvent(hostEvents, 'round:review:category');
      await nextEvent(guestEvents, 'round:review:category');
      await nextEvent(hostEvents, 'command:ack');
      for (const [socket, events, requestId, answerPlayerId] of [
        [host, hostEvents, 'vote-final-guest', guestId],
        [guest, guestEvents, 'vote-final-host', hostId],
      ] as const) {
        room.webSocketMessage(
          socket,
          JSON.stringify({
            type: 'answer:vote',
            requestId,
            roundId: started.id,
            categoryId,
            answerPlayerId,
            decision: 'valid',
          }),
        );
        await nextEvent(events, 'command:ack');
      }

      await nextEvent(hostEvents, 'round:review:category');
      const results = await nextEvent(hostEvents, 'round:results');
      const guestResults = await nextEvent(guestEvents, 'round:results');
      const finalHost = await nextEvent(hostEvents, 'game:final_results');
      const finalGuest = await nextEvent(guestEvents, 'game:final_results');
      expect(results.ranking).toEqual(guestResults.ranking);
      expect(finalGuest).toEqual(finalHost);
      expect(finalHost.list).toEqual([]);
      expect(finalHost.podium).toEqual(expect.arrayContaining([
        expect.objectContaining({ playerId: hostId, score: 20 }),
        expect.objectContaining({ playerId: guestId, score: 10 }),
      ]));
      expect((room as unknown as { room: { phase: string } }).room.phase).toBe('GAME_OVER');

      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'round:next', requestId: 'next-after-final', roundId: started.id }),
      );
      expect(await nextEvent(hostEvents, 'error')).toMatchObject({
        code: 'ROUND_CLOSED',
        requestId: 'next-after-final',
      });
    });
  });

  describe('resume sessions', () => {
    it('restores active round answers, letter, deadline, and current round from the same storage', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
        const { state } = makeDurableObjectState();
        const room = new GameRoom(state);
        await allocate(room, 'ABC234');
        const hostEvents: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', hostEvents);
        await negotiate(room, host, hostEvents, 'hello-recovery-active');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-recovery-active', nickname: 'Host' }),
        );
        await nextEvent(hostEvents, 'room:joined');
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
        await joinActivePlayer(room, 'ABC234', 'Guest');
        await nextEvent(hostEvents, 'room:state');

        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:categories:update',
            requestId: 'recovery-active-category',
            categories: ['Animal'],
          }),
        );
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:options:update',
            requestId: 'recovery-active-options',
            roundDurationSeconds: 60,
            allowedLetters: ['A'],
          }),
        );
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(host, JSON.stringify({ type: 'game:start', requestId: 'start-recovery-active' }));
        const started = await nextEvent(hostEvents, 'round:started');
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'answer:submit',
            requestId: 'submit-recovery-active',
            roundId: started.id,
            answers: { 'cat-0': 'Anta' },
          }),
        );
        await nextEvent(hostEvents, 'command:ack');

        const hostId = (room as unknown as {
          room: { players: Array<{ id: string; isHost: boolean }> };
        }).room.players.find((player) => player.isHost)!.id;
        const restoredRoom = new GameRoom(state);
        const restoredState = (restoredRoom as unknown as {
          room: { phase: string; currentRound: number; currentLetter?: string; roundDeadline?: number };
          currentRoundData: {
            letter: string;
            answers: Map<string, { value: string; isValid: boolean }>;
          } | null;
        });
        await vi.waitFor(() => {
          expect(restoredState.room.phase).toBe('ROUND_ACTIVE');
          expect(restoredState.currentRoundData?.answers.get(`${hostId}:cat-0`))
            .toMatchObject({ value: 'ANTA', isValid: true });
        });
        expect(restoredState.room).toMatchObject({
          currentRound: 1,
          currentLetter: 'A',
          roundDeadline: started.deadline,
        });
        expect(restoredState.currentRoundData?.letter).toBe('A');
        expect(state.storage.setAlarm).toHaveBeenLastCalledWith(started.deadline);
      } finally {
        vi.useRealTimers();
      }
    });

    it('restores review votes and stopper, then reconciles an expired alarm exactly once', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
        const { state } = makeDurableObjectState();
        const room = new GameRoom(state);
        await allocate(room, 'ABC234');
        const hostEvents: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', hostEvents);
        await negotiate(room, host, hostEvents, 'hello-recovery-review-host');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-recovery-review', nickname: 'Host' }),
        );
        const joined = await nextEvent(hostEvents, 'room:joined');
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
        async function joinRecoveryPlayer(nickname: string, suffix: string) {
          const events: ServerEvent[] = [];
          const socket = await connect(room, 'ABC234', events);
          await negotiate(room, socket, events, `hello-${suffix}`);
          room.webSocketMessage(
            socket,
            JSON.stringify({
              type: 'room:join',
              requestId: `join-${suffix}`,
              code: 'ABC234',
              nickname,
            }),
          );
          await nextEvent(events, 'room:state');
          await nextEvent(events, 'command:ack');
          await nextEvent(hostEvents, 'room:state');
          return { socket, events };
        }
        const { socket: guestOne, events: guestOneEvents } =
          await joinRecoveryPlayer('Guest One', 'recovery-guest-one');
        const { socket: guestTwo, events: guestTwoEvents } =
          await joinRecoveryPlayer('Guest Two', 'recovery-guest-two');

        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:categories:update',
            requestId: 'recovery-review-category',
            categories: ['Animal'],
          }),
        );
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(guestOneEvents, 'room:state');
        await nextEvent(guestTwoEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:rounds:update',
            requestId: 'recovery-review-rounds',
            totalRounds: 1,
          }),
        );
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(guestOneEvents, 'room:state');
        await nextEvent(guestTwoEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'lobby:options:update',
            requestId: 'recovery-review-options',
            roundDurationSeconds: 60,
            allowedLetters: ['A'],
          }),
        );
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(guestOneEvents, 'room:state');
        await nextEvent(guestTwoEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(host, JSON.stringify({ type: 'game:start', requestId: 'start-recovery-review' }));
        const started = await nextEvent(hostEvents, 'round:started');
        await nextEvent(hostEvents, 'command:ack');

        const playerIds = (room as unknown as {
          room: { players: Array<{ id: string; isHost: boolean }> };
        }).room.players;
        const hostId = playerIds.find((player) => player.isHost)!.id;
        const authorKey = `${hostId}:cat-0`;
        room.webSocketMessage(
          host,
          JSON.stringify({
            type: 'answer:submit',
            requestId: 'recovery-submit-author',
            roundId: started.id,
            answers: { 'cat-0': 'Anta' },
          }),
        );
        await nextEvent(hostEvents, 'command:ack');
        room.webSocketMessage(
          guestOne,
          JSON.stringify({
            type: 'answer:submit',
            requestId: 'recovery-submit-guest-one',
            roundId: started.id,
            answers: { 'cat-0': 'Arara' },
          }),
        );
        await nextEvent(guestOneEvents, 'command:ack');
        room.webSocketMessage(
          guestTwo,
          JSON.stringify({
            type: 'answer:submit',
            requestId: 'recovery-submit-guest-two',
            roundId: started.id,
            answers: { 'cat-0': 'Abelha' },
          }),
        );
        await nextEvent(guestTwoEvents, 'command:ack');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'round:stop', requestId: 'stop-recovery-review', roundId: started.id }),
        );
        const review = await nextEvent(hostEvents, 'round:review:category');
        await nextEvent(hostEvents, 'command:ack');
        const guestId = playerIds.find((player) => !player.isHost)!.id;
        room.webSocketMessage(
          guestOne,
          JSON.stringify({
            type: 'answer:vote',
            requestId: 'vote-recovery-review',
            roundId: started.id,
            categoryId: 'cat-0',
            answerPlayerId: hostId,
            decision: 'invalidate',
          }),
        );
        await nextEvent(guestOneEvents, 'round:review:category');
        await nextEvent(hostEvents, 'round:review:category');
        await nextEvent(guestOneEvents, 'command:ack');

        const restoredRoom = new GameRoom(state);
        const restored = restoredRoom as unknown as {
          room: { phase: string; reviewDeadline?: number; players: Array<{ id: string; score: number }> };
          currentRoundData: {
            stopperId: string | null;
            answers: Map<string, { votes?: Record<string, string>; eligibleVoters?: string[] }>;
            scoredCategoryIndexes: Set<number>;
          } | null;
        };
        await vi.waitFor(() => {
          expect(restored.room.phase).toBe('CATEGORY_REVIEW');
          expect(restored.currentRoundData?.answers.get(authorKey)?.votes?.[guestId]).toBe('invalidate');
        });
        expect(restored.currentRoundData?.stopperId).toBe(hostId);
        expect(restored.currentRoundData?.answers.get(authorKey)?.eligibleVoters).toContain(guestId);
        expect(restored.currentRoundData?.scoredCategoryIndexes.size).toBe(0);
        expect(restored.room.reviewDeadline).toBe(review.deadline);

        vi.setSystemTime(review.deadline! + 1);
        const beforeAlarmScore = restored.room.players.find((player) => player.id === hostId)!.score;
        const recoveredAfterDowntime = new GameRoom(state);
        const scoreUpdate = await nextEvent(hostEvents, 'round:review:score_update');
        expect(scoreUpdate.categoryScores[hostId]).toBe(5);
        expect(
          (recoveredAfterDowntime as unknown as { room: { players: Array<{ id: string; score: number }> } })
            .room.players.find((player) => player.id === hostId)!.score,
        ).toBe(beforeAlarmScore + 15);
        await nextEvent(hostEvents, 'round:results');
        await nextEvent(hostEvents, 'game:final_results');

        const recoveredState = recoveredAfterDowntime as unknown as {
          room: { phase: string; players: Array<{ id: string; score: number }> };
          currentRoundData: { scoredCategoryIndexes: Set<number> } | null;
        };
        expect(recoveredState.room.phase).toBe('GAME_OVER');
        expect(recoveredState.currentRoundData?.scoredCategoryIndexes).toContain(0);
        const scoreAfterRecovery = recoveredState.room.players.find((player) => player.id === hostId)!.score;
        await recoveredAfterDowntime.alarm();
        expect(recoveredState.room.players.find((player) => player.id === hostId)!.score).toBe(scoreAfterRecovery);
        expect(hostEvents.filter((event) => event.type === 'round:review:score_update')).toHaveLength(0);

        const finalReplayEvents: ServerEvent[] = [];
        const finalReplaySocket = await connect(recoveredAfterDowntime, 'ABC234', finalReplayEvents);
        await negotiate(recoveredAfterDowntime, finalReplaySocket, finalReplayEvents, 'hello-final-replay');
        recoveredAfterDowntime.webSocketMessage(
          finalReplaySocket,
          JSON.stringify({
            type: 'session:resume',
            requestId: 'resume-after-final',
            resumeToken: joined.resumeToken,
          }),
        );
        const resumed = await nextEvent(finalReplayEvents, 'session:resumed');
        expect(resumed.state.phase).toBe('GAME_OVER');
        await nextEvent(finalReplayEvents, 'player:presence');
        await nextEvent(finalReplayEvents, 'room:state');
        expect(await nextEvent(finalReplayEvents, 'game:final_results')).toMatchObject({
          podium: expect.arrayContaining([expect.objectContaining({ playerId: hostId, score: scoreAfterRecovery })]),
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps credentials private and persists only token verifiers', async () => {
      const { state, persisted } = makeDurableObjectState();
      const room = new GameRoom(state);
      await allocate(room, 'ABC234');
      const events: ServerEvent[] = [];
      const socket = await connect(room, 'ABC234', events);
      await negotiate(room, socket, events, 'hello-create');

      room.webSocketMessage(
        socket,
        JSON.stringify({ type: 'room:create', requestId: 'create-private', nickname: 'Host' }),
      );
      const joined = await nextEvent(events, 'room:joined');
      await nextEvent(events, 'room:state');
      await nextEvent(events, 'command:ack');

      expect(joined.resumeToken).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(persisted.get('resumeCredentials'))).not.toContain(joined.resumeToken);
      expect(events.every((event) => JSON.stringify(event).indexOf(joined.resumeToken) === -1)).toBe(true);
    });

    it('rejects invalid tokens and rotates credentials when restoring a player', async () => {
      const { state, persisted } = makeDurableObjectState();
      const room = new GameRoom(state);
      await allocate(room, 'ABC234');
      const firstEvents: ServerEvent[] = [];
      const firstSocket = await connect(room, 'ABC234', firstEvents);
      await negotiate(room, firstSocket, firstEvents, 'hello-first');
      room.webSocketMessage(
        firstSocket,
        JSON.stringify({ type: 'room:create', requestId: 'create-first', nickname: 'Host' }),
      );
      const created = await nextEvent(firstEvents, 'room:joined');
      await nextEvent(firstEvents, 'room:state');
      await nextEvent(firstEvents, 'command:ack');
      const playerId = created.playerId;
      const firstToken = created.resumeToken;
      const verifierBeforeResume = (persisted.get('resumeCredentials') as Array<{ tokenVerifier: string }>)[0]
        .tokenVerifier;

      const expiredToken = 'expired-session-token';
      const expiredDigest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(expiredToken),
      );
      persisted.set('resumeCredentials', [
        ...(persisted.get('resumeCredentials') as Array<Record<string, unknown>>),
        {
          playerId,
          tokenVerifier: Array.from(new Uint8Array(expiredDigest), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
          issuedAt: Date.now() - 1000,
          expiresAt: Date.now() - 1,
        },
      ]);
      const invalidEvents: ServerEvent[] = [];
      const invalidSocket = await connect(room, 'ABC234', invalidEvents);
      await negotiate(room, invalidSocket, invalidEvents, 'hello-invalid');
      room.webSocketMessage(
        invalidSocket,
        JSON.stringify({
          type: 'session:resume',
          requestId: 'resume-invalid',
          resumeToken: expiredToken,
        }),
      );
      expect(await nextEvent(invalidEvents, 'error')).toMatchObject({
        code: 'SESSION_INVALID',
        requestId: 'resume-invalid',
      });

      room.webSocketClose(invalidSocket);
      const resumedEvents: ServerEvent[] = [];
      const resumedSocket = await connect(room, 'ABC234', resumedEvents);
      await negotiate(room, resumedSocket, resumedEvents, 'hello-resume');
      room.webSocketMessage(
        resumedSocket,
        JSON.stringify({
          type: 'session:resume',
          requestId: 'resume-valid',
          resumeToken: firstToken,
        }),
      );

      const resumed = await nextEvent(resumedEvents, 'session:resumed');
      expect(resumed).toMatchObject({
        playerId,
        state: {
          code: 'ABC234',
          players: [{ id: playerId, nickname: 'Host', isHost: true, status: 'active' }],
        },
      });
      expect(resumed.resumeToken).not.toBe(firstToken);
      const verifierAfterResume = (persisted.get('resumeCredentials') as Array<{ tokenVerifier: string }>)[0]
        .tokenVerifier;
      expect(verifierAfterResume).not.toBe(verifierBeforeResume);
      await nextEvent(resumedEvents, 'player:presence');
      await nextEvent(resumedEvents, 'room:state');
      await nextEvent(resumedEvents, 'command:ack');
      expect(
        [...(room as unknown as { sessions: Map<WebSocket, string> }).sessions.values()].filter(
          (id) => id === playerId,
        ),
      ).toHaveLength(1);
      expect(firstSocket.readyState).toBe(WebSocket.CLOSED);

      room.webSocketClose(resumedSocket);
      const replayEvents: ServerEvent[] = [];
      const replaySocket = await connect(room, 'ABC234', replayEvents);
      await negotiate(room, replaySocket, replayEvents, 'hello-old-token');
      room.webSocketMessage(
        replaySocket,
        JSON.stringify({
          type: 'session:resume',
          requestId: 'resume-old-token',
          resumeToken: firstToken,
        }),
      );
      expect(await nextEvent(replayEvents, 'error')).toMatchObject({
        code: 'SESSION_INVALID',
        requestId: 'resume-old-token',
      });
    });

    it('restores the same player and replays the active round event', async () => {
      const { state } = makeDurableObjectState();
      const room = new GameRoom(state);
      await allocate(room, 'ABC234');
      const events: ServerEvent[] = [];
      const host = await connect(room, 'ABC234', events);
      await negotiate(room, host, events, 'hello-host');
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'room:create', requestId: 'create-host', nickname: 'Host' }),
      );
      const joined = await nextEvent(events, 'room:joined');
      await nextEvent(events, 'room:state');
      await nextEvent(events, 'command:ack');
      await joinActivePlayer(room, 'ABC234', 'Guest');
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'game:start', requestId: 'start-game' }),
      );
      const started = await nextEvent(events, 'round:started');
      await nextEvent(events, 'command:ack');
      room.webSocketClose(host);

      const resumedEvents: ServerEvent[] = [];
      const resumedSocket = await connect(room, 'ABC234', resumedEvents);
      await negotiate(room, resumedSocket, resumedEvents, 'hello-active-resume');
      room.webSocketMessage(
        resumedSocket,
        JSON.stringify({
          type: 'session:resume',
          requestId: 'resume-active',
          resumeToken: joined.resumeToken,
        }),
      );

      expect(await nextEvent(resumedEvents, 'session:resumed')).toMatchObject({
        playerId: joined.playerId,
        state: { phase: 'ROUND_ACTIVE', currentRound: 1 },
      });
      expect(await nextEvent(resumedEvents, 'player:presence')).toMatchObject({
        id: joined.playerId,
        status: 'active',
      });
      await nextEvent(resumedEvents, 'room:state');
      expect(await nextEvent(resumedEvents, 'round:started')).toMatchObject({
        id: started.id,
        letter: started.letter,
        deadline: started.deadline,
      });
    });

    it('replays the active category review after the same player resumes', async () => {
        const room = new GameRoom(makeDurableObjectState().state);
        await allocate(room, 'ABC234');
        const events: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', events);
        await negotiate(room, host, events, 'hello-review-host');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-review-host', nickname: 'Host' }),
        );
        const joined = await nextEvent(events, 'room:joined');
        await nextEvent(events, 'room:state');
        await nextEvent(events, 'command:ack');
        await joinActivePlayer(room, 'ABC234', 'Guest');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'game:start', requestId: 'start-review-game' }),
        );
        const started = await nextEvent(events, 'round:started');
        await nextEvent(events, 'command:ack');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'round:stop', requestId: 'stop-review-round', roundId: started.id }),
        );
        const review = await nextEvent(events, 'round:review:category');
        await nextEvent(events, 'command:ack');

        const resumedEvents: ServerEvent[] = [];
        const resumedSocket = await connect(room, 'ABC234', resumedEvents);
        await negotiate(room, resumedSocket, resumedEvents, 'hello-review-resume');
        room.webSocketMessage(
          resumedSocket,
          JSON.stringify({
            type: 'session:resume',
            requestId: 'resume-review',
            resumeToken: joined.resumeToken,
          }),
        );

        expect(await nextEvent(resumedEvents, 'session:resumed')).toMatchObject({
          playerId: joined.playerId,
          state: {
            phase: 'CATEGORY_REVIEW',
            currentReviewCategoryIndex: review.categoryIndex,
            reviewDeadline: review.deadline,
          },
        });
        await nextEvent(resumedEvents, 'player:presence');
        await nextEvent(resumedEvents, 'room:state');
        expect(await nextEvent(resumedEvents, 'round:review:category')).toMatchObject({
          categoryIndex: review.categoryIndex,
          category: review.category,
          deadline: review.deadline,
      });
    });
  });

  it('normalizes room codes to uppercase before routing and joining', async () => {
    const room = new GameRoom(makeDurableObjectState().state);
    expect((await allocate(room, 'ABC234')).status).toBe(201);
    const events: ServerEvent[] = [];
    const socket = await connect(room, 'abc234', events);
    await negotiate(room, socket, events, 'hello-lowercase');

    room.webSocketMessage(
      socket,
      JSON.stringify({
        type: 'room:create',
        requestId: 'create-lowercase',
        nickname: 'Host',
      }),
    );
    expect((await nextEvent(events, 'room:state')).state).toMatchObject({
      code: 'ABC234',
      phase: 'CONFIGURING',
    });
    await nextEvent(events, 'command:ack');
  });

  it('keeps the allocated code as the room identity and rejects duplicate creation', async () => {
    const room = new GameRoom(makeDurableObjectState().state);
    expect((await allocate(room, 'AB234C')).status).toBe(201);
    const events: ServerEvent[] = [];
    const socket = await connect(room, 'AB234C', events);
    await negotiate(room, socket, events, 'hello-host');

    const create = JSON.stringify({
      type: 'room:create',
      requestId: 'create-host',
      nickname: 'Host',
    });
    room.webSocketMessage(socket, create);
    expect((await nextEvent(events, 'room:state')).state.code).toBe('AB234C');
    await nextEvent(events, 'command:ack');

    room.webSocketMessage(
      socket,
      JSON.stringify({ type: 'room:create', requestId: 'create-again', nickname: 'Other' }),
    );
    expect(await nextEvent(events, 'error')).toMatchObject({
      code: 'ROOM_ALREADY_EXISTS',
      requestId: 'create-again',
    });
  });

  describe('host succession and mutation guards', () => {
      it('promotes the oldest active player when the host disconnects', async () => {
        const { state } = makeDurableObjectState();
        const room = new GameRoom(state);
        await allocate(room, 'ABC234');

        const hostEvents: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', hostEvents);
        await negotiate(room, host, hostEvents, 'hello-succession-host');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-succession-host', nickname: 'Host' }),
        );
        await nextEvent(hostEvents, 'room:joined');
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');

        const firstEvents: ServerEvent[] = [];
        const firstPlayer = await connect(room, 'ABC234', firstEvents);
        await negotiate(room, firstPlayer, firstEvents, 'hello-succession-first');
        room.webSocketMessage(
          firstPlayer,
          JSON.stringify({
            type: 'room:join',
            requestId: 'join-succession-first',
            code: 'ABC234',
            nickname: 'First',
          }),
        );
        await nextEvent(firstEvents, 'room:state');
        await nextEvent(firstEvents, 'command:ack');

        const secondEvents: ServerEvent[] = [];
        const secondPlayer = await connect(room, 'ABC234', secondEvents);
        await negotiate(room, secondPlayer, secondEvents, 'hello-succession-second');
        room.webSocketMessage(
          secondPlayer,
          JSON.stringify({
            type: 'room:join',
            requestId: 'join-succession-second',
            code: 'ABC234',
            nickname: 'Second',
          }),
        );
        await nextEvent(secondEvents, 'room:state');
        await nextEvent(secondEvents, 'command:ack');

        const players = (room as unknown as { room: RoomState }).room.players;
        const first = players.find((player) => player.nickname === 'First')!;
        const second = players.find((player) => player.nickname === 'Second')!;
        first.joinedAt = 10;
        second.joinedAt = 20;

        room.webSocketClose(host);
        await vi.waitFor(() => {
          expect((room as unknown as { room: RoomState }).room.players.find((player) => player.isHost)?.id)
            .toBe(first.id);
        });
        expect((room as unknown as { room: RoomState }).room.players.find((player) => player.id === second.id)?.isHost)
          .toBe(false);
        await vi.waitFor(() => {
          expect(firstEvents.some((event) =>
            event.type === 'room:state' &&
            event.state.players.some((player) => player.id === first.id && player.isHost),
          )).toBe(true);
        });
      });

      it('blocks host actions without an active host and assigns one when the host resumes', async () => {
        const { state } = makeDurableObjectState();
        const room = new GameRoom(state);
        await allocate(room, 'ABC234');
        const hostEvents: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', hostEvents);
        await negotiate(room, host, hostEvents, 'hello-no-host');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-no-host', nickname: 'Host' }),
        );
        const joined = await nextEvent(hostEvents, 'room:joined');
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');

        room.webSocketClose(host);
        await vi.waitFor(() => {
          expect((room as unknown as { room: RoomState }).room.players[0].status).toBe('disconnected');
        });
        expect((room as unknown as { room: RoomState }).room.players[0].isHost).toBe(false);

        const joinerEvents: ServerEvent[] = [];
        const joiner = await connect(room, 'ABC234', joinerEvents);
        await negotiate(room, joiner, joinerEvents, 'hello-no-host-joiner');
        room.webSocketMessage(
          joiner,
          JSON.stringify({
            type: 'room:join',
            requestId: 'join-no-host-joiner',
            code: 'ABC234',
            nickname: 'Joiner',
          }),
        );
        const joinedState = await nextEvent(joinerEvents, 'room:state');
        await nextEvent(joinerEvents, 'command:ack');
        expect(joinedState.state.players.every((player) => !player.isHost)).toBe(true);

        room.webSocketMessage(
          joiner,
          JSON.stringify({ type: 'lobby:rounds:update', requestId: 'no-host-update', totalRounds: 8 }),
        );
        expect(await nextEvent(joinerEvents, 'error')).toMatchObject({
          code: 'NOT_HOST',
          requestId: 'no-host-update',
        });

        const resumedEvents: ServerEvent[] = [];
        const resumed = await connect(room, 'ABC234', resumedEvents);
        await negotiate(room, resumed, resumedEvents, 'hello-host-resume');
        room.webSocketMessage(
          resumed,
          JSON.stringify({
            type: 'session:resume',
            requestId: 'resume-host',
            resumeToken: joined.resumeToken,
          }),
        );
        expect(await nextEvent(resumedEvents, 'session:resumed')).toMatchObject({
          state: {
            players: expect.arrayContaining([
              expect.objectContaining({ id: joined.playerId, isHost: true, status: 'active' }),
            ]),
          },
        });
      });

      it('rejects state-changing commands from connected sockets without active room membership', async () => {
        const { state } = makeDurableObjectState();
        const room = new GameRoom(state);
        await allocate(room, 'ABC234');
        const hostEvents: ServerEvent[] = [];
        const host = await connect(room, 'ABC234', hostEvents);
        await negotiate(room, host, hostEvents, 'hello-guard-host');
        room.webSocketMessage(
          host,
          JSON.stringify({ type: 'room:create', requestId: 'create-guard-host', nickname: 'Host' }),
        );
        await nextEvent(hostEvents, 'room:joined');
        await nextEvent(hostEvents, 'room:state');
        await nextEvent(hostEvents, 'command:ack');

        const outsiderEvents: ServerEvent[] = [];
        const outsider = await connect(room, 'ABC234', outsiderEvents);
        await negotiate(room, outsider, outsiderEvents, 'hello-guard-outsider');
        const unauthorizedCommands = [
          { type: 'lobby:categories:update', categories: ['Animal'] },
          { type: 'lobby:rounds:update', totalRounds: 8 },
          { type: 'lobby:options:update', roundDurationSeconds: 60, allowedLetters: ['A'] },
          { type: 'game:start' },
          { type: 'answer:submit', roundId: 'round-1', answers: {} },
          { type: 'round:stop', roundId: 'round-1' },
          {
            type: 'answer:vote',
            roundId: 'round-1',
            categoryId: 'cat-0',
            answerPlayerId: 'another-player',
            decision: 'valid',
          },
          { type: 'round:next', roundId: 'round-1' },
        ];
        for (const [index, command] of unauthorizedCommands.entries()) {
          const requestId = `guard-outsider-${index}`;
          room.webSocketMessage(outsider, JSON.stringify({ ...command, requestId }));
          expect(await nextEvent(outsiderEvents, 'error')).toMatchObject({
            code: 'NOT_ELIGIBLE',
            requestId,
          });
        }
        expect((room as unknown as { room: RoomState }).room.totalRounds).toBe(5);
        expect((room as unknown as { room: RoomState }).room.phase).toBe('CONFIGURING');
      });
  });

  it('allows a second client to join the initialized room by the same code', async () => {
    const room = new GameRoom(makeDurableObjectState().state);
    expect((await allocate(room, 'JMN234')).status).toBe(201);
    const hostEvents: ServerEvent[] = [];
    const host = await connect(room, 'JMN234', hostEvents);
    await negotiate(room, host, hostEvents, 'hello-host');
    room.webSocketMessage(
      host,
      JSON.stringify({ type: 'room:create', requestId: 'create-host', nickname: 'Host' }),
    );
    await nextEvent(hostEvents, 'room:state');
    await nextEvent(hostEvents, 'command:ack');

    const guestEvents: ServerEvent[] = [];
    const guest = await connect(room, 'JMN234', guestEvents);
    await negotiate(room, guest, guestEvents, 'hello-guest');
    room.webSocketMessage(
      guest,
      JSON.stringify({
        type: 'room:join',
        requestId: 'join-guest',
        code: 'jmn234',
        nickname: 'Guest',
      }),
    );

    const stateEvent = await nextEvent(guestEvents, 'room:state');
    expect(stateEvent.state.code).toBe('JMN234');
    expect(stateEvent.state.players.map((player) => player.nickname)).toEqual(['Host', 'Guest']);
    await nextEvent(guestEvents, 'command:ack');
  });

  it('rejects joins to uninitialized codes without creating a room', async () => {
    const room = new GameRoom(makeDurableObjectState().state);
    const events: ServerEvent[] = [];
    const socket = await connect(room, 'VWY789', events);
    await negotiate(room, socket, events, 'hello-unknown');

    room.webSocketMessage(
      socket,
      JSON.stringify({
        type: 'room:join',
        requestId: 'join-unknown',
        code: 'VWY789',
        nickname: 'Guest',
      }),
    );

    expect(await nextEvent(events, 'error')).toMatchObject({
      code: 'ROOM_NOT_FOUND',
      requestId: 'join-unknown',
    });
  });

  describe('room expiration alarms', () => {
    it('expires an idle unstarted room after 24 hours', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      try {
        const { state, persisted } = makeDurableObjectState();
        const room = new GameRoom(state);
        expect((await allocate(room, 'JDL246')).status).toBe(201);
        const expiresAt = (persisted.get('room') as RoomState).expiresAt!;
        expect(expiresAt - Date.now()).toBe(24 * 60 * 60 * 1000);
        expect(state.storage.setAlarm).toHaveBeenLastCalledWith(expiresAt);

        vi.setSystemTime(expiresAt);
        await room.alarm();

        expect(persisted.has('room')).toBe(false);
        expect(persisted.has('gameState')).toBe(false);
        expect(state.storage.deleteAlarm).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a completed game available for one hour, then expires it', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      try {
        const { state, persisted } = makeDurableObjectState();
        const room = new GameRoom(state);
        expect((await allocate(room, 'DNE234')).status).toBe(201);
        const internal = room as unknown as {
          room: RoomState;
          persistRoom: () => Promise<void>;
        };
        internal.room.phase = 'GAME_OVER';
        await internal.persistRoom();
        const expiresAt = internal.room.expiresAt!;
        expect(expiresAt - internal.room.completedAt!).toBe(60 * 60 * 1000);
        expect(state.storage.setAlarm).toHaveBeenLastCalledWith(expiresAt);
        vi.setSystemTime(expiresAt - 1);
        await room.alarm();
        expect(persisted.has('room')).toBe(true);

        vi.setSystemTime(expiresAt);
        await room.alarm();

        expect(persisted.has('room')).toBe(false);
        expect(persisted.has('roundData')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('preserves an active round deadline instead of applying idle expiry', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      try {
        const { state, persisted } = makeDurableObjectState();
        const room = new GameRoom(state);
        expect((await allocate(room, 'PLY234')).status).toBe(201);
        const internal = room as unknown as {
          room: RoomState;
          persistRoom: () => Promise<void>;
        };
        internal.room.phase = 'ROUND_ACTIVE';
        internal.room.roundDeadline = Date.now() + 90_000;
        internal.room.expiresAt = Date.now() - 1;
        await internal.persistRoom();

        await room.alarm();

        expect(persisted.has('room')).toBe(true);
        expect(state.storage.setAlarm).toHaveBeenLastCalledWith(internal.room.roundDeadline);
      } finally {
        vi.useRealTimers();
      }
    });

    it('persists expiration timestamps when restoring a legacy completed room', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      try {
        const { state, persisted } = makeDurableObjectState();
        const room = new GameRoom(state);
        await allocate(room, 'LEG234');
        const legacyRoom = {
          ...(persisted.get('room') as RoomState),
          phase: 'GAME_OVER' as const,
        };
        delete legacyRoom.lastActivityAt;
        delete legacyRoom.completedAt;
        delete legacyRoom.expiresAt;
        persisted.set('room', legacyRoom);
        persisted.set('gameState', { room: legacyRoom, roundData: null });

        const restored = new GameRoom(state);
        await restored.alarm();
        const savedRoom = (persisted.get('gameState') as { room: RoomState }).room;
        const expiresAt = savedRoom.expiresAt;
        expect(expiresAt).toBe(Date.now() + 60 * 60 * 1000);

        vi.setSystemTime(Date.now() + 10 * 60 * 1000);
        const restoredAgain = new GameRoom(state);
        await restoredAgain.alarm();
        expect((persisted.get('gameState') as { room: RoomState }).room.expiresAt).toBe(expiresAt);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

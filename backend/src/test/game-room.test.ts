import { describe, expect, it, vi } from 'vitest';
import worker, { GameRoom } from '../index';
import type { ServerEvent } from '../types';

function makeDurableObjectState() {
  const serverSockets: WebSocket[] = [];
  const persisted = new Map<string, unknown>();
  const state = {
    storage: {
      get: vi.fn(async (key: string) => persisted.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        persisted.set(key, value);
      }),
      setAlarm: vi.fn(async () => undefined),
      deleteAlarm: vi.fn(async () => undefined),
    },
    blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => {
      void callback();
    }),
    acceptWebSocket: vi.fn((socket: WebSocket) => {
      serverSockets.push(socket);
      socket.accept();
    }),
    getWebSockets: vi.fn(() => serverSockets),
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
  it('retries allocation collisions and returns the successfully reserved code', async () => {
    const allocatedCodes: string[] = [];
    let attempt = 0;
    const env = {
      GAME_ROOM: {
        idFromName: (name: string) => name,
        get: (id: string) => ({
          fetch: async () => {
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
    async function createRoom(nickname = 'Host') {
      const room = new GameRoom(makeDurableObjectState().state);
      await allocate(room, 'ABC234');
      const events: ServerEvent[] = [];
      const host = await connect(room, 'ABC234', events);
      await negotiate(room, host, events, 'hello-config-host');
      room.webSocketMessage(
        host,
        JSON.stringify({ type: 'room:create', requestId: 'create-config-host', nickname }),
      );
      await nextEvent(events, 'room:joined');
      await nextEvent(events, 'room:state');
      await nextEvent(events, 'command:ack');
      return { room, host, events };
    }

    async function joinGuest(room: GameRoom) {
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
        }),
      );
      await nextEvent(events, 'room:state');
      await nextEvent(events, 'command:ack');
      return { guest, events };
    }

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
    async function startRound() {
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
        code: 'INVALID_ANSWER',
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
  });

  describe('resume sessions', () => {
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
});

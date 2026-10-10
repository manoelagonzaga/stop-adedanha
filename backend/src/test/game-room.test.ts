import { describe, expect, it, vi } from 'vitest';
import worker, { GameRoom } from '../index';
import type { ServerEvent } from '../types';

function makeDurableObjectState() {
  let serverSocket: WebSocket | null = null;
  const state = {
    storage: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    },
    blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => {
      void callback();
    }),
    acceptWebSocket: vi.fn((socket: WebSocket) => {
      serverSocket = socket;
      socket.accept();
    }),
    getWebSockets: vi.fn(() => (serverSocket ? [serverSocket] : [])),
  } as unknown as DurableObjectState;

  return state;
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
  const server = state.getWebSockets()[0];
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

  it('normalizes room codes to uppercase before routing and joining', async () => {
    const room = new GameRoom(makeDurableObjectState());
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
    const room = new GameRoom(makeDurableObjectState());
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
    const room = new GameRoom(makeDurableObjectState());
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
    const room = new GameRoom(makeDurableObjectState());
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

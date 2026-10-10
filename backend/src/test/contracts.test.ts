import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from '../game-room';
import type { ServerEvent } from '../types';

function createRoomConnection(roomCode = 'AB12CD') {
  let acceptedSocket: WebSocket | null = null;
  const acceptWebSocket = vi.fn((socket: WebSocket) => {
    acceptedSocket = socket;
    socket.accept();
  });
  const state = {
    storage: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      setAlarm: vi.fn(async () => undefined),
      deleteAlarm: vi.fn(async () => undefined),
    },
    blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => callback()),
    acceptWebSocket,
    getWebSockets: vi.fn(() => (acceptedSocket ? [acceptedSocket] : [])),
  } as unknown as DurableObjectState;
  const room = new GameRoom(state);
  const events: ServerEvent[] = [];

  return {
    room,
    events,
    async connect() {
      const response = await room.fetch(
        new Request(`https://room.example/rooms/${roomCode}`, {
          headers: { Upgrade: 'websocket' },
        }),
      );
      const client = response.webSocket;
      if (!client || !acceptedSocket) throw new Error('WebSocket pair was not accepted');
      client.accept();
      client.addEventListener('message', (message) => {
        events.push(JSON.parse(String(message.data)) as ServerEvent);
      });
      return { client, server: acceptedSocket };
    },
    async nextEvent(type: ServerEvent['type']) {
      let event: ServerEvent | undefined;
      await vi.waitFor(() => {
        const index = events.findIndex((candidate) => candidate.type === type);
        if (index < 0) throw new Error(`Expected ${type} event`);
        [event] = events.splice(index, 1);
      });
      if (!event) throw new Error(`Expected ${type} event`);
      return event;
    },
  };
}

async function negotiate(connection: ReturnType<typeof createRoomConnection>, server: WebSocket) {
  await connection.nextEvent('session:ready');
  connection.room.webSocketMessage(
    server,
    JSON.stringify({ type: 'session:hello', requestId: 'hello-1', protocolVersion: 1 }),
  );
  const ready = await connection.nextEvent('session:ready');
  expect(ready).toMatchObject({ negotiatedProtocolVersion: 1 });
  await connection.nextEvent('command:ack');
}

describe('WebSocket protocol contract', () => {
  it('requires and negotiates protocol version 1 before room mutations', async () => {
    const connection = createRoomConnection();
    const { server } = await connection.connect();
    await connection.nextEvent('session:ready');

    connection.room.webSocketMessage(
      server,
      JSON.stringify({ type: 'room:create', requestId: 'create-before-hello', nickname: 'Ana' }),
    );
    expect(await connection.nextEvent('error')).toMatchObject({
      code: 'PROTOCOL_REQUIRED',
      requestId: 'create-before-hello',
    });

    connection.room.webSocketMessage(
      server,
      JSON.stringify({ type: 'session:hello', requestId: 'hello-1', protocolVersion: 1 }),
    );
    expect(await connection.nextEvent('session:ready')).toMatchObject({
      negotiatedProtocolVersion: 1,
    });
    expect(await connection.nextEvent('command:ack')).toMatchObject({
      requestId: 'hello-1',
      status: 'committed',
    });
  });

  it('rejects unsupported protocol versions with a stable error', async () => {
    const connection = createRoomConnection();
    const { server } = await connection.connect();
    await connection.nextEvent('session:ready');
    connection.room.webSocketMessage(
      server,
      JSON.stringify({ type: 'session:hello', requestId: 'hello-2', protocolVersion: 2 }),
    );

    expect(await connection.nextEvent('error')).toMatchObject({
      code: 'PROTOCOL_UNSUPPORTED',
      requestId: 'hello-2',
    });
  });

  it('returns stable errors for malformed JSON and oversized payloads', async () => {
    const connection = createRoomConnection();
    const { server } = await connection.connect();
    await connection.nextEvent('session:ready');

    connection.room.webSocketMessage(server, '{invalid json');
    expect(await connection.nextEvent('error')).toMatchObject({ code: 'INVALID_JSON' });

    connection.room.webSocketMessage(server, 'x'.repeat(16 * 1024 + 1));
    expect(await connection.nextEvent('error')).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });

    const hello = JSON.stringify({
      type: 'session:hello',
      requestId: 'hello-boundary',
      protocolVersion: 1,
    });
    const exactLimitPayload =
      hello + ' '.repeat(16 * 1024 - new TextEncoder().encode(hello).byteLength);
    connection.room.webSocketMessage(server, exactLimitPayload);
    expect(await connection.nextEvent('session:ready')).toMatchObject({
      negotiatedProtocolVersion: 1,
    });
    expect(await connection.nextEvent('command:ack')).toMatchObject({
      requestId: 'hello-boundary',
      status: 'committed',
    });
  });

  it('rejects unknown commands after negotiation and preserves request correlation', async () => {
    const connection = createRoomConnection();
    const { server } = await connection.connect();
    await negotiate(connection, server);

    connection.room.webSocketMessage(
      server,
      JSON.stringify({ type: 'unknown:command', requestId: 'unknown-1' }),
    );
    expect(await connection.nextEvent('error')).toMatchObject({
      code: 'UNKNOWN_COMMAND',
      requestId: 'unknown-1',
    });
  });

  it('acknowledges a request once and rejects a duplicate requestId', async () => {
    const connection = createRoomConnection('AB234C');
    const { server } = await connection.connect();
    await negotiate(connection, server);

    const create = JSON.stringify({
      type: 'room:create',
      requestId: 'create-1',
      nickname: 'Ana',
    });
    const allocation = await connection.room.fetch(
      new Request('https://room.internal/__allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'AB234C' }),
      }),
    );
    expect(allocation.status).toBe(201);
    connection.room.webSocketMessage(server, create);
    expect(await connection.nextEvent('command:ack')).toMatchObject({
      requestId: 'create-1',
      status: 'committed',
    });

    connection.room.webSocketMessage(server, create);
    expect(await connection.nextEvent('error')).toMatchObject({
      code: 'ALREADY_PROCESSED',
      requestId: 'create-1',
    });
  });
});

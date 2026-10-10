import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameSocket } from './useGameSocket';
import type { ServerEvent } from '../types';

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  emit(event: ServerEvent) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
}

describe('useGameSocket resume protocol', () => {
  afterEach(() => {
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('negotiates, resumes with the room token, and stores its rotation', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    sessionStorage.setItem('stop-adedanha:resume:ABC234', 'prior-token');
    const onEvent = vi.fn();
    const { result, unmount } = renderHook(() =>
      useGameSocket({ url: 'ws://example.test/rooms/ABC234', roomCode: 'ABC234', onEvent }),
    );
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket.onopen?.(new Event('open'));
    });
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: 'session:hello',
      protocolVersion: 1,
    });

    act(() => {
      socket.emit({
        type: 'session:ready',
        playerId: 'temporary-id',
        supportedProtocolVersions: [1],
      });
      socket.emit({
        type: 'session:ready',
        playerId: 'temporary-id',
        negotiatedProtocolVersion: 1,
      });
    });
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      type: 'session:resume',
      protocolVersion: 1,
      resumeToken: 'prior-token',
    });
    expect(result.current.status).toBe('resuming');

    act(() => {
      socket.emit({
        type: 'session:resumed',
        requestId: 'resume-1',
        playerId: 'stable-player',
        resumeToken: 'rotated-token',
        state: {
          code: 'ABC234',
          phase: 'CONFIGURING',
          players: [],
          categories: [],
          currentRound: 0,
          totalRounds: 5,
        },
      });
    });
    expect(sessionStorage.getItem('stop-adedanha:resume:ABC234')).toBe('rotated-token');
    expect(result.current.status).toBe('connected');
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'session:resumed' }));

    act(() => {
      socket.emit({
        type: 'error',
        code: 'SESSION_INVALID',
        message: 'Session expired',
        requestId: 'resume-2',
      });
    });
    expect(sessionStorage.getItem('stop-adedanha:resume:ABC234')).toBeNull();
    expect(result.current.status).toBe('error');
    unmount();
  });
});

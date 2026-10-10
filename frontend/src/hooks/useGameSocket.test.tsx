import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameSocket, useGameState } from './useGameSocket';
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

  it('tracks pending request IDs until the matching ack or error arrives', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onEvent = vi.fn();
    const { result, unmount } = renderHook(() =>
      useGameSocket({ url: 'ws://example.test/rooms/ABC234', roomCode: 'ABC234', onEvent }),
    );
    const socket = MockWebSocket.instances[0];
    act(() => socket.onopen?.(new Event('open')));
    act(() => socket.emit({
      type: 'session:ready',
      negotiatedProtocolVersion: 1,
    }));

    let sent = false;
    act(() => {
      sent = result.current.send({
        type: 'lobby:rounds:update',
        requestId: 'rounds-1',
        totalRounds: 8,
      });
    });
    expect(sent).toBe(true);
    expect(result.current.pendingRequestIds).toEqual(['rounds-1']);

    act(() => socket.emit({
      type: 'command:ack',
      requestId: 'rounds-1',
      commandType: 'lobby:rounds:update',
      status: 'committed',
    }));
    expect(result.current.pendingRequestIds).toEqual([]);

    act(() => {
      result.current.send({
        type: 'lobby:rounds:update',
        requestId: 'rounds-2',
        totalRounds: 10,
      });
    });
    act(() => socket.emit({
      type: 'error',
      requestId: 'rounds-2',
      code: 'INVALID_CONFIGURATION',
      message: 'Configuração inválida.',
    }));
    expect(result.current.pendingRequestIds).toEqual([]);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      requestId: 'rounds-2',
      message: 'Configuração inválida.',
    }));
    unmount();
  });

  it('returns false and reports the request when a command cannot be sent', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onEvent = vi.fn();
    const { result, unmount } = renderHook(() =>
      useGameSocket({ url: null, roomCode: null, onEvent }),
    );
    let sent = true;
    act(() => {
      sent = result.current.send({
        type: 'game:start',
        requestId: 'offline-start',
      });
    });
    expect(sent).toBe(false);
    expect(result.current.pendingRequestIds).toEqual([]);
    expect(onEvent).not.toHaveBeenCalled();
    unmount();
  });

  it('emits a correlated failure when the WebSocket send throws', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onEvent = vi.fn();
    const { result, unmount } = renderHook(() =>
      useGameSocket({ url: 'ws://example.test/rooms/ABC234', roomCode: 'ABC234', onEvent }),
    );
    const socket = MockWebSocket.instances[0];
    act(() => socket.onopen?.(new Event('open')));
    act(() => socket.emit({ type: 'session:ready', negotiatedProtocolVersion: 1 }));
    vi.spyOn(socket, 'send').mockImplementation(() => {
      throw new Error('socket write failed');
    });

    let sent = true;
    act(() => {
      sent = result.current.send({ type: 'game:start', requestId: 'send-failed' });
    });

    expect(sent).toBe(false);
    expect(result.current.pendingRequestIds).toEqual([]);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'error',
      requestId: 'send-failed',
      code: 'SEND_FAILED',
      message: 'Não foi possível enviar a ação. Verifique sua conexão e tente novamente.',
    });
    unmount();
  });

  it('rejects pending actions when the socket disconnects before an acknowledgement', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
    const onEvent = vi.fn();
    const { result, unmount } = renderHook(() =>
      useGameSocket({ url: 'ws://example.test/rooms/ABC234', roomCode: 'ABC234', onEvent }),
    );
    const socket = MockWebSocket.instances[0];
    act(() => socket.onopen?.(new Event('open')));
    act(() => socket.emit({ type: 'session:ready', negotiatedProtocolVersion: 1 }));
    act(() => {
      result.current.send({ type: 'round:stop', requestId: 'stop-pending', roundId: 'round-1' });
    });

    act(() => socket.close());

    expect(result.current.pendingRequestIds).toEqual([]);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'error',
      requestId: 'stop-pending',
      code: 'CONNECTION_LOST',
      message: 'A conexão foi perdida antes da confirmação desta ação.',
    });
    unmount();
    vi.useRealTimers();
  });
});

describe('useGameState authoritative category review', () => {
  it('records acknowledgements and correlated server errors in application state', () => {
    const { result } = renderHook(() => useGameState());
    act(() => {
      result.current.handleEvent({
        type: 'command:ack',
        requestId: 'settings-1',
        commandType: 'lobby:rounds:update',
        status: 'committed',
      });
      result.current.handleEvent({
        type: 'error',
        requestId: 'settings-2',
        code: 'INVALID_CONFIGURATION',
        message: 'Configuração inválida.',
      });
    });
    expect(result.current.state.lastCommandResult).toEqual({
      requestId: 'settings-2',
      status: 'rejected',
      message: 'Configuração inválida.',
      code: 'INVALID_CONFIGURATION',
    });
  });

  it('tracks the server category, deadline, answers, and cumulative scoreboard events', () => {
    const { result } = renderHook(() => useGameState());
    const room = {
      code: 'ABC234',
      phase: 'ROUND_ACTIVE' as const,
      players: [{ id: 'p1', nickname: 'Player', isHost: true, status: 'active' as const, score: 0 }],
      categories: [
        { id: 'cat-1', name: 'Animal' },
        { id: 'cat-2', name: 'Cidade' },
      ],
      currentRound: 1,
      totalRounds: 3,
      currentRoundId: 'round-1',
    };
    const reviewAnswer = {
      playerId: 'p1',
      categoryId: 'cat-2',
      value: 'Curitiba',
      isValid: true,
      invalidations: [],
      votes: {},
      eligibleVoters: [],
      score: 10,
    };

    act(() => {
      result.current.handleEvent({ type: 'room:state', state: room });
      result.current.handleEvent({
        type: 'round:review:category',
        categoryIndex: 0,
        totalCategories: 2,
        category: room.categories[0],
        answers: [],
        eligibleVoters: 1,
        deadline: 2000,
      });
      result.current.handleEvent({
        type: 'round:review:score_update',
        categoryIndex: 0,
        categoryScores: { p1: 10 },
        scoreboard: [{ ...room.players[0], score: 15 }],
      });
      result.current.handleEvent({
        type: 'round:review:category',
        categoryIndex: 1,
        totalCategories: 2,
        category: room.categories[1],
        answers: [reviewAnswer],
        eligibleVoters: 1,
        deadline: 4000,
      });
    });

    expect(result.current.state.room).toMatchObject({
      phase: 'CATEGORY_REVIEW',
      currentReviewCategoryIndex: 1,
      reviewDeadline: 4000,
      players: [{ id: 'p1', score: 15 }],
    });
    expect(result.current.state.answers).toEqual([reviewAnswer]);
  });

  it('preserves committed round results and the final server ranking', () => {
    const { result } = renderHook(() => useGameState());
    const answer = {
      playerId: 'p1',
      categoryId: 'cat-1',
      value: 'Curitiba',
      isValid: true,
      invalidations: [],
      votes: {},
      eligibleVoters: [],
      score: 10,
    };
    const ranking = [
      { id: 'p1', nickname: 'Player', isHost: true, status: 'active' as const, score: 20 },
    ];
    const podium = [
      { position: 1 as const, playerId: 'p1', nickname: 'Player', score: 20, tier: 'gold' as const },
    ];
    const finalResults = {
      podium,
      list: [],
    };

    act(() => {
      result.current.handleEvent({
        type: 'room:state',
        state: {
          code: 'ABC234',
          phase: 'CATEGORY_REVIEW',
          players: ranking.map((player) => ({ ...player, score: 0 })),
          categories: [{ id: 'cat-1', name: 'Cidade' }],
          currentRound: 3,
          totalRounds: 3,
          currentRoundId: 'round-3',
        },
      });
      result.current.handleEvent({ type: 'round:results', answers: [answer], ranking });
      result.current.handleEvent({ type: 'game:final_results', ...finalResults });
    });

    expect(result.current.state.room?.phase).toBe('GAME_OVER');
    expect(result.current.state.room?.players).toEqual(ranking);
    expect(result.current.state.answers).toEqual([answer]);
    expect(result.current.state.finalResults).toEqual(finalResults);
  });
});

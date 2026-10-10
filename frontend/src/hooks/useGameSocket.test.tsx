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
});

describe('useGameState authoritative category review', () => {
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

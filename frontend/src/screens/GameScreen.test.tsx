import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import type { RoomState } from '../types';
import { GameScreen } from './GameScreen';

describe('GameScreen authoritative timer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down from the server deadline and does not stop the round locally', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
    const room: RoomState = {
      code: 'ABC234',
      phase: 'ROUND_ACTIVE',
      players: [],
      categories: [{ id: 'cat-0', name: 'Nome' }],
      currentRound: 1,
      totalRounds: 5,
      currentRoundId: 'round-1',
      currentLetter: 'A',
      roundDeadline: Date.now() + 3_000,
      roundDurationSeconds: 60,
      allowedLetters: ['A', 'B'],
    };
    const onSubmitAnswers = vi.fn();
    const onStop = vi.fn();
    const orderedActions: string[] = [];
    onSubmitAnswers.mockImplementation(() => orderedActions.push('submit'));
    onStop.mockImplementation(() => orderedActions.push('stop'));
    const { rerender } = render(
      <ToastProvider>
        <GameScreen
          room={room}
          myPlayerId="player-1"
          onSubmitAnswers={onSubmitAnswers}
          onStop={onStop}
        />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText(/Ex com A/), { target: { value: 'Ana' } });
    expect(onSubmitAnswers).toHaveBeenLastCalledWith('round-1', { 'cat-0': 'ANA' });
    expect(screen.getByText('00:03')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('00:02')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(onSubmitAnswers).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Gritar STOP/ }));
    expect(orderedActions).toEqual(['submit', 'submit', 'stop']);

    rerender(
      <ToastProvider>
        <GameScreen
          room={{ ...room, roundDeadline: undefined, roundDurationSeconds: 0 }}
          myPlayerId="player-1"
          onSubmitAnswers={onSubmitAnswers}
          onStop={onStop}
        />
      </ToastProvider>,
    );
    expect(screen.getByText('Sem limite')).toBeInTheDocument();
  });
});

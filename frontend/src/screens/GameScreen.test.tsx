import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import type { RoomState } from '../types';
import { GameScreen } from './GameScreen';

describe('GameScreen authoritative timer and round intro', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('plays intro animation, runs 3-second countdown with accessible announcements, and enables gameplay', () => {
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
      roundDeadline: Date.now() + 20_000,
      roundDurationSeconds: 60,
      allowedLetters: ['A', 'B'],
    };
    const onSubmitAnswers = vi.fn();
    const onStop = vi.fn();
    const orderedActions: string[] = [];
    onSubmitAnswers.mockImplementation(() => orderedActions.push('submit'));
    onStop.mockImplementation(() => orderedActions.push('stop'));

    render(
      <ToastProvider>
        <GameScreen
          room={room}
          myPlayerId="player-1"
          onSubmitAnswers={onSubmitAnswers}
          onStop={onStop}
        />
      </ToastProvider>,
    );

    const liveRegion = screen.getByTestId('live-region');

    // Initial state: spinning letter announcement
    expect(liveRegion).toHaveTextContent('sorteando letra');

    // Advance 1200ms -> spinning ends, letter is revealed
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(liveRegion).toHaveTextContent('letra sorteada: A');

    // Advance 1000ms -> countdown starts at 3
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(liveRegion).toHaveTextContent('Iniciando o jogo em: 3');

    // Advance 1000ms -> countdown 2
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(liveRegion).toHaveTextContent('2');

    // Advance 1000ms -> countdown 1
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(liveRegion).toHaveTextContent('1');

    // Advance 1000ms -> countdown reaches 0 and unlocks playing phase
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Now input is enabled and game is playing
    const input = screen.getByPlaceholderText(/Nome com a letra A/);
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: 'Ana' } });
    expect(onSubmitAnswers).toHaveBeenLastCalledWith('round-1', { 'cat-0': 'ANA' });

    // Stop button is now active
    const stopButton = screen.getByRole('button', { name: /Gritar STOP/ });
    expect(stopButton).not.toBeDisabled();

    fireEvent.click(stopButton);
    expect(orderedActions).toEqual(['submit', 'submit', 'stop']);
  });

  it('formats authoritative countdown timer with accessible aria-label and supports unlimited time', () => {
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
      roundDeadline: Date.now() + 8_250,
      roundDurationSeconds: 60,
      allowedLetters: ['A', 'B'],
    };

    const { rerender } = render(
      <ToastProvider>
        <GameScreen
          room={room}
          myPlayerId="player-1"
          onSubmitAnswers={vi.fn()}
          onStop={vi.fn()}
        />
      </ToastProvider>,
    );

    // Fast forward past spinning, reveal and countdown (1200ms + 1000ms + 3000ms = 5200ms -> 5250ms to align with 250ms interval)
    act(() => {
      vi.advanceTimersByTime(5250);
    });

    const timer = screen.getByTestId('timer-display');
    // Now 8250 - 5250 = 3000ms (3 segundos restantes)
    expect(timer).toHaveAttribute('aria-label', '3 segundos restantes');

    // Advance 1000ms -> 2 segundos restantes
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(timer).toHaveAttribute('aria-label', '2 segundos restantes');

    // Re-render with unlimited mode
    rerender(
      <ToastProvider>
        <GameScreen
          room={{ ...room, roundDeadline: undefined, roundDurationSeconds: 0 }}
          myPlayerId="player-1"
          onSubmitAnswers={vi.fn()}
          onStop={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(timer).toHaveAttribute('aria-label', 'Sem limite de tempo');
    expect(screen.getByText('Sem limite')).toBeInTheDocument();
  });
});

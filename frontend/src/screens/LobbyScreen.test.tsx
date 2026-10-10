import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import type { RoomState } from '../types';
import { LobbyScreen } from './LobbyScreen';

describe('LobbyScreen authoritative options', () => {
  it('sends duration and allowed-letter changes without applying them before a room snapshot', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const onUpdateOptions = vi.fn();
    const room: RoomState = {
      code: 'ABC234',
      phase: 'CONFIGURING',
      players: [{ id: 'host-1', nickname: 'Host', isHost: true, status: 'active', score: 0 }],
      categories: [{ id: 'cat-0', name: 'Nome' }],
      currentRound: 0,
      totalRounds: 5,
      roundDurationSeconds: 60,
      allowedLetters: alphabet,
    };
    const props = {
      room,
      myPlayerId: 'host-1',
      onUpdateCategories: vi.fn(),
      onUpdateRounds: vi.fn(),
      onUpdateOptions,
      onStartGame: vi.fn(),
    };
    const { rerender } = render(
      <ToastProvider>
        <LobbyScreen {...props} />
      </ToastProvider>,
    );

    const ninetySeconds = screen.getByRole('button', { name: '90s' });
    expect(ninetySeconds).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(ninetySeconds);
    expect(onUpdateOptions).toHaveBeenLastCalledWith(90, alphabet);
    expect(ninetySeconds).toHaveAttribute('aria-pressed', 'false');

    const confirmedRoom = { ...room, roundDurationSeconds: 90 as const };
    rerender(
      <ToastProvider>
        <LobbyScreen {...props} room={confirmedRoom} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: '90s' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onUpdateOptions).toHaveBeenLastCalledWith(90, alphabet.filter((letter) => letter !== 'A'));
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true');
  });
});

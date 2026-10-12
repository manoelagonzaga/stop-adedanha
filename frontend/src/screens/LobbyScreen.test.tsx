import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import type { RoomState } from '../types';
import { LobbyScreen } from './LobbyScreen';

afterEach(cleanup);

describe('LobbyScreen authoritative options', () => {
  it('shows active and disconnected participants from the latest room snapshot', () => {
    const room: RoomState = {
      code: 'ABC234',
      phase: 'CONFIGURING',
      players: [
        { id: 'host-1', nickname: 'Host', isHost: true, status: 'active', score: 0, avatar: '🦊' },
        { id: 'guest-2', nickname: 'Guest', isHost: false, status: 'active', score: 0, avatar: '🐼' },
        { id: 'guest-3', nickname: 'Offline', isHost: false, status: 'disconnected', score: 0 },
      ],
      categories: [{ id: 'cat-0', name: 'Nome' }],
      currentRound: 0,
      totalRounds: 3,
    };

    render(
      <ToastProvider>
        <LobbyScreen
          room={room}
          myPlayerId="host-1"
          onUpdateCategories={vi.fn()}
          onUpdateRounds={vi.fn()}
          onUpdateOptions={vi.fn()}
          onStartGame={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Participantes da sala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar Link da Sala' })).toBeInTheDocument();
    expect(screen.getByText('2 de 20 participantes conectados')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getByText('🐼')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('Desconectado')).toBeInTheDocument();
  });

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

  it('reflects the selected category pack with aria-pressed', () => {
    const onUpdateCategories = vi.fn();
    const room: RoomState = {
      code: 'ABC234',
      phase: 'CONFIGURING',
      players: [{ id: 'host-1', nickname: 'Host', isHost: true, status: 'active', score: 0 }],
      categories: [{ id: 'cat-0', name: 'Nome' }],
      currentRound: 0,
      totalRounds: 5,
    };

    render(
      <ToastProvider>
        <LobbyScreen
          room={room}
          myPlayerId="host-1"
          onUpdateCategories={onUpdateCategories}
          onUpdateRounds={vi.fn()}
          onUpdateOptions={vi.fn()}
          onStartGame={vi.fn()}
        />
      </ToastProvider>,
    );

    const classic = screen.getByRole('button', { name: 'Clássico' });
    const geek = screen.getByRole('button', { name: 'Geek/Pop' });
    expect(classic).toHaveAttribute('aria-pressed', 'false');
    expect(geek).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(classic);
    expect(classic).toHaveAttribute('aria-pressed', 'true');
    expect(geek).toHaveAttribute('aria-pressed', 'false');
    expect(onUpdateCategories).toHaveBeenCalledWith([
      'Nome',
      'CEP / Lugar',
      'Animal',
      'Cor',
      'Fruta / Comida',
      'Objeto',
      'Marca',
    ]);

    fireEvent.click(geek);
    expect(geek).toHaveAttribute('aria-pressed', 'true');
    expect(classic).toHaveAttribute('aria-pressed', 'false');
  });

  it('suspends host controls and reports when no active host is present', () => {
    const room: RoomState = {
      code: 'ABC234',
      phase: 'CONFIGURING',
      players: [
        { id: 'host-1', nickname: 'Host', isHost: false, status: 'disconnected', score: 0 },
        { id: 'guest-2', nickname: 'Guest', isHost: false, status: 'active', score: 0 },
      ],
      categories: [{ id: 'cat-0', name: 'Nome' }],
      currentRound: 0,
      totalRounds: 5,
    };

    render(
      <ToastProvider>
        <LobbyScreen
          room={room}
          myPlayerId="guest-2"
          onUpdateCategories={vi.fn()}
          onUpdateRounds={vi.fn()}
          onUpdateOptions={vi.fn()}
          onStartGame={vi.fn()}
        />
      </ToastProvider>,
    );

    expect(screen.getByText(
      'Ações de anfitrião suspensas até um participante existente retomar a sessão.',
    )).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: '90s' })).toBeDisabled();
    expect(screen.getByText('Aguardando um anfitrião ativo…')).toBeInTheDocument();
  });

  it('keeps configuration controls enabled and announces sync status without disabling focused buttons', () => {
    const onUpdateRounds = vi.fn();
    const room: RoomState = {
      code: 'ABC234',
      phase: 'CONFIGURING',
      players: [
        { id: 'host-1', nickname: 'Host', isHost: true, status: 'active', score: 0 },
        { id: 'guest-2', nickname: 'Guest', isHost: false, status: 'active', score: 0 },
      ],
      categories: [{ id: 'cat-0', name: 'Nome' }],
      currentRound: 0,
      totalRounds: 5,
    };
    const props = {
      room,
      myPlayerId: 'host-1',
      onUpdateCategories: vi.fn(),
      onUpdateRounds,
      onUpdateOptions: vi.fn(),
      onStartGame: vi.fn(),
    };

    const { rerender, container } = render(
      <ToastProvider>
        <LobbyScreen {...props} actionStatus={{ status: 'pending', message: 'Aguardando confirmação do servidor...' }} />
      </ToastProvider>,
    );

    const pendingStatus = screen.getByText('Aguardando confirmação do servidor...');
    expect(pendingStatus).toHaveAttribute('role', 'status');
    expect(pendingStatus).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Salvando configurações…')).toBeInTheDocument();
    expect(container.querySelector('[data-game-screen]')).toHaveAttribute('aria-busy', 'true');

    const roundsButton = screen.getByRole('button', { name: '8' });
    expect(roundsButton).not.toBeDisabled();
    fireEvent.click(roundsButton);
    expect(onUpdateRounds).toHaveBeenCalledWith(8);

    rerender(
      <ToastProvider>
        <LobbyScreen {...props} actionStatus={{ status: 'confirmed', message: 'Configuração salva.' }} />
      </ToastProvider>,
    );
    const confirmedStatus = screen.getByText('Configuração salva.');
    expect(confirmedStatus).toHaveAttribute('role', 'status');
    expect(confirmedStatus).toHaveAttribute('aria-live', 'polite');
    expect(container.querySelector('[data-game-screen]')).not.toHaveAttribute('aria-busy');

    rerender(
      <ToastProvider>
        <LobbyScreen {...props} actionStatus={{ status: 'rejected', message: 'Configuração recusada.' }} />
      </ToastProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Configuração recusada.');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });
});

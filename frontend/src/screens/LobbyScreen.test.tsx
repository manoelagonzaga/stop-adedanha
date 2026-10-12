import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import type { RoomState } from '../types';
import { LobbyScreen } from './LobbyScreen';

afterEach(cleanup);

function renderLobby(
  room: RoomState,
  myPlayerId: string,
  overrides: Partial<{
    onUpdateCategories: ReturnType<typeof vi.fn>;
    onUpdateRounds: ReturnType<typeof vi.fn>;
    onUpdateOptions: ReturnType<typeof vi.fn>;
    onStartGame: ReturnType<typeof vi.fn>;
    onLeaveRoom: ReturnType<typeof vi.fn>;
    onCloseRoom: ReturnType<typeof vi.fn>;
    lifecycleBusy: boolean;
    actionStatus: {
      status: 'pending' | 'confirmed' | 'rejected';
      message?: string;
    } | null;
  }> = {},
) {
  const props = {
    room,
    myPlayerId,
    onUpdateCategories: overrides.onUpdateCategories ?? vi.fn(),
    onUpdateRounds: overrides.onUpdateRounds ?? vi.fn(),
    onUpdateOptions: overrides.onUpdateOptions ?? vi.fn(),
    onStartGame: overrides.onStartGame ?? vi.fn(),
    onLeaveRoom: overrides.onLeaveRoom ?? vi.fn(),
    onCloseRoom: overrides.onCloseRoom ?? vi.fn(),
    lifecycleBusy: overrides.lifecycleBusy,
    actionStatus: overrides.actionStatus,
  };

  return {
    ...props,
    ...render(
      <ToastProvider>
        <LobbyScreen {...props} />
      </ToastProvider>,
    ),
  };
}

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

    renderLobby(room, 'host-1');

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
    const { rerender, onUpdateCategories, onUpdateRounds, onStartGame, onLeaveRoom, onCloseRoom } =
      renderLobby(room, 'host-1', { onUpdateOptions });

    const ninetySeconds = screen.getByRole('button', { name: '90s' });
    expect(ninetySeconds).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(ninetySeconds);
    expect(onUpdateOptions).toHaveBeenLastCalledWith(90, alphabet);
    expect(ninetySeconds).toHaveAttribute('aria-pressed', 'false');

    const confirmedRoom = { ...room, roundDurationSeconds: 90 as const };
    rerender(
      <ToastProvider>
        <LobbyScreen
          room={confirmedRoom}
          myPlayerId="host-1"
          onUpdateCategories={onUpdateCategories}
          onUpdateRounds={onUpdateRounds}
          onUpdateOptions={onUpdateOptions}
          onStartGame={onStartGame}
          onLeaveRoom={onLeaveRoom}
          onCloseRoom={onCloseRoom}
        />
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

    renderLobby(room, 'host-1', { onUpdateCategories });

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

    renderLobby(room, 'guest-2');

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
    const { rerender, onUpdateCategories, onUpdateOptions, onStartGame, onLeaveRoom, onCloseRoom } =
      renderLobby(room, 'host-1', {
        onUpdateRounds,
        actionStatus: { status: 'pending', message: 'Aguardando confirmação do servidor...' },
      });

    const pendingStatus = screen.getByText('Aguardando confirmação do servidor...');
    expect(pendingStatus).toHaveAttribute('role', 'status');
    expect(pendingStatus).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Salvando configurações…')).toBeInTheDocument();
    expect(document.querySelector('[data-game-screen]')).toHaveAttribute('aria-busy', 'true');

    const roundsButton = screen.getByRole('button', { name: '8' });
    expect(roundsButton).not.toBeDisabled();
    fireEvent.click(roundsButton);
    expect(onUpdateRounds).toHaveBeenCalledWith(8);

    rerender(
      <ToastProvider>
        <LobbyScreen
          room={room}
          myPlayerId="host-1"
          onUpdateCategories={onUpdateCategories}
          onUpdateRounds={onUpdateRounds}
          onUpdateOptions={onUpdateOptions}
          onStartGame={onStartGame}
          onLeaveRoom={onLeaveRoom}
          onCloseRoom={onCloseRoom}
          actionStatus={{ status: 'confirmed', message: 'Configuração salva.' }}
        />
      </ToastProvider>,
    );
    const confirmedStatus = screen.getByText('Configuração salva.');
    expect(confirmedStatus).toHaveAttribute('role', 'status');
    expect(confirmedStatus).toHaveAttribute('aria-live', 'polite');
    expect(document.querySelector('[data-game-screen]')).not.toHaveAttribute('aria-busy');

    rerender(
      <ToastProvider>
        <LobbyScreen
          room={room}
          myPlayerId="host-1"
          onUpdateCategories={onUpdateCategories}
          onUpdateRounds={onUpdateRounds}
          onUpdateOptions={onUpdateOptions}
          onStartGame={onStartGame}
          onLeaveRoom={onLeaveRoom}
          onCloseRoom={onCloseRoom}
          actionStatus={{ status: 'rejected', message: 'Configuração recusada.' }}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Configuração recusada.');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('LobbyScreen lifecycle actions', () => {
  const hostRoom: RoomState = {
    code: 'ABC234',
    phase: 'CONFIGURING',
    players: [
      { id: 'host-1', nickname: 'Host', isHost: true, status: 'active', score: 0 },
      { id: 'guest-2', nickname: 'Guest', isHost: false, status: 'active', score: 0 },
    ],
    categories: [{ id: 'cat-0', name: 'Nome' }],
    currentRound: 0,
    totalRounds: 3,
  };

  it('shows Encerrar sala only for the active host', () => {
    const { unmount } = renderLobby(hostRoom, 'host-1');
    expect(screen.getByRole('button', { name: 'Voltar ao início' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar sala' })).toBeInTheDocument();
    unmount();

    renderLobby(hostRoom, 'guest-2');
    expect(screen.getByRole('button', { name: 'Voltar ao início' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encerrar sala' })).not.toBeInTheDocument();
  });

  it('asks the host to confirm discarding the draft before closing the room', () => {
    const onCloseRoom = vi.fn();
    const onLeaveRoom = vi.fn();
    renderLobby(hostRoom, 'host-1', { onCloseRoom, onLeaveRoom });

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao início' }));
    expect(onCloseRoom).not.toHaveBeenCalled();
    expect(onLeaveRoom).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Descartar sala em rascunho?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e deletar' }));
    expect(onCloseRoom).toHaveBeenCalledTimes(1);
    expect(onLeaveRoom).not.toHaveBeenCalled();
  });

  it('lets a guest leave immediately via Voltar ao início or Sair', () => {
    const onLeaveRoom = vi.fn();
    const onCloseRoom = vi.fn();
    renderLobby(hostRoom, 'guest-2', { onLeaveRoom, onCloseRoom });

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao início' }));
    expect(onLeaveRoom).toHaveBeenCalledTimes(1);
    expect(onCloseRoom).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onLeaveRoom).toHaveBeenCalledTimes(2);
    expect(onCloseRoom).not.toHaveBeenCalled();
  });

  it('opens the destructive close dialog for host Encerrar sala', () => {
    const onCloseRoom = vi.fn();
    renderLobby(hostRoom, 'host-1', { onCloseRoom });

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sala' }));
    expect(screen.getByRole('dialog', { name: 'Encerrar e deletar sala?' })).toBeInTheDocument();
    expect(onCloseRoom).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCloseRoom).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar sala' }));
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e deletar' }));
    expect(onCloseRoom).toHaveBeenCalledTimes(1);
  });
});

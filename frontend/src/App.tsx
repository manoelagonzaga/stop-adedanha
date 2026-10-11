import { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatedBackground } from './components/AnimatedBackground';
import { EntryScreen } from './screens/EntryScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { PodiumScreen } from './screens/PodiumScreen';
import { clearResumeToken, useGameSocket, useGameState } from './hooks/useGameSocket';
import { getBackendBaseUrl, getRoomWebSocketUrl, getRoomsApiUrl } from './utils/backendUrl';
import type { GameState } from './hooks/useGameSocket';
import type { Avatar, ClientCommand, RoomState } from './types';


const backendBaseUrl = getBackendBaseUrl(import.meta.env.VITE_BACKEND_URL, location.origin);
const requestedRoomCode = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase();
const invitedRoomCode =
  requestedRoomCode && /^[A-Z2-9]{6}$/.test(requestedRoomCode) ? requestedRoomCode : null;

type UIScreen = 'início' | 'configuração' | 'jogo' | 'resultado' | 'pódio';
type LobbyActionStatus = {
  status: 'pending' | 'confirmed' | 'rejected';
  message?: string;
};

/** Track which entry card triggered the pending connection */
type PendingAction = 'create' | 'join' | null;

function createEmptyGameState(): GameState {
  return {
    room: null,
    answers: [],
    finalResults: null,
    myPlayerId: null,
    pendingCommands: {},
    lastCommandResult: null,
  };
}

export default function App() {
  const [screen, setScreen] = useState<UIScreen>('início');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [lobbyActionStatus, setLobbyActionStatus] = useState<LobbyActionStatus | null>(null);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const pendingCommandRef = useRef<(() => void) | null>(null);
  const pendingRoomRequestIdRef = useRef<string | null>(null);
  const lobbyPendingRequestIds = useRef(new Map<string, ClientCommand['type']>());
  const lobbyRequestTimeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Snapshot of the previous room settings for "Play Again" reuse
  const prevRoomSettingsRef = useRef<{
    nickname: string;
    avatar: Avatar;
    categories: string[];
    totalRounds: number;
    roundDurationSeconds: 0 | 60 | 90 | 120;
    allowedLetters: string[];
  } | null>(null);

  useEffect(() => () => {
    for (const timeout of lobbyRequestTimeouts.current.values()) clearTimeout(timeout);
    lobbyRequestTimeouts.current.clear();
  }, []);

  const { state, setState, handleEvent, trackCommand } = useGameState();

  const settleStartCommand = useCallback(() => {
    for (const [requestId, commandType] of lobbyPendingRequestIds.current) {
      if (commandType !== 'game:start') continue;
      lobbyPendingRequestIds.current.delete(requestId);
      const timeout = lobbyRequestTimeouts.current.get(requestId);
      if (timeout) clearTimeout(timeout);
      lobbyRequestTimeouts.current.delete(requestId);
      setLobbyActionStatus({
        status: 'confirmed',
        message: 'Partida iniciada pelo servidor.',
      });
    }
  }, []);

  const onEvent = useCallback(
    (event: import('./types').ServerEvent) => {
      handleEvent(event);
      const lobbyCommandType =
        (event.type === 'command:ack' || event.type === 'error') && event.requestId
          ? lobbyPendingRequestIds.current.get(event.requestId)
          : undefined;

      // Drive screen transitions from server events
      if (event.type === 'room:state') {
        pendingRoomRequestIdRef.current = null;
        setEntryError(null);
        setPendingAction(null);
        setReconnectError(null);
        const phase = event.state.phase;
        if (phase === 'ROUND_ACTIVE') settleStartCommand();
        if (phase === 'CONFIGURING' || phase === 'WAITING_PLAYERS') setScreen('configuração');
        else if (phase === 'ROUND_ACTIVE') setScreen('jogo');
        else if (phase === 'CATEGORY_REVIEW' || phase === 'ROUND_RESULTS') setScreen('resultado');
        else if (phase === 'GAME_OVER') setScreen('pódio');
      }
      if (event.type === 'round:started') {
        settleStartCommand();
        setScreen('jogo');
      }
      if (event.type === 'round:review:category') setScreen('resultado');
      if (event.type === 'game:final_results') setScreen('pódio');
      if (event.type === 'session:resumed') setReconnectError(null);
      if (event.type === 'room:joined' || event.type === 'session:resumed') {
        pendingRoomRequestIdRef.current = null;
        setPendingAction(null);
        setEntryError(null);
      }
      if (event.type === 'error' && event.code === 'SESSION_INVALID') {
        setReconnectError('Não foi possível restaurar sua sessão. Volte ao início e entre na sala novamente.');
      }

      if (event.type === 'command:ack' && lobbyCommandType) {
        lobbyPendingRequestIds.current.delete(event.requestId);
        const timeout = lobbyRequestTimeouts.current.get(event.requestId);
        if (timeout) clearTimeout(timeout);
        lobbyRequestTimeouts.current.delete(event.requestId);
        setLobbyActionStatus({
          status: 'confirmed',
          message: lobbyCommandType === 'game:start'
            ? 'Início confirmado pelo servidor.'
            : 'Configuração salva pelo servidor.',
        });
      }
      if (event.type === 'error' && lobbyCommandType) {
        lobbyPendingRequestIds.current.delete(event.requestId!);
        const timeout = lobbyRequestTimeouts.current.get(event.requestId!);
        if (timeout) clearTimeout(timeout);
        lobbyRequestTimeouts.current.delete(event.requestId!);
        setLobbyActionStatus({
          status: 'rejected',
          message: event.message,
        });
      }
      if (
        event.type === 'error' &&
        event.requestId === pendingRoomRequestIdRef.current
      ) {
        pendingCommandRef.current = null;
        pendingRoomRequestIdRef.current = null;
        setRoomCode(null);
        setPendingAction(null);
        setEntryError(event.message);
        return;
      }
      if (
        event.type === 'error' &&
        event.code !== 'SESSION_INVALID' &&
        event.requestId !== pendingRoomRequestIdRef.current &&
        !lobbyCommandType
      ) {
        setCommandError(event.message);
      }

      if (event.type === 'command:ack' && event.requestId === pendingRoomRequestIdRef.current) {
        pendingRoomRequestIdRef.current = null;
        setPendingAction(null);
      }

      // Fire pending command once connected
      if (
        event.type === 'session:ready' &&
        event.negotiatedProtocolVersion === 1 &&
        pendingCommandRef.current
      ) {
        pendingCommandRef.current();
        pendingCommandRef.current = null;
      }
    },
    [handleEvent, settleStartCommand]
  );

  const { status, send } = useGameSocket({
    url: roomCode ? getRoomWebSocketUrl(backendBaseUrl, roomCode) : null,
    roomCode,
    onEvent,
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  function sendCommand(command: ClientCommand): boolean {
    setCommandError(null);
    const sent = send(command);
    if (sent) {
      trackCommand(command);
    } else {
      setCommandError('Não foi possível enviar a ação. Verifique sua conexão e tente novamente.');
    }
    return sent;
  }

  function sendLobbyCommand(command: ClientCommand): void {
    setLobbyActionStatus({ status: 'pending', message: 'Aguardando confirmação do servidor...' });
    lobbyPendingRequestIds.current.set(command.requestId, command.type);
    const timeout = setTimeout(() => {
      if (!lobbyPendingRequestIds.current.delete(command.requestId)) return;
      lobbyRequestTimeouts.current.delete(command.requestId);
      setLobbyActionStatus({
        status: 'rejected',
        message: 'O servidor não confirmou a alteração. Verifique a conexão e tente novamente.',
      });
    }, 15_000);
    lobbyRequestTimeouts.current.set(command.requestId, timeout);

    if (sendCommand(command)) {
      return;
    } else {
      clearTimeout(timeout);
      lobbyRequestTimeouts.current.delete(command.requestId);
      lobbyPendingRequestIds.current.delete(command.requestId);
      setLobbyActionStatus({
        status: 'rejected',
        message: 'Ação não enviada. Verifique sua conexão e tente novamente.',
      });
    }
  }

  async function handleCreateRoom(nickname: string, avatar: Avatar) {
    setEntryError(null);
    setReconnectError(null);
    setPendingAction('create');
    try {
      const response = await fetch(getRoomsApiUrl(backendBaseUrl), { method: 'POST' });
      const result = (await response.json()) as { code?: string; error?: string; message?: string };
      if (!response.ok || !result.code) {
        throw new Error(result.message ?? result.error ?? 'Não foi possível alocar uma sala.');
      }

      const requestId = crypto.randomUUID();
      pendingRoomRequestIdRef.current = requestId;
      pendingCommandRef.current = () => {
        const cmd: ClientCommand = {
          type: 'room:create',
          requestId,
          nickname,
          avatar,
          roundDurationSeconds: 60,
          allowedLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        };
        const sent = send(cmd);
        if (sent) {
          trackCommand(cmd);
        } else {
          pendingRoomRequestIdRef.current = null;
          setRoomCode(null);
          setPendingAction(null);
          setEntryError('Não foi possível enviar a criação da sala. Verifique sua conexão e tente novamente.');
        }
      };
      setRoomCode(result.code);
    } catch (error) {
      setPendingAction(null);
      setEntryError(
        error instanceof Error ? error.message : 'Falha inesperada ao criar a sala.',
      );
    }
  }

  function handleJoinRoom(nickname: string, code: string, avatar: Avatar) {
    const canonicalCode = code.trim().toUpperCase();
    clearResumeToken(canonicalCode);
    const requestId = crypto.randomUUID();
    setEntryError(null);
    setReconnectError(null);
    setPendingAction('join');
    pendingRoomRequestIdRef.current = requestId;
    pendingCommandRef.current = () => {
      const command: ClientCommand = {
        type: 'room:join',
        requestId,
        code: canonicalCode,
        nickname,
        avatar,
      };
      if (send(command)) {
        trackCommand(command);
      } else {
        pendingRoomRequestIdRef.current = null;
        setRoomCode(null);
        setPendingAction(null);
        setEntryError('Não foi possível enviar o ingresso na sala. Verifique sua conexão e tente novamente.');
      }
    };
    setRoomCode(canonicalCode);
  }

  function handleUpdateCategories(categories: string[]) {
    sendLobbyCommand({ type: 'lobby:categories:update', requestId: crypto.randomUUID(), categories });
  }

  function handleUpdateRounds(totalRounds: number) {
    sendLobbyCommand({ type: 'lobby:rounds:update', requestId: crypto.randomUUID(), totalRounds });
  }

  function handleUpdateOptions(
    roundDurationSeconds: 0 | 60 | 90 | 120,
    allowedLetters: string[],
  ) {
    sendLobbyCommand({
      type: 'lobby:options:update',
      requestId: crypto.randomUUID(),
      roundDurationSeconds,
      allowedLetters,
    });
  }

  function handleStartGame() {
    // Snapshot room settings before game starts so "Play Again" can reuse them
    if (state.room) {
      const me = state.room.players.find((p) => p.id === state.myPlayerId);
      prevRoomSettingsRef.current = {
        nickname: me?.nickname ?? '',
        avatar: me?.avatar ?? '🦊',
        categories: state.room.categories.map((c) => c.name),
        totalRounds: state.room.totalRounds,
        roundDurationSeconds: state.room.roundDurationSeconds ?? 60,
        allowedLetters: state.room.allowedLetters ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
      };
    }
    sendLobbyCommand({ type: 'game:start', requestId: crypto.randomUUID() });
  }

  function handleSubmitAnswers(roundId: string, answers: Record<string, string>) {
    sendCommand({ type: 'answer:submit', requestId: crypto.randomUUID(), roundId, answers });
  }

  function handleStop(roundId: string) {
    sendCommand({ type: 'round:stop', requestId: crypto.randomUUID(), roundId });
  }

  function handleNextRound() {
    if (!room?.currentRoundId) return;
    sendCommand({
      type: 'round:next',
      requestId: crypto.randomUUID(),
      roundId: room.currentRoundId,
    });
  }

  function handleNextCategory() {
    if (!room?.currentRoundId) return;
    sendCommand({
      type: 'round:review:next',
      requestId: crypto.randomUUID(),
      roundId: room.currentRoundId,
    });
  }

  function handleVote(
    roundId: string,
    categoryId: string,
    answerPlayerId: string,
    decision: 'valid' | 'invalidate',
  ) {
    sendCommand({
      type: 'answer:vote',
      requestId: crypto.randomUUID(),
      roundId,
      categoryId,
      answerPlayerId,
      decision,
    });
  }

  /** Reset everything and return to home screen */
  function handleBackToHome() {
    setRoomCode(null);
    setReconnectError(null);
    setCommandError(null);
    setLobbyActionStatus(null);
    setPendingAction(null);
    pendingCommandRef.current = null;
    pendingRoomRequestIdRef.current = null;
    lobbyPendingRequestIds.current.clear();
    for (const timeout of lobbyRequestTimeouts.current.values()) clearTimeout(timeout);
    lobbyRequestTimeouts.current.clear();
    setState(createEmptyGameState());
    setScreen('início');
  }

  /** Create a new room keeping previous nickname/avatar and replicating room settings */
  async function handlePlayAgain() {
    const prev = prevRoomSettingsRef.current;

    // If we have no previous settings, just go home
    if (!prev) {
      handleBackToHome();
      return;
    }

    // Snapshot before resetting state
    const { nickname, avatar, categories, totalRounds, roundDurationSeconds, allowedLetters } = prev;

    // Reset UI state first
    setRoomCode(null);
    setReconnectError(null);
    setCommandError(null);
    setLobbyActionStatus(null);
    setPendingAction('create');
    pendingCommandRef.current = null;
    pendingRoomRequestIdRef.current = null;
    lobbyPendingRequestIds.current.clear();
    for (const timeout of lobbyRequestTimeouts.current.values()) clearTimeout(timeout);
    lobbyRequestTimeouts.current.clear();
    setState(createEmptyGameState());

    try {
      const response = await fetch(getRoomsApiUrl(backendBaseUrl), { method: 'POST' });
      const result = (await response.json()) as { code?: string; error?: string; message?: string };
      if (!response.ok || !result.code) {
        throw new Error(result.message ?? result.error ?? 'Não foi possível criar a nova sala.');
      }

      const requestId = crypto.randomUUID();
      pendingRoomRequestIdRef.current = requestId;
      pendingCommandRef.current = () => {
        const cmd: ClientCommand = {
          type: 'room:create',
          requestId,
          nickname,
          avatar,
          totalRounds,
          roundDurationSeconds,
          allowedLetters,
        };
        const sent = send(cmd);
        if (sent) {
          trackCommand(cmd);
          // After room is created, replicate the categories
          // The server will respond with room:state -> we'll then push categories
          // We store a pending category update to be applied once lobby opens
          pendingCategoryUpdateRef.current = categories;
        } else {
          pendingRoomRequestIdRef.current = null;
          setRoomCode(null);
          setPendingAction(null);
          setEntryError('Não foi possível enviar a criação da sala. Verifique sua conexão.');
        }
      };
      setRoomCode(result.code);
    } catch (error) {
      setPendingAction(null);
      setScreen('início');
      setEntryError(
        error instanceof Error ? error.message : 'Falha inesperada ao criar nova sala.',
      );
    }
  }

  // Ref to apply pending category update after "Play Again" lands in lobby
  const pendingCategoryUpdateRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (screen === 'configuração' && pendingCategoryUpdateRef.current) {
      const cats = pendingCategoryUpdateRef.current;
      pendingCategoryUpdateRef.current = null;
      // Apply the category replication from previous session
      handleUpdateCategories(cats);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // ── Resolve display values ────────────────────────────────────────────────

  const room: RoomState | null = state.room;
  const myPlayerId = state.myPlayerId ?? '';

  useEffect(() => {
    if (room && myPlayerId) {
      const me = room.players.find((p) => p.id === myPlayerId);
      if (me) {
        prevRoomSettingsRef.current = {
          nickname: me.nickname,
          avatar: me.avatar,
          categories: room.categories.map((c) => c.name),
          totalRounds: room.totalRounds,
          roundDurationSeconds: room.roundDurationSeconds ?? 60,
          allowedLetters: room.allowedLetters ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        };
      }
    }
  }, [room, myPlayerId]);

  useEffect(() => {
    if (screen === 'início') return;
    document.querySelector<HTMLElement>('[data-game-screen] h1')?.focus();
  }, [room?.currentReviewCategoryIndex, room?.currentRound, room?.phase, screen]);

  const phaseAnnouncement = room
    ? room.phase === 'ROUND_ACTIVE'
      ? `Rodada ${room.currentRound} de ${room.totalRounds} iniciada. Letra ${room.currentLetter ?? 'não definida'}.`
      : room.phase === 'CATEGORY_REVIEW'
        ? `Revisão da categoria ${room.categories[room.currentReviewCategoryIndex ?? 0]?.name ?? ''}, rodada ${room.currentRound}.`
        : room.phase === 'ROUND_RESULTS'
          ? `Resultados da rodada ${room.currentRound} confirmados.`
          : room.phase === 'GAME_OVER'
            ? 'Partida concluída. Pódio final disponível.'
            : 'Sala pronta para configuração.'
    : '';

  return (
    <>
      <AnimatedBackground />
      {phaseAnnouncement && (
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {phaseAnnouncement}
        </p>
      )}

      {/* Connection status badge (dev helper) */}
      {status !== 'connected' && status !== 'disconnected' && (
        <div
          className={`fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${status === 'connecting' || status === 'resuming'
            ? 'bg-amber-400 text-amber-900'
            : 'bg-rose-500 text-white'
            }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${status === 'connecting' || status === 'resuming' ? 'animate-pulse bg-amber-700' : 'bg-white'
              }`}
          />
          {status === 'connecting'
            ? 'Conectando...'
            : status === 'resuming'
              ? 'Restaurando sessão...'
              : 'Conexão perdida'}
        </div>
      )}

      {reconnectError && (
        <div
          role="alert"
          className="fixed inset-x-4 top-16 z-50 mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900 shadow-lg"
        >
          <span>{reconnectError}</span>
          <button
            type="button"
            onClick={() => {
              if (roomCode) clearResumeToken(roomCode);
              handleBackToHome();
            }}
            className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-white"
          >
            Voltar ao início
          </button>
        </div>
      )}

      {commandError && screen !== 'início' && (
        <div
          role="alert"
          className="fixed inset-x-4 top-16 z-40 mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-900 shadow-lg"
        >
          <span>{commandError}</span>
          <button type="button" onClick={() => setCommandError(null)} className="shrink-0 underline">
            Fechar
          </button>
        </div>
      )}

      {screen !== 'início' && !room && (
        <p role="status" className="mx-auto mt-24 max-w-xl rounded-xl bg-white p-6 text-center text-sm font-semibold text-slate-700 shadow">
          Aguardando o estado confirmado da sala...
        </p>
      )}

      {screen === 'início' && (
        <EntryScreen
          onEnterRoom={handleJoinRoom}
          onCreateRoom={handleCreateRoom}
          error={entryError}
          pendingAction={pendingAction}
          initialRoomCode={invitedRoomCode}
        />
      )}

      {screen === 'configuração' && room && (
        <LobbyScreen
          room={room}
          myPlayerId={myPlayerId}
          onUpdateCategories={handleUpdateCategories}
          onUpdateRounds={handleUpdateRounds}
          onUpdateOptions={handleUpdateOptions}
          onStartGame={handleStartGame}
          actionStatus={lobbyActionStatus}
        />
      )}

      {screen === 'jogo' && room && (
        <GameScreen
          room={room}
          myPlayerId={myPlayerId}
          onSubmitAnswers={handleSubmitAnswers}
          onStop={handleStop}
        />
      )}

      {screen === 'resultado' && room && (
        <ResultsScreen
          room={room}
          myPlayerId={myPlayerId}
          answers={state.answers}
          onVote={handleVote}
          onNextRound={handleNextRound}
          onNextCategory={handleNextCategory}
        />
      )}

      {screen === 'pódio' && state.finalResults && (
        <PodiumScreen
          results={state.finalResults}
          myPlayerId={myPlayerId}
          onPlayAgain={handlePlayAgain}
          onBackToHome={handleBackToHome}
        />
      )}
    </>
  );
}

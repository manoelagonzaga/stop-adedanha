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
import type { ClientCommand, RoomState } from './types';


const backendBaseUrl = getBackendBaseUrl(import.meta.env.VITE_BACKEND_URL, location.origin);

type UIScreen = 'início' | 'configuração' | 'jogo' | 'resultado' | 'pódio';
type LobbyActionStatus = {
  status: 'pending' | 'confirmed' | 'rejected';
  message?: string;
};

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
  const [isRoomPending, setIsRoomPending] = useState(false);
  const pendingCommandRef = useRef<(() => void) | null>(null);
  const pendingRoomRequestIdRef = useRef<string | null>(null);
  const lobbyPendingRequestIds = useRef(new Map<string, ClientCommand['type']>());

  const { state, setState, handleEvent, trackCommand } = useGameState();

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
        setIsRoomPending(false);
        setReconnectError(null);
        const phase = event.state.phase;
        if (phase === 'CONFIGURING' || phase === 'WAITING_PLAYERS') setScreen('configuração');
        else if (phase === 'ROUND_ACTIVE') setScreen('jogo');
        else if (phase === 'CATEGORY_REVIEW' || phase === 'ROUND_RESULTS') setScreen('resultado');
        else if (phase === 'GAME_OVER') setScreen('pódio');
      }
      if (event.type === 'round:started') setScreen('jogo');
      if (event.type === 'round:review:category') setScreen('resultado');
      if (event.type === 'game:final_results') setScreen('pódio');
      if (event.type === 'session:resumed') setReconnectError(null);
      if (event.type === 'room:joined' || event.type === 'session:resumed') {
        pendingRoomRequestIdRef.current = null;
        setIsRoomPending(false);
        setEntryError(null);
      }
      if (event.type === 'error' && event.code === 'SESSION_INVALID') {
        setReconnectError('Não foi possível restaurar sua sessão. Volte ao início e entre na sala novamente.');
      }

      if (event.type === 'command:ack' && lobbyCommandType) {
        lobbyPendingRequestIds.current.delete(event.requestId);
        setLobbyActionStatus({
          status: 'confirmed',
          message: lobbyCommandType === 'game:start'
            ? 'Início confirmado pelo servidor.'
            : 'Configuração salva pelo servidor.',
        });
      }
      if (event.type === 'error' && lobbyCommandType) {
        lobbyPendingRequestIds.current.delete(event.requestId!);
        setLobbyActionStatus({ status: 'rejected', message: event.message });
      }

      if (
        event.type === 'error' &&
        event.requestId &&
        event.requestId === pendingRoomRequestIdRef.current
      ) {
        pendingCommandRef.current = null;
        pendingRoomRequestIdRef.current = null;
        setRoomCode(null);
        setIsRoomPending(false);
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
        setIsRoomPending(false);
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
    [handleEvent]
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
    if (sendCommand(command)) {
      lobbyPendingRequestIds.current.set(command.requestId, command.type);
    } else {
      setLobbyActionStatus({
        status: 'rejected',
        message: 'Ação não enviada. Verifique sua conexão e tente novamente.',
      });
    }
  }

  async function handleCreateRoom(nickname: string) {
    setEntryError(null);
    setReconnectError(null);
    setIsRoomPending(true);
    try {
      const response = await fetch(getRoomsApiUrl(backendBaseUrl), { method: 'POST' });
      const result = (await response.json()) as { code?: string; error?: string; message?: string };
      if (!response.ok || !result.code) {
        throw new Error(result.message ?? result.error ?? 'Não foi possível alocar uma sala.');
      }

      const requestId = crypto.randomUUID();
      pendingRoomRequestIdRef.current = requestId;
      pendingCommandRef.current = () => {
        const sent = send({
          type: 'room:create',
          requestId,
          nickname,
          roundDurationSeconds: 60,
          allowedLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        });
        if (sent) {
          trackCommand({
            type: 'room:create',
            requestId,
            nickname,
            roundDurationSeconds: 60,
            allowedLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
          });
        } else {
          pendingRoomRequestIdRef.current = null;
          setRoomCode(null);
          setIsRoomPending(false);
          setEntryError('Não foi possível enviar a criação da sala. Verifique sua conexão e tente novamente.');
        }
      };
      setRoomCode(result.code);
    } catch (error) {
      setIsRoomPending(false);
      setEntryError(
        error instanceof Error ? error.message : 'Falha inesperada ao criar a sala.',
      );
    }
  }

  function handleJoinRoom(nickname: string, code: string) {
    const canonicalCode = code.trim().toUpperCase();
    clearResumeToken(canonicalCode);
    const requestId = crypto.randomUUID();
    setEntryError(null);
    setReconnectError(null);
    setIsRoomPending(true);
    pendingRoomRequestIdRef.current = requestId;
    pendingCommandRef.current = () => {
      const command: ClientCommand = { type: 'room:join', requestId, code: canonicalCode, nickname };
      if (send(command)) {
        trackCommand(command);
      } else {
        pendingRoomRequestIdRef.current = null;
        setRoomCode(null);
        setIsRoomPending(false);
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

  function handlePlayAgain() {
    setRoomCode(null);
    setReconnectError(null);
    setCommandError(null);
    setLobbyActionStatus(null);
    pendingCommandRef.current = null;
    pendingRoomRequestIdRef.current = null;
    lobbyPendingRequestIds.current.clear();
    setState(createEmptyGameState());
    setScreen('início');
  }

  // ── Resolve display values ────────────────────────────────────────────────

  const room: RoomState | null = state.room;
  const myPlayerId = state.myPlayerId ?? '';

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
              setRoomCode(null);
              setReconnectError(null);
              setCommandError(null);
              setLobbyActionStatus(null);
              pendingCommandRef.current = null;
              pendingRoomRequestIdRef.current = null;
              lobbyPendingRequestIds.current.clear();
              setState(createEmptyGameState());
              setScreen('início');
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
          isLoading={isRoomPending}
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
        />
      )}

      {screen === 'pódio' && state.finalResults && (
        <PodiumScreen
          results={state.finalResults}
          myPlayerId={myPlayerId}
          onPlayAgain={handlePlayAgain}
          onBackToHome={handlePlayAgain}
        />
      )}
    </>
  );
}

import { useState, useCallback, useRef } from 'react';
import { AnimatedBackground } from './components/AnimatedBackground';
import { EntryScreen } from './screens/EntryScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { PodiumScreen } from './screens/PodiumScreen';
import { useGameSocket, useGameState } from './hooks/useGameSocket';
import type { RoomState, FinalResults } from './types';


// ── WebSocket URL ─────────────────────────────────────────────────────────────
// In dev mode the Vite proxy forwards /ws/* to the local wrangler backend.
// In production replace with the actual Workers URL.
function wsUrl(roomCode: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = import.meta.env.VITE_BACKEND_HOST || location.host;
  return `${proto}://${host}/rooms/${roomCode}`;
}

type UIScreen = 'início' | 'configuração' | 'jogo' | 'resultado' | 'pódio';

// ── Stub final results for when finalResults is null ─────────────────────────
function buildFinalResults(room: RoomState): import('./types').FinalResults {
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const podium = sorted.slice(0, 3).map((p, i) => ({
    position: (i + 1) as 1 | 2 | 3,
    playerId: p.id,
    nickname: p.nickname,
    score: p.score,
    tier: (['gold', 'silver', 'bronze'] as const)[i],
  }));
  const list = sorted.slice(3).map((p, i) => ({
    position: i + 4,
    playerId: p.id,
    nickname: p.nickname,
    score: p.score,
  }));
  return { podium, list };
}

export default function App() {
  const [screen, setScreen] = useState<UIScreen>('início');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [isRoomPending, setIsRoomPending] = useState(false);
  const pendingCommandRef = useRef<(() => void) | null>(null);
  const pendingRoomRequestIdRef = useRef<string | null>(null);

  const { state, setState, handleEvent } = useGameState();

  const onEvent = useCallback(
    (event: import('./types').ServerEvent) => {
      handleEvent(event);

      // Drive screen transitions from server events
      if (event.type === 'room:state') {
        pendingRoomRequestIdRef.current = null;
        setEntryError(null);
        setIsRoomPending(false);
        const phase = event.state.phase;
        if (phase === 'CONFIGURING' || phase === 'WAITING_PLAYERS') setScreen('configuração');
        else if (phase === 'ROUND_ACTIVE') setScreen('jogo');
        else if (phase === 'CATEGORY_REVIEW' || phase === 'ROUND_RESULTS') setScreen('resultado');
        else if (phase === 'GAME_OVER') setScreen('pódio');
      }
      if (event.type === 'round:started') setScreen('jogo');
      if (event.type === 'round:review:category') setScreen('resultado');
      if (event.type === 'game:final_results') setScreen('pódio');

      if (
        event.type === 'error' &&
        event.requestId &&
        event.requestId === pendingRoomRequestIdRef.current
      ) {
        pendingCommandRef.current = null;
        pendingRoomRequestIdRef.current = null;
        setRoomCode(null);
        setIsRoomPending(false);
        setEntryError(`${event.code}: ${event.message}`);
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
    url: roomCode ? wsUrl(roomCode) : null,
    onEvent,
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleCreateRoom(nickname: string) {
    setEntryError(null);
    setIsRoomPending(true);
    try {
      const response = await fetch('/rooms', { method: 'POST' });
      const result = (await response.json()) as { code?: string; error?: string; message?: string };
      if (!response.ok || !result.code) {
        throw new Error(result.message ?? result.error ?? 'Não foi possível alocar uma sala.');
      }

      const requestId = crypto.randomUUID();
      pendingRoomRequestIdRef.current = requestId;
      pendingCommandRef.current = () =>
        send({ type: 'room:create', requestId, nickname });
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
    const requestId = crypto.randomUUID();
    setEntryError(null);
    setIsRoomPending(true);
    pendingRoomRequestIdRef.current = requestId;
    pendingCommandRef.current = () =>
      send({ type: 'room:join', requestId, code: canonicalCode, nickname });
    setRoomCode(canonicalCode);
  }

  function handleUpdateCategories(categories: string[]) {
    send({ type: 'lobby:categories:update', requestId: crypto.randomUUID(), categories });
    // Optimistic update
    setState((s) => ({
      ...s,
      room: s.room
        ? { ...s.room, categories: categories.map((name, i) => ({ id: `cat-${i}`, name })) }
        : s.room,
    }));
  }

  function handleUpdateRounds(totalRounds: number) {
    // Optimistic update; no dedicated command yet — server will sync via room:state
    setState((s) => ({
      ...s,
      room: s.room ? { ...s.room, totalRounds } : s.room,
    }));
  }

  function handleStartGame() {
    send({ type: 'game:start', requestId: crypto.randomUUID() });
  }

  function handleSubmitAnswers(roundId: string, answers: Record<string, string>) {
    send({ type: 'answer:submit', requestId: crypto.randomUUID(), roundId, answers });
  }

  function handleStop(roundId: string) {
    send({ type: 'round:stop', requestId: crypto.randomUUID(), roundId });
  }

  function handleInvalidate(roundId: string, answerKey: string) {
    // answerKey is "playerId-categoryId"
    const [, categoryId] = answerKey.split('-');
    send({
      type: 'answer:invalidate',
      requestId: crypto.randomUUID(),
      roundId,
      categoryId,
      answerId: answerKey,
    });
  }

  function handleNextRound() {
    // Server transitions automatically; this is a local fallback
    setScreen('jogo');
  }

  function handlePlayAgain() {
    setRoomCode(null);
    setState({ room: null, answers: [], finalResults: null, myPlayerId: null });
    setScreen('início');
  }

  // ── Resolve display values ────────────────────────────────────────────────

  const room: RoomState = state.room ?? {
    code: roomCode ?? '—',
    phase: 'CONFIGURING',
    players: [],
    categories: [
      { id: 'cat-0', name: 'Nome' },
      { id: 'cat-1', name: 'Comidas' },
      { id: 'cat-2', name: 'Famosos' },
      { id: 'cat-3', name: 'Objeto' },
    ],
    currentRound: 1,
    totalRounds: 5,
    currentLetter: 'S',
    roundDeadline: Date.now() + 60_000,
  };

  const myPlayerId = state.myPlayerId ?? 'local-player';
  const finalResults: FinalResults = state.finalResults ?? buildFinalResults(room);

  return (
    <>
      <AnimatedBackground />

      {/* Connection status badge (dev helper) */}
      {status !== 'connected' && status !== 'disconnected' && (
        <div
          className={`fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${status === 'connecting'
            ? 'bg-amber-400 text-amber-900'
            : 'bg-rose-500 text-white'
            }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${status === 'connecting' ? 'animate-pulse bg-amber-700' : 'bg-white'
              }`}
          />
          {status === 'connecting' ? 'Conectando...' : 'Conexão perdida'}
        </div>
      )}

      {screen === 'início' && (
        <EntryScreen
          onEnterRoom={handleJoinRoom}
          onCreateRoom={handleCreateRoom}
          error={entryError}
          isLoading={isRoomPending}
        />
      )}

      {screen === 'configuração' && (
        <LobbyScreen
          room={room}
          myPlayerId={myPlayerId}
          onUpdateCategories={handleUpdateCategories}
          onUpdateRounds={handleUpdateRounds}
          onStartGame={handleStartGame}
        />
      )}

      {screen === 'jogo' && (
        <GameScreen
          room={room}
          myPlayerId={myPlayerId}
          onSubmitAnswers={handleSubmitAnswers}
          onStop={handleStop}
        />
      )}

      {screen === 'resultado' && (
        <ResultsScreen
          room={room}
          myPlayerId={myPlayerId}
          answers={state.answers}
          ranking={room.players}
          onNextRound={handleNextRound}
          onFinishGame={() => setScreen('pódio')}
          onInvalidate={handleInvalidate}
        />
      )}

      {screen === 'pódio' && (
        <PodiumScreen
          results={finalResults}
          myPlayerId={myPlayerId}
          onPlayAgain={handlePlayAgain}
          onBackToHome={handlePlayAgain}
        />
      )}
    </>
  );
}

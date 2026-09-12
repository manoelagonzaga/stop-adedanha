import { useState } from 'react';
import { AnimatedBackground } from './components/AnimatedBackground';
import { EntryScreen } from './screens/EntryScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import type { RoomState, Answer } from './types';

// ── Demo stub state — replace with real WebSocket state in task 4 ──
const DEMO_ROOM: RoomState = {
  code: 'XYD-7',
  phase: 'CONFIGURING',
  players: [
    { id: 'p1', nickname: 'Rafael Bezerra', isHost: true, status: 'active', score: 140 },
    { id: 'p2', nickname: 'Marina C.', isHost: false, status: 'active', score: 95 },
    { id: 'p3', nickname: 'Diego F.', isHost: false, status: 'active', score: 62 },
  ],
  categories: [
    { id: 'cat-1', name: 'Nome' },
    { id: 'cat-2', name: 'Comidas' },
    { id: 'cat-3', name: 'Famosos' },
    { id: 'cat-4', name: 'Objeto' },
  ],
  currentRound: 2,
  totalRounds: 3,
  currentLetter: 'S',
  roundDeadline: Date.now() + 60_000,
};

const DEMO_ANSWERS: Answer[] = [
  { playerId: 'p1', categoryId: 'cat-1', value: 'Silvia', isValid: true, invalidations: [], score: 5 },
  { playerId: 'p2', categoryId: 'cat-1', value: 'Silvia', isValid: true, invalidations: [], score: 5 },
  { playerId: 'p3', categoryId: 'cat-1', value: '', isValid: false, invalidations: [], score: 0 },
  { playerId: 'p1', categoryId: 'cat-2', value: 'Salada', isValid: true, invalidations: [], score: 10 },
  { playerId: 'p2', categoryId: 'cat-2', value: 'Sopa', isValid: true, invalidations: [], score: 10 },
  { playerId: 'p3', categoryId: 'cat-2', value: 'Salsicha', isValid: true, invalidations: [], score: 10 },
];

type UIScreen = 'início' | 'configuração' | 'jogo' | 'resultado';

export default function App() {
  const [screen, setScreen] = useState<UIScreen>('início');
  const [room, setRoom] = useState<RoomState>(DEMO_ROOM);
  const MY_ID = 'p1';

  // ── Screen navigation stubs (will be replaced by WebSocket events in task 4) ──
  function handleEnterRoom(nickname: string, code: string) {
    console.log('Joining room', code, 'as', nickname);
    setScreen('configuração');
  }

  function handleCreateRoom(nickname: string) {
    console.log('Creating room as', nickname);
    setScreen('configuração');
  }

  function handleUpdateCategories(categories: string[]) {
    setRoom((r: RoomState) => ({
      ...r,
      categories: categories.map((name, i) => ({ id: `cat-${i}`, name })),
    }));
  }

  function handleUpdateRounds(totalRounds: number) {
    setRoom((r: RoomState) => ({ ...r, totalRounds }));
  }

  function handleStartGame() {
    setRoom((r: RoomState) => ({ ...r, phase: 'ROUND_ACTIVE', roundDeadline: Date.now() + r.categories.length * 20_000 }));
    setScreen('jogo');
  }

  function handleSubmitAnswers(roundId: string, answers: Record<string, string>) {
    console.log('Submitted answers for', roundId, answers);
  }

  function handleStop(roundId: string) {
    console.log('Stop pressed for', roundId);
    setRoom((r: RoomState) => ({ ...r, phase: 'ROUND_RESULTS' }));
    setScreen('resultado');
  }

  function handleNextRound() {
    setRoom((r: RoomState) => ({
      ...r,
      phase: r.currentRound >= r.totalRounds ? 'GAME_OVER' : 'ROUND_ACTIVE',
      currentRound: Math.min(r.currentRound + 1, r.totalRounds),
      roundDeadline: Date.now() + r.categories.length * 20_000,
    }));
    setScreen('jogo');
  }

  function handleInvalidate(roundId: string, answerId: string) {
    console.log('Invalidate', answerId, 'in', roundId);
  }

  return (
    <>
      <AnimatedBackground />

      {/* ── Dev navigation strip (remove before production) ── */}
      <nav
        aria-label="Dev screen switcher"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex gap-2 rounded-full bg-black/70 px-4 py-2 backdrop-blur-md"
      >
        {(['início', 'configuração', 'jogo', 'resultado'] as UIScreen[]).map((s) => (
          <button
            key={s}
            onClick={() => setScreen(s)}
            className={[
              'rounded-full px-3 py-1 text-xs font-semibold transition',
              screen === s ? 'bg-white text-black' : 'text-white/60 hover:text-white',
            ].join(' ')}
          >
            {s}
          </button>
        ))}
      </nav>

      {screen === 'início' && (
        <EntryScreen
          onEnterRoom={handleEnterRoom}
          onCreateRoom={handleCreateRoom}
        />
      )}

      {screen === 'configuração' && (
        <LobbyScreen
          room={room}
          myPlayerId={MY_ID}
          onUpdateCategories={handleUpdateCategories}
          onUpdateRounds={handleUpdateRounds}
          onStartGame={handleStartGame}
        />
      )}

      {screen === 'jogo' && (
        <GameScreen
          room={room}
          myPlayerId={MY_ID}
          onSubmitAnswers={handleSubmitAnswers}
          onStop={handleStop}
        />
      )}

      {screen === 'resultado' && (
        <ResultsScreen
          room={room}
          myPlayerId={MY_ID}
          answers={DEMO_ANSWERS}
          ranking={room.players}
          roundScore={20}
          onNextRound={handleNextRound}
          onInvalidate={handleInvalidate}
        />
      )}
    </>
  );
}

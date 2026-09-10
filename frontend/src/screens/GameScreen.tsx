import { useEffect, useRef, useState } from 'react';
import type { RoomState, Category, Player } from '../types';
import { Scoreboard } from '../components/Scoreboard';

interface GameScreenProps {
  room: RoomState;
  myPlayerId: string;
  onSubmitAnswers: (roundId: string, answers: Record<string, string>) => void;
  onStop: (roundId: string) => void;
}

// Milestones at which the timer announces itself to screen readers (in seconds)
const ANNOUNCE_MILESTONES = [30, 10, 5];

/**
 * Tela 3 — Rodada Ativa.
 * DOM order: round header → drawn letter (h2) → stop button → answers form → scoreboard (aside).
 */
export function GameScreen({ room, myPlayerId: _myPlayerId, onSubmitAnswers, onStop }: GameScreenProps) {
  const letter = room.currentLetter ?? '?';
  const roundId = `round-${room.currentRound}`;

  // Local answers keyed by categoryId
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [letterVisible, setLetterVisible] = useState(false);

  // Countdown state
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [announcedTime, setAnnouncedTime] = useState<string>('');
  const announcedMilestonesRef = useRef<Set<number>>(new Set());

  // Animate letter in
  useEffect(() => {
    setLetterVisible(false);
    const t = setTimeout(() => setLetterVisible(true), 80);
    return () => clearTimeout(t);
  }, [letter]);

  // Reset answers when round changes
  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
    announcedMilestonesRef.current.clear();
  }, [room.currentRound]);

  // Countdown timer driven by server deadline
  useEffect(() => {
    if (!room.roundDeadline) return;

    const tick = () => {
      const remaining = Math.max(0, Math.round((room.roundDeadline! - Date.now()) / 1000));
      setSecondsLeft(remaining);

      // Announce milestones to screen readers (non-disruptively)
      for (const ms of ANNOUNCE_MILESTONES) {
        if (remaining <= ms && !announcedMilestonesRef.current.has(ms)) {
          announcedMilestonesRef.current.add(ms);
          setAnnouncedTime(remaining === 0 ? 'Tempo esgotado!' : `${remaining} segundos restantes`);
        }
      }
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [room.roundDeadline]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitted) return;
    setSubmitted(true);
    onSubmitAnswers(roundId, answers);
  }

  function handleStop() {
    onStop(roundId);
  }

  const totalSeconds = room.categories.length * 20;

  return (
    <div className="flex min-h-svh flex-col lg:grid lg:grid-cols-[1fr_25%] gap-4 px-4 py-8 lg:px-8">

      {/* ── Main game area ── */}
      <main className="flex flex-col gap-5">

        {/* Round header card */}
        <div className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold tracking-[0.2em] text-gray-400 uppercase">Letra sorteada</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
                Round {room.currentRound}/{room.totalRounds}
              </span>
            </div>

            {/* Timer — visible display */}
            <div aria-hidden="true" className="text-right">
              <span className="text-3xl font-extrabold tabular-nums text-navy">
                {secondsLeft !== null
                  ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
                  : `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`}
              </span>
              <p className="text-xs text-gray-400">
                {room.players.filter((p: Player) => p.status === 'active').length} jogando
              </p>
            </div>
          </div>

          {/* Drawn letter — animated, announced immediately */}
          <h2
            className={[
              'mt-4 text-center text-9xl font-extrabold text-orange transition-all duration-300',
              letterVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-50',
            ].join(' ')}
            aria-label={`Letra sorteada: ${letter}`}
            aria-live="assertive"
            aria-atomic="true"
          >
            {letter}
          </h2>
        </div>

        {/* STOP button */}
        {!submitted && (
          <button
            type="button"
            onClick={handleStop}
            className="w-full rounded-2xl bg-navy py-4 text-lg font-extrabold uppercase tracking-widest text-white
                       hover:bg-navy/90 active:scale-[0.97] transition-all
                       focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange focus-visible:ring-offset-2"
            aria-label="Parar o jogo — encerra a rodada para todos os jogadores"
          >
            Stop<span className="text-orange">!</span>
          </button>
        )}

        {/* Answers form */}
        <section className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-gray-800">Categorias</h3>
            <span className="text-xs text-gray-400">
              {Object.values(answers).filter(Boolean).length}/{room.categories.length}
            </span>
          </div>

          <form id="answers-form" onSubmit={handleSubmit}>
            <ul className="flex flex-col gap-3" aria-label="Formulário de respostas">
              {room.categories.map((cat: Category) => (
                <li key={cat.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  {/* Category pill */}
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white"
                  >
                    {cat.name[0].toUpperCase()}
                  </span>
                  <label htmlFor={`answer-${cat.id}`} className="w-28 shrink-0 text-sm font-semibold text-gray-700">
                    {cat.name}
                  </label>
                  <input
                    id={`answer-${cat.id}`}
                    type="text"
                    value={answers[cat.id] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                    disabled={submitted}
                    placeholder="Sua resposta…"
                    autoComplete="off"
                    className={[
                      'flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400',
                      'outline-none transition focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-navy/20',
                      submitted ? 'opacity-50 cursor-not-allowed' : '',
                    ].join(' ')}
                  />
                </li>
              ))}
            </ul>

            {!submitted && (
              <button
                type="submit"
                form="answers-form"
                className="mt-5 w-full rounded-xl border-2 border-navy py-3 text-sm font-bold text-navy
                           hover:bg-navy hover:text-white active:scale-[0.98] transition-all
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
              >
                Enviar respostas
              </button>
            )}
            {submitted && (
              <p role="status" aria-live="polite" className="mt-4 text-center text-sm font-semibold text-gray-500">
                ✓ Respostas enviadas — aguardando os outros jogadores…
              </p>
            )}
          </form>
        </section>

        {/* Timer live region — only announces at milestones, non-intrusive */}
        <div role="timer" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcedTime}
        </div>
      </main>

      {/* ── Sidebar Scoreboard — last in DOM ── */}
      <div>
        <div className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-5 py-5">
          <Scoreboard
            players={room.players}
            currentRound={room.currentRound}
            totalRounds={room.totalRounds}
          />
        </div>
      </div>
    </div>
  );
}

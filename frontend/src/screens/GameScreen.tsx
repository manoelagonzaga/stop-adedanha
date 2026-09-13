import { useEffect, useRef, useState } from 'react';
import type { RoomState, Category, Player } from '../types';
import { Scoreboard } from '../components/Scoreboard';

interface GameScreenProps {
  room: RoomState;
  myPlayerId: string;
  onSubmitAnswers: (roundId: string, answers: Record<string, string>) => void;
  onStop: (roundId: string) => void;
}


const LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
] as const;

/**
 * Tela 3 — Rodada Ativa.
 * DOM order: round header → drawn letter (h2) → stop button → answers form → scoreboard (aside).
 */
export function GameScreen({ room, myPlayerId: _myPlayerId, onSubmitAnswers, onStop }: GameScreenProps) {
  const roundId = `round-${room.currentRound}`;
  
  console.log('user: ', _myPlayerId);

  // Local answers keyed by categoryId
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Countdown state
  const [announcedTime] = useState<string>('');
  const announcedMilestonesRef = useRef<Set<number>>(new Set());

  const [letter, setLetter] = useState<string>(() => generateLetter());
  const [displayLetter, setDisplayLetter] = useState<string>(letter);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isStopped, setIsStopped] = useState(false);

  // Animate letter in
  useEffect(() => {
    const nextLetter = generateLetter();
    setLetter(nextLetter);
    drawLetter(nextLetter);
  }, [letter]);

  // Reset answers when round changes
  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
    announcedMilestonesRef.current.clear();
  }, [room.currentRound]);

  function CountdownTimer( initialSeconds = room.categories.length * 20) {
    const [timeLeft, setTimeLeft] = useState(initialSeconds);
    
    useEffect(() => {
      if (isStopped) {
        if (timeLeft <= 0) return;

        const intervalId = setInterval(() => {
          setTimeLeft((prevTime) => prevTime - 1);
        }, 1000);

        return () => clearInterval(intervalId);
      }
    }, [timeLeft, isStopped]);

    const formatTime = (seconds: number) => {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    return (
      <div>
        <h2>{formatTime(timeLeft)}</h2>
        {timeLeft === 0 && <p>O tempo acabou!</p>}
      </div>
    );
    
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitted) return;
    setSubmitted(true);
    onSubmitAnswers(roundId, answers);
  }

  function handleStop() {
    formRef.current?.requestSubmit();
    onStop(roundId);
  }

  function generateLetter(): string {
    return LETTERS[Math.floor(Math.random() * LETTERS.length)] ?? "A";
  }

  function drawLetter(finalLetter: string) {
    setIsDrawing(true);
    let steps = 0;
    const maxSteps = 22;
    const interval = setInterval(() => {
      steps = steps + 1;
      setDisplayLetter(LETTERS[Math.floor(Math.random() * LETTERS.length)] ?? finalLetter);
      if (steps >= maxSteps) {
        setIsStopped(true);
        setDisplayLetter(finalLetter);
        setIsDrawing(false);
        clearInterval(interval);
      }
    }, 70);
  }


  return (
    <div className="flex min-h-svh flex-col lg:grid lg:grid-cols-[1fr_3fr_1fr] gap-4 px-4 py-8 lg:px-8">

      {/* Round header card */}
      <div className="flex flex-col gap-5 rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5">
      <div>


        <span className="text-base font-bold tracking-widest text-navy uppercase">Letra sorteada</span>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 font-medium tracking-wide">
              Round {room.currentRound}/{room.totalRounds}
            </span>
          </div>
          </div>

        {/* Drawn letter — animated, announced immediately */}
        <div className="grid place-items-center">
          <span
            key={displayLetter + (isDrawing ? "-draw" : "-lock")}
            className={`mt-4 text-center text-9xl font-extrabold text-orange transition-all duration-300 ${isDrawing ? "animate-letter-shuffle" : "animate-letter-lock"}`}
            aria-label={`Letra sorteada: ${letter}`}
            aria-live="assertive"
            aria-atomic="true"
          >
            {displayLetter}
          </span>
        </div>

      </div>

      {/* Timer — visible display */}
      <div aria-hidden="true" className="text-center">
        <span className="text-3xl font-extrabold tabular-nums text-navy">
          {CountdownTimer()}
        </span>
        <p className="text-xs text-gray-400">
          {room.players.filter((p: Player) => p.status === 'active').length} jogando
        </p>
      </div>
      </div>

      {/* ── Main game area ── */}
      <main className="flex flex-col gap-5">

        {/* Answers form */}
        <section className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-gray-800 uppercase">Categorias</h3>
            <span className="text-xs text-gray-400">
              {Object.values(answers).filter(Boolean).length}/{room.categories.length}
            </span>
          </div>

          <form id="answers-form" ref={formRef}  onSubmit={handleSubmit}>
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

            {/* {!submitted && (
              <button
                type="submit"
                form="answers-form"
                className="mt-5 w-full rounded-xl border-2 border-navy py-3 text-sm font-bold text-navy
                           hover:bg-navy hover:text-white active:scale-[0.98] transition-all
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
              >
                Enviar respostas
              </button>
            )} */}
            {submitted && (
              <p role="status" aria-live="polite" className="mt-4 text-center text-sm font-semibold text-gray-500">
                ✓ Respostas enviadas — aguardando os outros jogadores…
              </p>
            )}
          </form>
        </section>

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

        {/* Timer live region — only announces at milestones, non-intrusive */}
        <div role="timer" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcedTime}
        </div>
      </main>

      {/* ── Sidebar Scoreboard — last in DOM ── */}
      <div className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-5 py-5">
        <Scoreboard
          players={room.players}
          currentRound={room.currentRound}
          totalRounds={room.totalRounds}
        />
      </div>
    </div>
  );
}

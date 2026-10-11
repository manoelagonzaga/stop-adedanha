import { useState, useEffect, useRef, useCallback } from 'react';
import type { RoomState, Category } from '../types';
import { useToast } from '../components/Toast';
import { playStopSound } from '../utils/audio';

interface GameScreenProps {
  room: RoomState;
  myPlayerId: string;
  onSubmitAnswers: (roundId: string, answers: Record<string, string>) => void;
  onStop: (roundId: string) => void;
}

type IntroPhase = 'spinning' | 'revealed' | 'countdown' | 'playing';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Produces a human-readable duration string that screen readers will read correctly */
function accessibleDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 segundos restantes';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins > 0 && secs > 0) return `${mins} minuto${mins > 1 ? 's' : ''} e ${secs} segundo${secs !== 1 ? 's' : ''} restantes`;
  if (mins > 0) return `${mins} minuto${mins > 1 ? 's' : ''} restantes`;
  return `${secs} segundo${secs !== 1 ? 's' : ''} restantes`;
}

export function GameScreen({ room, myPlayerId, onSubmitAnswers, onStop }: GameScreenProps) {
  const { showToast } = useToast();
  const roundId = room.currentRoundId ?? `round-${room.currentRound}`;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now);
  const [isStopped, setIsStopped] = useState<boolean>(false);
  const stopRequestedRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // ── Intro Animation State ───────────────────────────────────────────────────
  const [introPhase, setIntroPhase] = useState<IntroPhase>('spinning');
  const [spinningLetter, setSpinningLetter] = useState(ALPHABET[0]);
  const [countdownValue, setCountdownValue] = useState(3);
  // Announce text for screen readers — must change to re-trigger aria-live
  const [srAnnounce, setSrAnnounce] = useState('sorteando letra');

  const currentLetter = room.currentLetter ?? 'M';
  const timeLeft =
    room.roundDeadline === undefined
      ? null
      : Math.max(0, Math.ceil((room.roundDeadline - now) / 1000));

  // ── Intro animation: spinning → revealed → countdown → playing ──────────────
  useEffect(() => {
    setIntroPhase('spinning');
    setCountdownValue(3);
    setSrAnnounce('sorteando letra');

    // Rapid letter cycling for 1.2 s
    const spinDuration = 1200;
    const spinInterval = setInterval(() => {
      setSpinningLetter(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
    }, 80);

    const revealTimer = setTimeout(() => {
      clearInterval(spinInterval);
      setSpinningLetter(currentLetter);
      setSrAnnounce(`letra sorteada: ${currentLetter}`);
      setIntroPhase('revealed');
    }, spinDuration);

    const countdownStartTimer = setTimeout(() => {
      setIntroPhase('countdown');
      setCountdownValue(3);
    }, spinDuration + 1000);

    return () => {
      clearInterval(spinInterval);
      clearTimeout(revealTimer);
      clearTimeout(countdownStartTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // ── Countdown 3, 2, 1 → playing ─────────────────────────────────────────────
  useEffect(() => {
    if (introPhase !== 'countdown') return;

    if (countdownValue === 3) {
      setSrAnnounce('Iniciando o jogo em: 3');
    } else if (countdownValue === 2) {
      setSrAnnounce('2');
    } else if (countdownValue === 1) {
      setSrAnnounce('1');
    }

    if (countdownValue <= 0) {
      setIntroPhase('playing');
      // Focus first input when game unlocks
      requestAnimationFrame(() => firstInputRef.current?.focus());
      return;
    }

    const t = setTimeout(() => {
      setCountdownValue((v) => v - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [introPhase, countdownValue]);

  // ── Round timer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (room.roundDeadline === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [room.roundDeadline]);

  const handleTriggerStop = useCallback(() => {
    if (stopRequestedRef.current || isStopped) return;
    stopRequestedRef.current = true;
    setIsStopped(true);
    playStopSound();
    showToast('🛑 VOCÊ BATEU STOP! Congelando rodada...');
    onSubmitAnswers(roundId, answers);
    onStop(roundId);
  }, [answers, isStopped, onStop, onSubmitAnswers, roundId, showToast]);

  useEffect(() => {
    stopRequestedRef.current = false;
    setAnswers({});
    setIsStopped(false);
  }, [roundId]);

  // Keyboard shortcut: ENTER to trigger STOP
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !isStopped && introPhase === 'playing') {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        if (activeTag === 'input') {
          e.preventDefault();
          handleTriggerStop();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTriggerStop, isStopped, introPhase]);

  function handleInputChange(categoryId: string, value: string) {
    const nextAnswers = { ...answers, [categoryId]: value.toUpperCase() };
    setAnswers(nextAnswers);
    onSubmitAnswers(roundId, nextAnswers);
  }

  const filledCount = Object.values(answers).filter((val) => val && val.trim().length > 0).length;
  const totalCategories = room.categories.length;
  const progressPercent = totalCategories > 0 ? Math.round((filledCount / totalCategories) * 100) : 0;

  const minutes =
    timeLeft === null ? null : Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const seconds = timeLeft === null ? null : (timeLeft % 60).toString().padStart(2, '0');

  // Sorted players for live classification
  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);

  const isPlaying = introPhase === 'playing';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6" data-game-screen>
      {/* Screen reader announcements — aria-atomic ensures full re-read on change */}
      <div
        data-testid="live-region"
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {srAnnounce}
      </div>

      {/* ── Intro Overlay: Spinning Letter + Countdown ────────────────────── */}
      {!isPlaying && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm"
        >
          <p className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-300">
            {introPhase === 'spinning' ? 'Sorteando a letra...' : 'Prepare-se!'}
          </p>

          {/* Letter display */}
          <div
            className={`flex h-36 w-36 items-center justify-center rounded-3xl font-black text-8xl shadow-2xl transition-all duration-300 ${introPhase === 'spinning'
                ? 'animate-pulse bg-indigo-700 text-indigo-100 shadow-indigo-800'
                : 'scale-110 bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-purple-800'
              }`}
          >
            {introPhase === 'spinning' ? spinningLetter : currentLetter}
          </div>

          {/* Countdown */}
          {introPhase === 'countdown' && (
            <div className="mt-8 flex flex-col items-center gap-2">
              <span
                key={countdownValue}
                className="animate-ping-once text-6xl font-black text-white drop-shadow-xl"
              >
                {countdownValue > 0 ? countdownValue : '▶'}
              </span>
              <p className="mt-2 text-xs font-semibold text-slate-400">
                O jogo começa em instantes...
              </p>
            </div>
          )}
        </div>
      )}

      {/* Barra Superior da Rodada */}
      <div className="flex flex-col items-center justify-between gap-4 rounded-3xl border border-indigo-100 bg-white p-4 shadow-sm md:flex-row md:p-6">
        {/* Info da Rodada */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 font-black text-xl text-indigo-600">
            {room.currentRound}/{room.totalRounds}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-black uppercase text-indigo-800">
                Rodada Ativa
              </span>
              <span className="text-xs text-slate-400">Sala Privada #{room.code}</span>
            </div>
            <h1 tabIndex={-1} className="text-xl font-black text-slate-900 outline-none md:text-2xl">
              Rodada {room.currentRound} de {room.totalRounds}
            </h1>
          </div>
        </div>

        {/* Cronômetro Decrescente */}
        <div
          data-testid="timer-display"
          className={`flex items-center gap-3 rounded-2xl border px-5 py-2.5 transition-colors ${timeLeft !== null && timeLeft <= 10 ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'
            }`}
          aria-label={timeLeft === null ? 'Sem limite de tempo' : accessibleDuration(timeLeft)}
        >
          <div className="relative flex h-10 w-10 items-center justify-center">
            <span aria-hidden="true" className={`material-symbols-outlined text-2xl ${timeLeft !== null && timeLeft <= 10 ? 'animate-bounce text-rose-600' : 'animate-spin text-rose-500'
              }`}>
              timelapse
            </span>
          </div>
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Tempo Restante
            </span>
            {/* Visual mm:ss is aria-hidden; accessible label is on the parent container */}
            <span
              aria-hidden="true"
              className={`text-2xl font-black tracking-tight ${timeLeft !== null && timeLeft <= 10 ? 'text-rose-600' : 'text-slate-900'
                }`}
            >
              {timeLeft === null ? 'Sem limite' : `${minutes}:${seconds}`}
            </span>
          </div>
        </div>
      </div>

      {/* Grid Principal: 2 Colunas */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Coluna Esquerda: Digitação das Categorias + BOTÃO STOP APÓS AS CATEGORIAS */}
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
              <span aria-hidden="true" className="material-symbols-outlined text-indigo-600">edit_note</span>
              Preencha com a Letra{' '}
              <span className="font-black text-xl text-indigo-600">{currentLetter}</span>
            </h2>
            <span aria-hidden="true" className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
              {filledCount} de {totalCategories} Preenchidas
            </span>
          </div>

          {/* Lista de Campos das Categorias */}
          <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
            {room.categories.map((cat: Category, index: number) => {
              const val = answers[cat.id] || '';
              const isFilled = val.trim().length > 0;
             // const startsWithLetter = val.trim().startsWith(currentLetter);

              return (
                <div
                  key={cat.id}
                  className={`flex items-center gap-3 rounded-2xl border p-3.5 shadow-sm transition ${isFilled
                    ? 'border-indigo-200 bg-indigo-50/20 ring-1 ring-indigo-100'
                    : 'border-indigo-100 bg-white hover:border-slate-300'
                    } focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100`}
                >
                  <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-xs font-bold text-indigo-700">
                    {index + 1}
                  </span>
                  <span aria-hidden="true" className="w-28 shrink-0 truncate text-sm font-bold text-slate-800">
                    {cat.name}
                  </span>
                  <input
                    type="text"
                    ref={index === 0 ? firstInputRef : undefined}
                    value={val}
                    onChange={(e) => handleInputChange(cat.id, e.target.value)}
                    placeholder={`${cat.name} com a letra ${currentLetter}...`}
                    disabled={isStopped || !isPlaying}
                    autoComplete="off"
                    aria-label={`${cat.name} com a letra ${currentLetter}`}
                    className="game-field flex-1 text-base font-bold uppercase text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              );
            })}
          </form>

          {/* BOTÃO GIGANTE DE STOP — Posicionado após a sessão de categorias */}
          <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-3xl border-2 border-rose-200 bg-gradient-to-r from-rose-50 via-orange-50 to-rose-50 p-5 sm:flex-row">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-black text-rose-600">
                <span aria-hidden="true" className="material-symbols-outlined text-lg">bolt</span>
                COMPLETOU TUDO OU QUER ARRISCAR?
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Ao bater no STOP, o cronômetro trava na hora para todos os outros jogadores!
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleTriggerStop()}
              disabled={isStopped || !isPlaying}
              className="animate-stop-btn flex min-h-[56px] items-center gap-3 rounded-2xl bg-rose-600 px-8 py-4 text-xl font-black uppercase tracking-wider text-white shadow-xl shadow-rose-300 transition hover:bg-rose-700 active:scale-95 disabled:opacity-50"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-3xl">pan_tool</span>
              Gritar STOP!
            </button>
          </div>
        </div>

        {/* Coluna Direita: Letra Sorteada no Topo + Placar ao Vivo Abaixo */}
        <div className="space-y-4">
          {/* 1) Card da Letra Sorteada no Lado Direito */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-purple-50 to-indigo-50 p-6 text-center shadow-sm">
            <span className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              Letra Sorteada da Vez
            </span>
            <div
              className="flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-600 font-black text-5xl text-white shadow-xl shadow-indigo-300"
              aria-label={`Letra sorteada: ${currentLetter}`}
            >
              {currentLetter}
            </div>
            <p className="mt-2 text-xs font-medium text-slate-500">
              Preencha todas as categorias iniciando com a letra <strong>{currentLetter}</strong>
            </p>
          </div>

          {/* 2) Placar / Classificação ao Vivo */}
          <div className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <span aria-hidden="true" className="material-symbols-outlined text-amber-500">leaderboard</span>
                Classificação ao Vivo
              </h3>
              <span className="text-xs text-slate-400">Rodada {room.currentRound}</span>
            </div>

            {/* Progresso dos Jogadores */}
            <div className="mt-4 space-y-3">
              {sortedPlayers.map((player, index) => {
                const isMe = player.id === myPlayerId;
                const playerProgress = isMe
                  ? progressPercent
                  : Math.min(100, Math.max(25, 80 - index * 18));
                const playerFilled = isMe
                  ? filledCount
                  : Math.min(totalCategories, Math.max(1, totalCategories - index));

                return (
                  <div
                    key={player.id}
                    className={`rounded-xl p-3 transition ${isMe
                      ? 'border border-indigo-200 bg-indigo-50/70'
                      : 'border border-slate-100 bg-slate-50'
                      }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{player.avatar ?? '🦊'}</span>
                        <span className={isMe ? 'text-indigo-900' : 'text-slate-800'}>
                          {player.nickname} {isMe && '(Você)'}
                        </span>
                      </div>
                      <span className={isMe ? 'text-indigo-600' : 'text-slate-600'}>
                        {player.score} pts
                      </span>
                    </div>

                    {/* Barra de progresso do preenchimento */}
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${isMe ? 'bg-indigo-600' : index === 0 ? 'bg-amber-500' : 'bg-slate-400'
                          }`}
                        style={{ width: `${playerProgress}%` }}
                      />
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-slate-500">
                      <span>
                        {playerFilled} de {totalCategories} preenchidos
                      </span>
                      <span className={isMe ? 'text-indigo-700' : 'text-slate-500'}>
                        {index + 1}º Lugar
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dicas de Teclado */}
            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1 font-bold">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                  TAB
                </span>{' '}
                Próximo
              </span>
              <span className="flex items-center gap-1 font-bold">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                  ENTER
                </span>{' '}
                STOP!
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

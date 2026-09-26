import { useState, useEffect, useRef } from 'react';
import type { RoomState, Category, Player } from '../types';
import { useToast } from '../components/Toast';
import { playStopSound } from '../utils/audio';

interface GameScreenProps {
  room: RoomState;
  myPlayerId: string;
  onSubmitAnswers: (roundId: string, answers: Record<string, string>) => void;
  onStop: (roundId: string) => void;
}

const LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'M',
  'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V',
];

export function GameScreen({ room, myPlayerId, onSubmitAnswers, onStop }: GameScreenProps) {
  const { showToast } = useToast();
  const roundId = `round-${room.currentRound}`;
  const me = room.players.find((p: Player) => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentLetter, setCurrentLetter] = useState<string>(room.currentLetter || 'M');
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [isStopped, setIsStopped] = useState<boolean>(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Countdown timer
  useEffect(() => {
    if (isStopped || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTriggerStop(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isStopped, timeLeft]);

  // Keyboard shortcut: ENTER to trigger STOP
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !isStopped) {
        // If not in a textarea
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        if (activeTag === 'input') {
          e.preventDefault();
          handleTriggerStop();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStopped, answers]);

  function handleInputChange(categoryId: string, value: string) {
    setAnswers((prev) => ({
      ...prev,
      [categoryId]: value.toUpperCase(),
    }));
  }

  function handleRerollLetter() {
    if (!isHost) return;
    const available = LETTERS.filter((l) => l !== currentLetter);
    const pick = available[Math.floor(Math.random() * available.length)] || 'S';
    setCurrentLetter(pick);
    showToast(`Nova letra sorteada: ${pick}!`);
  }

  function handleTriggerStop(timeExpired = false) {
    if (isStopped) return;
    setIsStopped(true);
    playStopSound();

    if (timeExpired) {
      showToast('Tempo esgotado! Congelando rodada...');
    } else {
      showToast('🛑 VOCÊ BATEU STOP! Congelando rodada...');
    }

    onSubmitAnswers(roundId, answers);
    setTimeout(() => {
      onStop(roundId);
    }, 900);
  }

  const filledCount = Object.values(answers).filter((val) => val && val.trim().length > 0).length;
  const totalCategories = room.categories.length;
  const progressPercent = totalCategories > 0 ? Math.round((filledCount / totalCategories) * 100) : 0;

  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const seconds = (timeLeft % 60).toString().padStart(2, '0');

  // Sorted players for live classification
  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
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
            <h1 className="text-xl font-black text-slate-900 md:text-2xl">
              Rodada {room.currentRound} de {room.totalRounds}
            </h1>
          </div>
        </div>

        {/* Cronômetro Decrescente */}
        <div className={`flex items-center gap-3 rounded-2xl border px-5 py-2.5 transition-colors ${
          timeLeft <= 10 ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="relative flex h-10 w-10 items-center justify-center">
            <span className={`material-symbols-outlined text-2xl ${
              timeLeft <= 10 ? 'animate-bounce text-rose-600' : 'animate-spin text-rose-500'
            }`}>
              timelapse
            </span>
          </div>
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Tempo Restante
            </span>
            <span className={`text-2xl font-black tracking-tight ${
              timeLeft <= 10 ? 'text-rose-600' : 'text-slate-900'
            }`}>
              {minutes}:{seconds}
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
              <span className="material-symbols-outlined text-indigo-600">edit_note</span>
              Preencha com a Letra{' '}
              <span className="font-black text-xl text-indigo-600">{currentLetter}</span>
            </h2>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
              {filledCount} de {totalCategories} Preenchidas
            </span>
          </div>

          {/* Lista de Campos das Categorias */}
          <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
            {room.categories.map((cat: Category, index: number) => {
              const val = answers[cat.id] || '';
              const isFilled = val.trim().length > 0;
              const startsWithLetter = val.trim().startsWith(currentLetter);

              return (
                <div
                  key={cat.id}
                  className={`flex items-center gap-3 rounded-2xl border p-3.5 shadow-sm transition ${
                    isFilled
                      ? 'border-indigo-200 bg-indigo-50/20 ring-1 ring-indigo-100'
                      : 'border-indigo-100 bg-white hover:border-slate-300'
                  } focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-xs font-bold text-indigo-700">
                    {index + 1}
                  </span>
                  <span className="w-28 shrink-0 truncate text-sm font-bold text-slate-800">
                    {cat.name}
                  </span>
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => handleInputChange(cat.id, e.target.value)}
                    placeholder={`Ex com ${currentLetter}...`}
                    disabled={isStopped}
                    autoComplete="off"
                    className="game-field flex-1 text-base font-bold uppercase text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-300"
                  />
                  {isFilled ? (
                    <span
                      className={`material-symbols-outlined text-lg ${
                        startsWithLetter ? 'text-emerald-500' : 'text-amber-500'
                      }`}
                      title={startsWithLetter ? 'Inicia com a letra sorteada' : 'Atenção: não inicia com a letra sorteada'}
                    >
                      check_circle
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-slate-300">TAB ⇥</span>
                  )}
                </div>
              );
            })}
          </form>

          {/* BOTÃO GIGANTE DE STOP — Posicionado após a sessão de categorias */}
          <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-3xl border-2 border-rose-200 bg-gradient-to-r from-rose-50 via-orange-50 to-rose-50 p-5 sm:flex-row">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-black text-rose-600">
                <span className="material-symbols-outlined text-lg">bolt</span>
                COMPLETOU TUDO OU QUER ARRISCAR?
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                Ao bater no STOP, o cronômetro trava na hora para todos os outros jogadores!
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleTriggerStop()}
              disabled={isStopped}
              className="animate-stop-btn flex items-center gap-3 rounded-2xl bg-rose-600 px-8 py-4 text-xl font-black uppercase tracking-wider text-white shadow-xl shadow-rose-300 transition hover:bg-rose-700 active:scale-95 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-3xl">pan_tool</span>
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
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-600 font-black text-5xl text-white shadow-xl shadow-indigo-300">
              {currentLetter}
            </div>
            <p className="mt-2 text-xs font-medium text-slate-500">
              Preencha todas as categorias iniciando com a letra <strong>{currentLetter}</strong>
            </p>
            {isHost && (
              <button
                type="button"
                onClick={handleRerollLetter}
                className="mt-3 flex items-center gap-1 text-xs font-bold text-indigo-600 underline hover:text-indigo-800"
              >
                <span className="material-symbols-outlined text-sm">casino</span>
                Sortear outra letra
              </button>
            )}
          </div>

          {/* 2) Placar / Classificação ao Vivo */}
          <div className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <span className="material-symbols-outlined text-amber-500">leaderboard</span>
                Classificação ao Vivo
              </h3>
              <span className="text-xs text-slate-400">Rodada {room.currentRound}</span>
            </div>

            {/* Progresso dos Jogadores */}
            <div className="mt-4 space-y-3">
              {sortedPlayers.map((player, index) => {
                const isMe = player.id === myPlayerId;
                // Compute progress: For current player, use real filledCount; for others, simulate active progress
                const playerProgress = isMe
                  ? progressPercent
                  : Math.min(100, Math.max(25, 80 - index * 18));
                const playerFilled = isMe
                  ? filledCount
                  : Math.min(totalCategories, Math.max(1, totalCategories - index));

                return (
                  <div
                    key={player.id}
                    className={`rounded-xl p-3 transition ${
                      isMe
                        ? 'border border-indigo-200 bg-indigo-50/70'
                        : 'border border-slate-100 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{isMe ? '🦊' : '🐙'}</span>
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
                        className={`h-full rounded-full transition-all duration-300 ${
                          isMe ? 'bg-indigo-600' : index === 0 ? 'bg-amber-500' : 'bg-slate-400'
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

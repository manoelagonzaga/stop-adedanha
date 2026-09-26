import { useState, useMemo } from 'react';
import type { RoomState, Answer, Player, Category } from '../types';
import { useToast } from '../components/Toast';

interface ResultsScreenProps {
  room: RoomState;
  myPlayerId: string;
  answers: Answer[];
  ranking: Player[];
  roundScore?: number;
  onNextRound: () => void;
  onFinishGame?: () => void;
  onInvalidate: (roundId: string, answerId: string) => void;
}

export function ResultsScreen({
  room,
  myPlayerId,
  answers,
  ranking,
  onNextRound,
  onFinishGame,
  onInvalidate,
}: ResultsScreenProps) {
  const { showToast } = useToast();
  const roundId = `round-${room.currentRound}`;
  const me = room.players.find((p: Player) => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;
  const isLastRound = room.currentRound >= room.totalRounds;

  // Sequential category index
  const [activeCategoryIndex, setActiveCategoryIndex] = useState<number>(0);

  // Local invalidation state: map from answerKey to array of voter playerIds
  const [invalidationsMap, setInvalidationsMap] = useState<Record<string, string[]>>({});

  const currentCategory: Category | undefined = room.categories[activeCategoryIndex];
  const totalCategories = room.categories.length;

  // Answers for current active category
  const currentAnswers = useMemo(() => {
    if (!currentCategory) return [];
    return answers.filter((a) => a.categoryId === currentCategory.id);
  }, [answers, currentCategory]);

  // Compute word uniqueness for current category
  const wordFrequency = useMemo(() => {
    const freq: Record<string, number> = {};
    currentAnswers.forEach((a) => {
      const clean = a.value.trim().toLowerCase();
      if (clean) {
        freq[clean] = (freq[clean] || 0) + 1;
      }
    });
    return freq;
  }, [currentAnswers]);

  // Calculate live cumulative score per player up to active category
  const cumulativeScores = useMemo(() => {
    const scores: Record<string, number> = {};
    room.players.forEach((p) => {
      scores[p.id] = p.score; // Base initial score before round
    });

    // Tally validated categories up to current activeCategoryIndex
    for (let cIdx = 0; cIdx <= activeCategoryIndex; cIdx++) {
      const cat = room.categories[cIdx];
      if (!cat) continue;
      const catAns = answers.filter((a) => a.categoryId === cat.id);

      // Frequencies for this category
      const fMap: Record<string, number> = {};
      catAns.forEach((a) => {
        const clean = a.value.trim().toLowerCase();
        if (clean) fMap[clean] = (fMap[clean] || 0) + 1;
      });

      catAns.forEach((a) => {
        const key = `${a.playerId}-${cat.id}`;
        const invalidators = invalidationsMap[key] ?? a.invalidations ?? [];
        const isInvalid = invalidators.length > 0;
        const clean = a.value.trim().toLowerCase();

        if (clean && !isInvalid) {
          const isUnique = fMap[clean] === 1;
          const pts = isUnique ? 10 : 5;
          scores[a.playerId] = (scores[a.playerId] || 0) + pts;
        }
      });
    }

    // Add speed bonus to host/stopper (demo: me gets 10 speed pts)
    if (me) {
      scores[me.id] = (scores[me.id] || 0) + 10;
    }

    return scores;
  }, [room.players, room.categories, activeCategoryIndex, answers, invalidationsMap, me]);

  // Sorted players according to cumulative score
  const partialRanking = useMemo(() => {
    return [...room.players].map((p) => ({
      ...p,
      score: cumulativeScores[p.id] ?? p.score,
    })).sort((a, b) => b.score - a.score);
  }, [room.players, cumulativeScores]);

  function handleToggleContest(answer: Answer) {
    const key = `${answer.playerId}-${answer.categoryId}`;
    const currentList = invalidationsMap[key] ?? answer.invalidations ?? [];
    const hasVoted = currentList.includes(myPlayerId);

    let nextList: string[];
    if (hasVoted) {
      nextList = currentList.filter((id) => id !== myPlayerId);
      showToast('Contestação desfeita.');
    } else {
      nextList = [...currentList, myPlayerId];
      showToast('Voto para invalidar registrado com sucesso.');
    }

    setInvalidationsMap((prev) => ({
      ...prev,
      [key]: nextList,
    }));

    onInvalidate(roundId, key);
  }

  function handleNextCategory() {
    if (activeCategoryIndex < totalCategories - 1) {
      const nextIdx = activeCategoryIndex + 1;
      setActiveCategoryIndex(nextIdx);
      const nextName = room.categories[nextIdx]?.name;
      showToast(`Avançando para validação de: ${nextName}`);
    }
  }

  function handlePrevCategory() {
    if (activeCategoryIndex > 0) {
      const prevIdx = activeCategoryIndex - 1;
      setActiveCategoryIndex(prevIdx);
      const prevName = room.categories[prevIdx]?.name;
      showToast(`Retornando para: ${prevName}`);
    }
  }

  function handleFinishReview() {
    if (isLastRound) {
      if (onFinishGame) {
        onFinishGame();
      } else {
        onNextRound();
      }
    } else {
      onNextRound();
    }
  }

  const isLastCategory = activeCategoryIndex === totalCategories - 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      {/* Cabeçalho da Votação */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-3xl border border-indigo-100 bg-white p-5 shadow-sm md:flex-row md:items-center md:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 font-black text-2xl text-white shadow-md shadow-indigo-200">
            {room.currentLetter || 'M'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-800">
                <span className="material-symbols-outlined text-xs">how_to_vote</span>
                FASE DE VALIDAÇÃO
              </span>
              <span className="text-xs text-slate-400">• Letra {room.currentLetter || 'M'}</span>
            </div>
            <h1 className="mt-0.5 text-xl font-black text-slate-900 md:text-2xl">
              Apuração da Rodada {room.currentRound} de {room.totalRounds}
            </h1>
          </div>
        </div>

        {/* Notificação de quem bateu o STOP primeiro */}
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5">
          <span className="material-symbols-outlined text-xl text-rose-600">notifications_active</span>
          <div className="text-xs">
            <span className="font-bold text-rose-800">
              {me?.nickname || 'Você'} gritou STOP primeiro!
            </span>
            <span className="block text-[11px] font-semibold text-rose-600">
              +10 pts bônus de velocidade
            </span>
          </div>
        </div>
      </div>

      {/* Abas de Navegação entre Categorias (Sequencial) */}
      <div className="flex items-center gap-2 overflow-x-auto py-4">
        {room.categories.map((cat, idx) => {
          const isActive = idx === activeCategoryIndex;
          const isCompleted = idx < activeCategoryIndex;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategoryIndex(idx)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition md:text-sm ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : isCompleted
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{idx + 1}. {cat.name}</span>
              {isActive && <span className="h-2 w-2 rounded-full bg-amber-400" />}
              {isCompleted && (
                <span className="material-symbols-outlined text-xs text-emerald-600">check</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Layout Principal: Cartões de Validação da Categoria Ativa + Placar Parcial ao Vivo */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Coluna Esquerda: Cartões de Palavras da Categoria Ativa (2 Colunas) */}
        <div className="space-y-4 lg:col-span-2">
          {/* Banner de instrução */}
          <div className="flex items-center justify-between rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3.5 text-xs text-indigo-900">
            <span className="flex items-center gap-1.5 font-bold">
              <span className="material-symbols-outlined text-base text-indigo-600">info</span>
              Regra de Validação ({activeCategoryIndex + 1}/{totalCategories}):
            </span>
            <span>
              Toda palavra começa válida (+10 única, +5 repetida). Clique em "Invalidar" apenas se estiver incorreta.
            </span>
          </div>

          {/* Grid de Cartões de Respostas */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {currentAnswers.map((answer, index) => {
              const key = `${answer.playerId}-${answer.categoryId}`;
              const player = room.players.find((p) => p.id === answer.playerId);
              const isMe = answer.playerId === myPlayerId;
              const cleanVal = answer.value.trim();
              const hasAnswer = cleanVal.length > 0;

              const currentInvalidators = invalidationsMap[key] ?? answer.invalidations ?? [];
              const hasVotedInvalid = currentInvalidators.includes(myPlayerId);
              const isInvalidated = currentInvalidators.length > 0;

              const isUnique = hasAnswer && wordFrequency[cleanVal.toLowerCase()] === 1;
              const isDuplicated = hasAnswer && wordFrequency[cleanVal.toLowerCase()] > 1;

              return (
                <div
                  key={key}
                  className={`flex flex-col justify-between rounded-2xl p-5 shadow-sm transition ${
                    !hasAnswer
                      ? 'border border-dashed border-slate-300 bg-slate-50 opacity-75'
                      : isInvalidated
                      ? 'border-2 border-rose-300 bg-rose-50/50'
                      : isUnique
                      ? 'border border-emerald-200 bg-white'
                      : 'border border-amber-200 bg-white'
                  }`}
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400">
                        #{String(index + 1).padStart(2, '0')}{' '}
                        <strong className="text-slate-700">
                          {player?.nickname || 'Participante'} {isMe && '(Você)'}
                        </strong>
                      </span>
                      <div className="flex items-center gap-1.5">
                        {!hasAnswer ? (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                            0 pts (Sem Resposta)
                          </span>
                        ) : isInvalidated ? (
                          <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                            <span className="material-symbols-outlined text-xs">gavel</span> Contestada
                          </span>
                        ) : isUnique ? (
                          <>
                            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                              Válida por Padrão
                            </span>
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                              Exclusiva (+10)
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                              Palavra Repetida
                            </span>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                              Duplicada (+5)
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Palavra */}
                    <div className="my-4">
                      <span className="block text-xs font-semibold uppercase text-slate-400">
                        Palavra Enviada:
                      </span>
                      {hasAnswer ? (
                        <span
                          className={`text-2xl font-black tracking-tight ${
                            isInvalidated
                              ? 'text-rose-700 line-through'
                              : 'text-slate-900'
                          }`}
                        >
                          {answer.value}
                        </span>
                      ) : (
                        <span className="text-xl font-bold italic text-slate-400">
                          — Em branco —
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ação de Contestação / Invalidar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-xs font-medium text-slate-400">
                      {!hasAnswer
                        ? 'Tempo esgotado'
                        : `${currentInvalidators.length} ${
                            currentInvalidators.length === 1 ? 'contestação' : 'contestações'
                          }`}
                    </span>

                    {hasAnswer && (
                      <button
                        type="button"
                        onClick={() => handleToggleContest(answer)}
                        className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                          hasVotedInvalid
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">
                          {hasVotedInvalid ? 'thumb_down' : 'flag'}
                        </span>
                        {hasVotedInvalid ? 'Votado p/ Invalidar' : 'Invalidar / Contestar'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Botões de Avanço Sequencial de Categoria */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handlePrevCategory}
              disabled={activeCategoryIndex === 0}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
              Categoria Anterior
            </button>

            <div className="flex items-center gap-3">
              {!isLastCategory ? (
                <button
                  type="button"
                  onClick={handleNextCategory}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 active:scale-95"
                >
                  Próxima Categoria ({activeCategoryIndex + 2}/{totalCategories})
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleFinishReview}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-200 transition hover:bg-emerald-700 active:scale-95"
                >
                  <span className="material-symbols-outlined text-lg">emoji_events</span>
                  {isLastRound ? 'Encerrar e Ver Pódio' : 'Próxima Rodada'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Coluna Lateral: Classificação Parcial da Partida (Atualizada a cada categoria) */}
        <div className="h-fit rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
              <span className="material-symbols-outlined fill text-amber-500">trophy</span>
              Classificação Parcial
            </h3>
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
              Cat {activeCategoryIndex + 1} de {totalCategories}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {partialRanking.map((player, index) => {
              const isMe = player.id === myPlayerId;
              const placeBadge =
                index === 0
                  ? 'bg-amber-400 text-amber-950'
                  : index === 1
                  ? 'bg-slate-200 text-slate-700'
                  : index === 2
                  ? 'bg-amber-700 text-white'
                  : 'bg-slate-100 text-slate-500';

              return (
                <div
                  key={player.id}
                  className={`flex items-center justify-between rounded-xl p-3 transition ${
                    isMe
                      ? 'border border-amber-200 bg-amber-50/70'
                      : 'border border-slate-100 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${placeBadge}`}
                    >
                      {index + 1}º
                    </span>
                    <span className="text-xl">{isMe ? '🦊' : '🐙'}</span>
                    <div>
                      <span className="block text-xs font-bold text-slate-900">
                        {player.nickname} {isMe && '(Você)'}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-600">
                        +{player.score - (room.players.find(p => p.id === player.id)?.score || 0)} pts na rodada
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-black text-slate-900">
                    {player.score} pts
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

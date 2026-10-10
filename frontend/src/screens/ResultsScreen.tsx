import { useMemo } from 'react';
import type { RoomState, Answer, Player, VoteDecision } from '../types';

interface ResultsScreenProps {
  room: RoomState;
  myPlayerId: string;
  answers: Answer[];
  onVote: (roundId: string, categoryId: string, answerPlayerId: string, decision: VoteDecision) => void;
  onNextRound: () => void;
}

export function ResultsScreen({ room, myPlayerId, answers, onVote, onNextRound }: ResultsScreenProps) {
  const categoryIndex = room.currentReviewCategoryIndex ?? 0;
  const category = room.categories[categoryIndex];
  const roundId = room.currentRoundId;
  const me = room.players.find((player) => player.id === myPlayerId);
  const isActiveHost = me?.isHost === true && me.status === 'active';
  const hasActiveHost = room.players.some((player) => player.isHost && player.status === 'active');

  const categoryAnswers = useMemo(
    () => (category ? answers.filter((answer) => answer.categoryId === category.id) : []),
    [answers, category],
  );

  const ranking = useMemo(
    () => [...room.players].sort((a, b) => b.score - a.score),
    [room.players],
  );

  if (!category || !roundId) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-slate-600">
        Aguardando os dados da revisão do servidor...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      <header className="mb-6 flex flex-col justify-between gap-3 rounded-3xl border border-indigo-100 bg-white p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
            FASE DE VALIDAÇÃO · CATEGORIA {categoryIndex + 1}/{room.categories.length}
          </span>
          <h1 className="mt-2 text-2xl font-black text-slate-900">
            {category.name} — Rodada {room.currentRound} de {room.totalRounds}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Letra {room.currentLetter ?? '—'}. Os votos e resultados são confirmados pelo servidor.
          </p>
        </div>
        {room.reviewDeadline && (
          <p className="text-sm font-semibold text-slate-500">
            Revisão desta categoria termina em {new Date(room.reviewDeadline).toLocaleTimeString()}
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2" aria-label="Respostas para revisão">
          {categoryAnswers.map((answer, index) => {
            const player = room.players.find((entry) => entry.id === answer.playerId);
            const isAuthor = answer.playerId === myPlayerId;
            const value = answer.value.trim();
            const votes = answer.votes ?? {};
            const ownVote = votes[myPlayerId];
            const invalidVotes = Object.values(votes).filter((decision) => decision === 'invalidate').length;
            const validVotes = Object.values(votes).filter((decision) => decision === 'valid').length;
            const eligibleVoters = answer.eligibleVoters?.length ?? 0;
            const canVote = Boolean(
              room.phase === 'CATEGORY_REVIEW' &&
              me?.status === 'active' &&
              value &&
              answer.isValid &&
              !isAuthor &&
              (!room.reviewDeadline || Date.now() < room.reviewDeadline),
            );

            return (
              <article
                key={`${answer.playerId}:${answer.categoryId}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-500">
                      #{String(index + 1).padStart(2, '0')} · {player?.nickname ?? 'Participante'}
                      {isAuthor ? ' (Você)' : ''}
                    </p>
                    <p className="mt-2 text-2xl font-black text-slate-900">
                      {value || <span className="text-slate-400">— Sem resposta —</span>}
                    </p>
                  </div>
                  <div className="text-right text-xs font-semibold text-slate-500">
                    <p>{validVotes} voto(s) válido</p>
                    <p>{invalidVotes} voto(s) para invalidar</p>
                    <p>{eligibleVoters} votante(s) elegível(is)</p>
                  </div>
                </div>

                {canVote && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                    <span className="mr-2 text-xs font-semibold text-slate-500">Seu voto:</span>
                    {(['valid', 'invalidate'] as const).map((decision) => (
                      <button
                        key={decision}
                        type="button"
                        aria-pressed={ownVote === decision}
                        onClick={() => onVote(roundId, category.id, answer.playerId, decision)}
                        className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                          ownVote === decision
                            ? 'bg-indigo-600 text-white'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {decision === 'valid' ? 'Válida' : 'Invalidar'}
                      </button>
                    ))}
                    {ownVote && <span className="text-xs text-emerald-700">Voto confirmado pelo servidor</span>}
                  </div>
                )}
                {isAuthor && (
                  <p className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
                    Você não pode votar na própria resposta.
                  </p>
                )}
                {!value && (
                  <p className="mt-3 text-xs font-semibold text-slate-500">Resposta em branco não recebe votos.</p>
                )}
              </article>
            );
          })}
        </section>

        <aside className="h-fit rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
          <h2 className="border-b border-slate-100 pb-3 text-base font-bold text-slate-800">
            Placar confirmado
          </h2>
          <ol className="mt-4 space-y-3">
            {ranking.map((player: Player, index) => (
              <li
                key={player.id}
                className={`flex items-center justify-between rounded-xl p-3 ${
                  player.id === myPlayerId ? 'border border-amber-200 bg-amber-50' : 'bg-slate-50'
                }`}
              >
                <span className="text-sm font-bold text-slate-800">
                  {index + 1}. {player.nickname}{player.id === myPlayerId ? ' (Você)' : ''}
                </span>
                <span className="text-sm font-black text-slate-900">{player.score} pts</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-slate-500">
            {room.phase === 'ROUND_RESULTS'
              ? 'Pontuação da rodada confirmada pelo servidor.'
              : 'A pontuação desta rodada será atualizada após a revisão.'}
          </p>
          {room.phase === 'ROUND_RESULTS' && room.currentRound < room.totalRounds && isActiveHost && (
            <button
              type="button"
              onClick={onNextRound}
              className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700"
            >
              Próxima Rodada
            </button>
          )}
          {room.phase === 'ROUND_RESULTS' && room.currentRound < room.totalRounds && isActiveHost === false && hasActiveHost && (
            <p className="mt-4 text-xs font-semibold text-indigo-700">
              Aguardando o anfitrião iniciar a próxima rodada.
            </p>
          )}
          {room.phase === 'ROUND_RESULTS' && room.currentRound < room.totalRounds && !hasActiveHost && (
            <p role="status" className="mt-4 text-xs font-semibold text-amber-700">
              Próxima rodada suspensa: não há anfitrião ativo na sala.
            </p>
          )}
          {room.phase === 'CATEGORY_REVIEW' && isActiveHost && (
            <p className="mt-2 text-xs font-semibold text-indigo-700">
              A revisão avança automaticamente ao fim do tempo.
            </p>
          )}
          {room.phase === 'CATEGORY_REVIEW' && !hasActiveHost && (
            <p role="status" className="mt-2 text-xs font-semibold text-amber-700">
              Não há anfitrião ativo. Os votos continuam disponíveis aos jogadores ativos.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

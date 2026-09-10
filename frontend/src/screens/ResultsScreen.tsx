import type { RoomState, Answer, Player, Category } from '../types';
import { Scoreboard } from '../components/Scoreboard';

interface ResultsScreenProps {
  room: RoomState;
  myPlayerId: string;
  answers: Answer[];
  ranking: Player[];
  roundScore: number;
  onNextRound: () => void;
  onInvalidate: (roundId: string, answerId: string) => void;
  votingDeadline?: number;
}

/**
 * Tela 4 — Votação e Resultados.
 * DOM order: round result heading → score summary → next-round button (host) → answers list → scoreboard.
 */
export function ResultsScreen({
  room,
  myPlayerId,
  answers,
  ranking,
  roundScore,
  onNextRound,
  onInvalidate,
}: ResultsScreenProps) {
  const me = room.players.find((p: Player) => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;
  const isLastRound = room.currentRound >= room.totalRounds;

  const roundId = `round-${room.currentRound}`;

  // Group answers by category
  const byCategory = room.categories.map((cat: Category) => ({
    category: cat,
    answers: answers.filter((a: Answer) => a.categoryId === cat.id),
  }));

  return (
    <div className="flex min-h-svh flex-col lg:grid lg:grid-cols-[1fr_25%] gap-4 px-4 py-8 lg:px-8">

      {/* ── Main area ── */}
      <main className="flex flex-col gap-5">

        {/* Result banner */}
        <div className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5">
          <h2 className="text-xl font-extrabold text-navy">Rodada finalizada!</h2>
          <p className="mt-1 text-sm text-gray-500">
            Você marcou{' '}
            <strong className={roundScore > 0 ? 'text-orange' : 'text-gray-700'}>{roundScore}</strong>{' '}
            {roundScore === 1 ? 'ponto' : 'pontos'} nesta rodada.
          </p>

          {isHost && (
            <button
              type="button"
              onClick={onNextRound}
              className="mt-4 w-full rounded-xl bg-navy py-3.5 text-sm font-bold text-white tracking-wide
                         hover:bg-navy/90 active:scale-[0.98] transition-all
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2"
            >
              {isLastRound ? 'Ver resultado final' : 'Próxima rodada'}
            </button>
          )}
          {!isHost && (
            <p role="status" aria-live="polite" className="mt-3 text-center text-sm text-gray-400">
              Aguardando o anfitrião avançar…
            </p>
          )}
        </div>

        {/* Answers by category — with invalidation voting */}
        {byCategory.map(({ category, answers: catAnswers }) => (
          <section
            key={category.id}
            className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5"
            aria-labelledby={`cat-${category.id}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white"
              >
                {category.name[0].toUpperCase()}
              </span>
              <h3 id={`cat-${category.id}`} className="text-sm font-bold text-gray-700">{category.name}</h3>
            </div>

            <ul className="flex flex-col gap-2" aria-label={`Respostas para ${category.name}`}>
              {catAnswers.map((answer: Answer) => {
                const author = room.players.find((p: Player) => p.id === answer.playerId);
                const isMyAnswer = answer.playerId === myPlayerId;
                const alreadyInvalidated = answer.invalidations.includes(myPlayerId);

                return (
                  <li
                    key={`${answer.playerId}-${category.id}`}
                    className={[
                      'flex items-center justify-between rounded-xl border px-4 py-3 gap-3',
                      !answer.isValid ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50',
                    ].join(' ')}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs text-gray-400 font-medium truncate">
                        {author?.nickname ?? 'Desconhecido'}
                      </span>
                      <span
                        className={[
                          'text-sm font-semibold',
                          !answer.isValid ? 'text-red-500 line-through' : 'text-gray-800',
                        ].join(' ')}
                        aria-label={`${answer.value}${!answer.isValid ? ', inválida' : ''}`}
                      >
                        {answer.value || <em className="text-gray-300">sem resposta</em>}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-bold text-gray-500">{answer.score} pts</span>
                      {/* Invalidation vote — not shown for own answer or already invalid */}
                      {!isMyAnswer && answer.isValid && (
                        <button
                          type="button"
                          onClick={() => onInvalidate(roundId, `${answer.playerId}-${category.id}`)}
                          disabled={alreadyInvalidated}
                          aria-label={`Invalidar resposta "${answer.value}" de ${author?.nickname}`}
                          aria-pressed={alreadyInvalidated}
                          className={[
                            'rounded-lg px-2.5 py-1 text-xs font-semibold border transition',
                            alreadyInvalidated
                              ? 'border-red-300 bg-red-100 text-red-600 cursor-not-allowed'
                              : 'border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500 hover:bg-red-50',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
                          ].join(' ')}
                        >
                          {alreadyInvalidated ? '✗ Inválida' : 'Invalidar'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>

      {/* ── Scoreboard — last in DOM ── */}
      <div>
        <div className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-5 py-5">
          <Scoreboard
            players={ranking.length > 0 ? ranking : room.players}
            currentRound={room.currentRound}
            totalRounds={room.totalRounds}
          />
        </div>
      </div>
    </div>
  );
}

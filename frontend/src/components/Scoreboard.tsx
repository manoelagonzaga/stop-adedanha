import type { Player } from '../types';

interface ScoreboardProps {
  players: Player[];
  currentRound: number;
  totalRounds: number;
}

function getInitials(nickname: string): string {
  return nickname
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function abbreviateName(nickname: string): string {
  const parts = nickname.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/**
 * Vertical scoreboard sidebar.
 * On desktop it occupies ~25% of the width via the parent grid layout.
 * On mobile it renders below the game content (controlled by parent layout).
 * Placed last in DOM so screen readers reach it after game actions.
 */
export function Scoreboard({ players, currentRound, totalRounds }: ScoreboardProps) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <aside
      aria-label="Placar da partida"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold tracking-widest text-navy uppercase">Placar</h2>
        {totalRounds > 0 && (
          <span className="text-xs text-gray-400 font-medium tracking-wide">
            Round {currentRound}/{totalRounds}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-2" aria-label="Classificação dos jogadores">
        {sorted.map((player, index) => {
          const isLeader = index === 0 && player.score > 0;
          return (
            <li
              key={player.id}
              className={[
                'flex items-center gap-3 rounded-xl px-4 py-3 transition-all',
                isLeader
                  ? 'bg-orange/10 border border-orange/30'
                  : 'bg-white/70 border border-white/60',
                player.status === 'disconnected' ? 'opacity-50' : '',
              ].join(' ')}
            >
              {/* Position badge */}
              <span
                aria-hidden="true"
                className={[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                  isLeader
                    ? 'bg-orange text-white'
                    : 'bg-navy text-white',
                ].join(' ')}
              >
                {getInitials(player.nickname)}
              </span>

              <div className="flex flex-1 flex-col min-w-0">
                <span className="truncate text-sm font-semibold text-gray-800">
                  {abbreviateName(player.nickname)}
                  {player.isHost && (
                    <span className="ml-1 text-xs font-normal text-gray-400">(anfitrião)</span>
                  )}
                </span>
                {player.status === 'disconnected' && (
                  <span className="text-xs text-gray-400">desconectado</span>
                )}
              </div>

              <span
                aria-label={`${player.score} pontos`}
                className={[
                  'text-xl font-extrabold tabular-nums',
                  isLeader ? 'text-orange' : 'text-navy',
                ].join(' ')}
              >
                {player.score}
              </span>
            </li>
          );
        })}

        {sorted.length === 0 && (
          <li className="text-sm text-gray-400 text-center py-4">
            Nenhum jogador ainda.
          </li>
        )}
      </ul>
    </aside>
  );
}


import { useEffect, useState } from 'react';
import type { FinalResults, PodiumItem, RankingListItem } from '../types';

interface PodiumScreenProps {
  results: FinalResults;
  myPlayerId: string;
  onPlayAgain: () => void;
  onBackToHome: () => void;
}

const TIER_CONFIG: Record<
  PodiumItem['tier'],
  { bg: string; ring: string; crown: boolean; label: string; height: string; order: number }
> = {
  gold: {
    bg: 'from-amber-400 to-yellow-500',
    ring: 'ring-amber-400',
    crown: true,
    label: '1º Lugar',
    height: 'h-40',
    order: 2,
  },
  silver: {
    bg: 'from-slate-300 to-slate-400',
    ring: 'ring-slate-400',
    crown: false,
    label: '2º Lugar',
    height: 'h-28',
    order: 1,
  },
  bronze: {
    bg: 'from-amber-600 to-amber-700',
    ring: 'ring-amber-600',
    crown: false,
    label: '3º Lugar',
    height: 'h-20',
    order: 3,
  },
};

const AVATARS = ['🦊', '🐙', '🐵', '🦁', '🐸', '🦄', '🐧', '🦋'];

function getAvatar(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATARS[Math.abs(hash) % AVATARS.length];
}

function PodiumColumn({ item }: { item: PodiumItem }) {
  const cfg = TIER_CONFIG[item.tier];
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const delay = { gold: 400, silver: 200, bronze: 600 }[item.tier];
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [item.tier]);

  return (
    <div
      className={`flex flex-col items-center transition-all duration-700 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
      }`}
      style={{ order: cfg.order }}
    >
      {/* Crown for 1st */}
      {cfg.crown && (
        <div className="mb-1 animate-bounce text-3xl" aria-hidden="true">
          👑
        </div>
      )}

      {/* Avatar */}
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br ${cfg.bg} ring-4 ${cfg.ring} text-3xl shadow-xl`}
      >
        {getAvatar(item.playerId)}
      </div>

      {/* Name + Score */}
      <div className="mt-2 text-center">
        <span className="block max-w-[120px] truncate text-sm font-black text-white drop-shadow">
          {item.nickname}
        </span>
        <span className="mt-0.5 block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-black text-white">
          {item.score} pts
        </span>
      </div>

      {/* Podium Block */}
      <div
        className={`mt-3 flex w-28 items-center justify-center rounded-t-2xl bg-gradient-to-b ${cfg.bg} ${cfg.height} shadow-lg`}
      >
        <span className="text-2xl font-black text-white/90">{item.position}º</span>
      </div>
    </div>
  );
}

export function PodiumScreen({ results, myPlayerId, onPlayAgain, onBackToHome }: PodiumScreenProps) {
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowList(true), 900);
    return () => clearTimeout(t);
  }, []);

  // Sort podium: silver (2nd) first visually, then gold (1st), then bronze (3rd)
  const sortedPodium = [...results.podium].sort(
    (a, b) => TIER_CONFIG[a.tier].order - TIER_CONFIG[b.tier].order
  );

  const winner = results.podium.find((p) => p.tier === 'gold');

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center px-4 py-8">
      {/* Header */}
      <div className="text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white/80 backdrop-blur-sm">
          <span className="material-symbols-outlined text-sm text-amber-400">emoji_events</span>
          Fim de Jogo
        </div>
        <h1 className="mt-1 text-4xl font-black text-white drop-shadow-lg md:text-5xl">
          🏆 Pódio Final
        </h1>
        {winner && (
          <p className="mt-2 text-base font-semibold text-white/80">
            <span className="font-black text-amber-400">{winner.nickname}</span> venceu a partida!
          </p>
        )}
      </div>

      {/* Podium Stage */}
      <div className="mt-12 flex w-full max-w-xl items-end justify-center gap-4">
        {sortedPodium.map((item) => (
          <PodiumColumn key={item.playerId} item={item} />
        ))}
      </div>

      {/* Podium base */}
      <div className="h-4 w-full max-w-xl rounded-b-2xl bg-white/10 shadow-inner backdrop-blur-sm" />

      {/* Remaining Players List */}
      {results.list.length > 0 && (
        <div
          className={`mt-10 w-full max-w-lg transition-all duration-700 ${
            showList ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <h2 className="mb-3 text-center text-xs font-black uppercase tracking-widest text-white/60">
            Demais Participantes
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/10 backdrop-blur-sm">
            {results.list.map((item: RankingListItem, idx: number) => {
              const isMe = item.playerId === myPlayerId;
              return (
                <div
                  key={item.playerId}
                  className={`flex items-center justify-between px-5 py-3 ${
                    idx < results.list.length - 1 ? 'border-b border-white/10' : ''
                  } ${isMe ? 'bg-indigo-500/20' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs font-black text-white">
                      {item.position}º
                    </span>
                    <span className="text-xl">{getAvatar(item.playerId)}</span>
                    <span className="text-sm font-bold text-white">
                      {item.nickname} {isMe && <span className="text-indigo-300">(Você)</span>}
                    </span>
                  </div>
                  <span className="text-sm font-black text-white/80">{item.score} pts</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div
        className={`mt-10 flex flex-col items-center gap-3 sm:flex-row transition-all duration-700 delay-300 ${
          showList ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        <button
          type="button"
          onClick={onPlayAgain}
          className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-8 py-4 text-base font-black text-white shadow-xl shadow-indigo-900/50 transition hover:bg-indigo-500 active:scale-95"
        >
          <span className="material-symbols-outlined">replay</span>
          Jogar Novamente
        </button>
        <button
          type="button"
          onClick={onBackToHome}
          className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-8 py-4 text-base font-bold text-white backdrop-blur-sm transition hover:bg-white/20 active:scale-95"
        >
          <span className="material-symbols-outlined">home</span>
          Voltar ao Início
        </button>
      </div>
    </div>
  );
}

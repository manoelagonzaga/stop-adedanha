import { useState } from 'react';
import type { RoomState, Category, Player } from '../types';
import { Scoreboard } from '../components/Scoreboard';

const SUGGESTED_CATEGORIES = [
  'Animais', 'Lugares', 'Super-heróis', 'Comidas', 'Famosos',
  'Marcas', 'Filmes', 'Músicas', 'Esportes', 'Profissões',
];

interface LobbyScreenProps {
  room: RoomState;
  myPlayerId: string;
  onUpdateCategories: (categories: string[]) => void;
  onUpdateRounds: (totalRounds: number) => void;
  onStartGame: () => void;
  statusMessage?: string | null;
}

/**
 * Tela 2 — Sala de Espera e Configuração.
 * DOM order: heading → rounds → categories → players list → start button → scoreboard.
 * Host controls are editable; guest controls are read-only.
 */
export function LobbyScreen({
  room,
  myPlayerId,
  onUpdateCategories,
  onUpdateRounds,
  onStartGame,
  statusMessage,
}: LobbyScreenProps) {
  const me = room.players.find((p: Player) => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;

  const [newCategory, setNewCategory] = useState('');

  const categoryNames = room.categories.map((c: Category) => c.name);

  function handleAddCategory() {
    const trimmed = newCategory.trim();
    if (!trimmed || categoryNames.includes(trimmed)) return;
    onUpdateCategories([...categoryNames, trimmed]);
    setNewCategory('');
  }

  function handleRemoveCategory(cat: Category) {
    onUpdateCategories(categoryNames.filter((n: string) => n !== cat.name));
  }

  function handleSuggest(name: string) {
    if (categoryNames.includes(name)) return;
    onUpdateCategories([...categoryNames, name]);
  }

  function handleRoundsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.max(1, Math.min(10, Number(e.target.value)));
    onUpdateRounds(val);
  }

  const canStart = isHost && room.categories.length > 0 && room.players.length >= 1;

  return (
    <div className="flex min-h-svh flex-col lg:grid lg:grid-cols-[1fr_25%] gap-4 px-4 py-8 lg:px-8">
      {/* ── Main area ── */}
      <main className="flex flex-col gap-5">

        {/* Categories */}
        <section className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5" aria-labelledby="categories-heading">
          <div className="flex items-center justify-between mb-3">
            <h3 id="categories-heading" className="text-xs font-bold tracking-[0.2em] text-gray-400 uppercase">
              Categorias
            </h3>
            <span className="text-xs text-gray-400">{room.categories.length} selecionada(s)</span>
          </div>

          {/* Active category list */}
          <ul className="mb-4 flex flex-col gap-2" aria-label="Categorias da partida">
            {room.categories.length === 0 && (
              <li className="text-sm text-gray-400 py-2">Nenhuma categoria adicionada ainda.</li>
            )}
            {room.categories.map((cat: Category) => (
              <li
                key={cat.id}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-navy text-xs font-bold text-white shrink-0"
                  >
                    {cat.name[0].toUpperCase()}
                  </span>
                  <span className="text-sm font-medium text-gray-700">{cat.name}</span>
                </div>
                {isHost && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCategory(cat)}
                    aria-label={`Remover categoria ${cat.name}`}
                    className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  >
                    Remover
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Add custom category (host only) */}
          {isHost && (
            <div className="mb-4 flex gap-2">
              <label htmlFor="new-category" className="sr-only">Nova categoria</label>
              <input
                id="new-category"
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCategory())}
                placeholder="Adicionar categoria…"
                maxLength={32}
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400
                           outline-none transition focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-navy/20"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy/90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
              >
                Adicionar
              </button>
            </div>
          )}

          {/* Suggestions (host only) */}
          {isHost && (
            <div>
              <p className="mb-2 text-xs text-gray-400 font-medium">Sugestões:</p>
              <div className="flex flex-wrap gap-2" role="list" aria-label="Categorias sugeridas">
                {SUGGESTED_CATEGORIES.filter((s) => !categoryNames.includes(s)).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSuggest(s)}
                    role="listitem"
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600
                               hover:border-navy/40 hover:text-navy hover:bg-navy/5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Players 
        <section className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5" aria-labelledby="players-heading">
          <h3 id="players-heading" className="mb-3 text-xs font-bold tracking-[0.2em] text-gray-400 uppercase">
            Jogadores ({room.players.length}/20)
          </h3>
          <ul className="flex flex-col gap-2" aria-label="Lista de jogadores na sala">
            {room.players.map((player: Player) => (
              <li key={player.id} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white"
                >
                  {player.nickname[0].toUpperCase()}
                </span>
                <span className="text-sm text-gray-700 font-medium">
                  {player.nickname}
                  {player.id === myPlayerId && (
                    <span className="ml-1 text-gray-400 font-normal">(você)</span>
                  )}
                  {player.isHost && (
                    <span className="ml-1 text-xs text-orange font-semibold">★</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
        */}

        {/* Status announcements for screen readers */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {statusMessage ?? ''}
        </div>
      </main>
      <div className="flex flex-col gap-5">
              {/* Room header */}
        <section className="relative h-30 rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-gray-400 uppercase mb-0.5">Sala</p>
            <h2 className="text-2xl font-extrabold text-navy tracking-widest">{room.code}</h2>
          </div>
          <div className="absolute top-5 right-6 flex items-center gap-2">
            <span
              className={[
                'rounded-full px-3 py-1 text-xs font-semibold tracking-wide',
                isHost ? 'bg-orange/15 text-orange' : 'bg-gray-100 text-gray-500',
              ].join(' ')}
              aria-label={isHost ? 'Você é o anfitrião desta sala' : 'Você é um convidado'}
            >
              {isHost ? 'Anfitrião' : 'Convidado'}
            </span>
          </div>
        </section>

        {/* Number of rounds */}
        <section className="rounded-2xl bg-white/90 shadow-md backdrop-blur-sm px-6 py-5 " aria-labelledby="rounds-heading">
          <h3 id="rounds-heading" className="mb-3 text-xs font-bold tracking-[0.2em] text-gray-400 uppercase">
            Configuração
          </h3>
          <div className="flex items-center gap-4">
            <label htmlFor="total-rounds" className="text-sm font-semibold text-gray-700">
              Número de rodadas
            </label>
            <input
              id="total-rounds"
              type="number"
              min={1}
              max={10}
              value={room.totalRounds || 3}
              onChange={handleRoundsChange}
              readOnly={!isHost}
              aria-readonly={!isHost}
              className={[
                'w-20 rounded-xl border border-gray-200 px-3 py-2 text-center text-sm font-bold text-navy',
                'outline-none transition focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-navy/20',
                !isHost ? 'bg-gray-50 cursor-not-allowed text-gray-400' : 'bg-white',
              ].join(' ')}
            />
          </div>
        </section>

                {/* Start game (host only) */}
        {isHost && (
          <button
            type="button"
            onClick={onStartGame}
            disabled={!canStart}
            className="w-full rounded-2xl bg-navy py-4 text-base font-bold text-white tracking-wide
                       hover:bg-navy/90 active:scale-[0.98] transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2"
          >
            Iniciar jogo
          </button>
        )}
        {!isHost && (
          <p className="text-center text-sm text-gray-400" aria-live="polite">
            Aguardando o anfitrião iniciar a partida…
          </p>
        )}
        </div>

      {/* ── Sidebar Scoreboard (last in DOM for screen readers) ── */}
      <div className="lg:pt-0">
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

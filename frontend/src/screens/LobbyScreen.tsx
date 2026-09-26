import { useState } from 'react';
import type { RoomState, Category, Player } from '../types';
import { useToast } from '../components/Toast';

interface LobbyScreenProps {
  room: RoomState;
  myPlayerId: string;
  onUpdateCategories: (categories: string[]) => void;
  onUpdateRounds: (totalRounds: number) => void;
  onStartGame: () => void;
  statusMessage?: string | null;
}

const CATEGORY_PACKS = {
  classico: ['Nome', 'CEP / Lugar', 'Animal', 'Cor', 'Fruta / Comida', 'Objeto', 'Marca'],
  geek: ['Personagem Pop', 'Filme / Série', 'Jogo / Game', 'Poder / Magia', 'Vilão Fictício', 'Item Geek'],
  expert: ['País ou Capital', 'Profissão Rara', 'Instrumento Musical', 'Termo Científico', 'Obra de Arte', 'Comida Típica'],
};

const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const HARD_LETTERS = ['K', 'W', 'Y', 'X', 'Z'];

export function LobbyScreen({
  room,
  myPlayerId,
  onUpdateCategories,
  onUpdateRounds,
  onStartGame,
}: LobbyScreenProps) {
  const { showToast } = useToast();
  const me = room.players.find((p: Player) => p.id === myPlayerId);
  const isHost = me?.isHost ?? false;

  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [roundTime, setRoundTime] = useState<number>(60);
  const [excludedLetters, setExcludedLetters] = useState<string[]>([]);
  const [hardLettersBlocked, setHardLettersBlocked] = useState(false);

  const categoryNames = room.categories.map((c: Category) => c.name);

  function handleSelectRounds(rounds: number) {
    if (!isHost) return;
    onUpdateRounds(rounds);
    showToast(`Partida configurada para ${rounds} rodadas.`);
  }

  function handleSelectTime(seconds: number) {
    if (!isHost) return;
    setRoundTime(seconds);
    showToast(seconds === 0 ? 'Tempo por rodada: Sem limite' : `Tempo por rodada: ${seconds} segundos`);
  }

  function handleLoadPack(packName: keyof typeof CATEGORY_PACKS) {
    if (!isHost) return;
    const pack = CATEGORY_PACKS[packName];
    onUpdateCategories(pack);
    showToast(`Pacote ${packName.toUpperCase()} carregado!`);
  }

  function handleAddCustomCategory() {
    if (!isHost) return;
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    if (categoryNames.map(c => c.toLowerCase()).includes(trimmed.toLowerCase())) {
      showToast('Esta categoria já está adicionada.');
      return;
    }
    onUpdateCategories([...categoryNames, trimmed]);
    setNewCategoryInput('');
    showToast(`Categoria "${trimmed}" adicionada!`);
  }

  function handleRemoveCategory(nameToRemove: string) {
    if (!isHost) return;
    if (categoryNames.length <= 4) {
      showToast('Mantenha pelo menos 4 categorias para uma partida dinâmica.');
      return;
    }
    onUpdateCategories(categoryNames.filter((n) => n !== nameToRemove));
    showToast(`Categoria "${nameToRemove}" removida.`);
  }

  function handleToggleHardLetters() {
    if (!isHost) return;
    if (!hardLettersBlocked) {
      setExcludedLetters((prev) => Array.from(new Set([...prev, ...HARD_LETTERS])));
      setHardLettersBlocked(true);
      showToast('Letras difíceis bloqueadas (K, W, Y, X, Z)!');
    } else {
      setExcludedLetters((prev) => prev.filter((l) => !HARD_LETTERS.includes(l)));
      setHardLettersBlocked(false);
      showToast('Todas as letras liberadas para sorteio!');
    }
  }

  function handleToggleLetter(letter: string) {
    if (!isHost) return;
    setExcludedLetters((prev) =>
      prev.includes(letter) ? prev.filter((l) => l !== letter) : [...prev, letter]
    );
  }

  function handleCopyLink() {
    navigator.clipboard?.writeText(window.location.href);
    showToast('Link da sala copiado para a área de transferência!');
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      {/* Topo do Lobby */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-indigo-100 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
              <span className="material-symbols-outlined fill text-xs">star</span>
              {isHost ? 'VOCÊ É O HOST' : 'CONVIDADO'}
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Salvo em tempo real
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-slate-900 md:text-3xl">
            Sala Privada: <span className="text-indigo-600">#{room.code}</span>
          </h1>
          <p className="text-xs text-slate-500 md:text-sm">
            Personalize as rodadas, categorias e letras antes de iniciar a partida.
          </p>
        </div>

        {/* Botões de Ação do Topo */}
        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-50 sm:flex-initial"
          >
            <span className="material-symbols-outlined text-lg">link</span>
            Copiar Link da Sala
          </button>
          {isHost ? (
            <button
              type="button"
              onClick={onStartGame}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 active:scale-95 sm:flex-initial"
            >
              <span className="material-symbols-outlined text-lg">play_arrow</span>
              Iniciar Partida
            </button>
          ) : (
            <span className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">
              Aguardando o host iniciar…
            </span>
          )}
        </div>
      </div>

      {/* Grid Principal das Configurações — Sem placar nem lista de jogadores nesta fase */}
      <div className="mt-6 space-y-6">
        {/* Card 1: Estrutura da Partida (Rodadas + Tempo) */}
        <div className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <span className="material-symbols-outlined text-lg">tune</span>
              </span>
              <h2 className="text-lg font-bold text-slate-800">Regras & Estrutura da Partida</h2>
            </div>
            <span className="text-xs font-medium text-slate-400">Ajuste o ritmo do jogo</span>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {/* Número de Rodadas */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Número de Rodadas
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[3, 5, 8, 10].map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={!isHost}
                    onClick={() => handleSelectRounds(count)}
                    className={`py-2 rounded-xl text-sm font-bold transition ${
                      room.totalRounds === count
                        ? 'border-2 border-indigo-600 bg-indigo-600 text-white shadow-sm'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-400'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* Tempo por Rodada */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Tempo por Rodada
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '60s', value: 60 },
                  { label: '90s', value: 90 },
                  { label: '120s', value: 120 },
                  { label: 'Sem Fim', value: 0 },
                ].map(({ label, value }) => (
                  <button
                    key={label}
                    type="button"
                    disabled={!isHost}
                    onClick={() => handleSelectTime(value)}
                    className={`py-2 rounded-xl text-sm font-bold transition ${
                      roundTime === value
                        ? 'border-2 border-rose-500 bg-rose-500 text-white shadow-sm'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-rose-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Categorias da Partida */}
        <div className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <span className="material-symbols-outlined text-lg">category</span>
              </span>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Categorias da Partida</h2>
                <p className="text-xs text-slate-500">
                  Mínimo de 4 para um jogo dinâmico. Adicione ou remova categorias livremente.
                </p>
              </div>
            </div>
            {isHost && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-medium text-slate-400">Packs:</span>
                <button
                  type="button"
                  onClick={() => handleLoadPack('classico')}
                  className="rounded-lg bg-indigo-50 px-2.5 py-1 font-bold text-indigo-700 transition hover:bg-indigo-100"
                >
                  Clássico
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadPack('geek')}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 font-bold text-slate-700 transition hover:bg-slate-200"
                >
                  Geek/Pop
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadPack('expert')}
                  className="rounded-lg bg-rose-50 px-2.5 py-1 font-bold text-rose-700 transition hover:bg-rose-100"
                >
                  Expert 🌶️
                </button>
              </div>
            )}
          </div>

          {/* Tags das Categorias Ativas */}
          <div className="my-4 flex flex-wrap gap-2.5">
            {categoryNames.map((cat, index) => (
              <div
                key={cat}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 transition hover:bg-slate-100"
              >
                <span className="font-extrabold text-indigo-600">
                  {(index + 1).toString().padStart(2, '0')}
                </span>
                <span>{cat}</span>
                {isHost && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCategory(cat)}
                    className="ml-1 text-slate-400 hover:text-rose-500 focus:outline-none"
                    title={`Remover ${cat}`}
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Adicionar Nova Categoria */}
          {isHost && (
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <input
                type="text"
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomCategory();
                  }
                }}
                placeholder="Criar categoria personalizada (ex: Vilão de Anime, Sobremesa)..."
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:bg-white"
              />
              <button
                type="button"
                onClick={handleAddCustomCategory}
                className="flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700"
              >
                <span className="material-symbols-outlined text-base">add</span>
                Adicionar
              </button>
            </div>
          )}
        </div>

        {/* Card 3: Letras Permitidas */}
        <div className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <span className="material-symbols-outlined text-lg">font_download</span>
              </span>
              <h2 className="text-lg font-bold text-slate-800">Letras Permitidas na Partida</h2>
            </div>
            {isHost && (
              <button
                type="button"
                onClick={handleToggleHardLetters}
                className="flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
              >
                <span className="material-symbols-outlined text-sm">filter_alt</span>
                {hardLettersBlocked ? 'Desbloquear Difíceis' : 'Bloquear Difíceis (K, W, Y, X, Z)'}
              </button>
            )}
          </div>
          <p className="mb-4 text-xs text-slate-500">
            {isHost
              ? 'Clique em qualquer letra para incluir ou excluir do sorteio das rodadas.'
              : 'Letras liberadas pelo anfitrião para sorteio.'}
          </p>

          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9 md:grid-cols-13">
            {ALL_LETTERS.map((letter) => {
              const isExcluded = excludedLetters.includes(letter);
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={!isHost}
                  onClick={() => handleToggleLetter(letter)}
                  className={`h-9 rounded-lg text-xs font-bold border transition ${
                    isExcluded
                      ? 'border-slate-200 bg-slate-100 text-slate-300 line-through'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50'
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </div>

        {/* Card 4: Confirmação & Início (Apenas anfitrião) */}
        {isHost && (
          <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-indigo-50 p-6 sm:flex-row">
            <div>
              <h3 className="text-base font-bold text-slate-900">Tudo pronto para o jogo?</h3>
              <p className="text-xs text-slate-500">
                {room.totalRounds} rodadas configuradas • {categoryNames.length} categorias ativas • {ALL_LETTERS.length - excludedLetters.length} letras disponíveis
              </p>
            </div>
            <button
              type="button"
              onClick={onStartGame}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-indigo-300/50 transition hover:bg-indigo-700 active:scale-95"
            >
              <span className="material-symbols-outlined text-xl">play_circle</span>
              Iniciar Partida Agora
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { RoomState, Category, Player } from '../types';
import { useToast } from '../components/Toast';

interface LobbyScreenProps {
  room: RoomState;
  myPlayerId: string;
  onUpdateCategories: (categories: string[]) => void;
  onUpdateRounds: (totalRounds: number) => void;
  onUpdateOptions: (roundDurationSeconds: 0 | 60 | 90 | 120, allowedLetters: string[]) => void;
  onStartGame: () => void;
  actionStatus?: {
    status: 'pending' | 'confirmed' | 'rejected';
    message?: string;
  } | null;
}

const CATEGORY_PACKS = {
  classico: ['Nome', 'CEP / Lugar', 'Animal', 'Cor', 'Fruta / Comida', 'Objeto', 'Marca'],
  geek: ['Personagem Pop', 'Filme / Série', 'Jogo / Game', 'Poder / Magia', 'Vilão Fictício', 'Item Geek'],
  expert: ['País ou Capital', 'Profissão Rara', 'Instrumento Musical', 'Termo Científico', 'Obra de Arte', 'Comida Típica'],
};

const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const HARD_LETTERS = ['K', 'W', 'Y', 'X', 'Z'];
const ROUND_DURATIONS: { label: string; value: 0 | 60 | 90 | 120 }[] = [
  { label: '60s', value: 60 },
  { label: '90s', value: 90 },
  { label: '120s', value: 120 },
  { label: 'Sem Fim', value: 0 },
];

export function LobbyScreen({
  room,
  myPlayerId,
  onUpdateCategories,
  onUpdateRounds,
  onUpdateOptions,
  onStartGame,
  actionStatus,
}: LobbyScreenProps) {
  const { showToast } = useToast();
  const me = room.players.find((p: Player) => p.id === myPlayerId);
  const isHost = me?.isHost === true && me.status === 'active';
  const hasActiveHost = room.players.some((player) => player.isHost && player.status === 'active');

  const [newCategoryInput, setNewCategoryInput] = useState('');

  const categoryNames = room.categories.map((c: Category) => c.name);
  const roundTime = room.roundDurationSeconds ?? 60;
  const allowedLetters = room.allowedLetters ?? ALL_LETTERS;
  const excludedLetters = ALL_LETTERS.filter((letter) => !allowedLetters.includes(letter));
  const hardLettersBlocked = HARD_LETTERS.every((letter) => !allowedLetters.includes(letter));
  const canEditLobby =
    isHost &&
    room.phase === 'CONFIGURING' &&
    actionStatus?.status !== 'pending';
  const activePlayers = room.players.filter((player) => player.status === 'active').length;
  const canStart =
    canEditLobby &&
    activePlayers >= 2 &&
    categoryNames.length >= 1 &&
    categoryNames.length <= 20;

  function handleSelectRounds(rounds: number) {
    if (!canEditLobby) return;
    onUpdateRounds(rounds);
  }

  function handleSelectTime(seconds: 0 | 60 | 90 | 120) {
    if (!canEditLobby) return;
    onUpdateOptions(seconds, allowedLetters);
  }

  function handleLoadPack(packName: keyof typeof CATEGORY_PACKS) {
    if (!canEditLobby) return;
    const pack = CATEGORY_PACKS[packName];
    onUpdateCategories(pack);
  }

  function handleAddCustomCategory() {
    if (!canEditLobby) return;
    const trimmed = newCategoryInput.trim();
    if (!trimmed) {
      showToast('Informe o nome da categoria.');
      return;
    }
    if (Array.from(trimmed).length > 40) {
      showToast('O nome da categoria deve ter até 40 pontos de código Unicode.');
      return;
    }
    if (categoryNames.length >= 20) {
      showToast('A partida pode ter no máximo 20 categorias.');
      return;
    }
    if (categoryNames.map(c => c.toLowerCase()).includes(trimmed.toLowerCase())) {
      showToast('Esta categoria já está adicionada.');
      return;
    }
    onUpdateCategories([...categoryNames, trimmed]);
    setNewCategoryInput('');
  }

  function handleRemoveCategory(nameToRemove: string) {
    if (!canEditLobby) return;
    if (categoryNames.length <= 1) {
      showToast('A partida precisa ter pelo menos uma categoria.');
      return;
    }
    onUpdateCategories(categoryNames.filter((n) => n !== nameToRemove));
  }

  function handleToggleHardLetters() {
    if (!canEditLobby) return;
    const nextAllowedLetters = hardLettersBlocked
      ? Array.from(new Set([...allowedLetters, ...HARD_LETTERS]))
      : allowedLetters.filter((letter) => !HARD_LETTERS.includes(letter));
    if (nextAllowedLetters.length === 0) {
      showToast('Mantenha pelo menos uma letra permitida.');
      return;
    }
    onUpdateOptions(roundTime, nextAllowedLetters);
  }

  function handleToggleLetter(letter: string) {
    if (!canEditLobby) return;
    const nextAllowedLetters = allowedLetters.includes(letter)
      ? allowedLetters.filter((allowedLetter) => allowedLetter !== letter)
      : [...allowedLetters, letter];
    if (nextAllowedLetters.length === 0) {
      showToast('Mantenha pelo menos uma letra permitida.');
      return;
    }
    onUpdateOptions(roundTime, nextAllowedLetters);
  }

  async function handleCopyLink() {
    const inviteUrl = new URL(window.location.href);
    inviteUrl.searchParams.set('room', room.code);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API is unavailable');
      await navigator.clipboard.writeText(inviteUrl.toString());
      showToast(`Link da sala #${room.code} copiado. O convite já inclui o código da sala.`);
    } catch (error) {
      console.error('[Lobby] Could not copy the room invitation link', error);
      showToast(`Copie o código da sala: ${room.code}`);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-6" data-game-screen>
      {/* Topo do Lobby */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-indigo-100 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
              <span className="material-symbols-outlined fill text-xs">star</span>
              {isHost ? 'VOCÊ É O HOST' : hasActiveHost ? 'CONVIDADO' : 'SEM ANFITRIÃO ATIVO'}
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Estado atual recebido do servidor
            </span>
          </div>
          <h1 tabIndex={-1} className="mt-1 text-2xl font-black text-slate-900 outline-none md:text-3xl">
            Sala Privada: <span className="text-indigo-600">#{room.code}</span>
          </h1>
          <p className="text-xs text-slate-500 md:text-sm">
            Personalize as rodadas, categorias e letras antes de iniciar a partida.
          </p>
          {!hasActiveHost && (
            <p role="status" className="mt-2 text-sm font-semibold text-amber-700">
              Ações de anfitrião suspensas até um participante existente retomar a sessão.
            </p>
          )}
        </div>

        {/* Botões de Ação do Topo */}
        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-50 sm:flex-initial"
          >
            <span className="material-symbols-outlined text-lg">link</span>
            Copiar Link da Sala <span className="font-black">#{room.code}</span>
          </button>
          {canStart ? (
            <button
              type="button"
              onClick={onStartGame}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 active:scale-95 sm:flex-initial"
            >
              <span className="material-symbols-outlined text-lg">play_arrow</span>
              Iniciar Partida
            </button>
          ) : actionStatus?.status === 'pending' ? (
            <span className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
              Aguardando confirmação do servidor…
            </span>
          ) : isHost ? (
            <span className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
              Entre 2 jogadores ativos e configure ao menos uma categoria para iniciar.
            </span>
          ) : !hasActiveHost ? (
            <span className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
              Aguardando um anfitrião ativo…
            </span>
          ) : (
            <span className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">
              Aguardando o host iniciar…
            </span>
          )}
        </div>
      </div>

      <section
        aria-labelledby="lobby-participants-heading"
        className="mt-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="lobby-participants-heading" className="text-lg font-bold text-slate-800">
              Participantes da sala
            </h2>
            <p className="text-sm text-slate-500" role="status" aria-live="polite">
              {activePlayers} de 20 participantes conectados
            </p>
          </div>
          {activePlayers < 2 && isHost && (
            <p className="text-sm font-semibold text-amber-700">
              A partida pode começar quando outro participante entrar.
            </p>
          )}
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {room.players.map((player) => (
            <li
              key={player.id}
              className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700"
                >
                  {player.nickname.slice(0, 1).toLocaleUpperCase()}
                </span>
                <span className="truncate font-semibold text-slate-800">{player.nickname}</span>
                {player.isHost && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">
                    Anfitrião
                  </span>
                )}
              </span>
              <span
                className={`ml-2 shrink-0 text-xs font-semibold ${
                  player.status === 'active' ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {player.status === 'active' ? 'Conectado' : 'Desconectado'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {actionStatus && (
        <p
          role={actionStatus.status === 'rejected' ? 'alert' : 'status'}
          aria-live={actionStatus.status === 'rejected' ? 'assertive' : 'polite'}
          className={`mt-4 rounded-xl border px-4 py-3 text-sm font-medium ${
            actionStatus.status === 'rejected'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : actionStatus.status === 'pending'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {actionStatus.message}
        </p>
      )}

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
                    disabled={!canEditLobby}
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
                {ROUND_DURATIONS.map(({ label, value }) => (
                  <button
                    key={label}
                    type="button"
                    disabled={!canEditLobby}
                    aria-pressed={roundTime === value}
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
                  Escolha de 1 a 20 categorias. Os nomes devem ser únicos e ter até 40 pontos de código Unicode.
                </p>
              </div>
            </div>
            {canEditLobby && (
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
                {canEditLobby && (
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
          {canEditLobby && (
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <input
                type="text"
                value={newCategoryInput}
                maxLength={80}
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
                disabled={!canEditLobby}
                aria-pressed={hardLettersBlocked}
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
                  disabled={!canEditLobby}
                  aria-pressed={!isExcluded}
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
        {canEditLobby && (
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
              disabled={!canStart}
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

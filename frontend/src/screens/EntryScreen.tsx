import { useState } from 'react';

interface EntryScreenProps {
  onEnterRoom: (nickname: string, roomCode: string) => void;
  onCreateRoom: (nickname: string) => void;
  error?: string | null;
  isLoading?: boolean;
}

/**
 * Tela 1 — Entrada.
 * DOM order: h1 → description → nickname input → room code input → submit button → status region.
 */
export function EntryScreen({ onEnterRoom, onCreateRoom, error, isLoading }: EntryScreenProps) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedNickname = nickname.trim();
    const trimmedCode = roomCode.trim();
    if (!trimmedNickname) return;
    if (trimmedCode) {
      onEnterRoom(trimmedNickname, trimmedCode);
    } else {
      onCreateRoom(trimmedNickname);
    }
  }

  function handleGenerateCode() {
    // Generates a random 4-char code locally (the real one comes from the server on room:create)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setRoomCode(code);
  }

  const canSubmit = nickname.trim().length > 0 && !isLoading;

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl bg-white/90 shadow-xl backdrop-blur-sm px-8 py-10">

          {/* Heading */}
          <p className="mb-1 text-xs font-bold tracking-[0.2em] text-gray-400 uppercase">Bem-vindo</p>
          <h1 className="mb-2 text-5xl font-extrabold text-navy">
            Stop<span className="text-orange">!</span>
          </h1>
          <p className="mb-8 text-sm text-gray-500 leading-relaxed">
            Entre na sala, sorteie uma letra e complete as categorias antes que o tempo acabe.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            {/* Nickname */}
            <div className="mb-5">
              <label
                htmlFor="nickname"
                className="mb-1.5 block text-xs font-semibold tracking-wider text-gray-500 uppercase"
              >
                Seu nome
              </label>
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Como quer ser chamado?"
                maxLength={24}
                autoComplete="off"
                autoFocus
                required
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 placeholder-gray-400
                           outline-none transition focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-navy/20"
              />
            </div>

            {/* Room code */}
            <div className="mb-7">
              <label
                htmlFor="room-code"
                className="mb-1.5 block text-xs font-semibold tracking-wider text-gray-500 uppercase"
              >
                Código da sala
                <span className="ml-1 font-normal text-gray-400">(deixe vazio para criar uma nova)</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="room-code"
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="X Y D - 7"
                  maxLength={8}
                  autoComplete="off"
                  className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-mono tracking-widest text-gray-800 placeholder-gray-300
                             outline-none transition focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-navy/20 uppercase"
                />
                <button
                  type="button"
                  onClick={handleGenerateCode}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-600
                             hover:border-navy/30 hover:text-navy transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40"
                  aria-label="Gerar código de sala aleatório"
                >
                  Nova
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-xl bg-navy py-3.5 text-sm font-bold text-white tracking-wide
                         hover:bg-navy/90 active:scale-[0.98] transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2"
            >
              {isLoading ? 'Entrando…' : roomCode.trim() ? 'Entrar na sala' : 'Criar sala'}
            </button>
          </form>

          {/* Live error region */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-4 min-h-[20px] text-center text-sm text-red-500"
          >
            {error ?? ''}
          </div>
        </div>
      </div>
    </main>
  );
}


import { useToast } from './Toast';

interface HeaderProps {
  roomCode?: string;
  playerName?: string;
  playerAvatar?: string;
  isHost?: boolean;
  showRoomInfo?: boolean;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onExit?: () => void;
  onGoHome?: () => void;
}

export function Header({
  roomCode,
  playerName = 'Jogador',
  playerAvatar = '🦊',
  isHost = false,
  showRoomInfo = true,
  audioEnabled,
  onToggleAudio,
  onExit,
  onGoHome,
}: HeaderProps) {
  const { showToast } = useToast();

  function copyRoomLink() {
    if (!roomCode) return;
    try {
      navigator.clipboard?.writeText(window.location.href);
      showToast('Link da sala copiado para a área de transferência!');
    } catch {
      showToast(`Código copiado: #${roomCode}`);
    }
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-indigo-100/70 bg-white/85 backdrop-blur-md transition-colors">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo & Online Status */}
        <div className="flex items-center gap-4">
          <button
            onClick={onGoHome}
            type="button"
            className="group flex items-center gap-2 text-left focus:outline-none"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 font-black text-xl text-white shadow-md shadow-indigo-200 transition-transform group-hover:scale-105">
              !
            </div>
            <div>
              <span className="text-2xl font-black tracking-tight text-indigo-900 transition-colors group-hover:text-indigo-600">
                STOP!
              </span>
              <span className="-mt-1 block text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                Multiplayer Online
              </span>
            </div>
          </button>

          <div className="hidden items-center gap-2 border-l border-slate-200 pl-4 text-xs lg:flex">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              3.492 jogadores online
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-500">Servidor BR-Leste (18ms)</span>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {showRoomInfo && roomCode && (
            <div className="flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-bold text-indigo-700">
              <span className="material-symbols-outlined text-base">tag</span>
              <span>
                SALA: <strong className="font-black">#{roomCode}</strong>
              </span>
              <button
                type="button"
                onClick={copyRoomLink}
                title="Copiar Link"
                className="ml-1 text-xs underline hover:text-indigo-900"
              >
                Copiar
              </button>
            </div>
          )}

          {/* Player Pill */}
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-800">
            <span className="text-base sm:text-lg">{playerAvatar}</span>
            <span className="max-w-[100px] truncate sm:max-w-[140px]">{playerName}</span>
            {isHost && (
              <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                Host
              </span>
            )}
          </div>

          {/* Audio toggle button */}
          <button
            type="button"
            onClick={onToggleAudio}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-600 shadow-sm transition hover:bg-slate-50"
            title={audioEnabled ? 'Mutar efeitos sonoros' : 'Ativar efeitos sonoros'}
          >
            <span className="material-symbols-outlined text-lg">
              {audioEnabled ? 'volume_up' : 'volume_off'}
            </span>
          </button>

          {/* Exit button */}
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="flex items-center gap-1 rounded-lg border border-rose-200/50 px-3 py-1.5 text-xs sm:text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50"
            >
              <span className="material-symbols-outlined text-base">logout</span>
              <span className="hidden sm:inline">Sair</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

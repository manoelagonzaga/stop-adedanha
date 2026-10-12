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
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:h-16 sm:px-6">
        {/* Logo & Online Status */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button
            onClick={onGoHome}
            type="button"
            className="group flex min-h-[44px] items-center gap-2 text-left focus:outline-none"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-xl font-black text-white shadow-md shadow-indigo-200 transition-transform group-hover:scale-105">
              !
            </div>
            <div className="min-w-0">
              <span className="text-xl font-black tracking-tight text-indigo-900 transition-colors group-hover:text-indigo-600 sm:text-2xl">
                STOP!
              </span>
              <span className="-mt-1 hidden text-[10px] font-bold uppercase tracking-wider text-indigo-400 sm:block">
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
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {showRoomInfo && roomCode && (
            <div className="hidden items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700 sm:flex sm:px-3 sm:text-sm">
              <span className="material-symbols-outlined text-base">tag</span>
              <span>
                SALA: <strong className="font-black">#{roomCode}</strong>
              </span>
              <button
                type="button"
                onClick={copyRoomLink}
                title="Copiar Link"
                className="ml-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-xs underline hover:text-indigo-900"
              >
                Copiar
              </button>
            </div>
          )}

          {/* Player Pill */}
          <div className="flex max-w-[120px] items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-800 sm:max-w-none sm:gap-2 sm:px-3 sm:text-sm">
            <span className="text-base sm:text-lg">{playerAvatar}</span>
            <span className="truncate sm:max-w-[140px]">{playerName}</span>
            {isHost && (
              <span className="hidden rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white sm:inline">
                Host
              </span>
            )}
          </div>

          {/* Audio toggle button */}
          <button
            type="button"
            onClick={onToggleAudio}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-600 shadow-sm transition hover:bg-slate-50"
            title={audioEnabled ? 'Mutar efeitos sonoros' : 'Ativar efeitos sonoros'}
            aria-label={audioEnabled ? 'Mutar efeitos sonoros' : 'Ativar efeitos sonoros'}
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
              className="flex min-h-[44px] items-center gap-1 rounded-lg border border-rose-200/50 px-2.5 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50 sm:px-3 sm:text-sm"
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

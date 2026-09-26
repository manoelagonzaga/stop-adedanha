import { useState, useRef } from 'react';
import { useToast } from '../components/Toast';

interface EntryScreenProps {
  onEnterRoom: (nickname: string, roomCode: string, avatar: string) => void;
  onCreateRoom: (nickname: string, roomCode: string, avatar: string) => void;
  error?: string | null;
  isLoading?: boolean;
}

const AVATAR_OPTIONS = ['🦊', '🐙', '🐵', '🦁', '🐯', '🐼', '🐨', '🐸', '🦄'];

export function EntryScreen({ onEnterRoom, onCreateRoom, error }: EntryScreenProps) {
  const { showToast } = useToast();

  const [createNick, setCreateNick] = useState('CapitãoPalavra');
  const [joinNick, setJoinNick] = useState('Veloz99');
  const [selectedAvatar, setSelectedAvatar] = useState('🦊');

  // 6-digit PIN state
  const [pinDigits, setPinDigits] = useState<string[]>(['S', 'T', 'P', '9', '4', '8']);
  const pinInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  function handleDigitChange(index: number, value: string) {
    const char = value.slice(-1).toUpperCase();
    const newDigits = [...pinDigits];
    newDigits[index] = char;
    setPinDigits(newDigits);

    // Auto-advance
    if (char && index < 5) {
      pinInputsRef.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinInputsRef.current[index - 1]?.focus();
    }
  }

  function handlePastePin(e?: React.ClipboardEvent) {
    if (e) e.preventDefault();
    navigator.clipboard?.readText().then((text) => {
      const clean = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
      if (clean) {
        const digits = clean.split('');
        while (digits.length < 6) digits.push('');
        setPinDigits(digits);
        showToast(`Código #${clean} inserido!`);
      }
    }).catch(() => {
      // Fallback
      setPinDigits(['S', 'T', 'P', '9', '4', '8']);
      showToast('Código #STP-948 inserido automaticamente!');
    });
  }

  function handleRandomAvatar() {
    const random = AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)];
    setSelectedAvatar(random);
    showToast(`Avatar alterado para ${random}`);
  }

  function handleActionCreate() {
    const nick = createNick.trim();
    if (!nick) {
      showToast('Por favor, informe seu apelido.');
      return;
    }
    // Generate 6-char room code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = 'STP-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    showToast('Sala privada criada com sucesso!');
    onCreateRoom(nick, code, selectedAvatar);
  }

  function handleActionJoin() {
    const nick = joinNick.trim();
    if (!nick) {
      showToast('Por favor, informe seu apelido.');
      return;
    }
    const code = pinDigits.join('').trim();
    if (code.length < 3) {
      showToast('Por favor, digite o código da sala.');
      return;
    }
    showToast(`Conectando à sala #${code}...`);
    onEnterRoom(nick, code, selectedAvatar);
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      {/* Hero Banner */}
      <div className="mx-auto my-6 max-w-3xl text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-4 py-1 text-xs font-bold uppercase tracking-wider text-indigo-700">
          <span className="material-symbols-outlined fill text-sm text-amber-500">bolt</span>
          Multiplayer em Tempo Real • A clássica Adedonha Turbo
        </div>
        <h1 className="text-4xl font-black leading-tight tracking-tight text-slate-900 md:text-5xl lg:text-6xl">
          Dedos ágeis, mentes rápidas: <br />
          <span className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-rose-600 bg-clip-text text-transparent">
            Grite STOP primeiro!
          </span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-600 md:text-lg">
          Desafie seus amigos no jogo de vocabulário mais frenético da internet. Crie sua sala privada ou digite o PIN de um amigo para começar.
        </p>

        {error && (
          <div className="mx-auto mt-4 max-w-md rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Grid: Criar Sala vs Entrar */}
      <div className="mx-auto mt-6 grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-2">
        {/* Card 1: Criar Sala Privada */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-indigo-100 bg-white p-6 shadow-xl shadow-indigo-100/50 md:p-8">
          <div className="pointer-events-none absolute top-0 right-0 -mr-10 -mt-10 h-32 w-32 rounded-full bg-indigo-50/60 blur-2xl" />
          
          <div>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
                  <span className="material-symbols-outlined text-2xl">add_circle</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Criar Sala Privada</h2>
                  <p className="text-xs text-slate-500">Configure temas e convide seus amigos</p>
                </div>
              </div>
              <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                Anfitrião VIP
              </span>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Seu Apelido no Jogo
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute top-1/2 left-3.5 -translate-y-1/2 text-lg text-slate-400">
                    badge
                  </span>
                  <input
                    type="text"
                    value={createNick}
                    onChange={(e) => setCreateNick(e.target.value)}
                    maxLength={24}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pr-4 pl-10 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-500 focus:bg-white"
                  />
                </div>
              </div>

              {/* Escolha de Avatar */}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Seu Avatar
                </label>
                <div className="flex items-center gap-2">
                  {AVATAR_OPTIONS.slice(0, 4).map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setSelectedAvatar(emoji)}
                      className={`flex h-11 w-11 items-center justify-center rounded-xl text-2xl transition-transform hover:scale-105 ${
                        selectedAvatar === emoji
                          ? 'border-2 border-indigo-600 bg-indigo-100 shadow-sm'
                          : 'border-2 border-transparent bg-slate-100'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleRandomAvatar}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 transition hover:bg-slate-100"
                    title="Sortear Aleatório"
                  >
                    <span className="material-symbols-outlined text-lg">shuffle</span>
                  </button>
                </div>
              </div>

              {/* Resumo das categorias */}
              <div className="flex items-center justify-between rounded-xl border border-indigo-100/60 bg-indigo-50/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-base text-indigo-600">category</span>
                  <div className="text-xs">
                    <span className="font-bold text-slate-800">Categorias: </span>
                    <span className="text-slate-600">Nome, CEP, Animal, Cor, Fruta, Objeto (6)</span>
                  </div>
                </div>
                <span className="text-xs font-bold text-indigo-600">Personalizável</span>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleActionCreate}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-base font-bold text-white shadow-lg shadow-indigo-300/50 transition hover:bg-indigo-700 active:scale-[0.99]"
            >
              <span className="material-symbols-outlined text-xl">rocket_launch</span>
              Criar Sala e Convidar Amigos
            </button>
            <p className="mt-2.5 flex items-center justify-center gap-1 text-center text-[11px] font-medium text-slate-400">
              <span className="material-symbols-outlined text-sm text-emerald-500">check_circle</span>
              Link direto e código gerados na hora • Até 12 jogadores
            </p>
          </div>
        </div>

        {/* Card 2: Entrar em Sala Existente */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-rose-100 bg-white p-6 shadow-xl shadow-rose-100/40 md:p-8">
          <div className="pointer-events-none absolute top-0 right-0 -mr-10 -mt-10 h-32 w-32 rounded-full bg-rose-50/50 blur-2xl" />

          <div>
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-lg shadow-rose-200">
                  <span className="material-symbols-outlined text-2xl">login</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Entrar em Sala</h2>
                  <p className="text-xs text-slate-500">Tem o PIN ou link do seu amigo?</p>
                </div>
              </div>
              <span className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
                Conexão Direta
              </span>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Seu Apelido
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute top-1/2 left-3.5 -translate-y-1/2 text-lg text-slate-400">
                    sentiment_satisfied
                  </span>
                  <input
                    type="text"
                    value={joinNick}
                    onChange={(e) => setJoinNick(e.target.value)}
                    placeholder="Ex: Veloz99"
                    maxLength={24}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pr-4 pl-10 text-sm font-semibold text-slate-800 outline-none transition focus:border-rose-500 focus:bg-white"
                  />
                </div>
              </div>

              {/* Input Código PIN da Sala */}
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Código da Sala (6 dígitos)
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {pinDigits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { pinInputsRef.current[i] = el; }}
                      type="text"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      className="aspect-square w-full rounded-xl border-2 border-slate-200 bg-slate-50 text-center text-lg font-black text-slate-900 uppercase outline-none transition focus:border-rose-500 focus:bg-white"
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span>Exemplo: STP-948</span>
                  <button
                    type="button"
                    onClick={() => handlePastePin()}
                    className="font-bold text-rose-600 hover:underline"
                  >
                    Colar link ou código
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleActionJoin}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3.5 text-base font-bold text-white shadow-lg shadow-rose-300/50 transition hover:bg-rose-700 active:scale-[0.99]"
            >
              <span className="material-symbols-outlined text-xl">sports_esports</span>
              Entrar no Jogo Agora
            </button>
            <p className="mt-2.5 text-center text-[11px] font-medium text-slate-400">
              Não precisa de cadastro ou download • Direto no navegador
            </p>
          </div>
        </div>
      </div>

      {/* Guia Rápido: Como Jogar STOP! Online */}
      <div className="mx-auto mt-16 max-w-4xl">
        <div className="mb-8 text-center">
          <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-600">
            Fácil e Rápido de Aprender
          </span>
          <h2 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">Como Jogar STOP! Online</h2>
          <p className="mt-1 text-sm text-slate-500">
            As clássicas regras do papel, otimizadas para partidas virtuais dinâmicas, justas e muito divertidas.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-indigo-50 bg-white p-5 shadow-md">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-lg font-black text-indigo-600">
              01
            </div>
            <h3 className="text-base font-bold text-slate-800">Sorteie a Letra</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              A cada rodada o sistema sorteia uma letra aleatória do alfabeto. Todos os participantes começam exatamente no mesmo segundo!
            </p>
          </div>

          <div className="rounded-2xl border border-amber-50 bg-white p-5 shadow-md">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-lg font-black text-amber-600">
              02
            </div>
            <h3 className="text-base font-bold text-slate-800">Preencha Rápido</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Digite respostas com a letra da rodada para cada coluna: Nome, Animal, Cidade, Objeto, etc. Quanto mais veloz, maior sua chance de vencer!
            </p>
          </div>

          <div className="rounded-2xl border border-rose-50 bg-white p-5 shadow-md">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-lg font-black text-rose-600">
              03
            </div>
            <h3 className="text-base font-bold text-slate-800">Grite STOP! & Pontue</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Acabou de preencher? Clique no botão gigante de STOP! O cronômetro congela para todos. Palavras únicas valem 10 pts e repetidas 5 pts.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

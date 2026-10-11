# Implementation Plan: Correções de Fluxo, Acessibilidade e Responsividade Mobile

**Branch**: `004-gameplay-ux-a11y-fixes` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Especificação de correções para tela inicial, configuração do lobby, início da rodada, cronômetro acessível, validação de respostas, pódio e responsividade mobile.

---

## 1. Summary

Este plano estabelece a implementação técnica dos ajustes funcionais, de acessibilidade (WCAG 2.1 AA) e de layout mobile demandados na Feature 4. As alterações englobam desacoplamento de estado na tela inicial, retenção de foco e `aria-pressed` no Lobby, animação de impacto com roleta de letras e regressiva de 3s no início da partida, verbalização acessível do cronômetro sem interpretação de hora do relógio, validação por contestação (apenas invalidar) com avanço manual de palavras, restauração automática de sala no pódio e layout responsivo fluido em todos os dispositivos móveis.

---

## 2. Technical Context

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide / Material Symbols, Vitest + React Testing Library.
- **Backend**: Cloudflare Workers, Cloudflare Durable Objects (`GameRoom`), Vitest.
- **Contratos Compartilhados**: `shared/types.ts` (`ClientCommand`, `ServerEvent`, `RoomState`).
- **Acessibilidade**: Suporte a leitores de tela NVDA, TalkBack, VoiceOver e navegação por teclado (`aria-live`, `aria-pressed`, `aria-label`, `tabIndex`).

---

## 3. Decisions & Architecture

### 3.1 Tela Inicial (`EntryScreen.tsx` & `App.tsx`)
- **Isolamento de Avatares**: Criar `createAvatar` e `joinAvatar` independentes com valor inicial aleatório ou padrão `AVATAR_OPTIONS[0]`.
- **Isolamento de Ação Pendente**: Substituir `isLoading?: boolean` em `EntryScreenProps` por `pendingAction?: 'create' | 'join' | null`.
  - Botão "Criar Sala": exibe estado de carregamento e desabilita somente quando `pendingAction === 'create'`.
  - Botão "Entrar no Jogo": exibe estado de carregamento e desabilita somente quando `pendingAction === 'join'`.

### 3.2 Configuração de Sala (`LobbyScreen.tsx`)
- **Estabilidade de Foco**: Eliminar o bloqueio de botões (`disabled={!canEditLobby}`) durante requisições de micro-configuração (`actionStatus?.status === 'pending'`). Usar indicador não intrusivo ou `aria-busy="true"` no container sem alterar a propriedade `disabled` do botão sob foco.
- **Pacotes de Categorias e `aria-pressed`**:
  - Declarar `selectedPack` com `useState<'classico' | 'geek' | 'expert' | null>`.
  - Definir `aria-pressed={selectedPack === 'classico'}` com styling visual de seleção ativo (ex.: borda destacada e preenchimento sólido).

### 3.3 Sorteio de Letra e Regressiva (`GameScreen.tsx`)
- **Estado de Abertura**: Adicionar máquina de estados interna:
  - `phaseIntro`: `'spinning'` (0s a 1.2s: roleta rápida de letras) -> `'countdown'` (3s, 2s, 1s) -> `'playing'` (jogo liberado).
- **Acessibilidade**:
  - Durante `'spinning'`: elemento `<div role="status" aria-live="assertive" className="sr-only">sorteando letra</div>`.
  - Ao definir a letra: `<div role="status" aria-live="assertive" className="sr-only">letra sorteada: {letra}</div>`.
  - Durante `'countdown'`: verbalização `"Iniciando o jogo em: 3"`, `"2"`, `"1"`.
  - Ao atingir `'playing'`: liberar inputs e executar foco programático `firstInputRef.current?.focus()`.

### 3.4 Cronômetro Acessível (`GameScreen.tsx`)
- **Interpretação de Hora**: A formatação visual `${minutes}:${seconds}` recebe `aria-hidden="true"`.
- **Texto Acessível**: Criar string de duração em linguagem natural:
  - Se `timeLeft >= 60`: `${Math.floor(timeLeft / 60)} minutos e ${timeLeft % 60} segundos restantes`.
  - Se `timeLeft < 60`: `${timeLeft} segundos restantes`.
  - Fornecer através de `aria-label` no container do cronômetro com atualizações discretas.

### 3.5 Validação de Respostas e Avanço Manual (`ResultsScreen.tsx` & `game-room.ts`)
- **Respostas Válidas por Padrão**:
  - No backend, `passesLetterCheck(value, letter)` já garante a validade inicial.
  - No frontend, remover o botão redundante "Válida".
  - O único botão interativo de voto para respostas de outros jogadores é `"Invalidar"` (com toggle para cancelar a invalidação caso o jogador mude de ideia).
- **Avanço Manual de Categoria**:
  - Adicionar comando `{ type: 'round:review:next'; roundId: string }` no contrato `shared/types.ts`.
  - Backend `GameRoom`: ao receber `round:review:next` do Host ativo durante `CATEGORY_REVIEW`, chama imediatamente `this.completeCategoryReview(roundData, categoryIndex)`.
  - Frontend `ResultsScreen`: renderizar botão `"Próxima Palavra / Categoria"` para o Host ativo.
- **Foco ao Finalizar Revisão**:
  - Ao transitar para `ROUND_RESULTS`, focar programaticamente o cabeçalho do resumo de resultados (`tabIndex={-1}`) com anúncio `aria-live`.

### 3.6 Pódio: Replicar Configurações no "Jogar Novamente" (`PodiumScreen.tsx` & `App.tsx`)
- **Separar Callbacks**:
  - `onBackToHome`: limpa o estado e retorna para a tela inicial (`'início'`).
  - `onPlayAgain`:
    1. Preserva o apelido atual (`myNickname`) e avatar (`myAvatar`).
    2. Preserva as configurações da sala atual (`totalRounds`, `roundDurationSeconds`, `allowedLetters`, `categories`).
    3. Requisita nova sala (`POST /rooms`).
    4. Conecta via WebSocket criando a sala e aplicando as categorias e opções salvas.
    5. Direciona o jogador para a tela de Lobby (`'configuração'`) com o novo ID.

### 3.7 Responsividade Mobile (Tailwind & CSS)
- **Breakpoints**: Testar e ajustar regras para resoluções de 320px, 360px, 390px e 414px.
- **Formulários e Inputs**:
  - Tamanho de fonte `text-base` (16px) em inputs para prevenir zoom automático no Safari iOS.
  - Botões com altura mínima de 44px (`min-h-[44px]`).
  - Grade de PIN flexível com `gap-1 sm:gap-2` e `text-base sm:text-lg`.
  - Botão STOP posicionado de forma visível e de fácil toque.

---

## 4. Implementation Steps

### Fase 1: Contratos e Backend
1. Atualizar `shared/types.ts` com o comando `round:review:next`.
2. Adicionar o manipulador `handleRoundReviewNext` em `backend/src/game-room.ts`.
3. Validar avanço manual de categoria com testes unitários em `backend/src/test/game-room.test.ts`.

### Fase 2: Tela Inicial (`EntryScreen.tsx` & `App.tsx`)
1. Separar estados de avatar (`createAvatar`, `joinAvatar`).
2. Adaptar props para `pendingAction: 'create' | 'join' | null` e renderizar loading isolado.
3. Atualizar testes em `frontend/src/screens/EntryScreen.test.tsx`.

### Fase 3: Configuração do Lobby (`LobbyScreen.tsx`)
1. Transformar `selectedPack` em estado com `useState`.
2. Corrigir o atributo `aria-pressed` nos botões de packs ("Clássico", "Geek", "Expert").
3. Manter a estabilidade do foco removendo desativação em bloco de botões durante saves.
4. Atualizar testes em `frontend/src/screens/LobbyScreen.test.tsx`.

### Fase 4: Tela de Jogo - Animação, Regressiva e Cronômetro (`GameScreen.tsx`)
1. Implementar o overlay de animação do sorteio com roleta de letras.
2. Implementar a contagem regressiva de 3s antes da liberação dos campos.
3. Inserir anúncios via `aria-live` estritamente nos padrões solicitados.
4. Ajustar o cronômetro para que o leitor de telas vocalize a duração sem interpretar "meia-noite".
5. Atualizar testes em `frontend/src/screens/GameScreen.test.tsx`.

### Fase 5: Tela de Validação e Foco (`ResultsScreen.tsx`)
1. Ajustar interface de validação: palavras válidas por padrão, botão único para "Invalidar".
2. Inserir botão de avanço manual ("Próxima Palavra / Categoria") conectado ao backend.
3. Garantir transição e alocação de foco previsível ao finalizar a validação (`ROUND_RESULTS`).
4. Atualizar testes em `frontend/src/screens/ResultsScreen.test.tsx`.

### Fase 6: Pódio e Novo Jogo (`PodiumScreen.tsx` & `App.tsx`)
1. Separar `onPlayAgain` de `onBackToHome`.
2. Implementar fluxo de recriação de sala com preservação de apelido/avatar e replicação de configurações.
3. Atualizar testes em `frontend/src/screens/PodiumScreen.test.tsx`.

### Fase 7: Responsividade Mobile e Polimento Global
1. Ajustar estilos Tailwind em todas as telas para visualização em 320px a 480px.
2. Executar testes automatizados (unitários e de acessibilidade) em todo o frontend e backend.

# Feature Specification: Correções de Fluxo, Acessibilidade e Responsividade Mobile

**Feature Branch**: `004-gameplay-ux-a11y-fixes`  
**Created**: 2026-10-10  
**Status**: Draft  
**Input**: Correções de itens levantados na tela inicial, configuração do lobby, início da rodada, cronômetro acessível, validação de respostas, pódio e responsividade mobile.

---

## 1. Contexto e Diagnóstico

Durante a validação prática da aplicação com leitores de tela, dispositivos móveis e testes de usabilidade, foram identificados 8 gargalos críticos na experiência do usuário e na conformidade com diretrizes de acessibilidade (WCAG 2.1 AA) e usabilidade:

1. **Acoplamento de Estado na Tela Inicial (`EntryScreen`)**:
   - Os cards de "Criar Sala" e "Entrar em Sala" compartilham o mesmo estado de avatar (`selectedAvatar`) e a mesma flag de loading (`isLoading`), fazendo com que a seleção em um card reflita no outro e que ambos os botões exibam "Conectando..." simultaneamente ao clicar em "Criar Sala".
2. **Perda de Foco e Falhas de ARIA no Lobby (`LobbyScreen`)**:
   - Ao alterar configurações de categorias e rodadas, os botões tornam-se desabilitados durante o status pendente (`actionStatus === 'pending'`), forçando o navegador a descartar o foco para o `<body>`.
   - O estado do botão dos pacotes de categorias (`selectedPack`) foi implementado como variável local em vez de estado reativo, fazendo com que `aria-pressed` permaneça permanentemente inativo.
3. **Ausência de Animação e Sorteio Verbalizado no Início do Jogo (`GameScreen`)**:
   - O jogo entra abruptamente na rodada sem animação visual de impacto para o sorteio da letra e sem a contagem regressiva de 3 segundos ("3, 2, 1, STOP!").
   - A verbalização para leitores de tela não cumpre o formato padronizado ("sorteando letra", "letra sorteada: A", "Iniciando o jogo em: 3, 2, 1").
4. **Interpretação Incorreta do Cronômetro pelo Leitor de Telas (`GameScreen`)**:
   - A formatação `mm:ss` (ex.: `00:45`, `00:30`) é interpretada por sintetizadores de voz (NVDA, TalkBack, VoiceOver) como horários do dia ("meia-noite e 45", "meia-noite e meia") em vez de duração restante.
5. **Fluxo e Regra de Validação de Respostas (`ResultsScreen` & `GameRoom`)**:
   - Respostas iniciadas com a letra sorteada devem ser válidas por padrão. O voto dos jogadores deve ser exclusivamente para **invalidar** (ação opcional de contestação).
   - Não há controle para avançar para a próxima palavra/categoria sem aguardar o término total do timer da categoria (`reviewDeadline`).
6. **Perda de Foco ao Finalizar Validação (`ResultsScreen`)**:
   - Ao encerrar a revisão das categorias e transitar para a confirmação de pontuação da rodada, o foco é removido da visão do leitor de telas.
7. **Duplicidade de Ação no Pódio (`PodiumScreen`)**:
   - Ambos os botões "Jogar Novamente" e "Voltar ao Início" executam `handlePlayAgain` que descarta tudo e retorna para a tela inicial.
   - O botão "Jogar Novamente" deve criar uma nova sala automaticamente, preservar o apelido/avatar do jogador, replicar as configurações da sala anterior e abrir a tela de Lobby com o novo ID.
8. **Inconsistências de Layout em Dispositivos Móveis**:
   - Telas com quebra de layout, áreas de clique inferiores a 44x44px e elementos sem scroll apropriado em telas pequenas (320px a 480px).

---

## 2. User Scenarios & Acceptance Criteria

### User Story 1 - Isolamento de Estado na Tela Inicial (Priority: P1)
Como usuário na tela inicial, quero que o formulário de "Criar Sala" e o formulário de "Entrar em Sala" operem de forma independente, para que minha escolha de avatar ou clique no botão de criar sala não afete visualmente o componente de entrar em sala.

**Acceptance Criteria**:
1. **Given** que o usuário está na tela inicial, **When** seleciona um avatar no card "Criar Sala", **Then** o avatar no card "Entrar em Sala" permanece inalterado.
2. **Given** que o usuário clica no botão "Criar Sala e Convidar Amigos", **When** a requisição entra em processamento, **Then** apenas o botão de criar sala exibe o indicador de carregamento e estado desabilitado; o botão "Entrar no Jogo Agora" permanece em seu estado padrão e habilitado.
3. **Given** que o usuário clica no botão "Entrar no Jogo Agora", **When** a conexão é iniciada, **Then** apenas o botão de entrar na sala exibe o estado de carregamento.

---

### User Story 2 - Acessibilidade e Estabilidade de Foco no Lobby (Priority: P1)
Como usuário que utiliza leitor de telas na tela de configuração da sala, quero navegar e alterar categorias, rodadas e tempo sem perder o foco do elemento ativo e com retorno fidedigno do estado dos pacotes de categorias.

**Acceptance Criteria**:
1. **Given** que o leitor de telas está focado em um item de configuração (botão de rodada, tempo, adição/remoção de categoria), **When** o usuário aciona a alteração, **Then** o foco programático permanece no controle acionado ou em seu substituto direto sem saltar para o topo da página ou para `<body>`.
2. **Given** os botões de pacotes de categoria ("Clássico", "Geek/Pop", "Expert"), **When** o pacote ativo é selecionado, **Then** o atributo `aria-pressed="true"` é aplicado e verbalizado corretamente pelo leitor de tela.
3. **Given** a confirmação de alteração pelo servidor, **When** o evento de atualização é recebido, **Then** uma mensagem suave é anunciada via região `aria-live="polite"` sem interromper o foco da navegação por teclado.

---

### User Story 3 - Animação de Impacto e Contagem Regressiva Acessível (Priority: P1)
Como jogador ao iniciar a partida, quero presenciar uma animação visual impactante do sorteio da letra e uma contagem regressiva de 3 segundos antes do início da digitação, para criar expectativa e garantir que todos comecem exatamente ao mesmo tempo, com verbalização precisa para acessibilidade.

**Acceptance Criteria**:
1. **Given** que a rodada é iniciada, **When** a tela do jogo é exibida, **Then** uma animação de sorteio da letra entra em execução imediata (efeito de rolagem/destaque de letra).
2. **Given** a execução da animação de sorteio, **When** o leitor de tela está ativo, **Then** a região `aria-live="assertive"` anuncia estritamente `"sorteando letra"`.
3. **Given** que a letra é definida na animação, **When** o sorteio se conclui, **Then** o sistema anuncia `"letra sorteada: {LETRA}"` e dispara uma contagem regressiva visual de 3 segundos ("3, 2, 1").
4. **Given** a contagem regressiva, **When** os segundos decrescem, **Then** o leitor de tela verbaliza o formato `"Iniciando o jogo em: 3"`, `"2"`, `"1"`.
5. **Given** o término da contagem (0 segundos), **When** o jogo é liberado, **Then** o cronômetro da rodada é iniciado, os campos de preenchimento são habilitados para digitação e o foco é automaticamente colocado no primeiro campo de categoria.

---

### User Story 4 - Leitura Acessível da Duração Restante da Rodada (Priority: P1)
Como usuário de leitor de telas durante o jogo, quero que o cronômetro seja anunciado como tempo restante em segundos/minutos e não como hora do relógio ("meia-noite").

**Acceptance Criteria**:
1. **Given** o cronômetro decrescente na tela de jogo, **When** o tempo restante for lido pelo leitor de telas, **Then** a leitura verbaliza `"X minutos e Y segundos restantes"` ou `"X segundos restantes"`.
2. **Given** o elemento visual que exibe o formato `mm:ss` (ex.: `00:45`), **When** inspecionado por tecnologia assistiva, **Then** o elemento possui `aria-hidden="true"` para evitar a interpretação de hora do dia.
3. **Given** momentos críticos do tempo (ex.: 10 segundos restantes), **When** o tempo atinge o limiar, **Then** um alerta acessível curto avisa `"10 segundos restantes"` sem poluir a digitação nos campos.

---

### User Story 5 - Validação por Invalidação Opcional e Avanço Manual (Priority: P1)
Como participante da fase de validação, quero que todas as palavras com a letra correta sejam aceitas por padrão e que o voto seja apenas para contestar/invalidar, com um botão que permita avançar manualmente para a próxima palavra sem esperar o timer esgotar.

**Acceptance Criteria**:
1. **Given** que os jogadores enviaram respostas na rodada, **When** a fase de validação se inicia, **Then** todas as respostas que possuem inicial igual à letra sorteada já nascem marcadas como **válidas** por padrão.
2. **Given** uma resposta na tela de validação, **When** outro jogador analisa o item, **Then** a interface apresenta um botão opcional `"Invalidar"` (com toggle de anulação do voto); não é obrigatório registrar voto "válida".
3. **Given** a tela de revisão de categoria, **When** o anfitrião (Host) ou jogadores clicam no botão `"Próxima Categoria / Palavra"`, **Then** a revisão avança imediatamente para a categoria seguinte sem necessitar esperar o timer de 15 segundos expirar.
4. **Given** a última categoria em revisão, **When** o avanço é acionado, **Then** o sistema computa os placares e transita para o resumo da rodada (`ROUND_RESULTS`).

---

### User Story 6 - Manutenção de Foco após Confirmação dos Resultados (Priority: P2)
Como usuário cego ou com baixa visão ao concluir a validação, quero que o foco do sistema seja movido de forma previsível para o resumo dos resultados da rodada, para que eu possa acompanhar minha pontuação e a próxima ação.

**Acceptance Criteria**:
1. **Given** que todas as categorias da rodada foram validadas, **When** o servidor transita para o estado `ROUND_RESULTS`, **Then** o leitor de telas anuncia a confirmação dos resultados e o foco é automaticamente alocado no título `<h1>` do resumo da rodada com `tabIndex={-1}`.
2. **Given** que o usuário é o Host da sala, **When** os resultados são exibidos, **Then** a navegação por tabulação alcança prontamente o botão `"Próxima Rodada"`.
3. **Given** que o usuário é um participante convidado, **When** os resultados são exibidos, **Then** o leitor de telas informa claramente o status de espera do anfitrião.

---

### User Story 7 - Reinício Inteligente no Pódio ("Jogar Novamente") (Priority: P1)
Como jogador no pódio final, quero que o botão "Jogar Novamente" crie uma nova sala preservando meu apelido, avatar e configurações anteriores, enquanto o botão "Voltar ao Início" me leve de volta à página inicial limpa.

**Acceptance Criteria**:
1. **Given** que a partida terminou e o pódio final é exibido, **When** o usuário clica em `"Voltar ao Início"`, **Then** a sessão da sala é descartada e o usuário retorna à tela inicial (`'início'`).
2. **Given** que a partida terminou, **When** o usuário clica em `"Jogar Novamente"`, **Then**:
   - Uma nova sala é requisitada à API (`POST /rooms`) gerando um novo código de sala.
   - O apelido e o avatar utilizados na partida encerrada são reutilizados sem necessidade de nova digitação.
   - As configurações da partida (categorias customizadas, número de rodadas, tempo de rodada, letras permitidas) são replicadas para a nova sala.
   - O usuário é levado diretamente para a tela de **Lobby / Configuração** (`'configuração'`), atuando como Host na nova sala e pronto para compartilhar o novo link/PIN.

---

### User Story 8 - Responsividade Mobile Completa (Priority: P1)
Como usuário acessando pelo smartphone (telas de 320px a 480px), quero que todas as telas, formulários, botões e tabelas se adaptem perfeitamente ao tamanho da tela sem rolagem horizontal indesejada e com alvos de toque adequados.

**Acceptance Criteria**:
1. **Given** um dispositivo móvel com viewport vertical (ex.: 360x780 ou 390x844), **When** qualquer uma das 5 telas (`EntryScreen`, `LobbyScreen`, `GameScreen`, `ResultsScreen`, `PodiumScreen`) é renderizada, **Then** nenhum elemento transborda a largura da tela (`overflow-x: hidden`).
2. **Given** a tela inicial no mobile, **When** os cards são exibidos, **Then** eles se empilham verticalmente em coluna única e o teclado virtual não esconde botões primários.
3. **Given** a grade de dígitos PIN (6 caracteres), **When** visualizada em celular estreito (320px-360px), **Then** os inputs mantêm espaçamento legível e tamanho mínimo de toque de 44x44px.
4. **Given** a tela de jogo (`GameScreen`) no mobile, **When** o usuário digita respostas, **Then** o botão "STOP!" permanece destacado e acessível sem rolagem excessiva, com fonte de input mínima de 16px para evitar zoom automático no iOS Safari.
5. **Given** a tela de pódio (`PodiumScreen`) no mobile, **When** as colunas de 1º, 2º e 3º lugares são desenhadas, **Then** elas se ajustam proporcionalmente sem quebrar o layout nem sobrepor os nomes dos jogadores.

---

## 3. Requisitos Técnicos e Arquitetura de Componentes

### 3.1 Frontend (`frontend/src/`)
- **`screens/EntryScreen.tsx`**:
  - `createAvatar`: `useState<Avatar>(AVATAR_OPTIONS[0])`.
  - `joinAvatar`: `useState<Avatar>(AVATAR_OPTIONS[0])`.
  - Prop `pendingAction?: 'create' | 'join' | null` substituindo `isLoading` genérico.
- **`screens/LobbyScreen.tsx`**:
  - `selectedPack`: `useState<'classico' | 'geek' | 'expert' | null>`.
  - Eliminar desativação geral de botões via `disabled` quando `actionStatus === 'pending'` em edições pontuais (usar `aria-busy="true"` ou debounce visual).
  - Região de status `aria-live="polite"` sem desvio de foco.
- **`screens/GameScreen.tsx`**:
  - Estado de abertura de rodada: `phaseIntro: 'spinning' | 'countdown' | 'playing'`.
  - Contagem regressiva de 3s gerenciada localmente por `useEffect`/`setInterval`.
  - Desbloqueio dos inputs apenas quando `phaseIntro === 'playing'`.
  - Cronômetro: texto visual em `<span aria-hidden="true">{minutes}:{seconds}</span>` e `<span className="sr-only" aria-live="off">{accessibleDuration}</span>`.
- **`screens/ResultsScreen.tsx`**:
  - Respostas consideradas válidas por padrão se `answer.isValid === true`.
  - Interface com botão de alternância única: `"Contestar / Invalidar"`.
  - Botão `"Próxima Palavra"` acionando o avanço antecipado da categoria.
  - Alocação do foco para cabeçalho de resultados ao transitar para `ROUND_RESULTS`.
- **`screens/PodiumScreen.tsx` & `App.tsx`**:
  - `handlePlayAgain` separado de `handleBackToHome`.
  - Criação de nova sala, cópia de `RoomSettings` da sala anterior, preservação de `nickname` e `avatar`.
- **Estilos Globais e Responsividade (`index.css` e Tailwind)**:
  - Garantir `min-h-[44px]` e `min-w-[44px]` para todos os alvos de toque interativos.
  - Regra de inputs `text-base` (16px) no mobile para evitar zoom indesejado no Safari iOS.
  - Flex wraps e grids responsivos com `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`.

### 3.2 Backend & Protocolo (`backend/src/` e `shared/types.ts`)
- Novo comando de cliente:
  ```typescript
  | ({ type: 'round:review:next'; roundId: string } & CommandRequest)
  ```
- No `GameRoom`:
  - Tratar comando `round:review:next`: se enviado pelo Host durante `CATEGORY_REVIEW`, invoca imediatamente `this.completeCategoryReview(roundData, categoryIndex)`.
  - Garantir que `answer.isValid` seja inicializado com `passesLetterCheck(normalizedValue, roundData.letter)` e que apenas votos de invalidação alterem a validade se atingirem a maioria elegível.

---

## 4. Edge Cases e Tratamento de Erros

1. **Jogadores em Dispositivos Lentos durante a Contagem Regressiva de 3s**:
   - A contagem de 3s deve ser baseada no timestamp de início da rodada para manter sincronia aproximada entre clientes, ou compensar a contagem regressiva no frontend para que o tempo visual restante não desalinhe da deadline do servidor.
2. **Tentativa de Votar na Própria Palavra**:
   - O botão de invalidar deve continuar desabilitado/oculto para o autor da palavra.
3. **Múltiplos Cliques no Botão "Próxima Palavra"**:
   - Desabilitar o botão temporariamente após o clique para evitar requisições duplicadas até a resposta do servidor.
4. **Reconexão Durante a Animação de Sorteio**:
   - Se um jogador reconectar quando a rodada já estiver em andamento há mais de 3 segundos, ignorar a animação e ingressar direto na fase de preenchimento (`playing`).
5. **Criação de Nova Sala com Falha de Rede no Pódio**:
   - Exibir mensagem de erro amigável caso a chamada `POST /rooms` falhe, permitindo tentar novamente sem perder os dados da partida.

# Tasks: Correções de Fluxo, Acessibilidade e Responsividade Mobile

**Branch**: `004-gameplay-ux-a11y-fixes` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Task Checklist

### Fase 1: Contratos e Backend
- [x] **T-1.1**: Adicionar o comando `round:review:next` na união de tipos `ClientCommand` em `shared/types.ts`.
- [x] **T-1.2**: Implementar o handler `handleRoundReviewNext` no Durable Object `GameRoom` em `backend/src/game-room.ts` para permitir avanço antecipado de categoria pelo Host ativo.
- [x] **T-1.3**: Criar testes automatizados no backend em `backend/src/test/game-room.test.ts` cobrindo o avanço manual da revisão de categorias.

### Fase 2: Tela Inicial (`EntryScreen`)
- [x] **T-2.1**: Desacoplar o estado de seleção de avatares: criar `createAvatar` e `joinAvatar` independentes em `frontend/src/screens/EntryScreen.tsx`.
- [x] **T-2.2**: Substituir a prop booleana `isLoading` por `pendingAction: 'create' | 'join' | null` em `EntryScreen.tsx` e `frontend/src/App.tsx`.
- [x] **T-2.3**: Exibir estado de carregamento e desabilitar exclusivamente o botão acionado pelo usuário ("Criar Sala" ou "Entrar no Jogo").
- [x] **T-2.4**: Atualizar e adicionar testes unitários em `frontend/src/screens/EntryScreen.test.tsx`.

### Fase 3: Configuração do Lobby (`LobbyScreen`)
- [x] **T-3.1**: Converter `selectedPack` em estado com `useState<'classico' | 'geek' | 'expert' | null>` em `frontend/src/screens/LobbyScreen.tsx`.
- [x] **T-3.2**: Garantir que o atributo `aria-pressed` reflita fielmente o pacote selecionado ("Clássico", "Geek/Pop", "Expert").
- [x] **T-3.3**: Corrigir a retenção de foco nos controles de configuração: não desabilitar botões durante status pendente de sincronização para evitar que o navegador descarte o foco para o `<body>`.
- [x] **T-3.4**: Adicionar anúncios discretos via `aria-live="polite"` para confirmação de configurações salvas.
- [x] **T-3.5**: Atualizar testes em `frontend/src/screens/LobbyScreen.test.tsx`.

### Fase 4: Tela de Jogo (`GameScreen`)
- [x] **T-4.1**: Criar animação visual de impacto para sorteio da letra (efeito roleta / destaque) ao abrir a rodada em `frontend/src/screens/GameScreen.tsx`.
- [x] **T-4.2**: Implementar contagem regressiva de 3 segundos antes do início da rodada, mantendo os campos e o timer bloqueados durante a contagem.
- [x] **T-4.3**: Implementar acessibilidade do sorteio: verbalizar estritamente `"sorteando letra"` durante a animação e `"letra sorteada: {LETRA}"` ao definir a letra.
- [x] **T-4.4**: Implementar verbalização acessível da contagem no formato `"Iniciando o jogo em: 3"`, `"2"`, `"1"`.
- [x] **T-4.5**: Direcionar o foco programático para o primeiro campo de categoria assim que a contagem regressiva zerar.
- [x] **T-4.6**: Ajustar a leitura do tempo restante da rodada com `aria-label` descritivo ("X minutos e Y segundos restantes" / "X segundos restantes") e marcar o texto visual `mm:ss` com `aria-hidden="true"`.
- [x] **T-4.7**: Atualizar testes em `frontend/src/screens/GameScreen.test.tsx`.

### Fase 5: Validação de Respostas (`ResultsScreen`)
- [x] **T-5.1**: Tratar respostas preenchidas com inicial correspondente como válidas por padrão na interface de validação.
- [x] **T-5.2**: Modificar os controles de voto para exibir apenas a opção opcional `"Invalidar"` (com toggle de desmarcar).
- [x] **T-5.3**: Adicionar botão `"Próxima Palavra / Categoria"` para o Host avançar a revisão sem esperar o cronômetro expirar, disparando `round:review:next`.
- [x] **T-5.4**: Alocar o foco programático no cabeçalho do resumo dos resultados (`h1` com `tabIndex={-1}`) ao transitar para `ROUND_RESULTS`.
- [x] **T-5.5**: Atualizar testes em `frontend/src/screens/ResultsScreen.test.tsx`.

### Fase 6: Pódio e Fluxo de Novo Jogo (`PodiumScreen` & `App.tsx`)
- [x] **T-6.1**: Separar a ação de `"Voltar ao Início"` (limpa estado e redireciona para a tela inicial) da ação de `"Jogar Novamente"` em `frontend/src/screens/PodiumScreen.tsx` e `frontend/src/App.tsx`.
- [x] **T-6.2**: Implementar em `handlePlayAgain` a criação de uma nova sala (`POST /rooms`), mantendo o apelido e avatar anteriores do jogador.
- [x] **T-6.3**: Replicar as configurações da sala anterior (categorias, duração, letras permitidas, total de rodadas) na nova sala gerada e levar o usuário diretamente para o Lobby (`'configuração'`).
- [x] **T-6.4**: Atualizar testes em `frontend/src/screens/PodiumScreen.test.tsx`.

### Fase 7: Responsividade Mobile e Validação Final
- [x] **T-7.1**: Otimizar layouts e espaçamentos em Tailwind para telas de celular (320px a 480px) em todas as 5 telas do sistema.
- [x] **T-7.2**: Garantir área de toque mínima de 44x44px em todos os botões e tamanho de fonte de 16px em inputs móveis (prevenindo zoom indesejado no iOS).
- [x] **T-7.3**: Executar a suíte completa de testes no frontend (`npm test` em `frontend/`) e no backend (`npm test` em `backend/`) garantindo 100% de aprovação.

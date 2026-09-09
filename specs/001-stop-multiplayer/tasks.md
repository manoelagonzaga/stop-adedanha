# Tasks: Stop Multiplayer

Este documento descreve as tarefas de implementação técnica (Frontend, Backend e Realtime) baseando-se no `plan.md`, `spec.md` e `ui-spec.md`.

## 1. Configuração e Infraestrutura Base
- [x] **1.1. Setup do Frontend:** Iniciar um projeto React 19 + Vite + TypeScript (com TailwindCSS/estilização adequada).
- [x] **1.2. Setup do Backend:** Inicializar o projeto Cloudflare Workers com TypeScript (`wrangler init`).
- [x] **1.3. Contratos de Dados:** Criar a pasta e arquivos compartilhados (ex: `shared/types.ts`) contendo as interfaces dos eventos de WebSocket e modelos (Jogador, Sala, Resposta) referenciados em `contracts/realtime-events.md`.
- [x] **1.4. Configuração de Armazenamento:** Habilitar e configurar os Durable Objects e SQLite no `wrangler.jsonc`.

## 2. Implementação da UI (Design e Acessibilidade)
- [x] **2.1. Container e Fundo Animado:** Implementar o fundo com formas geométricas animadas (`@keyframes`) e garantir o suporte a `@media (prefers-reduced-motion: reduce)`.
- [x] **2.2. Componente de Placar (Sidebar):** Implementar o `<aside>` de Placar, usando Grid/Flex para ocupar 25% na lateral (desktop) ou empilhar em mobile, ordenado corretamente no DOM no fim da hierarquia do main content.
- [x] **2.3. Tela de Entrada:** Criar os inputs para "Seu Nome" e "Código da sala", incluindo validações básicas de HTML/React, usando labels explícitos.
- [x] **2.4. Tela de Espera e Configuração (Lobby da Sala):** 
  - Interface para exibir código da sala e lista de jogadores.
  - Painel de configuração de rodadas (input number) e de categorias (adicionar/remover itens) visível apenas para o Host, com *read-only* para os convidados.
  - Botão "Iniciar Jogo" protegido por permissão de anfitrião.
- [x] **2.5. Tela de Jogo (Rodada Ativa):** 
  - Criar o Cronômetro com suporte a leitor de tela (`aria-live="polite"` focado apenas em milestones de tempo).
  - Criar o efeito (ou transição seca, se modo reduced-motion) para exibição da Letra Sorteada.
  - Criar o componente visual de Categorias (Formulário) onde cada linha possui Pílula (letra), Label e Input de texto.
  - Implementar o grande botão "STOP!".
- [x] **2.6. Tela de Votação/Resultados:** Exibir a lista de respostas e categorias de todos os jogadores; implementar os botões de invalidação.

## 3. Lógica do Backend e Durable Objects (Autoridade do Servidor)
- [ ] **3.1. Gerenciamento de Conexão WebSocket:** No Durable Object, lidar com `onConnect`, `onMessage`, `onClose` para registrar jogadores temporariamente.
- [ ] **3.2. Criação de Sala e Configuração:** Lógica para criação de código de sala, limitação de até 20 jogadores, recebimento da configuração de categorias pelo anfitrião.
- [ ] **3.3. Máquina de Estados da Partida:**
  - `WAITING_PLAYERS` -> `CONFIGURING` -> `ROUND_ACTIVE` -> `VOTING` -> `ROUND_RESULTS` -> `GAME_OVER`.
- [ ] **3.4. Motor de Cronômetro e Botão Stop:** Interromper a rodada e disparar `END_ROUND` imediatamente quando um jogador enviar o gatilho de "Stop" ou os 20s/categoria se esgotarem.
- [ ] **3.5. Engine de Validação Primária:** Conferir no backend se a string de cada categoria começa com a Letra Sorteada e não é vazia.
- [ ] **3.6. Engine de Pontuação Base:** Dar 10 pontos para resposta válida única, 5 pontos para repetida, 0 para vazia/inválida.
- [ ] **3.7. Votação de Invalidação:** Calcular a porcentagem de votos dos demais (entre 10% e 50% corta pela metade, acima de 50% zera). Fim da votação pós-30 segundos.

## 4. Integração (Frontend x Backend)
- [ ] **4.1. Hook de WebSocket:** Construir em React o hook/provider (ex: `useMultiplayerRoom()`) para escutar e emitir ações pela conexão WSS para a Cloudflare Worker.
- [ ] **4.2. Sincronização de Estado:** Conectar os eventos WSS (como `ROUND_STARTED`, `TIMER_TICK`, `PLAYER_SCORED`) às atualizações da UI.
- [ ] **4.3. Tratamento de Exceções/Desconexões:** Mostrar alerta visual claro e semântico se a conexão cair, o nickname for duplicado, ou a sala não existir.

## 5. Testes e Estabilidade
- [ ] **5.1. Testes Unitários de Pontuação:** Usar `Vitest` no backend para garantir que as regras de pontuação (única, repetida, porcentagem de invalidação) nunca quebram.
- [ ] **5.2. Teste de Acessibilidade (A11y):** Teste manual com leitor de tela (NVDA/VoiceOver) ou com axe-core para garantir que tudo no DOM possui rótulo correto.
- [ ] **5.3. Teste Integrado (Wrangler/Local):** Executar múltiplas abas simulando o botão Stop concorrente para garantir propagação do socket para todos abaixo de 3 segundos.


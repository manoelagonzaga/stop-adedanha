# Tasks: Stop Multiplayer

Este documento descreve as tarefas de implementação técnica (Frontend, Backend e Realtime) baseando-se no `plan.md`, `spec.md` e `ui-spec.md`.

## 1. Configuração e Infraestrutura Base
- [x] **1.1. Setup do Frontend:** Iniciar um projeto React 19 + Vite + TypeScript (com TailwindCSS/estilização adequada).
- [x] **1.2. Setup do Backend:** Inicializar o projeto Cloudflare Workers com TypeScript (`wrangler init`).
- [x] **1.3. Contratos de Dados:** Criar a pasta e arquivos compartilhados (ex: `shared/types.ts`) contendo as interfaces dos eventos de WebSocket e modelos (Jogador, Sala, Resposta) referenciados em `contracts/realtime-events.md`.
- [x] **1.4. Configuração de Armazenamento:** Habilitar e configurar os Durable Objects e SQLite no `wrangler.jsonc`.

## 2. Implementação da UI (Design e Acessibilidade)
- [x] **2.1. Container e Fundo Animado:** Implementar o fundo com formas geométricas animadas (`@keyframes`) e garantir o suporte a `@media (prefers-reduced-motion: reduce)`.
- [x] **2.2. Componente de Placar (Sidebar):** Implementar o `<aside>` de Placar, posicionado na coluna direita na rodada e na avaliação, ou empilhado linearmente em mobile.
- [x] **2.3. Tela de Entrada:** Criar os inputs para "Seu Nome" e "Código da sala", incluindo validações básicas de HTML/React, usando labels explícitos.
- [x] **2.4. Tela de Espera e Configuração (Lobby da Sala):**
  - Interface com código da sala em destaque.
  - Painel de configuração de rodadas e de categorias (adicionar/remover/sugestões) editável pelo anfitrião.
  - Botão "Iniciar Jogo" protegido por permissão de anfitrião.
  - **✅ Regra aplicada:** NÃO exibe placar nem lista de jogadores nesta tela.
- [x] **2.5. Tela de Jogo (Rodada Ativa):**
  - **✅ Letra Sorteada** posicionada na coluna direita, acima do placar.
  - Área principal com cabeçalho (round/cronômetro) e formulário com inputs de categorias.
  - **✅ Botão STOP** posicionado imediatamente após a seção de categorias.
- [x] **2.6. Tela de Validação Sequencial por Categoria:**
  - **✅ Fluxo categoria por categoria** com abas e navegação Anterior/Próxima.
  - Exibe todos os termos inseridos para a categoria em avaliação.
  - Sistema de contestação com toggle por clique (ausência de voto = concordância).
  - Cronômetro regressivo controlado pelo backend via `reviewDeadline`.
  - **✅ Placar parcial** no lado direito, atualizado a cada categoria finalizada.
- [x] **2.7. Tela de Resultado Final com Pódio Centralizado:**
  - **✅ Placar em destaque no centro** da tela.
  - **✅ Pódio animado** para 1º (ouro + coroa), 2º (prata), 3º (bronze), com alturas escalonadas.
  - **✅ Lista dos demais** (4º em diante) com avatar, nome e total de pontos.
  - **✅ Total de pontos** exibido em todas as posições.

## 3. Lógica do Backend e Durable Objects (Autoridade do Servidor)
- [x] **3.1. Gerenciamento de Conexão WebSocket:** `onConnect` (`webSocketMessage`), `onClose` (`webSocketClose`), `onError` (`webSocketError`) com suporte a hibernação via `state.acceptWebSocket` e `state.getWebSockets()`.
- [x] **3.2. Criação de Sala e Configuração:** `room:create` gera código aleatório de 6 chars; `room:join` valida nickname duplicado e suporta rejoin; `lobby:categories:update` e `lobby:rounds:update` protegidos por permissão de host.
- [x] **3.3. Máquina de Estados da Partida:** `WAITING_PLAYERS` → `CONFIGURING` → `ROUND_ACTIVE` → `CATEGORY_REVIEW` (iteração sequencial por categoria com Alarm API) → `ROUND_RESULTS` → `GAME_OVER`.
- [x] **3.4. Motor de Cronômetro e Botão Stop:** `round:stop` congela imediatamente para quem grita STOP; Alarm API expira o round automaticamente pelo `roundDeadline`; transição para `CATEGORY_REVIEW` da categoria 0.
- [x] **3.5. Engine de Validação Primária:** No `computeCategoryScores`, resposta vazia → 0 pts automático. A validação de letra inicial é feita no frontend (indicador visual) e reforçada na fase de contestação do backend.
- [x] **3.6. Engine de Pontuação Base:** +10 pts para resposta válida única, +5 pts para repetida, 0 para vazia/invalidada. Bônus de velocidade: +10 pts para quem gritou STOP primeiro.
- [x] **3.7. Votação Sequencial por Categoria e Placar Incremental:**
  - Alarm API controla o deadline de cada categoria (`REVIEW_CATEGORY_DURATION_MS = 30s`).
  - `answer:invalidate` coleta votos; maioria simples (>50%) invalida a resposta.
  - `round:review:score_update` transmite placar incremental após cada voto.
  - Broadcast de `round:review:category` antes de avançar para o próximo tema.
- [x] **3.8. Emissão de Resultados Finais:** `game:final_results` emitido após última rodada com `podium` (top 3 com tier gold/silver/bronze) e `list` (demais com posição e score).

## 4. Integração (Frontend x Backend)
- [x] **4.1. Hook de WebSocket:** `useGameSocket.ts` + `useGameState()` em `frontend/src/hooks/useGameSocket.ts`. Reconexão automática (3s), proxy Vite `/rooms/*` → `localhost:8787`.
- [x] **4.2. Sincronização de Estado:** `App.tsx` escuta `room:state`, `round:started`, `round:review:category`, `round:review:score_update`, `game:final_results` e navega entre telas automaticamente.
- [x] **4.3. Tratamento de Exceções/Desconexões:** Badge de status de conexão ("Conectando..." / "Conexão perdida") no canto superior direito. Eventos `error` do servidor tratados no hook. `player:presence` notifica desconexões de jogadores.

## 5. Testes e Estabilidade
- [ ] **5.1. Testes Unitários de Pontuação:** Usar `Vitest` no backend para garantir que as regras de pontuação (única, repetida, porcentagem de invalidação e soma incremental por categoria) nunca quebrem.
- [ ] **5.2. Teste de Acessibilidade (A11y):** Teste com leitores de tela e navegação por teclado para garantir foco lógico após Stop, durante transições de categoria e no pódio final.
- [ ] **5.3. Teste Integrado (Wrangler/Local):** Simulação com múltiplos jogadores navegando a avaliação tema a tema e verificando a sincronização do placar lateral e resultado final, simulando o botão Stop concorrente para garantir propagação do socket para todos abaixo de 3 segundos.

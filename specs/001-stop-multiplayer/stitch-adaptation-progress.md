# Registro de Progresso: Adequação ao Protótipo Stitch (Stop! Online)

## 📋 Lista de Tarefas de Implementação

- [ ] **Tarefa 1: Tipografia, Fontes e Design System**
  - [ ] Importar Google Font `Outfit` (400 a 900) e `Material Symbols Outlined` em `frontend/index.html`.
  - [ ] Configurar tokens de cores do protótipo Stitch (`brand-indigo`, `brand-tomato`, `brand-emerald`, `brand-amber`, etc.) e animação `.animate-stop-btn` em `frontend/src/index.css`.

- [ ] **Tarefa 2: Componentes Globais (Header Universal e Feedback de Som/Toast)**
  - [ ] Criar `frontend/src/components/Header.tsx` com logo, status online, badge de sala `#STP-XXXX` com cópia de link, pill do jogador (avatar, nome, tag Host), toggle de áudio com Web Audio API e botão de saída.
  - [ ] Criar sistema de notificação flutuante (Toast) para feedbacks instantâneos.

- [ ] **Tarefa 3: Tela de Início (`EntryScreen.tsx`)**
  - [ ] Banner Hero: "Dedos ágeis, mentes rápidas: Grite STOP primeiro!".
  - [ ] Card 1 (Criar Sala Privada): Apelido, seletor de avatar com emojis (🦊, 🐙, 🐵, 🦁 + sortear), prévia de categorias com atalho para personalizar, botão de criar sala.
  - [ ] Card 2 (Entrar em Sala): Apelido, inputs para PIN de 6 dígitos com avanço automático e botão de colar, botão de entrar.
  - [ ] Seção "Como Jogar STOP! Online" com 3 cards explicativos das etapas clássicas.

- [ ] **Tarefa 4: Tela de Configuração da Sala / Lobby (`LobbyScreen.tsx`)**
  - [ ] **Regra do Usuário**: Placar e lista de jogadores NÃO são exibidos nesta etapa.
  - [ ] Topo com status de anfitrião ("VOCÊ É O HOST"), código da sala, botão de copiar link e botão de iniciar partida.
  - [ ] Card de Estrutura da Partida: Seleção de rodadas (3, 5, 8, 10) e tempo por rodada (60s, 90s, 120s, Sem Fim).
  - [ ] Card de Categorias da Partida: Botões de packs rápidos ("Clássico", "Geek/Pop", "Expert 🌶️"), tags das categorias ativas com botão de exclusão e input para nova categoria personalizada.
  - [ ] Card de Letras Permitidas: Grade interativa do alfabeto A-Z com exclusão/inclusão e botão "Bloquear Difíceis (K, W, Y, X, Z)".

- [ ] **Tarefa 5: Tela da Partida Ativa (`GameScreen.tsx`)**
  - [ ] **Regra do Usuário 1**: Botão de STOP posicionado **após a sessão de categorias**.
  - [ ] **Regra do Usuário 2**: Letra sorteada posicionada **do lado direito, diretamente acima do placar**.
  - [ ] Topo da rodada: Contador de rodadas ("Rodada X de Y") e Cronômetro decrescente com ícone animado.
  - [ ] Coluna esquerda: Lista de campos de digitação com numeração, tag, input em caixa alta, ícone de validação `check_circle` e atalho TAB.
  - [ ] Botão Gigante de STOP: Posicionado após as categorias com animação pulsante `.animate-stop-btn`, ícone `pan_tool` e aviso de risco/velocidade.
  - [ ] Coluna direita: Card da letra sorteada em destaque com botão de sortear outra (host) e Placar/Classificação ao vivo com barras de progresso do preenchimento de cada jogador.

- [ ] **Tarefa 6: Tela de Validação Sequencial por Categoria (`ResultsScreen.tsx`)**
  - [ ] **Regra do Usuário**: Validação sequencial realizada **uma categoria por vez**.
  - [ ] Cabeçalho com letra da rodada, aviso de quem bateu o STOP primeiro (+10 pts) e abas de categorias com status de progresso.
  - [ ] Cartões de respostas anônimas da categoria ativa com tags de pontuação (+10 exclusiva, +5 repetida, 0 em branco) e botão de alternância "Invalidar / Contestar" com contador de contestações.
  - [ ] Navegação: "Categoria Anterior", "Próxima Categoria" e "Encerrar e Ver Pódio / Próxima Rodada".
  - [ ] Coluna lateral direita: Placar parcial recalculado imediatamente conforme as categorias são validadas.

- [ ] **Tarefa 7: Tela de Pódio e Fim de Jogo (`PodiumScreen.tsx`)**
  - [ ] **Regra do Usuário**: Placar em destaque no centro; 1º, 2º e 3º em formato de pódio 3D; demais participantes em lista; **todas as posições com a pontuação total**.
  - [ ] Pódio tridimensional centralizado: 2º lugar (Prata), 1º lugar (Ouro com coroa animada), 3º lugar (Bronze), com avatars, nomes, títulos e total de pontos.
  - [ ] Lista dos demais participantes (4º lugar em diante) em tabela/lista centralizada com avatar, nome e total de pontos.
  - [ ] Cards de "Destaques Divertidos da Mesa" (Dicionário Humano, Dedo Veloz, Palavra Criativa, O Inquisidor).
  - [ ] Botões de ação para revanche ("Jogar Novamente") ou "Voltar ao Início".

- [ ] **Tarefa 8: Integração no `App.tsx`, Gestão de Estado e Validação de Build**
  - [ ] Integrar todos os componentes e telas com transições fluidas e barra de navegação/simulação.
  - [ ] Garantir compilação TypeScript limpa (`npm run build`) e dev server operacional.

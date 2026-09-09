# UI & Accessibility Specification: Stop Multiplayer

## 1. Identidade Visual e Estilo
- **Fundo (Background):** Fundo claro com gradiente suave e formas geométricas grandes e difusas que se movimentam de forma lenta e ambiente.
- **Superfícies:** Cartões brancos ou off-white (elevados) com sombras suaves (`box-shadow`) para separar as áreas de conteúdo do fundo.
- **Cores Principais:**
  - **Ação Principal:** Azul Marinho (ex: `#1E3A5F`) para botões de ação principal ("Entrar na sala", "Próxima rodada", botão Stop).
  - **Destaque/Ênfase:** Laranja (ex: `#E8613C`) para a letra sorteada, o ponto de exclamação no logo "STOP!" e para destacar o jogador líder no placar.
  - **Texto:** Cinza escuro/grafite para alta legibilidade; cinza claro para placeholders e rótulos secundários.
- **Tipografia:** Fonte sem serifa, limpa e geométrica. Uso de labels em letras maiúsculas e espaçadas (ex: "BEM-VINDO", "LETRA SORTEADA").

## 2. Estrutura de Layout e Responsividade
A aplicação deve ser *mobile-first*, adaptando-se para um layout de colunas em telas maiores (desktop/tablets grandes).

### Telas Largas (Desktop)
- **Área Principal do Jogo (Aprox. 75% da largura):** Centraliza os cartões de jogo (Lobby, Rodada Ativa, Votação/Resultado).
- **Área do Placar (Aprox. 25% da largura):** Uma barra lateral (sidebar) vertical fixa na lateral direita ou esquerda da tela. Isso atende ao requisito de ter o placar ocupando 1/4 da tela na vertical, permitindo que os jogadores acompanhem o ranking em tempo real sem perder o contexto do jogo.

### Telas Estreitas (Mobile)
- **Área Principal do Jogo (100% da largura):** Cartões ocupam a largura total.
- **Área do Placar:** O placar flui na sequência lógica da página, posicionando-se abaixo do conteúdo principal da rodada para não espremer o layout horizontalmente.

## 3. Animações e Movimento
As animações devem ser suaves para não distrair, mas devem respeitar a preferência do sistema operacional do usuário.
- **Sorteio da Letra:** Uma animação de "roleta" ou transição rápida ao revelar a nova letra.
- **Botão STOP!:** Um efeito de clique (scale) seguido de uma transição visual clara indicando o fim da rodada.
- **Fundo Animado:** Formas no fundo se movendo em um loop contínuo e suave usando CSS `@keyframes`.
- **Acessibilidade de Movimento (`prefers-reduced-motion: reduce`):** 
  - O fundo animado DEVE ser pausado ou substituído por uma imagem estática.
  - As animações do sorteio e do botão Stop DEVEM ser substituídas por trocas instantâneas de estado, evitando enjoo ou desconforto visual.

## 4. Acessibilidade (A11y) e Ordem do DOM
Para pessoas com deficiência visual usando leitores de tela, a ordem dos elementos no código (DOM) deve seguir a ordem lógica de interação. É muito importante não usar tabindex para mudar a ordem visual artificialmente; a ordem natural das tags HTML deve fazer sentido.

### Tela 1: Entrada
1. `<h1>` "Stop!"
2. `<p>` Mensagem de boas-vindas e instruções.
3. `<label>` explícita para o input "Seu nome" + `<input>`
4. `<label>` explícita para o input "Código da sala" + `<input>` + `<button>` "Nova"
5. `<button>` "Entrar na sala"
*Região ARIA (Live Region):* Anunciar mensagens de estado da conexão.

### Tela 2: Sala de Espera e Configuração (Lobby da Partida)
1. `<h2>` "Sala: [Código]" e indicação visual se o usuário é o anfitrião (Host) ou convidado.
2. **Quantidade de Rodadas:** Um `<input type="number">` com a `<label>` "Número de Rodadas" (editável apenas pelo anfitrião, *readonly* para os demais).
3. **Categorias da Partida:** 
   - Lista dinâmica de categorias (`<ul>`/`<li>`).
   - Botões de "Remover" categoria em cada item (com `aria-label` claro, ex: "Remover categoria Animais").
   - Campo para adicionar nova categoria + botão "Adicionar".
   - (Se não for o anfitrião, esta área é apenas leitura).
4. **Lista de Participantes:** `<ul>` exibindo quem já entrou na sala.
5. `<button>` "Iniciar Jogo" (Visível e clicável apenas pelo anfitrião).
*Região ARIA:* Anunciar "Novo jogador [Nome] entrou na sala" e "Categorias atualizadas".

### Tela 3: Rodada Ativa (Durante o Jogo)
1. **Cabeçalho da Rodada:** `<header>` contendo o round atual (ex: Round 02) e o Cronômetro.
   - *Cronômetro Acessível:* Usar `aria-live="polite"` para anunciar o tempo esporadicamente, limitando os anúncios (ex: avisar quando faltar 30s, 10s e 5s) para não sobrepor o leitor de tela enquanto a pessoa digita.
2. **Letra Sorteada:** `<h2>` Letra Sorteada: "S" (Deve ser anunciada imediatamente no início da rodada).
3. **Botão STOP!:** `<button>` com alta visibilidade e semântica clara.
4. **Formulário de Categorias:**
   - As perguntas devem estar em um `<form>` onde cada categoria possui uma `<label>` associada (pelo atributo `for` ou envolvendo o input) ao respectivo campo `<input type="text">`.
5. **Placar (Sidebar/Rodapé):** `<aside>` Placar. Semanticamente após as ações principais do jogo no DOM, para não obrigar o leitor de tela a ler todos os pontuadores repetidamente antes de chegar no formulário da rodada.

### Tela 3: Fim de Rodada / Resultados
1. `<h2>` "Rodada finalizada!"
2. `<p>` Mensagem de pontuação (ex: "Você marcou 0 pontos nesta rodada").
3. `<button>` "Próxima rodada" (se anfitrião).
4. Lista de categorias e visualização das respostas (para eventual invalidação).
5. `<aside>` Placar com as pontuações atualizadas em lista (`<ul>`/`<li>`).

## 5. Detalhamento de Componentes UI (Baseado nos Mockups)
- **Campos de Entrada (Inputs):** Bordas ligeiramente arredondadas, fundo levemente mais claro que o cartão, placeholders claros e anéis de foco (`:focus-visible`) que se destacam muito para quem navega por teclado (`Tab`).
- **Linha de Categoria (Rodada):** Uma pílula redonda com a primeira letra da categoria (ex: "A" para Animais), o nome e o campo de texto.
- **Cartão de Jogador (Placar):** 
  - Avatar circular com as iniciais.
  - Nome abreviado (ex: "Rafael B.").
  - Pontuação em destaque com número grande.
  - O líder ou jogador atual pode ser destacado com cores ou bordas.


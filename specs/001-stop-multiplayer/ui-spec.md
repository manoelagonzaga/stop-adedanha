# UI & Accessibility Specification: Stop Multiplayer

## 1. Identidade Visual e Estilo
- **Fundo (Background):** Fundo claro com gradiente suave e formas geométricas grandes e difusas que se movimentam de forma lenta e ambiente.
- **Superfícies:** Cartões brancos ou off-white (elevados) com sombras suaves (`box-shadow`) para separar as áreas de conteúdo do fundo.
- **Cores Principais:**
  - **Ação Principal:** Azul Marinho (ex: `#1E3A5F`) para botões de ação principal ("Entrar na sala", "Iniciar jogo", botão "STOP!").
  - **Destaque/Ênfase:** Laranja (ex: `#E8613C`) para a letra sorteada, o ponto de exclamação no logo "STOP!", badges de liderança e elementos de destaque do pódio.
  - **Pódio:** Dourado/Amarelo para 1º lugar, Prata/Cinza para 2º lugar e Bronze/Cobre para 3º lugar, integrados à paleta de destaque.
  - **Texto:** Cinza escuro/grafite para alta legibilidade; cinza claro para placeholders e rótulos secundários.
- **Tipografia:** Fonte sem serifa, limpa e geométrica. Uso de labels em letras maiúsculas e espaçadas (ex: "BEM-VINDO", "LETRA SORTEADA", "RODADA 01/03").

## 2. Estrutura de Layout e Responsividade
A aplicação é *mobile-first*, adaptando-se para layouts em colunas conforme a fase do jogo.

### Tela de Configuração da Sala (Lobby)
- **Regra:** O placar e a lista de jogadores **NÃO são exibidos** nesta tela, pois nessa etapa de configuração ainda não temos essas informações consolidadas.
- **Layout:** Focado exclusivamente nos parâmetros da partida:
  - Código da sala em destaque com ação de cópia.
  - Quantidade de rodadas (configurável pelo anfitrião).
  - Painel de categorias (selecionadas, adição de personalizadas, sugestões).
  - Botão principal de "Iniciar Jogo" (anfitrião).

### Telas da Rodada Ativa e Avaliação por Categorias (Desktop)
- **Área Principal do Jogo (Aprox. 70-75% da largura, à esquerda):**
  - **Na Rodada Ativa:** Cabeçalho da rodada com contador de rodada e cronômetro; formulário com as categorias e seus campos de texto; e o **botão STOP posicionado obrigatoriamente após a seção de categorias**.
  - **Na Avaliação por Categoria:** Barra de progresso da categoria atual (ex: "Categoria 1 de 5: Animais"), cronômetro de validação, lista de todos os termos inseridos pelos jogadores para a categoria em avaliação e botões para invalidação.
- **Barra Lateral Direita (Aprox. 25-30% da largura):**
  - **Na Rodada Ativa:** A **Letra Sorteada** fica posicionada no topo do lado direito, em grande destaque visual, **acima da seção de placar**. Logo abaixo da letra sorteada, posiciona-se a seção do Placar da partida.
  - **Na Avaliação por Categorias:** A seção de Placar permanece visível no lado direito, **refletindo em tempo real o cálculo já apurado** das categorias consolidadas até o momento.

### Telas da Rodada Ativa e Avaliação (Mobile)
- Em telas estreitas, a hierarquia lógica linear é mantida: Letra sorteada e cronômetro no topo, categorias e botão STOP logo abaixo, seguidos pelo placar no rodapé da página sem sobreposições.

### Tela de Resultado Final (Ranking Final da Partida)
- **Regra:** O placar deve ficar em **destaque, no centro da tela** (sem sidebar lateral, ocupando a área central de foco).
- **Estrutura Visual:**
  - **Pódio em Destaque:** 1º, 2º e 3º colocados em formato de pódio (ex: 2º lugar à esquerda, 1º lugar ao centro mais elevado com coroa/troféu, 3º lugar à direita), com avatares grandes, nicknames e **total de pontos efetuados**.
  - **Lista dos Demais Participantes:** Do 4º colocado em diante, dispostos em formato de lista ordenada logo abaixo do pódio, exibindo posição, nickname e **total de pontos efetuados**.
  - **Regra Geral de Pontos:** Todas as posições do resultado final (tanto no pódio quanto na lista) exibem o total acumulado de pontos conquistados pelo participante.

## 3. Animações e Movimento
- **Sorteio da Letra:** Animação de "roleta" rápida antes da revelação da letra sorteada.
- **Botão STOP!:** Efeito de escala ao pressionar, seguido de alerta imediato de encerramento para toda a sala.
- **Transição entre Categorias na Validação:** Efeito suave de transição deslizante quando uma categoria é apurada e a próxima entra em votação.
- **Revelação do Pódio:** Animação de entrada dos degraus do pódio (3º, 2º e finalmente 1º lugar) para celebração.
- **Acessibilidade (`prefers-reduced-motion: reduce`):** Animações decorativas e transições são desligadas ou substituídas por estados estáticos instantâneos.

## 4. Acessibilidade (A11y) e Ordem do DOM

### Tela 1: Entrada
1. `<h1>` "Stop!"
2. `<p>` Mensagem de boas-vindas e instruções.
3. `<label>` para "Seu nome" + `<input>`
4. `<label>` para "Código da sala" + `<input>` + `<button>` "Nova sala"
5. `<button>` "Entrar na sala"

### Tela 2: Sala de Espera e Configuração (Lobby da Partida)
> *Nota: Não exibir placar nem lista de jogadores nesta tela.*
1. `<h2>` "Sala: [Código]" e indicador de status (Anfitrião / Convidado).
2. **Quantidade de Rodadas:** `<input type="number">` com `<label>` "Número de Rodadas" (editável apenas pelo anfitrião).
3. **Categorias da Partida:**
   - Lista dinâmica de categorias (`<ul>`/`<li>`).
   - Botões de remoção de categoria (se anfitrião).
   - Campo para adicionar nova categoria + botão "Adicionar".
   - Botões de sugestões rápidas de temas.
4. `<button>` "Iniciar Jogo" (apenas anfitrião).

### Tela 3: Rodada Ativa (Durante o Jogo)
1. **Área Principal:**
   - **Cabeçalho:** Rodada atual (ex: "Round 02/04") e Cronômetro da rodada (`aria-live="polite"` para milestones).
   - **Formulário de Categorias:** `<form>` contendo cada categoria com label associada e seu respectivo `<input type="text">`.
   - **Botão STOP!:** `<button>` posicionado **imediatamente após a seção de categorias**, com alta visibilidade.
2. **Coluna Lateral Direita:**
   - **Letra Sorteada:** `<h2>` Letra Sorteada em grande destaque, posicionada no topo da coluna direita (anunciada de imediato via `aria-live="assertive"`).
   - **Placar da Partida:** `<aside>` Placar posicionado logo abaixo da letra sorteada, exibindo pontuação acumulada dos jogadores.

### Tela 4: Validação por Categoria (Avaliação Sequencial dos Temas)
*Fluxo: Avaliação individual de um tema por vez.*
1. **Área Principal:**
   - **Cabeçalho da Validação:** Título com número da categoria (ex: "Categoria 1 de 5: Animais") e cronômetro regressivo da categoria.
   - **Painel de Termos Submetidos:** Lista com todos os termos preenchidos pelos jogadores para a categoria em avaliação.
   - **Ações de Invalidação:** Botão "Invalidar" disponível para contestar respostas de outros jogadores (não exibido para a própria resposta do jogador).
   - **Status de Votação:** Indicador de jogadores que já concluíram a validação da categoria atual.
2. **Coluna Lateral Direita:**
   - **Placar Parcial em Tempo Real:** `<aside>` Placar refletindo o cálculo já apurado até a categoria atual. A cada categoria validada, a pontuação é recalculada e somada no placar em tempo real.

### Tela 5: Resultado Final (Ranking da Partida)
*Exibida após a conclusão de todas as categorias da última rodada.*
1. **Cabeçalho:** `<h1>` ou `<h2>` "Resultado Final da Partida!" com resumo geral de rodadas.
2. **Placar em Destaque Central:**
   - **Pódio dos Vencedores (1º, 2º e 3º lugares):**
     - Estrutura visual em 3 degraus com destaque diferenciado (ouro, prata e bronze).
     - Informações obrigatórias de cada degrau: Avatar/Iniciais, Posição no Pódio, Nickname e **Total de Pontos Efetuados**.
   - **Lista dos Demais Participantes (4º lugar em diante):**
     - Lista vertical (`<ol start="4">` ou `<ul>`) com cada participante exibindo sua posição ordinal, nickname e **Total de Pontos Efetuados**.
3. **Ações:** Botão "Jogar Novamente" ou "Voltar ao Início".

## 5. Detalhamento de Componentes UI
- **Botão STOP!:** Botão proeminente estilizado em azul marinho com exclamação laranja, com estados de hover, active e foco destacados, localizado imediatamente abaixo do bloco de categorias.
- **Card da Letra Sorteada:** Cartão compacto no topo da coluna lateral direita com tipografia gigante (display), contrastando com a cor de ênfase laranja.
- **Pódio:** Cartões elevados com bordas ou gradientes temáticos para 1º (ouro), 2º (prata) e 3º (bronze), com altura visual proporcional ao degrau e exibição destacada do score total.
- **Placar Lateral:** Lista compacta com avatares circulares, nicknames e pontuações consolidadas até o momento.


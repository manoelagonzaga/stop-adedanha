# Feature Specification: Stop Multiplayer

**Feature Branch**: `001-stop-multiplayer`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Criar um jogo web multiplayer chamado Stop, com salas acessíveis por código compartilhável, sem login, nickname obrigatório, categorias sugeridas e personalizáveis, respostas, pontuação e ranking temporário por sala."

## Clarifications

### Session 2026-09-08

- Q: Qual regra de pontuação deve ser usada quando a rodada terminar? → A: 10 pontos para resposta válida e exclusiva; 5 pontos para resposta válida repetida; 0 para resposta vazia ou inválida.
- Q: Quantos jogadores devem ser permitidos em uma sala no MVP? → A: Até 20 jogadores.
- Q: Quanto tempo deve durar cada rodada para os jogadores enviarem suas respostas? → A: 20 segundos por categoria, totalizados para a rodada; o botão Stop encerra a rodada imediatamente para todos.
- Q: Como respostas devem ser validadas? → A: Validar automaticamente primeira letra e preenchimento; permitir apenas votos de invalidação dos demais jogadores, considerando a ausência de voto como concordância e aplicando o percentual também à avaliação de unicidade.
- Q: Como a partida deve definir sua duração? → A: O anfitrião informa a quantidade de rodadas na configuração da sala antes de iniciar.

### Session 2026-09-26

- Q: O placar e a lista de jogadores devem ser exibidos na tela de configuração da sala? → A: Não. Na tela de configuração da sala o placar e a lista de jogadores NÃO devem ser exibidos, pois ainda não teremos essa informação consolidada nesta etapa preliminar.
- Q: Onde devem ficar o botão Stop e a letra sorteada na tela de jogo? → A: Na tela do game, o botão de Stop deve ficar posicionado após a seção de categorias. A letra sorteada deve ficar posicionada do lado direito, logo acima da seção de placar.
- Q: Como deve funcionar o fluxo de validação dos temas/categorias? → A: A validação é feita uma categoria de cada vez. Quando a fase de respostas termina (por Stop ou tempo limite), passa-se para a Categoria 1 com todos os termos inseridos pelos jogadores. Todos validam (ou invalidam) e a pontuação dessa categoria é calculada. Em seguida, passa-se para a Categoria 2 (após todos votarem ou o tempo exceder), exibindo seus termos e calculando os pontos, repetindo sucessivamente até a última categoria. Durante todo o tempo de avaliação, a seção do placar fica no lado direito refletindo o cálculo já apurado.
- Q: Como deve ser estruturada a tela de resultado final? → A: Na tela de resultado final, o placar deve ficar em destaque no centro da tela. O 1º, 2º e 3º colocados devem ter destaque em formato de pódio. Os demais participantes devem ser exibidos em formato de lista. Todas as posições (pódio e lista) devem obrigatoriamente exibir o total de pontos efetuados pelo participante.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar e entrar em uma sala (Priority: P1)

Como jogador, quero criar uma sala ou entrar em uma sala existente usando um código compartilhável, informar meu nickname e aguardar a configuração para começar uma partida com outras pessoas.

**Why this priority**: A sala é a unidade básica da experiência multiplayer; sem ela, nenhuma partida pode acontecer.

**Independent Test**: Criar uma sala em uma janela, copiar o código, entrar com outro jogador em uma segunda janela e confirmar que ambos se conectam à mesma sala com nicknames distintos.

**Acceptance Scenarios**:

1. **Given** que o jogador está na tela inicial, **When** ele cria uma sala e informa um nickname válido, **Then** uma sala é criada, um código é exibido e o jogador entra na sala.
2. **Given** que uma sala existente está disponível, **When** outro jogador informa o código e um nickname válido, **Then** ele entra na sala com sucesso.
3. **Given** que o nickname já está sendo usado na sala, **When** o jogador tenta entrar, **Then** o sistema rejeita o nickname e solicita outro.
4. **Given** que o código informado não corresponde a uma sala ativa, **When** o jogador tenta entrar, **Then** o sistema informa que a sala não foi encontrada.

---

### User Story 2 - Configurar categorias e iniciar uma partida (Priority: P1)

Como anfitrião, quero escolher categorias sugeridas, personalizá-las e informar a quantidade de rodadas em uma tela focada exclusivamente nas definições da partida (sem placar e sem lista de jogadores) antes do jogo iniciar.

**Why this priority**: A configuração define os parâmetros e temas de cada rodada antes das respostas começarem, sem distrações preliminares.

**Independent Test**: Em uma sala ativa, verificar que o placar e a lista de jogadores não aparecem na tela de configuração; adicionar, remover e editar categorias, definir a quantidade de rodadas, iniciar a partida e confirmar que a configuração é aplicada.

**Acceptance Scenarios**:

1. **Given** que o anfitrião está na tela de configuração da sala, **When** a tela é carregada, **Then** são exibidos apenas o código da sala, a quantidade de rodadas e as categorias, sem exibir placar e sem exibir lista de jogadores.
2. **Given** que o anfitrião está configurando a partida, **When** ele adiciona, edita ou remove uma categoria, **Then** a lista atualizada não contém categorias vazias ou duplicadas.
3. **Given** que a sala tem categorias válidas, **When** o anfitrião inicia a partida, **Then** todos recebem a mesma letra sorteada e a mesma lista de categorias da rodada.
4. **Given** que a configuração não possui nenhuma categoria válida, **When** o anfitrião tenta iniciar a partida, **Then** o sistema impede o início e informa que pelo menos uma categoria é necessária.
5. **Given** que a quantidade de rodadas não foi informada ou está fora do limite permitido, **When** o anfitrião tenta iniciar a partida, **Then** o sistema impede o início e informa o valor esperado.

---

### User Story 3 - Responder, validar categoria por categoria e acompanhar ranking com pódio (Priority: P1)

Como jogador, quero responder às categorias com a letra no lado direito acima do placar e o botão STOP após as categorias, validar os termos inseridos uma categoria de cada vez acompanhando o placar parcial à direita e visualizar a tela de resultado final com pódio no centro.

**Why this priority**: Responder, validar sequencialmente de forma transparente e celebrar os vencedores no pódio constitui o ciclo completo do jogo.

**Independent Test**: Executar uma rodada, verificar o layout (letra acima do placar à direita e botão STOP abaixo das categorias), validar categoria por categoria com atualização do placar lateral e conferir o resultado final com pódio no centro e pontos em todas as posições.

**Acceptance Scenarios**:

1. **Given** que uma rodada está ativa, **When** o jogador observa a tela de jogo, **Then** a letra sorteada é exibida no lado direito acima da seção de placar, as categorias estão na área principal e o botão Stop fica posicionado após a seção de categorias.
2. **Given** que a rodada está ativa, **When** qualquer jogador pressiona o botão Stop ou o tempo limite total se esgota, **Then** a fase de respostas é encerrada imediatamente para todos os participantes.
3. **Given** que a fase de respostas encerrou, **When** tem início a avaliação, **Then** o sistema exibe a Categoria 1 com todos os termos inseridos por todos os participantes para essa categoria.
4. **Given** que a Categoria 1 está em avaliação, **When** os jogadores votam (invalidando termos de outros ou concordando por omissão) e todos votam ou o tempo da categoria expira, **Then** a pontuação dessa categoria é calculada e o placar lateral direito é atualizado com o valor já apurado.
5. **Given** que a Categoria 1 foi concluída, **When** o sistema avança para a Categoria 2, **Then** são exibidos todos os termos inseridos para a Categoria 2, todos validam e a pontuação é apurada e somada ao placar lateral, repetindo sucessivamente até a última categoria configurada.
6. **Given** que a última categoria da última rodada foi apurada, **When** a partida é finalizada, **Then** é exibida a tela de resultado final com o placar em destaque no centro, destacando o 1º, 2º e 3º colocados em formato de pódio e os demais participantes em lista, com todas as posições exibindo o total de pontos efetuados.

### Edge Cases

- Um jogador desconecta durante a rodada ou durante a avaliação de uma categoria; os demais continuam e a sala não trava.
- Um jogador tenta enviar respostas mais de uma vez; apenas o primeiro envio é considerado.
- O tempo termina enquanto um jogador está digitando; termos já preenchidos são salvos e os vazios recebem zero.
- O botão Stop pressionado por qualquer jogador encerra imediatamente a fase de respostas para todos.
- Letra incorreta ou campo vazio recebe 0 pontos automaticamente e não depende de votação.
- Respostas idênticas entre jogadores são marcadas como repetidas (5 pontos base) caso sejam válidas.
- Votação de invalidação por categoria: entre 10% e 50% dos votos dos demais corta o score base pela metade; acima de 50% zera.
- A ausência de voto na categoria é tratada como concordância.
- O autor não pode votar em seu próprio termo da categoria.
- O tempo limite de cada categoria na avaliação encerra a votação daquele tema caso nem todos votem a tempo.
- Empates no pódio (ex: dois 1º lugares) devem ser refletidos sem quebras de layout, mantendo a pontuação de ambos em destaque.
- A tela de resultado final deve exibir o total de pontos conquistados em 100% das posições do ranking (pódio e lista).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir que um jogador crie uma sala sem criar conta ou realizar login.
- **FR-002**: O sistema MUST gerar um código compartilhável para cada sala ativa.
- **FR-003**: O sistema MUST permitir a entrada em uma sala ativa mediante código válido e nickname informado.
- **FR-004**: O sistema MUST exigir um nickname não vazio e único dentro da sala.
- **FR-005**: O sistema MUST, na tela de configuração da sala, exibir o código compartilhável, a seleção de rodadas e o gerenciamento de categorias, **NÃO exibindo o placar nem a lista de jogadores** nesta fase.
- **FR-006**: O sistema MUST oferecer uma lista inicial de categorias sugeridas para seleção rápida.
- **FR-007**: O sistema MUST permitir que o anfitrião adicione, edite, remova e reordene categorias antes do início da partida.
- **FR-008**: O sistema MUST impedir categorias vazias ou duplicadas na configuração final.
- **FR-009**: O sistema MUST permitir que o anfitrião informe a quantidade de rodadas antes do início (mínimo de 1 rodada).
- **FR-010**: O sistema MUST impedir que jogadores não anfitriões alterem a configuração da sala ou iniciem a partida.
- **FR-011**: O sistema MUST iniciar cada rodada com uma letra sorteada comum e a lista de categorias configurada para todos os jogadores.
- **FR-012**: O sistema MUST permitir que cada jogador registre no máximo uma resposta por categoria em cada rodada.
- **FR-013**: O sistema MUST permitir o envio das respostas antes do encerramento da rodada e bloquear alterações após o envio.
- **FR-014**: O sistema MUST calcular o tempo total da rodada como 20 segundos por categoria configurada.
- **FR-015**: O sistema MUST, na tela de jogo, posicionar o **botão Stop após a seção de categorias** e posicionar a **letra sorteada no lado direito, acima da seção de placar**; o acionamento do Stop por qualquer jogador encerra a rodada imediatamente para todos.
- **FR-016**: O sistema MUST validar automaticamente que cada resposta não está vazia e começa com a letra sorteada; respostas que falharem nessa validação recebem 0 pontos.
- **FR-017**: O sistema MUST realizar a validação dos temas **uma categoria de cada vez**; para cada categoria, o sistema MUST apresentar todos os termos inseridos pelos participantes naquela categoria.
- **FR-018**: O sistema MUST permitir que os jogadores validem ou invalidem os termos da categoria ativa, tratando a ausência de voto como concordância e calculando a pontuação dessa categoria quando todos votarem ou o tempo da categoria expirar.
- **FR-019**: O sistema MUST transitar automaticamente para a categoria seguinte após apurar a categoria atual, repetindo o fluxo sucessivamente até que todas as categorias da rodada sejam avaliadas.
- **FR-020**: O sistema MUST exibir a **seção do placar no lado direito durante todo o tempo de avaliação das categorias**, refletindo o cálculo de pontuação já apurado em tempo real a cada categoria concluída.
- **FR-021**: O sistema MUST calcular a pontuação de cada categoria conforme: 10 pontos para válida e exclusiva; 5 pontos para válida e repetida; 0 pontos para vazia/inválida; redução de 50% para invalidações entre 10% e 50%; zeramento para invalidações acima de 50%.
- **FR-022**: O sistema MUST exibir, na tela de resultado final, o **placar em destaque no centro da tela**, com o **1º, 2º e 3º colocados em destaque em formato de pódio** e os demais participantes em **formato de lista**, exibindo em **todas as posições o total de pontos** efetuados pelo participante.
- **FR-023**: O sistema MUST permitir iniciar uma nova rodada enquanto o total de rodadas configuradas não for atingido, e conduzir ao resultado final definitivo após a última rodada.
- **FR-024**: O sistema MUST comunicar estados de carregamento, erro, sala inexistente, nickname indisponível e desconexão de maneira clara.
- **FR-025**: O sistema MUST manter todos os participantes sincronizados quanto à configuração, rodada atual, tempo, acionamento do Stop, categoria ativa em avaliação, termos exibidos, votos, placar parcial e resultado final.
- **FR-026**: O sistema MUST fornecer uma sequência lógica de foco, títulos e rótulos semânticos para acessibilidade.
- **FR-027**: O sistema MUST comunicar a letra sorteada, o tempo restante, a categoria em avaliação, pontuações e ações por texto acessível.
- **FR-028**: O sistema MUST respeitar `prefers-reduced-motion`, simplificando ou desativando animações da letra, do botão Stop, das transições de categoria e do pódio.
- **FR-029**: O sistema MUST estruturar a interface conforme os layouts dedicados: tela de configuração sem placar/jogadores; tela de jogo com letra à direita acima do placar e botão STOP após categorias; tela de avaliação com tema atual à esquerda e placar apurado à direita; tela de resultado final com placar e pódio centralizados.

### Key Entities *(include if feature involves data)*

- **Sala**: Espaço da partida identificado por código compartilhável, com anfitrião, participantes, configuração de categorias e rodadas.
- **Jogador**: Participante identificado por nickname único dentro da sala.
- **Partida**: Sessão com quantidade definida de rodadas e pontuação acumulada.
- **Rodada**: Etapa com uma letra sorteada, lista de categorias, tempo de respostas e ciclo sequencial de avaliação por tema.
- **Categoria**: Tema a ser respondido em cada rodada e avaliado individualmente na fase de validação.
- **Avaliação de Categoria**: Etapa na qual os termos de uma única categoria são expostos simultaneamente a todos os jogadores para contestação/validação, com apuração imediata.
- **Resposta**: Termo inserido por um jogador para determinada categoria.
- **Placar**: Pontuação acumulada por participante, exibida à direita durante o jogo e a avaliação, e em destaque central no resultado final.
- **Ranking Final**: Classificação definitiva estruturada em pódio (1º ao 3º) e lista (4º em diante), com pontuações totais em todas as posições.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um jogador consegue criar uma sala e acessar a tela de configuração em até 30 segundos, sem login.
- **SC-002**: A tela de configuração da sala carrega sem exibir lista de jogadores nem placar em 100% das sessões de configuração.
- **SC-003**: Na tela de jogo, a letra sorteada posiciona-se no lado direito acima do placar e o botão Stop fica posicionado após as categorias para 100% dos usuários.
- **SC-004**: O acionamento do botão Stop por qualquer jogador encerra a fase de respostas para todos em até 3 segundos.
- **SC-005**: A validação das respostas avança categoria por categoria, exibindo todos os termos de cada tema e atualizando o placar lateral direito em até 2 segundos após a conclusão de cada categoria.
- **SC-006**: Em testes com respostas válidas, vazias, repetidas e invalidadas, 100% dos resultados seguem as regras de pontuação estipuladas.
- **SC-007**: Em uma rodada com 5 categorias, o tempo limite de respostas é de 100 segundos se ninguém acionar Stop.
- **SC-008**: Cada categoria na fase de avaliação encerra sua votação e consolida os pontos imediatamente após todos os participantes elegíveis votarem ou ao expirar o tempo limite do tema.
- **SC-009**: Ao término da partida, a tela de resultado final exibe o placar centralizado com pódio destacado para o 1º, 2º e 3º lugares e lista para os demais, com total de pontos informado em 100% das posições.
- **SC-010**: Usuários navegando por teclado e leitores de tela conseguem percorrer a sequência de categorias, Stop, votação tema por tema e resultado final sem perda de foco.

## Assumptions

- A tela de configuração da sala omite propositalmente o placar e a lista de jogadores, focando na definição dos temas e quantidade de rodadas.
- Na tela do jogo, a coluna da direita agrupa a letra sorteada no topo e o placar logo abaixo, enquanto a coluna principal abriga o cabeçalho, categorias e o botão STOP após o formulário.
- A validação ocorre sequencialmente, tema a tema, para que todos os jogadores foquem na mesma categoria por vez, permitindo maior clareza e dinamismo.
- Durante a validação, o placar lateral direito atualiza-se incrementalmente a cada categoria concluída.
- Na tela de resultado final, o layout foca no centro da tela com pódio para o top 3 e lista para os demais, garantindo a exibição do total de pontos em todas as posições.

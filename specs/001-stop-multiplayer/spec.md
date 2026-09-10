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
- Q: Quando a fase de votação de invalidação deve ser encerrada? → A: Quando todos os jogadores elegíveis votarem ou após 30 segundos.
- Q: Como a partida deve definir sua duração? → A: O anfitrião informa a quantidade de rodadas na configuração da sala antes de iniciar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar e entrar em uma sala (Priority: P1)

Como jogador, quero criar uma sala ou entrar em uma sala existente usando um código compartilhável, informar meu nickname e visualizar os participantes para começar uma partida com outras pessoas.

**Why this priority**: A sala é a unidade básica da experiência multiplayer; sem ela, nenhuma partida pode acontecer.

**Independent Test**: Criar uma sala em uma janela, copiar o código, entrar com outro jogador em uma segunda janela e confirmar que ambos aparecem na mesma sala com nicknames distintos.

**Acceptance Scenarios**:

1. **Given** que o jogador está na tela inicial, **When** ele cria uma sala e informa um nickname válido, **Then** uma sala é criada, um código é exibido e o jogador entra como participante.
2. **Given** que uma sala existente está disponível, **When** outro jogador informa o código e um nickname válido, **Then** ele entra na sala e passa a ser exibido na lista de participantes.
3. **Given** que o nickname já está sendo usado na sala, **When** o jogador tenta entrar, **Then** o sistema rejeita o nickname e solicita outro.
4. **Given** que o código informado não corresponde a uma sala ativa, **When** o jogador tenta entrar, **Then** o sistema informa que a sala não foi encontrada.

---

### User Story 2 - Configurar categorias e iniciar uma partida (Priority: P1)

Como anfitrião, quero escolher categorias sugeridas, personalizá-las e informar a quantidade de rodadas antes da partida para adaptar o jogo ao meu grupo.

**Why this priority**: A configuração define o conteúdo de cada rodada e precisa estar pronta antes das respostas começarem.

**Independent Test**: Em uma sala com pelo menos dois participantes, adicionar, remover e editar categorias, informar a quantidade de rodadas, iniciar a partida e confirmar que a configuração aparece para todos.

**Acceptance Scenarios**:

1. **Given** que o anfitrião está na sala aguardando participantes, **When** ele seleciona categorias sugeridas, **Then** as categorias selecionadas ficam visíveis para todos os participantes.
2. **Given** que o anfitrião está configurando a partida, **When** ele adiciona, edita ou remove uma categoria, **Then** a lista atualizada é exibida para todos e não contém categorias vazias ou duplicadas.
3. **Given** que a sala tem categorias válidas e participantes suficientes, **When** o anfitrião inicia a partida, **Then** todos recebem a mesma letra e a mesma lista de categorias da rodada.
4. **Given** que a configuração não possui nenhuma categoria válida, **When** o anfitrião tenta iniciar a partida, **Then** o sistema impede o início e informa que pelo menos uma categoria é necessária.
5. **Given** que a quantidade de rodadas não foi informada ou está fora do limite permitido, **When** o anfitrião tenta iniciar a partida, **Then** o sistema impede o início e informa o valor esperado.

---

### User Story 3 - Responder, pontuar e acompanhar o ranking (Priority: P1)

Como jogador, quero responder às categorias dentro do tempo da rodada e ver minha pontuação e posição no ranking ao final para acompanhar meu desempenho.

**Why this priority**: Responder e pontuar é o núcleo do jogo e entrega o valor principal da partida.

**Independent Test**: Executar uma rodada com dois jogadores, enviar respostas diferentes, encerrar a rodada e confirmar que os pontos e o ranking são calculados e exibidos para todos.

**Acceptance Scenarios**:

1. **Given** que uma rodada está ativa, **When** o jogador preenche suas respostas e envia a rodada, **Then** suas respostas ficam registradas e ele não pode alterá-las após o envio.
2. **Given** que todos os jogadores enviaram suas respostas ou o tempo terminou, **When** a rodada é encerrada, **Then** o sistema revela as respostas, calcula os pontos conforme as regras da partida e atualiza o ranking.
3. **Given** que dois ou mais jogadores têm a mesma pontuação total, **When** o ranking é exibido, **Then** eles aparecem empatados sem que um jogador seja favorecido arbitrariamente.
4. **Given** que uma rodada foi encerrada, **When** o jogador consulta o resultado, **Then** ele vê suas respostas, os pontos por categoria, a pontuação acumulada e sua posição no ranking da sala.
5. **Given** que uma rodada está ativa, **When** qualquer jogador pressiona o botão Stop, **Then** a rodada é encerrada imediatamente para todos os participantes.
6. **Given** que as respostas foram reveladas, **When** os jogadores marcam respostas de outros participantes como inválidas ou deixam de votar, **Then** o sistema trata a ausência de voto como concordância e calcula a penalidade após todos votarem ou após 30 segundos.
7. **Given** que uma partida possui uma quantidade definida de rodadas, **When** a última rodada termina, **Then** o sistema exibe o resultado final e não oferece uma nova rodada.

### Edge Cases

- Um jogador desconecta durante a sala de espera ou durante a rodada; os demais devem continuar vendo seu estado e a partida não deve travar.
- Um jogador tenta enviar a rodada duas vezes; apenas o primeiro envio válido deve ser considerado.
- O tempo termina enquanto um jogador ainda está preenchendo respostas; as respostas já preenchidas são preservadas e as demais ficam sem resposta.
- O tempo total da rodada deve ser igual a 20 segundos multiplicados pela quantidade de categorias/perguntas da rodada.
- O botão Stop pressionado por qualquer jogador deve prevalecer sobre o tempo restante e encerrar a rodada para todos.
- Uma resposta vazia não deve receber pontos.
- Uma resposta que não começa com a letra sorteada não deve receber pontos e deve ser marcada como inválida automaticamente.
- Respostas idênticas entre jogadores devem ser avaliadas quanto à unicidade antes e depois da penalidade de invalidação.
- Se entre 10% e 50% dos demais jogadores elegíveis marcarem uma resposta como inválida, sua pontuação base deve ser reduzida pela metade.
- Se mais de 50% dos demais jogadores elegíveis marcarem uma resposta como inválida, sua pontuação deve ser zerada.
- Percentuais de invalidação iguais a 10% e 50% estão incluídos na faixa de redução pela metade; percentuais acima de 50% zeram a pontuação.
- A ausência de voto de invalidação deve ser considerada concordância com a resposta.
- O autor da resposta não pode votar na própria resposta e não deve fazer parte do denominador da votação daquela resposta.
- A fase de votação de invalidação deve terminar quando todos os jogadores elegíveis votarem ou após 30 segundos, o que ocorrer primeiro.
- O anfitrião sai antes de iniciar a partida; a sala deve indicar um novo anfitrião ou impedir o início até que exista um responsável.
- Um código de sala deve permanecer válido apenas enquanto a sala estiver ativa; salas encerradas não devem aceitar novos participantes.
- A quantidade de rodadas deve permanecer fixa durante a partida e não pode ser alterada após o início.
- O jogo deve continuar utilizável com animações reduzidas ou desativadas para pessoas com sensibilidade a movimento ou usando tecnologia assistiva.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir que um jogador crie uma sala sem criar conta ou realizar login.
- **FR-002**: O sistema MUST gerar um código compartilhável para cada sala ativa.
- **FR-003**: O sistema MUST permitir a entrada em uma sala ativa mediante código válido e nickname informado.
- **FR-004**: O sistema MUST exigir um nickname não vazio e único dentro da sala, sem exigir unicidade global.
- **FR-005**: O sistema MUST exibir aos participantes o código da sala, a lista de jogadores e o estado atual da partida, limitando cada sala a no máximo 20 jogadores.
- **FR-006**: O sistema MUST oferecer uma lista inicial de categorias sugeridas.
- **FR-007**: O sistema MUST permitir que o anfitrião adicione, edite, remova e reordene categorias antes do início da partida.
- **FR-008**: O sistema MUST impedir categorias vazias ou duplicadas na configuração final.
- **FR-009**: O sistema MUST permitir que o anfitrião informe a quantidade de rodadas antes do início, com um limite mínimo de 1 e um limite máximo definido pelo MVP.
- **FR-010**: O sistema MUST impedir que jogadores não anfitriões alterem a configuração da sala ou iniciem a partida.
- **FR-011**: O sistema MUST iniciar cada rodada com uma letra comum e a lista de categorias configurada para todos os jogadores.
- **FR-012**: O sistema MUST permitir que cada jogador registre no máximo uma resposta por categoria em cada rodada.
- **FR-013**: O sistema MUST permitir o envio das respostas antes do encerramento da rodada e bloquear alterações após o envio.
- **FR-014**: O sistema MUST calcular o tempo total da rodada como 20 segundos por categoria/pergunta configurada.
- **FR-015**: O sistema MUST encerrar a rodada quando todos os jogadores ativos enviarem suas respostas, quando o tempo total calculado terminar ou quando qualquer jogador pressionar o botão Stop.
- **FR-016**: O sistema MUST validar automaticamente que cada resposta não está vazia e começa com a letra sorteada; respostas que falharem nessa validação devem receber 0 pontos.
- **FR-017**: O sistema MUST permitir que cada jogador marque como inválida uma resposta revelada de outro participante, registrando no máximo um voto de invalidação por resposta; não deve existir voto explícito de validação.
- **FR-018**: O sistema MUST tratar a ausência de voto de invalidação como concordância com a resposta e calcular o percentual de invalidações sobre os demais jogadores elegíveis, excluindo o autor da resposta.
- **FR-019**: O sistema MUST encerrar a fase de votação quando todos os jogadores elegíveis votarem ou após 30 segundos, o que ocorrer primeiro.
- **FR-020**: O sistema MUST reduzir pela metade a pontuação base quando o percentual de invalidações estiver entre 10% e 50%, inclusive, e zerar a pontuação quando estiver acima de 50%.
- **FR-021**: O sistema MUST calcular a pontuação base como 10 pontos para resposta válida e exclusiva, 5 pontos para resposta válida repetida e 0 pontos para resposta vazia ou inválida antes da penalidade de invalidação.
- **FR-022**: O sistema MUST manter o ranking limitado à sala e à partida ativa, sem criar ranking global ou perfil permanente no MVP.
- **FR-023**: O sistema MUST permitir iniciar uma nova rodada enquanto a quantidade configurada de rodadas ainda não tiver sido concluída e encerrar a partida após a última rodada.
- **FR-024**: O sistema MUST comunicar estados de carregamento, erro, sala inexistente, nickname indisponível e desconexão de maneira compreensível ao jogador.
- **FR-025**: O sistema MUST manter todos os participantes da sala sincronizados quanto à configuração, quantidade de rodadas, rodada atual, envio de respostas, encerramento por tempo ou Stop, votos de invalidação, encerramento da votação, resultados e ranking.
- **FR-026**: O sistema MUST fornecer uma sequência de foco, títulos, rótulos e mensagens de status lógica para navegação por teclado, leitor de tela e outras tecnologias assistivas.
- **FR-027**: O sistema MUST comunicar a letra sorteada, o tempo restante, o estado da rodada, o resultado e as ações disponíveis por texto acessível, sem depender apenas de cor, movimento ou posição visual.
- **FR-028**: O sistema MUST respeitar a preferência `prefers-reduced-motion`, reduzindo ou removendo as animações do sorteio da letra, do botão Stop e das formas decorativas do fundo.
- **FR-029**: O sistema MUST exibir o placar em uma área vertical dedicada que ocupe aproximadamente um quarto da tela em layouts amplos, permanecendo acessível e reorganizada abaixo do jogo em telas estreitas.

### Key Entities *(include if feature involves data)*

- **Sala**: Espaço temporário da partida, identificado por um código compartilhável, com anfitrião, participantes, configuração e estado atual.
- **Jogador**: Participante identificado por nickname único dentro de uma sala, sem conta permanente.
- **Partida**: Sessão de jogo pertencente a uma sala, com uma ou mais rodadas e pontuações acumuladas.
- **Rodada**: Etapa da partida com uma letra, categorias, limite de tempo, respostas e resultado.
- **Categoria**: Tema que deve ser respondido em cada rodada; pode ser sugerido ou personalizado pelo anfitrião.
- **Resposta**: Texto enviado por um jogador para uma categoria em uma rodada, associado ao resultado de pontuação.
- **Ranking**: Ordenação temporária dos jogadores da partida por pontuação acumulada, incluindo empates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um jogador consegue criar uma sala e visualizar seu código em até 30 segundos, sem login.
- **SC-002**: Pelo menos 95% das tentativas válidas de entrada em sala exibem o jogador e seu nickname aos demais participantes em até 3 segundos.
- **SC-003**: Em um teste com 10 jogadores na mesma sala, todos recebem a mesma letra, categorias e estado de rodada em até 3 segundos após cada mudança de estado.
- **SC-004**: Pelo menos 90% dos jogadores conseguem concluir uma rodada válida sem suporte externo, desde a exibição da letra até o envio das respostas.
- **SC-005**: O resultado de uma rodada, incluindo pontos por categoria e ranking, fica disponível para todos os jogadores em até 5 segundos após o encerramento por tempo, envio de todos, Stop ou encerramento da votação.
- **SC-006**: Em testes com respostas válidas, vazias, repetidas e empatadas, 100% dos resultados seguem de forma consistente a regra de pontuação definida para a partida.
- **SC-007**: Em uma rodada com 5 categorias, a rodada termina automaticamente após 100 segundos se nenhum jogador pressionar Stop.
- **SC-008**: Em testes com 20 jogadores, o acionamento do botão Stop por qualquer jogador encerra a rodada para todos em até 3 segundos.
- **SC-009**: Em testes com respostas que recebem 0%, 10%, 50% e mais de 50% de invalidações, 100% das pontuações seguem as faixas de penalidade definidas.
- **SC-010**: Em testes com 1, 3 e 10 rodadas configuradas, a partida encerra exatamente após a última rodada definida e o ranking final é exibido.
- **SC-011**: Usuários navegando apenas por teclado conseguem chegar ao nickname, código da sala, categorias, quantidade de rodadas, respostas, Stop, votação e ranking em uma sequência lógica sem foco perdido.
- **SC-012**: Leitores de tela recebem texto equivalente para letra, cronômetro, estado da rodada, pontuação, ranking e mensagens de erro, sem depender exclusivamente de cor ou animação.
- **SC-013**: Quando a preferência de movimento reduzido está ativa, o conteúdo e as ações permanecem disponíveis sem animações essenciais e sem perda de informação.
- **SC-014**: Em layouts amplos, o placar ocupa aproximadamente 25% da área disponível em uma coluna vertical; em telas estreitas, ele aparece em uma ordem linear após o conteúdo principal sem sobreposição.
- **SC-015**: A experiência não exige criação de conta e não oferece ranking global ou persistência permanente de nickname no MVP.

## Assumptions

- O MVP será usado em navegadores modernos com conexão estável à internet.
- As salas e os rankings são temporários e vinculados à partida ativa; não haverá histórico após o encerramento da sala.
- O jogador que cria a sala será o anfitrião inicial e terá permissão para configurar categorias e iniciar partidas.
- A quantidade de rodadas será informada pelo anfitrião antes do início e permanecerá fixa durante a partida.
- A regra padrão de pontuação é 10 pontos para resposta válida e exclusiva, 5 pontos para resposta válida repetida e 0 pontos para resposta vazia ou inválida.
- Cada categoria/pergunta contribui com 20 segundos para o tempo total da rodada; com 5 categorias, o limite padrão é de 100 segundos.
- A validação automática considera apenas preenchimento e primeira letra; a validade semântica da palavra pode ser contestada pelos jogadores após a revelação.
- O percentual de invalidação é calculado sobre os demais jogadores elegíveis da sala, excluindo o autor da resposta; quem não votar é considerado concordante. A pontuação reduzida pode assumir valores fracionários quando a metade da pontuação base não for inteira.
- A fase de votação de invalidação dura no máximo 30 segundos e encerra antes se todos os jogadores elegíveis votarem.
- A interface seguirá o padrão visual do protótipo fornecido: fundo claro com formas suaves em movimento, superfícies claras elevadas, azul-marinho para ações principais e laranja para destaque da letra e do jogador líder.
- As animações são decorativas ou informativas, nunca a única forma de comunicar estado; a preferência de movimento reduzido desativa ou simplifica as transições.
- O placar será organizado verticalmente em uma coluna lateral de aproximadamente um quarto da tela em desktop e reordenado abaixo do jogo em mobile.
- Chat, áudio, autenticação, ranking global, perfis permanentes e moderação avançada estão fora do escopo desta feature.

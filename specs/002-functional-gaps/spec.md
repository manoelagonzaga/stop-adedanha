# Implementações pendentes para tornar Stop funcional

**Status:** levantamento baseado no código existente  
**Escopo:** lacunas entre a experiência apresentada pela aplicação e o fluxo funcional esperado para uma partida multiplayer completa.  
**Referências:** [spec.md](../001-stop-multiplayer/spec.md), [data-model.md](../001-stop-multiplayer/data-model.md), [data-model.md](./data-model.md), [contracts/realtime-events.md](./contracts/realtime-events.md) e [quickstart.md](./quickstart.md).

## Contexto da avaliação

O projeto já possui as telas principais, o transporte WebSocket, um Durable Object por sala, partes do fluxo de rodada e funções de pontuação. Porém, alguns comandos e estados ainda não estão ligados de ponta a ponta: a criação e o ingresso podem apontar para salas diferentes, as opções da interface nem sempre são enviadas ao servidor, e o estado autoritativo não conduz corretamente a partida até as rodadas seguintes.

Os itens abaixo descrevem o trabalho que falta, em ordem de prioridade. Cada item é independente como unidade de implementação e inclui critérios observáveis para determinar quando está concluído.

## Item 1 — Unificar a criação e o ingresso na mesma sala

**Prioridade:** bloqueador — P0

**Contexto observado:** a interface escolhe um identificador temporário e conecta a ele antes de enviar `room:create`. O backend gera outro código dentro do Durable Object. Como as conexões de ingresso são roteadas para um Durable Object identificado pelo código informado, o código mostrado ao anfitrião não identifica necessariamente o objeto em que a sala foi criada. Além disso, um código arbitrário pode inicializar um Durable Object vazio em vez de resultar em “sala não encontrada”.

**Implementação necessária:**

- Definir uma única autoridade e um único fluxo para gerar o código da sala, associá-lo ao Durable Object e comunicá-lo à interface.
- Fazer com que o código apresentado, copiado e usado para ingressar identifique exatamente a sala criada.
- Distinguir uma sala existente de um código inexistente; não criar silenciosamente uma sala durante uma tentativa de ingresso.
- Remover ou completar o endpoint de criação HTTP para que ele não concorra com o comando WebSocket `room:create`.

**Critérios de aceite:**

1. Criar uma sala em uma janela exibe um código que, informado em outra janela, conecta os dois jogadores ao mesmo estado de sala.
2. O código mantém formato e comparação consistentes, inclusive quando digitado em minúsculas.
3. Um código que não corresponde a uma sala ativa retorna um erro de sala inexistente e não cria uma sala nova.
4. A criação repetida não sobrescreve nem reutiliza acidentalmente o estado de outra sala ativa.

## Item 2 — Preservar a identidade do jogador ao reconectar

**Prioridade:** bloqueador — P0

**Contexto observado:** cada conexão WebSocket recebe um novo `playerId`. A reconexão automática do frontend abre outro socket, mas não reenvia automaticamente `room:join` nem dispõe de um identificador persistente que associe a nova conexão ao jogador anterior. Isso pode deixar jogadores desconectados no estado da sala, duplicá-los ou impedir que o jogador retome uma partida.

**Implementação necessária:**

- Definir uma credencial/token de sessão de jogador, com validação no servidor, e reutilizá-la em reconexões.
- Restaurar a associação entre a conexão nova, a sala e o jogador existente antes de retomar os eventos.
- Enviar ao jogador que reconectou um snapshot autoritativo suficiente para reconstruir a tela e o estado atual.
- Formalizar o evento `session:ready` nos tipos compartilhados, incluindo os dados necessários para retomar a sessão.

**Critérios de aceite:**

1. Uma desconexão seguida de reconexão restaura o mesmo jogador, nickname, pontuação e permissões.
2. O estado da sala não passa a contar um jogador duplicado após reconexões sucessivas.
3. Durante a partida, o jogador reconectado recebe a rodada/categoria em andamento e os deadlines atuais.
4. Uma identidade inválida ou expirada é rejeitada explicitamente, sem associar a conexão a outro jogador.

## Item 3 — Tornar a configuração da partida autoritativa no servidor

**Prioridade:** alta — P1

**Contexto observado:** a alteração de número de rodadas é apenas local no frontend: não há comando correspondente nos tipos compartilhados nem envio ao servidor. Já categorias têm comando, mas o servidor filtra vazios sem rejeitar categorias duplicadas ou impedir uma configuração vazia. O início da partida verifica apenas um jogador ativo, apesar do fluxo multiplayer documentado exigir pelo menos dois. As regras também devem impedir edição fora da fase de configuração.

**Implementação necessária:**

- Completar o comando compartilhado de atualização de rodadas e enviá-lo ao backend.
- Validar no servidor permissão de anfitrião, fase de configuração e limites de rodadas (mínimo 1 e máximo 20).
- Validar categorias no servidor: trim, nome não vazio, unicidade sem diferenciar maiúsculas/minúsculas e ao menos uma categoria antes de iniciar.
- Exigir ao menos dois jogadores ativos para iniciar uma partida, conforme o contrato de jogo multiplayer.
- Responder com erro explícito para configuração inválida, sem aplicar atualização parcial.

**Critérios de aceite:**

1. Alterar rodadas ou categorias no anfitrião atualiza o snapshot recebido por todos os participantes.
2. Um participante que não seja anfitrião não consegue alterar as opções.
3. O servidor rejeita valores de rodada fora do limite e categorias vazias/duplicadas, mesmo que o cliente contorne a interface.
4. O início é recusado com mensagem clara quando não há categorias válidas ou jogadores suficientes.
5. Após o início, comandos de configuração não alteram a partida em andamento.

## Item 4 — Persistir e aplicar as opções de tempo e letras

**Prioridade:** alta — P1

**Contexto observado:** o lobby apresenta seleção de tempo por rodada e exclusão de letras, e a tela de jogo permite ao anfitrião sortear outra letra localmente. Essas opções permanecem no estado do componente e não são transmitidas ao servidor. O backend usa uma duração fixa e uma lista de letras própria; por isso, os participantes podem ver regras divergentes ou uma letra que não foi sorteada pela autoridade da sala.

**Implementação necessária:**

- Decidir e documentar limites válidos para o tempo, incluindo o comportamento da opção “sem limite”.
- Incluir as opções de tempo e letras na configuração autoritativa da sala e nos comandos/eventos compartilhados.
- Sortear e validar a letra no backend usando as exclusões salvas; distribuir a mesma letra e deadline a todos.
- Remover a ação de sorteio local ou convertê-la em comando autorizado, com política definida para quando a troca é permitida.
- Derivar o cronômetro da interface do deadline enviado pelo servidor, sem temporizador local com duração divergente.

**Critérios de aceite:**

1. Opções selecionadas pelo anfitrião são refletidas no estado de sala e aplicadas em todas as rodadas.
2. Todos os jogadores recebem a mesma letra e o mesmo deadline.
3. Uma letra excluída nunca é sorteada; valores inválidos de configuração são recusados pelo servidor.
4. O indicador de tempo do cliente acompanha o deadline autoritativo e não encerra a rodada antes dele por diferença de relógio local.

## Item 5 — Validar respostas e encerrar a rodada de forma autoritativa

**Prioridade:** bloqueador — P0

**Contexto observado:** `passesLetterCheck` existe no motor de pontuação, mas não é usado ao receber respostas nem no cálculo final. As respostas são armazenadas como válidas por padrão. O backend também não confere de forma suficiente se o jogador está ativo, se o `roundId` corresponde à rodada atual, se a categoria existe ou se o deadline já expirou. O cliente inicia o cronômetro em 60 segundos enquanto o servidor define 90 segundos.

**Implementação necessária:**

- Validar no servidor identidade/estado do jogador, fase atual, rodada, deadline e categorias enviadas.
- Normalizar a resposta e aplicar a validação de preenchimento e letra inicial usando a letra da rodada no servidor.
- Garantir que respostas vazias ou com letra incorreta não recebam pontos automáticos.
- Definir um único corte de submissão para STOP e timeout. O envio final de respostas e STOP deve ser processado em ordem determinística, sem aceitar alterações após o encerramento.
- Enviar atualizações incrementais de respostas para que o servidor retenha as respostas de todos os jogadores quando outra pessoa acionar STOP.
- Tornar o comportamento do timeout coerente com a configuração escolhida no lobby.

**Critérios de aceite:**

1. Uma resposta iniciada com letra errada é marcada inválida pelo servidor e pontua zero, mesmo que o cliente a envie manualmente.
2. Respostas de jogadores/categorias/rodadas não autorizadas ou enviadas após o deadline são rejeitadas explicitamente.
3. STOP ou timeout muda a fase uma única vez para avaliação e todos recebem a mesma transição.
4. A resposta final enviada antes do STOP é incluída; comandos posteriores ao corte não a alteram.
5. O tempo exibido e o encerramento do servidor correspondem ao mesmo deadline.

## Item 6 — Corrigir a identificação e a elegibilidade dos votos

**Prioridade:** bloqueador — P0

**Contexto observado:** a interface monta `answerId` concatenando `playerId` e `categoryId` com hífen e depois divide essa string pelo mesmo caractere. Como o identificador do jogador é um UUID com hífens, essa operação pode extrair somente parte do UUID e a categoria incorreta. No servidor, a resolução da resposta também depende de interpretar esse identificador. O backend não rejeita voto do autor e não verifica que a categoria votada é a categoria em avaliação.

**Implementação necessária:**

- Usar identificadores de resposta opacos/estáveis ou campos separados (`playerId`, `categoryId`), sem depender de parse de delimitadores ambíguos.
- Validar que a resposta pertence à rodada e à categoria ativa.
- Impedir voto do autor, jogador desconectado/não elegível e voto duplicado quando a ação não for uma retirada intencional.
- Excluir o autor do denominador de votantes elegíveis. Entre 10% e 50% de invalidações, inclusive, a resposta recebe metade dos pontos-base; acima de 50%, recebe zero.
- Distinguir voto “invalidar” de voto “válida/concordo”, preservando o significado de ausência de voto como concordância ao término do prazo.

**Critérios de aceite:**

1. Respostas de jogadores com UUIDs contendo hífens são localizadas e atualizadas sem ambiguidade.
2. Votos do autor ou de jogadores não elegíveis são recusados e não alteram a resposta.
3. Os testes cobrem os limites de 10% e 50%, valores abaixo/acima deles, e aplicam metade dos pontos entre 10% e 50% inclusive e zero acima de 50%.
4. A ausência de voto não invalida uma resposta automaticamente.
5. A votação de uma categoria não modifica respostas de outra categoria ou rodada.

## Item 7 — Sincronizar votação, avanço de categoria e placar parcial

**Prioridade:** alta — P1

**Contexto observado:** o cliente navega abas de categorias localmente, sem aguardar a transição autoritativa do servidor. O servidor avança por timeout, mas não registra votos explícitos de concordância nem avança quando todos terminam antes do prazo. O evento de atualização calcula pontos da categoria atual, porém transmite `room.players` sem incorporar essa pontuação; a interface reconstrói uma pontuação parcial local usando regras diferentes e pode atribuir bônus ao jogador errado.

**Implementação necessária:**

- Fazer do Durable Object a única autoridade para o índice de categoria, votos, deadline e conclusão.
- Bloquear navegação local para categorias que ainda não estão ativas; atualizar a interface somente com eventos autoritativos.
- Avançar quando todos os votantes elegíveis tiverem registrado uma decisão ou quando o deadline expirar.
- Calcular a pontuação da categoria no servidor após a decisão final e transmitir uma atualização de placar acumulada e consistente.
- Aplicar pontos de cada categoria e bônus de STOP uma única vez, ao jogador que o servidor identificou como primeiro a parar.
- Exibir contestação, validade e placar com base no estado recebido do servidor, sem cálculos locais concorrentes.

**Critérios de aceite:**

1. Todos os clientes permanecem na mesma categoria ativa e recebem o mesmo deadline.
2. A categoria avança assim que todos os votantes elegíveis decidem ou quando o prazo acaba.
3. O placar lateral é atualizado após cada categoria com pontos já confirmados, sem antecipar categorias futuras nem somar pontos duas vezes.
4. A votação e o placar em todas as telas seguem a mesma regra de invalidação e unicidade.
5. O bônus de STOP aparece e é atribuído apenas ao jogador reconhecido pelo servidor como primeiro a parar.

## Item 8 — Implementar a transição autoritativa entre rodadas

**Prioridade:** bloqueador — P0

**Contexto observado:** ao terminar uma rodada não final, o backend transmite `round:results` e permanece em `ROUND_RESULTS`. O botão de próxima rodada apenas troca a tela localmente; não há comando compartilhado que solicite/autorize a próxima rodada e o servidor não inicia automaticamente a seguinte. Assim, uma partida configurada com mais de uma rodada pode ficar travada.

**Implementação necessária:**

- Definir o evento/command e o responsável pela transição para a próxima rodada (por exemplo, transição automática após resultados ou confirmação do anfitrião).
- Fazer com que a mudança de fase, o número da rodada, a nova letra, respostas vazias e deadline sejam criados pelo servidor.
- Desabilitar a ação de avançar enquanto a rodada ainda estiver sendo avaliada e impedir transições duplicadas.
- Na última rodada, manter a exibição do resultado final até que os dados autoritativos estejam disponíveis.

**Critérios de aceite:**

1. Uma partida com várias rodadas percorre todas elas sem recarregar a página ou depender de mudança apenas local.
2. Todos os participantes iniciam cada rodada com o mesmo número, letra, categorias e deadline.
3. Uma rodada não pode ser pulada nem iniciada duas vezes por comandos concorrentes.
4. A partida termina somente após a apuração completa da última rodada e todos veem o mesmo ranking final.

## Item 9 — Recuperar a rodada ativa após reinício do Durable Object

**Prioridade:** alta — P1

**Contexto observado:** somente `RoomState` é salvo no Durable Storage. Respostas, votos, primeiro jogador a parar e outros dados da rodada vivem em `Map`/`Set` em memória. Se a instância for recriada durante uma partida, o snapshot pode indicar uma fase ativa sem que os dados necessários para continuar existam. O alarme sozinho não recupera essas estruturas.

**Implementação necessária:**

- Persistir os dados de rodada necessários para continuar (letra, respostas, votos, identificador do primeiro STOP e etapa atual), usando uma representação serializável.
- Restaurar o estado completo sob `blockConcurrencyWhile` antes de processar conexões, comandos ou alarmes.
- Reconciliar deadlines expirados no restauro sem reaplicar pontuações ou transições já concluídas.
- Preservar um estado final idempotente para cada categoria e rodada.

**Critérios de aceite:**

1. Reiniciar/recriar a instância durante respostas ou avaliação mantém respostas, votos, fase e deadline.
2. Um alarme após restauro avança apenas a etapa devida e não duplica pontos.
3. Uma conexão que chega após o restauro recebe snapshot consistente com a fase retomada.

## Item 10 — Tratar saída do anfitrião e permissões durante a partida

**Prioridade:** média — P2

**Contexto observado:** o modelo descreve promoção do jogador ativo mais antigo quando o anfitrião sai, mas o código apenas marca o jogador como desconectado. As verificações de autoria e fase também não estão aplicadas uniformemente a todos os comandos.

**Implementação necessária:**

- Promover de forma serializada outro jogador ativo conforme a regra de ordenação definida; se não houver ninguém ativo, suspender ações administrativas até um retorno válido ou encerramento da sala.
- Aplicar validações de fase, papel, status ativo e sala em todos os comandos.
- Definir o comportamento de saída durante resposta, votação, entre rodadas e fim de jogo.

**Critérios de aceite:**

1. A saída do anfitrião não deixa a sala sem capacidade de iniciar ou configurar antes da partida.
2. O novo anfitrião é comunicado a todos por estado autoritativo.
3. Jogadores desconectados ou comandos enviados em fase inválida não executam ações privilegiadas.

## Item 11 — Exibir erros e refletir confirmações do servidor na interface

**Prioridade:** média — P2

**Contexto observado:** erros recebidos pelo hook não são incorporados ao estado da interface. Algumas ações fazem atualização otimista, e `send` não informa quando o socket não está aberto. Assim, a tela pode indicar “salvo” ou mostrar configuração que nunca foi aplicada.

**Implementação necessária:**

- Correlacionar comandos e respostas/erros por `requestId` nos tipos compartilhados.
- Exibir mensagem recuperável para erros de código de sala, nickname, permissões, limites e fase.
- Não descartar silenciosamente comandos enviados enquanto o socket está desconectado; enfileirar com política explícita ou rejeitar e informar o usuário.
- Remover atualizações otimistas sem rollback ou confirmação; indicar carregamento/erro quando a operação ainda não foi confirmada.
- Substituir valores simulados da interface por estado de carregamento até chegar um snapshot real.

**Critérios de aceite:**

1. Cada falha relevante tem feedback visível e não deixa a interface aparentando sucesso.
2. Uma alteração só é apresentada como confirmada após o servidor aceitá-la.
3. Ações indisponíveis durante desconexão são bloqueadas ou retomadas de forma segura.
4. Nenhuma tela de jogo/resultados é apresentada com jogador, letra ou pontuação de demonstração como se fossem dados reais.

## Item 12 — Completar a validação automatizada e de acessibilidade

**Prioridade:** média — P2

**Contexto observado:** há testes unitários para parte do motor de pontuação, mas os scripts `test` do frontend e backend estão vazios. Os cenários de integração e acessibilidade descritos no quickstart não estão conectados a comandos executáveis do projeto.

**Implementação necessária:**

- Configurar o comando de testes do backend para executar a suíte Vitest existente e cobrir as regras e fronteiras dos itens anteriores.
- Definir uma suíte executável para o frontend/integração, incluindo duas conexões reais ou simuladas com estados independentes.
- Cobrir criação/ingresso, nickname/capacidade, permissões, desconexão/reconexão, submissão/STOP, timeout, voto, pontuação incremental, transição entre rodadas e ranking final.
- Validar navegação por teclado, rótulos, foco após STOP/transições e preferência por movimento reduzido.
- Atualizar [quickstart.md](./quickstart.md) com comandos que existam e cenários de teste compatíveis com a implementação.

**Critérios de aceite:**

1. `test` em cada pacote executa testes e retorna falha real quando há regressão.
2. Os testes automatizados cobrem o ciclo completo de uma partida multiplayer e as principais condições de erro.
3. Há uma verificação reproduzível para acessibilidade essencial e movimento reduzido.
4. Os comandos documentados para build, lint e teste funcionam a partir do ambiente indicado no quickstart.

## Item 13 — Expirar salas inativas e partidas concluídas

**Prioridade:** baixa — P2

**Contexto observado:** o Durable Object mantém uma sala persistida indefinidamente depois que o lobby fica abandonado ou a partida termina. Isso deixa dados de jogo e credenciais de retomada sem uma política de limpeza, e o Durable Object possui um único alarme que também é usado pelos prazos de rodada e revisão.

**Implementação necessária:**

- Expirar salas ainda não iniciadas/configurando após 24 horas sem atividade válida e jogos concluídos uma hora após `GAME_OVER`.
- Multiplexar o alarme do Durable Object para que os deadlines de rodada e revisão tenham precedência; não expirar jogos ativos, inclusive resultados aguardando a confirmação do anfitrião.
- Ao expirar, apagar o estado persistido da sala, rodada, jogo e credenciais de retomada, encerrar sockets restantes e permitir nova alocação no mesmo Durable Object.
- Preservar/migrar timestamps de expiração no restauro para não reiniciar a janela de retenção por eviction.

**Critérios de aceite:**

1. Uma sala não iniciada é removida após 24 horas sem atividade válida; atividade válida no lobby renova o prazo.
2. Uma sala concluída permanece disponível por uma hora após `GAME_OVER` e é removida quando o prazo vence.
3. Um prazo antigo de inatividade não antecipa alarme de rodada/revisão nem encerra uma partida ativa.
4. Os testes verificam limpeza persistida e a política continua correta após restauração do Durable Object.

## Ordem recomendada de execução

Implementar os itens na ordem apresentada. Os itens 1 e 2 desbloqueiam uma sessão multiplayer confiável; os itens 3 a 8 completam o ciclo da partida; o item 9 protege partidas em execução; os itens 10 e 11 endurecem a experiência real; e os itens 12 e 13 cobrem regressões, acessibilidade e ciclo de vida das salas.

## Fora do escopo deste levantamento

Este documento não substitui a especificação original nem afirma que as telas e componentes já existentes precisem ser refeitos. Ele registra as ligações ausentes e divergências observadas entre a interface, os contratos compartilhados, o backend e as regras documentadas. Decisões de produto não explicitadas — por exemplo, duração exata de cada modo de tempo — devem ser confirmadas antes de implementar as opções correspondentes.

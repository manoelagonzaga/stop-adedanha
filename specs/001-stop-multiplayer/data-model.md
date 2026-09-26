# Data Model: Stop Multiplayer

Cada sala corresponde a uma instância de `GameRoom` identificada por `roomCode`. O serviço de sala armazena jogadores, partida, rodadas, respostas e invalidações. A camada WebSocket mantém o roteamento, enquanto a lógica de domínio governa as regras do jogo.

## Sala

- `id`: identificador interno da sala.
- `code`: código compartilhável, único entre salas ativas.
- `hostPlayerId`: jogador com permissão de configurar e iniciar a partida.
- `players`: jogadores conectados ou marcados como ativos.
- `categories`: categorias escolhidas para a partida.
- `state`: `lobby`, `answering`, `category_review`, `results`, `game_over` ou `closed`.
- `createdAt`: instante de criação.
- `updatedAt`: instante da última alteração.
- `expiresAt`: timestamp usado pelo serviço de sala para limpeza.

Rules:

- No máximo 20 jogadores por sala.
- Nicknames são únicos dentro da sala, comparados de forma case-insensitive.
- Na tela de configuração da sala (`lobby`), o placar e a lista de jogadores não são exibidos aos participantes.
- Código de sala não aceita novas entradas depois de `closed`.
- Quando o anfitrião sai, uma operação serializada promove o jogador ativo mais antigo ou bloqueia ações de anfitrião até a promoção.

## Jogador

- `id`: identificador temporário emitido pelo backend para a conexão/jogador na sala.
- `nickname`: nome informado pelo jogador.
- `status`: `active`, `submitted` ou `disconnected`.
- `joinedAt`: instante de entrada.
- `score`: pontuação acumulada na partida.

## Partida

- `id`: identificador da partida dentro da sala.
- `roomId`: sala proprietária.
- `roundNumber`: número da rodada atual.
- `totalRounds`: quantidade de rodadas definida pelo anfitrião antes do início.
- `scoreboard`: pontuação acumulada por jogador, recalculada e transmitida incrementalmente a cada categoria avaliada.
- `status`: `active` ou `finished`.

Rules:

- `totalRounds` deve ser um inteiro dentro dos limites definidos pelo MVP (mínimo 1).
- A partida termina quando a última categoria da rodada final (`roundNumber === totalRounds`) tiver sua avaliação concluída.
- `totalRounds` não pode ser alterado depois que a partida passa de `lobby`.

## Rodada

- `id`: identificador da rodada.
- `gameId`: partida proprietária.
- `letter`: letra sorteada exibida no topo do lado direito acima do placar.
- `categories`: snapshot ordenado das categorias da rodada.
- `answerDeadline`: instante de encerramento da fase de respostas, calculado como 20 segundos por categoria.
- `stopRequestedBy`: jogador que acionou o botão Stop posicionado após as categorias.
- `state`: `answering`, `category_review`, `results` ou `closed`.
- `currentReviewCategoryIndex`: índice (0 a N-1) da categoria que está sendo avaliada no momento.
- `categoryReviewDeadline`: instante limite para a votação e avaliação da categoria atual.
- `answers`: respostas por jogador e categoria.

State transitions:

```text
lobby -> answering -> category_review (categoria 1)
category_review (cat i) -> category_review (cat i+1) [quando todos votam ou expira o tempo da categoria]
category_review (última categoria) -> results (se roundNumber < totalRounds)
category_review (última categoria) -> game_over (se roundNumber === totalRounds)
results -> answering (próxima rodada)
lobby -> closed
```

## Categoria

- `id`: identificador estável no snapshot da rodada.
- `label`: texto exibido.
- `position`: ordem de exibição.

Rules:

- `label` deve ser não vazio depois de trim.
- Categorias não podem se repetir ignorando maiúsculas/minúsculas e espaços laterais.
- A configuração final deve possuir pelo menos uma categoria.

## Resposta e Avaliação

- `playerId`: autor.
- `roundId`: rodada.
- `categoryId`: categoria respondida.
- `text`: texto original enviado.
- `normalizedText`: texto normalizado para comparações.
- `automaticValidity`: `valid` se não vazio e inicia com a letra sorteada; `invalid` caso contrário.
- `uniqueness`: `unique`, `duplicate` ou `not-applicable`.
- `baseScore`: 10 para válida e única, 5 para válida repetida, 0 para inválida.
- `invalidationVoters`: conjunto de jogadores elegíveis que marcaram a resposta como inválida.
- `invalidationRatio`: quantidade de votos de invalidação dividida pelos jogadores elegíveis, excluindo o autor.
- `finalScore`: `baseScore`, metade da base entre 10% e 50%, ou 0 acima de 50%.

Rules:

- Cada jogador possui no máximo uma resposta por categoria.
- A avaliação é feita uma categoria por vez, apresentando todos os termos enviados naquela categoria.
- O autor não pode votar na própria resposta.
- Ausência de voto equivale a concordância com o termo.
- Ao concluir a avaliação da categoria (todos votaram ou tempo expirou), sua pontuação é somada ao placar lateral direito antes de avançar para a próxima.

## Ranking e Resultado Final

- `playerId`: jogador.
- `nickname`: snapshot exibido.
- `score`: total de pontos efetuados pelo participante na partida (obrigatório em todas as posições).
- `position`: posição ordinal no ranking (1º, 2º, 3º, etc.).
- `isPodium`: booleano indicando se o jogador integra o pódio (1º, 2º ou 3º lugar).
- `podiumTier`: `'gold' | 'silver' | 'bronze' | null`.
- `tie`: indica empate na mesma pontuação.

Rules da Tela de Resultado Final:

- O placar é apresentado em destaque central na tela.
- O 1º, 2º e 3º colocados têm destaque em formato de pódio.
- Os demais participantes (4º em diante) são exibidos em formato de lista.
- **Todas as posições** exibem o total acumulado de pontos efetuados pelo participante.


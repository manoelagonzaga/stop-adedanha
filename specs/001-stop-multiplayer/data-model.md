# Data Model: Stop Multiplayer

Cada sala corresponde a uma instancia de `GameRoom` identificada por `roomCode`. O servico de sala armazena jogadores, partida, rodadas, respostas e invalidações. A camada WebSocket mantém o roteamento, mas não calcula regras de jogo.

## Sala

- `id`: identificador interno da sala.
- `code`: codigo compartilhavel, unico entre salas ativas.
- `hostPlayerId`: jogador com permissao de configurar e iniciar.
- `players`: jogadores conectados ou marcados como ativos.
- `categories`: categorias escolhidas para a partida.
- `state`: `lobby`, `answering`, `review`, `results` ou `closed`.
- `createdAt`: instante de criacao.
- `updatedAt`: instante da ultima alteracao.
- `expiresAt`: timestamp usado pelo servico de sala para limpeza.

Rules:

- No maximo 20 jogadores por sala.
- Nicknames sao unicos dentro da sala, comparados de forma case-insensitive.
- Codigo de sala nao aceita entrada depois de `closed`.
- Quando o anfitriao sai, uma operação serializada promove o jogador ativo mais antigo ou bloqueia ações de anfitrião até a promoção.

## Jogador

- `id`: identificador temporario emitido pelo backend para a conexao/jogador na sala.
- `nickname`: nome informado pelo jogador.
- `status`: `active`, `submitted` ou `disconnected`.
- `joinedAt`: instante de entrada.
- `score`: pontuacao acumulada na partida.

## Partida

- `id`: identificador da partida dentro da sala.
- `roomId`: sala proprietaria.
- `roundNumber`: numero da rodada atual.
- `totalRounds`: quantidade de rodadas definida pelo anfitriao antes do inicio.
- `scoreboard`: pontuacao acumulada por jogador.
- `status`: `active` ou `finished`.

Rules:

- `totalRounds` deve ser um inteiro dentro dos limites definidos pelo MVP.
- A partida termina quando `roundNumber` atingir `totalRounds`.
- `totalRounds` nao pode ser alterado depois que a partida passa de `lobby`.

## Rodada

- `id`: identificador da rodada.
- `gameId`: partida proprietaria.
- `letter`: letra sorteada.
- `categories`: snapshot ordenado das categorias.
- `answerDeadline`: instante de encerramento automatico, calculado como 20 segundos por categoria.
- `stopRequestedBy`: jogador que acionou Stop, quando aplicavel.
- `state`: `answering`, `review`, `results` ou `closed`.
- `answers`: respostas por jogador e categoria.
- `invalidationDeadline`: no maximo 30 segundos apos a revelacao.

State transitions:

```text
lobby -> answering -> review -> results -> answering
lobby -> closed
answering -> review (all submitted, timeout, or Stop)
review -> results (all eligible voted or 30-second timeout)
```

## Categoria

- `id`: identificador estavel no snapshot da rodada.
- `label`: texto exibido.
- `position`: ordem de exibicao.

Rules:

- `label` deve ser nao vazio depois de trim.
- Categorias nao podem se repetir ignorando maiusculas/minusculas e espacos laterais.
- A configuracao final deve possuir pelo menos uma categoria.

## Resposta

- `playerId`: autor.
- `roundId`: rodada.
- `categoryId`: categoria respondida.
- `text`: texto original enviado.
- `normalizedText`: texto normalizado para comparacoes.
- `automaticValidity`: `valid` se nao vazio e inicia com a letra; `invalid` caso contrario.
- `uniqueness`: `unique`, `duplicate` ou `not-applicable`.
- `baseScore`: 10 para valida e unica, 5 para valida repetida, 0 para invalida.
- `invalidationVoters`: conjunto de jogadores elegiveis que marcaram a resposta como invalida.
- `invalidationRatio`: quantidade de votos de invalidacao dividida pelos jogadores elegiveis, excluindo o autor.
- `finalScore`: `baseScore`, metade da base entre 10% e 50%, ou 0 acima de 50%.

Rules:

- Cada jogador possui no maximo uma resposta por categoria.
- O autor nao pode votar na propria resposta.
- Ausencia de voto equivale a concordancia.
- Percentuais de 10% e 50% reduzem a pontuacao pela metade; acima de 50% zera.
- Respostas automaticamente invalidas recebem 0 e nao dependem de votacao.

## Ranking

- `playerId`: jogador.
- `nickname`: snapshot exibido.
- `score`: pontuacao acumulada, possivelmente decimal.
- `position`: posicao calculada por score.
- `tie`: indica empate na mesma pontuacao.

O ranking pertence somente a uma partida ativa e nao e persistido apos o encerramento da sala.

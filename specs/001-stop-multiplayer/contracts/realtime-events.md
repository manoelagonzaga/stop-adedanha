# Realtime Contract: Cloudflare WebSocket

Transport: Cloudflare Worker TypeScript com WebSocket e Durable Object por sala. O frontend do GitHub Pages usa `wss://` em produção.

Os comandos são mensagens JSON sobre WebSocket. O Durable Object serializa comandos, valida identidade temporária, autoria, host, fase e capacidade, persiste em SQLite e transmite snapshots aos sockets da sala.

## Client to server

### `room:create`

```json
{"requestId":"r1","nickname":"Ana"}
```

Cria a sala/Durable Object com código, host, categorias e expiração.

### `room:join`

```json
{"requestId":"r2","code":"ABCD","nickname":"Bia"}
```

O Durable Object rejeita sala inexistente/fechada, sala cheia e nickname duplicado.

### `lobby:categories:update`

```json
{"requestId":"r3","categories":["Nome","Animal","Comida"]}
```

Host-only. Rejeita categorias vazias ou duplicadas e grava uma nova versão no SQLite.

### `game:start`

```json
{"requestId":"r4"}
```

Host-only. Exige categorias válidas e pelo menos dois jogadores ativos; grava a letra e o deadline da rodada.

### `answer:submit`

```json
{"requestId":"r5","roundId":"round-1","answers":{"cat-1":"Ana","cat-2":"Arara"}}
```

Uma resposta por jogador e categoria. O Durable Object usa seu próprio relógio e aceita respostas apenas até o deadline da rodada.

### `round:stop`

```json
{"requestId":"r6","roundId":"round-1"}
```

Qualquer jogador ativo pode solicitar através do botão Stop (posicionado após as categorias na UI). O primeiro comando serializado encerra a rodada e inicia a fase de avaliação pela Categoria 1.

### `answer:invalidate`

```json
{"requestId":"r7","roundId":"round-1","categoryId":"cat-1","answerId":"p2-cat-1"}
```

Registra voto de invalidação para um termo da categoria ativa. O autor do termo é rejeitado. O mesmo requestId é idempotente.

## Server to client

### `room:state`

Snapshot autoritativo de lobby/jogo com código, fase e metadados. Na tela de configuração da sala (`lobby`), o placar e a lista de jogadores não são exibidos aos participantes.

### `round:started`

Inclui id da rodada, letra sorteada (exibida no topo direito acima do placar), categorias ordenadas e deadline absoluto de respostas.

### `round:review:category`

Enviado sequencialmente para cada tema da rodada:
```json
{
  "type": "round:review:category",
  "categoryIndex": 0,
  "totalCategories": 5,
  "category": { "id": "cat-1", "name": "Animais" },
  "answers": [
    { "playerId": "p1", "text": "Arara", "automaticValidity": "valid", "invalidations": [] },
    { "playerId": "p2", "text": "Aranha", "automaticValidity": "valid", "invalidations": [] }
  ],
  "eligibleVoters": 2,
  "deadline": 1727360000000
}
```

Apresenta todos os termos inseridos pelos jogadores para a categoria em avaliação.

### `round:review:score_update`

Transmitido imediatamente após todos os jogadores votarem na categoria atual ou o tempo limite da categoria expirar:
```json
{
  "type": "round:review:score_update",
  "categoryIndex": 0,
  "categoryScores": { "p1": 10, "p2": 10 },
  "scoreboard": [
    { "playerId": "p1", "nickname": "Ana", "score": 10 },
    { "playerId": "p2", "nickname": "Bia", "score": 10 }
  ]
}
```

Atualiza a seção de placar no lado direito da tela com a pontuação já apurada até o momento.

### `round:results`

Disparado após a avaliação de todas as categorias da rodada intermediária, contendo resumo das pontuações da rodada e placar geral.

### `game:final_results`

Disparado após a conclusão de todas as categorias da última rodada da partida:
```json
{
  "type": "game:final_results",
  "podium": [
    { "position": 1, "playerId": "p1", "nickname": "Ana", "score": 120, "tier": "gold" },
    { "position": 2, "playerId": "p2", "nickname": "Bia", "score": 95, "tier": "silver" },
    { "position": 3, "playerId": "p3", "nickname": "Carlos", "score": 80, "tier": "bronze" }
  ],
  "list": [
    { "position": 4, "playerId": "p4", "nickname": "Diego", "score": 60 }
  ]
}
```

Apresenta o placar centralizado com pódio (1º, 2º e 3º) e lista (demais participantes), com pontuações totais em todas as posições.

### `player:presence`

Inclui id, nickname e estado active/disconnected.

### `error`

```json
{"code":"ROUND_CLOSED","message":"A rodada ja foi encerrada."}
```

## Contract invariants

- O backend controla o relógio; clientes exibem countdowns a partir de deadlines enviados pelo servidor.
- Na tela de configuração da sala, o placar e a lista de jogadores não são renderizados.
- Na tela de jogo, a letra sorteada fica no lado direito acima do placar, e o botão Stop após as categorias.
- A validação ocorre sequencialmente tema a tema. A cada categoria finalizada, o placar lateral direito é atualizado com o valor já apurado.
- O autor não pode invalidar sua própria resposta; ausência de voto é tratada como concordância.
- Ao final da partida, o resultado final exibe o placar centralizado com pódio (1º a 3º) e lista (4º em diante), com pontuações em todas as posições.


# Realtime Contract: Cloudflare WebSocket

Transport: Cloudflare Worker TypeScript com WebSocket e Durable Object por sala. O frontend do GitHub Pages usa `wss://` em produção.

Os comandos sao mensagens JSON sobre WebSocket. O Durable Object serializa comandos, valida identidade temporaria, autoria, host, fase e capacidade, persiste em SQLite e transmite snapshots aos sockets da sala.

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

Qualquer jogador ativo pode solicitar. O primeiro comando serializado pelo serviço de sala move a rodada para review.

### `answer:invalidate`

```json
{"requestId":"r7","roundId":"round-1","answerId":"answer-1"}
```

Registra somente invalidação. O autor é rejeitado. O mesmo requestId é idempotente.

## Server to client

### `room:state`

Snapshot autoritativo de lobby/jogo com código, jogadores, host, categorias, fase e metadados da rodada. Nunca expõe rascunhos privados antes de review.

### `round:started`

Inclui id, letra, categorias ordenadas e deadline absoluto.

### `round:review`

Inclui respostas enviadas, validade automatica, invalidacoes, quantidade de elegiveis e deadline de 30 segundos.

### `round:results`

Inclui pontuacao base/final, razoes de invalidacao, acumulados e ranking com empates.

### `player:presence`

Inclui id, nickname e estado active/disconnected.

### `error`

```json
{"code":"ROUND_CLOSED","message":"A rodada ja foi encerrada."}
```

Known codes incluem `INVALID_NICKNAME`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `DUPLICATE_NICKNAME`, `NOT_HOST`, `INVALID_PHASE`, `INVALID_CATEGORY_LIST`, `ANSWER_NOT_FOUND`, `CANNOT_INVALIDATE_OWN_ANSWER` e `ROUND_CLOSED`.

## Contract invariants

- O backend controla o relógio; clientes exibem countdowns a partir de deadlines enviados pelo servidor.
- `round:results` só é considerado final após todos os elegíveis votarem ou o deadline de 30 segundos passar.
- Resposta automaticamente invalida tem score zero e nao se torna valida por ausencia de invalidacao.
- Unicidade e calculada entre respostas automaticamente validas antes das penalidades.
- Comandos críticos usam serialização do serviço de sala e `requestId` para permitir retry sem duplicar jogador, resposta ou invalidação.

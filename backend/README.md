# Stop Adedanha Worker

Backend realtime do Stop usando Cloudflare Workers, TypeScript e Durable Objects.

## Desenvolvimento

```bash
npm install
npm run typecheck
npm run dev
```

O Worker aceita WebSocket em `/rooms/<codigo>`. Cada codigo e roteado para um Durable Object dedicado, que sera a autoridade da sala.

## Deploy

```bash
npm run deploy
```

O deploy exige uma conta Cloudflare configurada no Wrangler. Nunca coloque tokens no frontend ou no repositorio.

## Escopo do scaffold

O scaffold cria a conexao WebSocket, a identidade temporaria da sessao e o roteamento por sala. As regras completas de lobby, rodadas, respostas, Stop, pontuacao, invalidacoes e ranking serao implementadas nas tarefas seguintes.

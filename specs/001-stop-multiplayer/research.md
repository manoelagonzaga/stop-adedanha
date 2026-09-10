# Research: Stop Multiplayer

## Decision: Cloudflare Workers e Durable Objects com TypeScript

**Rationale**: O jogo precisa sincronizar lobby, inicio de rodada, respostas, Stop, votacao e ranking entre ate 20 jogadores. Um Durable Object por sala oferece estado serializado, WebSockets, alarmes e SQLite local, permitindo que o Worker seja a autoridade do jogo.

**Alternatives considered**: Java/Gradle exigiria container ou hospedagem JVM. Firestore e Supabase simplificariam persistencia, mas mudariam o modelo de autoridade. MongoDB Atlas exigiria backend e camada realtime adicionais.

## Decision: Identidade temporaria emitida pelo Worker

**Rationale**: O produto nao exige login. Ao entrar, o Worker cria um `playerId` aleatorio associado a uma sessao WebSocket; o Durable Object valida que cada comando pertence ao jogador conectado. O nickname e unico dentro da sala, mas nao e identidade global.

**Alternatives considered**: Firebase Auth anonima adicionaria outro provedor. JWT seria desnecessario para o MVP sem persistencia de usuario.

## Decision: Dominio puro separado do Worker

**Rationale**: Regras de letra, resposta vazia, unicidade, votos de invalidacao, limiares de 10%/50% e pontuacao devem ser funcoes testaveis sem Cloudflare ou navegador. O Worker apenas valida conexao e encaminha comandos para a sala.

**Alternatives considered**: Colocar regras diretamente em handlers WebSocket dificultaria testes e misturaria transporte com dominio.

## Decision: Votação somente de invalidação

**Rationale**: O produto define que ausência de voto significa concordância e que o autor não pode votar na própria resposta. Assim, cada resposta possui uma coleção de jogadores que a invalidaram; o denominador é o número de jogadores elegíveis excluindo o autor. A fase encerra quando todos os elegíveis votam ou após 30 segundos.

**Alternatives considered**: Voto explícito de validade aumentaria cliques e permitiria estados conflitantes. Contar apenas votos registrados produziria resultado dependente da participação, contrariando a regra de concordância por omissão.

## Decision: Pontuação decimal permitida

**Rationale**: A penalidade de metade pode transformar 5 pontos em 2,5. Preservar o valor matemático evita uma regra de arredondamento escondida e mantém a penalidade proporcional.

**Alternatives considered**: Arredondar para baixo ou para cima adicionaria viés e precisaria de uma nova regra de desempate.

## Decision: Validação automática mínima

**Rationale**: A primeira versão valida apenas resposta preenchida e primeira letra, deixando validade semântica para contestação dos jogadores. Isso evita depender de dicionário ou serviço externo e preserva o caráter social do Stop.

**Alternatives considered**: Dicionário automático falharia em nomes próprios, regionalismos e respostas criativas. Moderação manual por todos tornaria o fluxo mais lento.

## Decision: Testes em três níveis

**Rationale**: Testes unitários cobrem o domínio e as bordas de pontuação; integração cobre comandos e broadcasts entre cliente/servidor; Playwright cobre duas ou mais sessões de navegador para criação de sala, Stop e ranking.

**Alternatives considered**: Apenas testes unitários não detectariam divergências de sincronização; apenas E2E seria lento e menos preciso para regras matemáticas.

## Resolved Unknowns

- Limite por sala: 20 jogadores.
- Tempo da rodada: 20 segundos por categoria, totalizado.
- Encerramento manual: qualquer jogador pode pressionar Stop.
- Votacao: apenas invalidacao, ausencia equivale a concordancia, maximo de 30 segundos.
- Persistencia: SQLite temporario em Durable Object; sem historico funcional apos encerramento.
- Hospedagem: GitHub Pages para frontend e Cloudflare Workers para backend.
- Limpeza: alarmes do Durable Object encerram salas expiradas; nao depender de TTL pago.

# Feature Specification: Limpeza Periódica de Registros no Durable Objects

**Feature Branch**: `003-scheduled-cleanup`  
**Created**: 2026-10-10  
**Status**: Draft  
**Input**: User description: "Quero fazer um agendamento de limpeza periodica no durable objects desse projeto, a cada 2 dias, as 01:00 da madrugada, todos os registros devem ser deletados, iniciando hoje."

---

## 1. Contexto e Avaliação Técnica

### 1.1 Diagnóstico do Ambiente Atual
- **Stack**: Cloudflare Workers com Durable Objects (`GameRoom`), utilizando SQLite Storage e KV Storage dentro de cada instância.
- **Roteamento de Salas**: As salas são criadas via `POST /rooms` com códigos de 6 caracteres alfanuméricos gerados aleatoriamente (`generateCode()`). Cada sala é instanciada via `env.GAME_ROOM.idFromName(roomCode)`.
- **Ausência de Descoberta Global**: O Cloudflare Workers Runtime **não** disponibiliza método para enumerar ou listar todas as instâncias existentes em um `DurableObjectNamespace` (não existe `env.GAME_ROOM.list()`).
- **Limpeza Existente**: O código atual de `GameRoom` possui um método local `expireRoomIfDue(now)` acionado por `alarm` individual por sala baseado em inatividade (`IDLE_ROOM_TTL_MS = 24h`) ou fim de jogo (`COMPLETED_ROOM_TTL_MS = 1h`). Não há coordenação global ou agendamento periódico sincronizado.

### 1.2 Requisitos Arquiteturais para Implementação
Para viabilizar a limpeza de todos os registros de Durable Objects com periodicidade de 2 dias às 01:00:
1. **Cron Trigger no Worker**:
   - Declaração de `triggers.crons` no `wrangler.jsonc`.
   - Consideração de fuso horário: O Cloudflare Cron Trigger opera estritamente em **UTC**. Como o horário de referência do projeto é UTC-3 (horário de Brasília), 01:00 BRT corresponde a **04:00 UTC**. A expressão cron para dias alternados iniciando hoje é `0 4 */2 * *` (ou `0 1 */2 * *` caso se adote UTC).
   - Manipulador `scheduled(controller, env, ctx)` no ponto de entrada do Worker (`backend/src/index.ts`).
2. **Catálogo de Salas (Room Registry / Directory)**:
   - Para que o processo de limpeza consiga encontrar todas as instâncias de `GameRoom`, é necessário registrar o código de cada sala no momento de sua criação (`POST /rooms`).
   - Abordagem canônica: Utilizar uma instância singleton do Durable Object dedicada como registro (`__system_registry__`) ou um Durable Object dedicado `RoomRegistry`, sem necessidade de adicionar serviços externos (como KV ou D1).
   - No registro, cada sala criada adiciona seu identificador. Quando a sala expira naturalmente ou é purgada, ela é desregistrada.
3. **Endpoint Interno de Purga no `GameRoom`**:
   - Criação da rota interna privada `POST https://room.internal/__purge` acessível pelo Worker.
   - Ação na instância:
     - Notificar e encerrar de forma graciosa WebSockets ativos (código `1001` - Going Away, motivo `"Manutenção periódica programada"`).
     - Executar `await this.state.storage.deleteAll()` para eliminar todos os dados gravados (`gameState`, `room`, `roundData`, `resumeCredentials`, etc.).
     - Cancelar alarmes ativos via `await this.state.storage.deleteAlarm()`.
     - Resetar o estado em memória da instância para as configurações padrão.
4. **Endpoint de Administração e Testabilidade (Manual Trigger)**:
   - Disponibilizar `POST /admin/cleanup` protegido por token de autenticação (`CRON_SECRET` ou `ADMIN_SECRET`) para permitir disparos manuais, testes de integração automatizados e manutenção emergencial sem aguardar a janela de 48 horas do cron.
5. **Estratégia de Execução Inicial ("Iniciando hoje")**:
   - O cron trigger entra em vigor no deploy. Para garantir a execução no dia corrente ou na inicialização inicial, o Worker registrará a última data de execução no registro de sistema e acionará a limpeza se o ciclo do dia não tiver ocorrido.
6. **Expurgo de Instâncias Legadas (Bootstrap Inicial)**:
   - Como instâncias foram geradas antes da criação do catálogo de salas, uma lista estática de instâncias legadas deve ser incluída no primeiro expurgo para eliminar qualquer sujeira pré-existente no Durable Objects.
   - Lista de 27 instâncias legadas identificadas:
     `J8FGR9`, `DE781CE0`, `6B41CE38`, `4B0F685E`, `577B8F22`, `STP948`, `0BEC491F`, `619B89CE`, `FA964596`, `FF84DF2C`, `A000F18E`, `TVT6AD`, `FF221452`, `6FA106FF`, `5F3497B1`, `140F9FF8`, `A8ADF241`, `999999`, `YL8YAA`, `M2H6RJ`, `T3F4C7`, `cb70738f59e44df0434969976c3758f562f5f04b65bbf851fea8dd4cbdb1ef53`, `4P37G6`, `WUPF3D`, `76B9FC`, `NH34VP`, `8SENFM`.
   - Para identificadores hexadecimais de 64 caracteres (como `cb70738f...`), o sistema deve resolver o ID tanto via `idFromString` quanto via `idFromName` garantindo a purga completa da instância.

---

## 2. User Scenarios & Testing

### User Story 1 - Execução Automática do Agendamento de Limpeza (Priority: P1)
Como operador do sistema, quero que a rotina de limpeza seja disparada automaticamente a cada 2 dias às 01:00 da madrugada, para que registros antigos e salas ociosas sejam eliminados e os recursos de armazenamento do Durable Objects permaneçam limpos.

**Why this priority**: É o requisito principal do ciclo de vida e manutenção da infraestrutura de dados da aplicação.

**Independent Test**: Simular o evento `scheduled` do Worker e validar que todas as instâncias de Durable Objects registradas têm seus dados excluídos e seus storages esvaziados.

**Acceptance Scenarios**:
1. **Given** que existem 3 salas criadas com dados salvos em storage, **When** o cron trigger dispara às 01:00 no intervalo de 2 dias, **Then** o método `scheduled` itera sobre as salas registradas, executa o expurgo de dados (`deleteAll`) em cada uma e limpa o catálogo de salas.
2. **Given** que uma sala está ativa no momento do expurgo, **When** a limpeza periódica executa, **Then** as conexões WebSocket recebem fechamento amigável (`1001` - "Manutenção periódica"), o storage da sala é deletado e alarmes são cancelados.
3. **Given** que o expurgo foi concluído, **When** uma requisição tenta acessar uma sala que existia antes da limpeza, **Then** o sistema trata o código como inexistente (`404` ou recriação limpa).

---

### User Story 2 - Rastreamento e Catálogo de Salas Ativas (Priority: P1)
Como backend do jogo, quero que cada sala criada seja automaticamente catalogada no registro central, para que o processo de limpeza global saiba exatamente quais Durable Objects devem ser limpos.

**Why this priority**: Sem catálogo de salas, o Worker não tem como mapear quais instâncias de Durable Objects foram alocadas dinamicamente.

**Independent Test**: Criar novas salas via `POST /rooms` e consultar o registro para garantir que todos os códigos criados estão listados para o próximo ciclo de limpeza.

**Acceptance Scenarios**:
1. **Given** uma requisição válida `POST /rooms`, **When** uma nova sala é alocada, **Then** o código gerado é adicionado à lista de salas ativas no registro central.
2. **Given** que uma sala expira naturalmente antes do agendamento de 2 dias, **When** a sala é limpa por inatividade, **Then** ela remove seu código do registro central de salas.

---

### User Story 3 - Disparo Manual e Observabilidade Operacional (Priority: P2)
Como desenvolvedor ou mantenedor, quero poder acionar a limpeza periódica manualmente via endpoint protegido e acompanhar logs estruturados da execução, para validar o funcionamento sem esperar 48 horas.

**Why this priority**: Essencial para garantia de qualidade, testes em ambiente de staging/local (`wrangler dev`) e auditoria de erros.

**Independent Test**: Executar uma requisição `POST /admin/cleanup` com cabeçalho de autorização válido e verificar na resposta JSON e nos logs a contagem de salas limpas, duração e status de sucesso.

**Acceptance Scenarios**:
1. **Given** um token secreto configurado, **When** uma requisição `POST /admin/cleanup` é enviada com o token correto no cabeçalho `Authorization`, **Then** a limpeza é executada imediatamente e retorna `{ success: true, roomsPurged: X, durationMs: Y }`.
2. **Given** uma requisição `POST /admin/cleanup` sem token ou com token inválido, **When** o servidor processa a chamada, **Then** a requisição é rejeitada com status HTTP `401 Unauthorized` ou `403 Forbidden`.
3. **Given** a execução do cron ou do endpoint manual, **When** uma sala específica falha ao ser limpa, **Then** o erro é capturado e registrado em log sem interromper a limpeza das demais salas.

---

## 3. Edge Cases & Tratamento de Erros

1. **Volume Alto de Salas**:
   - Se houver centenas de salas ativas, a iteração síncrona sequencial pode estourar o limite de tempo de CPU do Worker.
   - *Solução*: Processamento em batches (ex: lotes de 10 salas em paralelo com `Promise.allSettled`).
2. **Falha na Limpeza de Uma Sala Específica**:
   - Se uma instância de Durable Object estiver corrompida ou inacessível, as demais salas não devem ser prejudicadas.
   - *Solução*: Uso de `Promise.allSettled` e log de erros detalhado para cada sala não purgada.
3. **Colisão de Horários entre Partidas e Limpeza**:
   - Se jogadores estiverem jogando no exato momento da limpeza periódica (01:00 da madrugada a cada 2 dias), desconectar abruptamente causaria erros não tratados no frontend.
   - *Solução*: Envio de evento de encerramento amigável via WebSocket antes do `deleteAll`, com código `1001` informando manutenção periódica do servidor.
4. **Reinício de Ciclo e Idempotência**:
   - Caso o trigger seja acionado duas vezes consecutivas ou o catálogo esteja vazio, a rotina deve ser executada sem erros e reportar zero salas afetadas.

---

## 4. Requisitos

### Requisitos Funcionais (FR)
- **FR-001**: O sistema DEVE configurar um Cron Trigger no Worker para executar a cada 2 dias às 01:00 da madrugada (considerando fuso horário de referência).
- **FR-002**: O sistema DEVE implementar o handler `scheduled` no Cloudflare Worker para processar os disparos periódicos do cron.
- **FR-003**: O sistema DEVE manter um registro persistente de todos os códigos de salas alocados ativamente no Durable Objects.
- **FR-004**: O sistema DEVE disponibilizar uma rota interna privada em `GameRoom` para executar a exclusão total do storage (`deleteAll`), cancelamento de alarmes e reinicialização de estado.
- **FR-005**: O sistema DEVE desconectar graciosamente quaisquer conexões WebSocket ativas na sala antes de expurgar seus registros.
- **FR-006**: O sistema DEVE limpar o catálogo de salas ativas ao concluir o ciclo de expurgo.
- **FR-007**: O sistema DEVE disponibilizar um endpoint HTTP protegido (`POST /admin/cleanup`) para acionamento sob demanda e testes.
- **FR-008**: O sistema DEVE emitir logs estruturados com o número de salas purgadas, erros pontuais e tempo total de execução.
- **FR-009**: O sistema DEVE incluir na primeira rotina de limpeza as 27 instâncias legadas pré-existentes (`J8FGR9`, `DE781CE0`, `6B41CE38`, `4B0F685E`, `577B8F22`, `STP948`, `0BEC491F`, `619B89CE`, `FA964596`, `FF84DF2C`, `A000F18E`, `TVT6AD`, `FF221452`, `6FA106FF`, `5F3497B1`, `140F9FF8`, `A8ADF241`, `999999`, `YL8YAA`, `M2H6RJ`, `T3F4C7`, `cb70738f59e44df0434969976c3758f562f5f04b65bbf851fea8dd4cbdb1ef53`, `4P37G6`, `WUPF3D`, `76B9FC`, `NH34VP`, `8SENFM`), assegurando que nenhum dado residual permaneça sem expurgo.

### Entidades Chave
- **RoomRegistry**: Instância singleton ou tabela de controle responsável por manter a coleção de códigos de salas ativas.
  - Atributos: `roomCodes: Set<string>`, `lastCleanupTimestamp: number`.
- **GameRoom (Durable Object)**:
  - Método interno `purge()`: Executa `state.storage.deleteAll()`, cancela alarmes e encerra WebSockets.
- **CleanupExecutionReport**: Objeto emitido ao final da execução contendo `timestamp`, `totalRooms`, `purgedCount`, `failedCount` e `durationMs`.

---

## 5. Critérios de Sucesso (SC)
- **SC-001**: 100% dos registros persistidos das salas catalogadas são excluídos após a execução da limpeza periódica.
- **SC-002**: O agendamento periódico não interfere no funcionamento normal das salas fora da janela de manutenção.
- **SC-003**: A rotina de limpeza processa lotes de salas com tempo de resposta dentro dos limites do Cloudflare Workers sem estourar tempo limite de execução.
- **SC-004**: O endpoint manual protegido permite validação automatizada e cobertura completa por testes de integração.

---

## 6. Suposições e Decisões de Design
- **Fuso Horário**: Considera-se o horário de Brasília (UTC-3), onde 01:00 corresponde a 04:00 UTC. Caso seja adotado 01:00 UTC, a expressão cron correspondente é indicada no arquivo de configuração.
- **Armazenamento do Registro**: A lista de salas ativas é mantida através de um Durable Object singleton (`RoomRegistry` ou identificador reservado `__system_registry__`), evitando custos adicionais e sem dependência de serviços externos.
- **Comportamento das Sessões Ativas**: Partidas em andamento às 01:00 no dia de limpeza serão finalizadas graciosamente para garantir a exclusão irrestrita de todos os registros solicitada pelo requisito.

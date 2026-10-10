# Implementation Plan: Limpeza Periódica de Registros no Durable Objects

**Branch**: `003-scheduled-cleanup` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Especificação de agendamento de limpeza periódica de Durable Objects a cada 2 dias às 01:00 da madrugada com exclusão completa de registros.

---

## 1. Summary

Implementar a limpeza periódica e determinística de todas as instâncias de Durable Objects (`GameRoom`) criadas no projeto. Como a API nativa da Cloudflare não oferece enumeração global de IDs de um `DurableObjectNamespace`, a solução estrutura um registro centralizado leve de salas ativas (`RoomRegistry`), configura um Cron Trigger no Worker para rodar a cada 2 dias às 01:00 (04:00 UTC no fuso BRT) e implementa um método interno de purga nas instâncias `GameRoom` que remove completamente os dados do storage SQLite/KV, cancela alarmes e encerra WebSockets de forma amigável. Além disso, disponibiliza um endpoint administrativo seguro (`POST /admin/cleanup`) para testes automatizados e acionamento manual.

---

## 2. Technical Context

- **Linguagem & Runtime**: TypeScript 5.8+, Cloudflare Workers Runtime, Cloudflare Durable Objects.
- **Configuração de Infraestrutura**: `backend/wrangler.jsonc` com bloco de `triggers.crons`.
- **Arquitetura de Storage**:
  - `GameRoom` (Durable Object): usa SQLite e KV storage (`this.state.storage`).
  - `RoomRegistry` (Durable Object Singleton ou KV): armazena o catálogo de identificadores de salas ativas (`roomCodes`).
- **Padrão de Execução**:
  - Worker exporta handler `scheduled(controller, env, ctx)`.
  - Endpoint HTTP `POST /admin/cleanup` para auditoria e acionamento sob demanda.
- **Testes**: Vitest no backend (`backend/src/test/`), com cobertura para o handler `scheduled`, rota de purga e registro de salas.

---

## 3. Decisions & Architecture

1. **Expressão Cron & Fuso Horário**:
   - O horário estipulado é "a cada 2 dias, às 01:00 da madrugada".
   - O runtime da Cloudflare executa Cron Triggers em **UTC**. No fuso de Brasília (UTC-3), 01:00 da madrugada equivale a **04:00 UTC**.
   - Expressão cron configurada: `"0 4 */2 * *"`.
2. **Catálogo de Salas sem Dependências Externas (Room Registry)**:
   - Utilizar uma instância singleton do próprio Durable Object existente (`env.GAME_ROOM.idFromName('__system_registry__')`) ou um namespace dedicado.
   - Sempre que o Worker cria uma nova sala (`POST /rooms`), envia uma requisição interna de registro para catalogar o código.
   - Quando o Cron Trigger dispara, ele recupera todos os códigos ativos do catálogo e efetua a purga de cada um.
3. **Mecanismo de Purga no `GameRoom`**:
   - Criar rota interna `POST https://room.internal/__purge`.
   - Executa sequencialmente:
     1. Fechamento de todos os WebSockets ativos com código `1001` (Going Away) e mensagem de manutenção programada.
     2. `await this.state.storage.deleteAll()` para eliminar chaves `gameState`, `room`, `roundData`, `resumeCredentials`, etc.
     3. `await this.state.storage.deleteAlarm()` para interromper qualquer alarme agendado.
     4. Reset em memória das variáveis da sala.
4. **Execução em Lotes (Batching) e Tolerância a Falhas**:
   - Processamento de salas em blocos com concorrência controlada (ex.: 10 salas por lote via `Promise.allSettled`).
   - Evita estouro de subrequests ou limite de tempo de CPU da Cloudflare.
   - Isolamento de erros: falha em uma sala específica não aborta a limpeza das demais.
5. **Endpoint Administrativo de Auditoria**:
   - `POST /admin/cleanup` com validação de secret (`ADMIN_SECRET` / `CRON_SECRET`).
   - Permite verificar imediatamente a funcionalidade em ambientes de teste/desenvolvimento (`wrangler dev`).
6. **Inclusão de Instâncias Legadas no Primeiro Expurgo**:
   - Vetor estático de identificadores pré-existentes a ser processado na primeira execução do ciclo:
     `LEGACY_ROOM_IDS = ['J8FGR9', 'DE781CE0', '6B41CE38', '4B0F685E', '577B8F22', 'STP948', '0BEC491F', '619B89CE', 'FA964596', 'FF84DF2C', 'A000F18E', 'TVT6AD', 'FF221452', '6FA106FF', '5F3497B1', '140F9FF8', 'A8ADF241', '999999', 'YL8YAA', 'M2H6RJ', 'T3F4C7', 'cb70738f59e44df0434969976c3758f562f5f04b65bbf851fea8dd4cbdb1ef53', '4P37G6', 'WUPF3D', '76B9FC', 'NH34VP', '8SENFM']`.
   - Garante que nenhuma instância anterior ao catálogo fique com storage persistido órfão. Para o hash de 64 caracteres, a resolução tenta tanto `idFromString` quanto `idFromName`.

---

## 4. Implementation Steps

### Fase 1: Configuração do Wrangler e Definição de Tipos
- Atualizar `backend/wrangler.jsonc` adicionando a seção `triggers.crons`:
  ```jsonc
  "triggers": {
    "crons": ["0 4 */2 * *"]
  }
  ```
- Atualizar `backend/src/types.ts` ou interface `Env` em `backend/src/index.ts` para tipar o Scheduled Handler e variáveis de ambiente (como `ADMIN_SECRET`).

### Fase 2: Implementação do Catálogo de Salas (Room Registry)
- Implementar métodos de catálogo:
  - Registro de sala criada (`addRoom(code)`).
  - Consulta de todas as salas ativas (`listRooms()`).
  - Remoção/limpeza total do catálogo (`clearRooms()`).
- Integrar a chamada de registro no fluxo existente de criação de salas em `backend/src/index.ts` (`POST /rooms`).

### Fase 3: Rota Interna de Limpeza no `GameRoom`
- Adicionar o handler `POST https://room.internal/__purge` dentro de `GameRoom.fetch()`:
  - Desconectar WebSockets conectados.
  - Executar `storage.deleteAll()`.
  - Executar `storage.deleteAlarm()`.
  - Resetar variáveis de estado locais.

### Fase 4: Manipulador de Agendamento (`scheduled`) e Endpoint Admin
- Implementar função central de purga `purgeAllRooms(env: Env)`:
  - Busca a lista de salas do catálogo.
  - Itera em lotes disparando a purga em cada `GameRoom`.
  - Limpa o catálogo de salas.
  - Retorna relatório estruturado com contadores e duração.
- Conectar a função ao handler `scheduled` no `export default` do Worker.
- Conectar a função à rota `POST /admin/cleanup` com validação de token.

### Fase 5: Testes e Validação
- Criar suíte de testes em `backend/src/test/cleanup.test.ts`.
- Validar limpeza total de storage, cancelamento de alarmes, fechamento de sockets e processamento em lote.

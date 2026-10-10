# Tasks: Limpeza Periódica de Registros no Durable Objects

**Branch**: `003-scheduled-cleanup` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Task Checklist

### Fase 1: Configuração e Infraestrutura
- [x] **T-1.1**: Adicionar configuração de Cron Trigger em `backend/wrangler.jsonc` com expressão `"0 4 */2 * *"` (01:00 BRT / 04:00 UTC a cada 2 dias).
- [x] **T-1.2**: Tipar `ScheduledController`, `ExecutionContext` e `Env` no backend para incluir suporte a eventos cron e variável `ADMIN_SECRET`.

### Fase 2: Catálogo Central de Salas (Room Registry)
- [x] **T-2.1**: Implementar o gerenciamento do catálogo de códigos de salas ativas (usando DO Singleton `__system_registry__`).
- [x] **T-2.2**: Integrar o registro do código de sala no endpoint de criação `POST /rooms` em `backend/src/index.ts`.
- [x] **T-2.3**: Tratar remoção de sala do catálogo quando expirar naturalmente por inatividade.

### Fase 3: Rota Interna de Purga no `GameRoom`
- [x] **T-3.1**: Criar rota interna `POST https://room.internal/__purge` no método `fetch` do `GameRoom`.
- [x] **T-3.2**: Implementar fechamento gracioso de todas as conexões WebSocket com código `1001` e motivo explicativo.
- [x] **T-3.3**: Executar `await this.state.storage.deleteAll()` e `await this.state.storage.deleteAlarm()`.
- [x] **T-3.4**: Resetar o estado da sala em memória para os valores padrão.

### Fase 4: Orquestração do Agendamento e Endpoint Administrativo
- [x] **T-4.1**: Implementar a rotina orquestradora `purgeAllRooms(env)` com execução em lotes (`batching` com `Promise.allSettled`).
- [x] **T-4.2**: Implementar o export `scheduled` no Worker em `backend/src/index.ts`.
- [x] **T-4.3**: Implementar o endpoint `POST /admin/cleanup` com autenticação via cabeçalho `Authorization` / `ADMIN_SECRET`.
- [x] **T-4.4**: Adicionar logs estruturados registrando contadores de salas limpas, falhas e tempo total de execução.
- [x] **T-4.5**: Integrar a lista de 27 instâncias legadas (`LEGACY_ROOM_IDS`) no primeiro ciclo de purga para remoção total de dados residuais.

### Fase 5: Testes e Validação
- [x] **T-5.1**: Criar testes unitários e de integração em `backend/src/test/cleanup.test.ts`.
- [x] **T-5.2**: Testar cenário com múltiplas salas criadas, verificando a exclusão de 100% dos registros.
- [x] **T-5.3**: Testar isolamento de erros caso uma sala falhe durante o lote de purga.
- [x] **T-5.4**: Testar acionamento manual via endpoint de admin e rejeição para chamadas não autenticadas.
- [x] **T-5.5**: Validar a execução da purga para as 27 instâncias legadas (incluindo resolução de IDs hexadecimais).

const SYSTEM_REGISTRY_ROOM_NAME = '__system_registry__';

export const LEGACY_ROOM_IDS: readonly string[] = [
  'J8FGR9',
  'DE781CE0',
  '6B41CE38',
  '4B0F685E',
  '577B8F22',
  'STP948',
  '0BEC491F',
  '619B89CE',
  'FA964596',
  'FF84DF2C',
  'A000F18E',
  'TVT6AD',
  'FF221452',
  '6FA106FF',
  '5F3497B1',
  '140F9FF8',
  'A8ADF241',
  '999999',
  'YL8YAA',
  'M2H6RJ',
  'T3F4C7',
  'cb70738f59e44df0434969976c3758f562f5f04b65bbf851fea8dd4cbdb1ef53',
  '4P37G6',
  'WUPF3D',
  '76B9FC',
  'NH34VP',
  '8SENFM',
] as const;

export interface CleanupReport {
  timestamp: number;
  totalRooms: number;
  purgedCount: number;
  failedCount: number;
  durationMs: number;
  legacyIncluded: boolean;
}

export type EnvWithBindings = {
  GAME_ROOM: DurableObjectNamespace;
  ADMIN_SECRET?: string;
};

// ── Registry Helpers ─────────────────────────────────────────────────────────

function getRegistryStub(env: EnvWithBindings): DurableObjectStub {
  const registryId = env.GAME_ROOM.idFromName(SYSTEM_REGISTRY_ROOM_NAME);
  return env.GAME_ROOM.get(registryId);
}

export async function addRoomToRegistry(env: EnvWithBindings, code: string): Promise<void> {
  try {
    const stub = getRegistryStub(env);
    await stub.fetch(
      new Request('https://room.internal/__registry/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
    );
  } catch (error) {
    console.error(`[Cleanup] Failed to register room ${code}:`, error);
  }
}

export async function removeRoomFromRegistry(env: EnvWithBindings, code: string): Promise<void> {
  try {
    const stub = getRegistryStub(env);
    await stub.fetch(
      new Request('https://room.internal/__registry/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
    );
  } catch (error) {
    console.error(`[Cleanup] Failed to unregister room ${code}:`, error);
  }
}

export async function listRoomsFromRegistry(env: EnvWithBindings): Promise<string[]> {
  try {
    const stub = getRegistryStub(env);
    const resp = await stub.fetch(new Request('https://room.internal/__registry/list'));
    if (!resp.ok) return [];
    const data = (await resp.json()) as { rooms?: string[] };
    return data.rooms ?? [];
  } catch (error) {
    console.error('[Cleanup] Failed to list registered rooms:', error);
    return [];
  }
}

export async function clearRegistry(env: EnvWithBindings): Promise<void> {
  try {
    const stub = getRegistryStub(env);
    await stub.fetch(
      new Request('https://room.internal/__registry/clear', {
        method: 'POST',
      }),
    );
  } catch (error) {
    console.error('[Cleanup] Failed to clear registry:', error);
  }
}

// ── Purge Execution ──────────────────────────────────────────────────────────

export async function purgeRoomStub(stub: DurableObjectStub): Promise<boolean> {
  try {
    const resp = await stub.fetch(
      new Request('https://room.internal/__purge', {
        method: 'POST',
      }),
    );
    return resp.ok;
  } catch (error) {
    console.error('[Cleanup] Failed to purge room stub:', error);
    return false;
  }
}

export async function purgeAllRooms(
  env: EnvWithBindings,
  includeLegacy = true,
  batchSize = 10,
): Promise<CleanupReport> {
  const startTime = Date.now();
  const registeredRooms = await listRoomsFromRegistry(env);

  const targets = new Set<string>();
  for (const r of registeredRooms) {
    if (r && r !== SYSTEM_REGISTRY_ROOM_NAME) {
      targets.add(r);
    }
  }

  if (includeLegacy) {
    for (const legacyId of LEGACY_ROOM_IDS) {
      if (legacyId && legacyId !== SYSTEM_REGISTRY_ROOM_NAME) {
        targets.add(legacyId);
      }
    }
  }

  const allTargets = Array.from(targets);
  let purgedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < allTargets.length; i += batchSize) {
    const batch = allTargets.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (targetId) => {
        let purged = false;

        // If targetId is a 64-char hex string, try idFromString as well
        if (/^[0-9a-fA-F]{64}$/.test(targetId)) {
          try {
            const doId = env.GAME_ROOM.idFromString(targetId);
            const ok = await purgeRoomStub(env.GAME_ROOM.get(doId));
            if (ok) purged = true;
          } catch {
            // Ignore error and fall back to idFromName
          }
        }

        // Standard name lookup
        const nameId = env.GAME_ROOM.idFromName(targetId.toUpperCase());
        const okName = await purgeRoomStub(env.GAME_ROOM.get(nameId));
        if (okName) purged = true;

        if (!purged) {
          throw new Error(`Failed to purge ${targetId}`);
        }
        return true;
      }),
    );

    for (const res of results) {
      if (res.status === 'fulfilled') {
        purgedCount += 1;
      } else {
        failedCount += 1;
      }
    }
  }

  // Clear room registry
  await clearRegistry(env);

  const durationMs = Date.now() - startTime;
  console.log(
    `[Cleanup] Finished: ${purgedCount} purged, ${failedCount} failed of ${allTargets.length} targets in ${durationMs}ms`,
  );

  return {
    timestamp: startTime,
    totalRooms: allTargets.length,
    purgedCount,
    failedCount,
    durationMs,
    legacyIncluded: includeLegacy,
  };
}

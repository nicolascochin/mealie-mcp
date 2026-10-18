import type { LiveSeed } from './seed.js';

/** Seed data handed over by tests/live/run.ts. */
export function liveSeed(): LiveSeed {
  const raw = process.env.MEALIE_LIVE_SEED;
  if (!raw) throw new Error('MEALIE_LIVE_SEED is not set: run the live suite with `npm run test:live`');
  return JSON.parse(raw) as LiveSeed;
}

/**
 * Reads a recipe exactly as Mealie stores it, straight from the API: compare it before and after
 * a tool call to check that nothing else changed.
 */
export async function readRawRecipe(slug: string, seed: LiveSeed = liveSeed()): Promise<Record<string, unknown>> {
  const res = await fetch(`${seed.mealieUrl}/api/recipes/${encodeURIComponent(slug)}`, {
    headers: { authorization: `Bearer ${seed.token}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET recipe ${slug} answered ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

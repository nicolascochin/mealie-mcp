import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();

/** A recipe of its own: these tests change it, and delete it at the end. */
const TART: RecipeFixture = {
  name: 'Tarte aux oignons (édition)',
  ingredients: [
    { section: 'Pâte', quantity: 200, unit: 'gramme', food: 'farine' },
    { quantity: 100, unit: 'gramme', food: 'beurre' },
    { section: 'Garniture', quantity: 3, food: 'œuf' },
    { note: '2 oignons émincés' },
    { note: 'sel' },
  ],
  steps: [
    { text: 'Préparer la pâte.', ingredients: [0, 1] },
    { text: 'Garnir et cuire.', ingredients: [2, 3, 4] },
  ],
};

type Raw = Record<string, unknown>;
type RawIngredient = Raw & { referenceId: string; display?: string; food?: { name: string } | null; unit?: { name: string } | null };
const ingredientsOf = (raw: Raw) => raw.recipeIngredient as RawIngredient[];
const stepsOf = (raw: Raw) => raw.recipeInstructions as Array<Raw & { ingredientReferences: Array<{ referenceId: string }> }>;

/** Keys Mealie may change on any write. */
const TIMESTAMPS = new Set(['dateUpdated', 'updatedAt', 'updateAt', 'update_at']);

/**
 * Steps without their `id`: Mealie gives every step a new id on each write, even one that only
 * sends the ingredients (as its own interface does). Text and ingredient links must stay.
 */
const stepsWithoutIds = (raw: Raw) => stepsOf(raw).map(({ id: _id, ...step }) => step);

/** The fields a write of the ingredients must not change, all compared at once. */
function stableFields(raw: Raw, alsoChanged: string[]) {
  const fields: Raw = { recipeInstructions: stepsWithoutIds(raw) };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'recipeIngredient' || key === 'recipeInstructions' || TIMESTAMPS.has(key) || alsoChanged.includes(key)) continue;
    fields[key] = value;
  }
  for (const key of alsoChanged) delete fields[key];
  return fields;
}

/** Every top-level field except the ingredient list and timestamps is unchanged. */
function expectOnlyIngredientsChanged(before: Raw, after: Raw, alsoChanged: string[] = []) {
  expect(stableFields(after, alsoChanged)).toEqual(stableFields(before, alsoChanged));
}

let app: TestApp;
let client: Client;
let slug: string;
let before: Raw;

beforeAll(async () => {
  slug = await createFixtureRecipe(seed.mealieUrl, seed.token, TART);
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (slug) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token);
});
beforeEach(async () => {
  before = await readRawRecipe(slug);
});

const edit = (args: Record<string, unknown>) => callJson(client, 'mealie_edit_ingredients', { slug, ...args });

describe('mealie_edit_ingredients against a real Mealie', () => {
  it('changes one quantity and nothing else, to the JSON', async () => {
    await edit({ operations: [{ op: 'update', n: 3, quantity: 4 }] });
    const after = await readRawRecipe(slug);
    const [b, a] = [ingredientsOf(before), ingredientsOf(after)];
    expect(a).toHaveLength(5);
    for (const i of [0, 1, 3, 4]) expect(a[i], `ingredient ${i + 1}`).toEqual(b[i]);
    expect(a[2]).toMatchObject({ referenceId: b[2]!.referenceId, quantity: 4, title: 'Garniture', food: { name: 'œuf' } });
    expect(a[2]!.display).toContain('4');
    expect(a[2]!.display).not.toBe(b[2]!.display);
    expectOnlyIngredientsChanged(before, after);
  });

  it('changes a food by name and keeps its unit and quantity', async () => {
    await edit({ operations: [{ op: 'update', n: 2, food: 'creme fraiche' }] });
    const after = ingredientsOf(await readRawRecipe(slug));
    expect(after[1]).toMatchObject({ quantity: 100, unit: { name: 'gramme' }, food: { name: 'crème fraîche' } });
    expect(after[0]).toEqual(ingredientsOf(before)[0]);
  });

  it('structures a free-text ingredient and keeps its original text', async () => {
    const result = await edit({ operations: [{ op: 'update', n: 4, quantity: 2, food: 'oignons', note: 'émincés' }] });
    const after = ingredientsOf(await readRawRecipe(slug));
    expect(after[3]).toMatchObject({ quantity: 2, food: { name: 'oignon' }, note: 'émincés', originalText: '2 oignons émincés' });
    expect((result as { ingredients: Raw[] }).ingredients[3]).not.toHaveProperty('freeText');
  });

  it('refuses an unknown food with suggestions and leaves the recipe untouched', async () => {
    const result = await client.callTool({ name: 'mealie_edit_ingredients', arguments: { slug, operations: [{ op: 'update', n: 1, food: 'farinne' }] } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('Close matches: "farine"');
    expect(await readRawRecipe(slug)).toEqual(before);
  });

  it('creates a missing food on request and adds it in a new section', async () => {
    await edit({ operations: [{ op: 'add', after: 5, quantity: 1, unit: 'cuillère à soupe', food: 'ciboulette', section: 'Finition' }], createMissing: true });
    const after = ingredientsOf(await readRawRecipe(slug));
    expect(after).toHaveLength(6);
    expect(after[5]).toMatchObject({ title: 'Finition', food: { name: 'ciboulette' }, unit: { name: 'cuillère à soupe' } });
    expect(after.slice(0, 5)).toEqual(ingredientsOf(before));
    expect(await callJson(client, 'mealie_search_foods', { name: 'ciboulette' })).toMatchObject({ status: 'found' });
  });

  it('moves an ingredient and keeps every step link', async () => {
    await edit({ operations: [{ op: 'move', n: 6, after: 0 }] });
    const after = await readRawRecipe(slug);
    const ids = ingredientsOf(after).map((i) => i.referenceId);
    const prev = ingredientsOf(before).map((i) => i.referenceId);
    expect(ids).toEqual([prev[5], ...prev.slice(0, 5)]);
    expect(stepsWithoutIds(after)).toEqual(stepsWithoutIds(before));
  });

  it('refuses to delete a linked ingredient, then unlinks it on request', async () => {
    const refused = await client.callTool({ name: 'mealie_edit_ingredients', arguments: { slug, operations: [{ op: 'delete', n: 2 }] } });
    expect(toolText(refused)).toContain('used by step 1');
    expect(await readRawRecipe(slug)).toEqual(before);

    const removed = ingredientsOf(before)[1]!.referenceId;
    await edit({ operations: [{ op: 'delete', n: 2 }], unlinkSteps: true });
    const after = await readRawRecipe(slug);
    expect(ingredientsOf(after).map((i) => i.referenceId)).not.toContain(removed);
    const [step1, step2] = stepsWithoutIds(after);
    const [before1, before2] = stepsWithoutIds(before);
    expect(step1).toEqual({ ...before1, ingredientReferences: stepsOf(before)[0]!.ingredientReferences.filter((r) => r.referenceId !== removed) });
    expect(step2).toEqual(before2);
    expectOnlyIngredientsChanged(before, after, ['recipeInstructions']);
  });

  it('leaves the recipe fully structured', async () => {
    const view = await callJson<{ ingredients: Raw[]; warnings?: string[] }>(client, 'mealie_get_recipe', { slug });
    expect(view.ingredients.filter((i) => i.freeText).map((i) => i.note)).toEqual(['sel']);
  });
});

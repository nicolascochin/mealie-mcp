import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();

const FOODS = [
  { name: 'ciboulette (tests)', pluralName: null, aliases: [] },
  { name: 'ciboulette ciselée (tests)', pluralName: null, aliases: [{ name: 'cive (tests)' }] },
];
const UNITS = [
  { name: 'botte (tests)', pluralName: 'bottes (tests)', abbreviation: '', aliases: [] },
  { name: 'bouquet (tests)', pluralName: 'bouquets (tests)', abbreviation: 'bqt', aliases: [] },
];

/** Uses both duplicates, so that a merge has ingredients to move. */
const OMELETTE: RecipeFixture = {
  name: 'Omelette aux fines herbes (fusion)',
  ingredients: [
    { quantity: 3, food: 'œuf' },
    { quantity: 1, unit: 'botte (tests)', food: 'ciboulette (tests)', note: 'fraîche' },
    { quantity: 2, unit: 'bouquet (tests)', food: 'ciboulette ciselée (tests)', note: 'pour servir' },
  ],
  steps: [{ text: 'Battre les œufs avec les herbes.', ingredients: [0, 1, 2] }],
};

interface Entry {
  id: string;
  name: string;
}

let app: TestApp;
let client: Client;
let slug: string;
const created: { foods: Entry[]; units: Entry[] } = { foods: [], units: [] };

const list = async (path: string) => (await call<{ items: Entry[] }>(seed.mealieUrl, 'GET', `${path}?page=1&perPage=-1`, seed.token)).items;

/** The ingredients as Mealie stores them, with catalog entries reduced to their id. */
async function rawIngredients() {
  const recipe = await readRawRecipe(slug);
  return (recipe.recipeIngredient as Array<Record<string, unknown>>).map(({ display: _display, food, unit, ...rest }) => ({
    ...rest,
    food: (food as Entry | null)?.id ?? null,
    unit: (unit as Entry | null)?.id ?? null,
  }));
}

beforeAll(async () => {
  for (const food of FOODS) created.foods.push(await call<Entry>(seed.mealieUrl, 'POST', '/api/foods', seed.token, food));
  for (const unit of UNITS) {
    created.units.push(await call<Entry>(seed.mealieUrl, 'POST', '/api/units', seed.token, { ...unit, useAbbreviation: false, fraction: true }));
  }
  slug = await createFixtureRecipe(seed.mealieUrl, seed.token, OMELETTE);
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (slug) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token);
  const remove = async (path: string, entries: Entry[]) => {
    const left = new Set((await list(path)).map((entry) => entry.id));
    for (const entry of entries) if (left.has(entry.id)) await call(seed.mealieUrl, 'DELETE', `${path}/${entry.id}`, seed.token);
  };
  await remove('/api/foods', created.foods);
  await remove('/api/units', created.units);
});

describe('catalog editing tools against a real Mealie', () => {
  it('updates a food: plural and aliases, then finds it by the new alias', async () => {
    expect(
      await callJson(client, 'mealie_update_food', { food: 'ciboulette (tests)', pluralName: 'ciboulettes (tests)', addAliases: ['civette (tests)'] })
    ).toEqual({ updated: { name: 'ciboulette (tests)', pluralName: 'ciboulettes (tests)', aliases: ['civette (tests)'] } });
    expect(await callJson(client, 'mealie_search_foods', { name: 'Civette (tests)' })).toMatchObject({
      status: 'found',
      match: { name: 'ciboulette (tests)' },
    });
    const clash = await client.callTool({ name: 'mealie_update_food', arguments: { food: 'ciboulette (tests)', addAliases: ['oignons'] } });
    expect(toolText(clash)).toContain('"oignons" already names the food "oignon"');
  });

  it('merges two foods: the recipe keeps its structured ingredients, now on the food that stays', async () => {
    const before = await rawIngredients();
    const [kept, duplicate] = created.foods;
    const merged = await callJson<{ merged: string; into: { name: string; aliases: string[] }; addedAliases: string[] }>(client, 'mealie_merge_foods', {
      from: 'cive (tests)',
      into: 'ciboulette (tests)',
    });
    expect(merged).toMatchObject({ merged: 'ciboulette ciselée (tests)', into: { name: 'ciboulette (tests)' } });
    expect(merged.addedAliases).toEqual(['ciboulette ciselée (tests)', 'cive (tests)']);
    // Mealie does not keep the order of aliases.
    expect([...merged.into.aliases].sort()).toEqual(['ciboulette ciselée (tests)', 'cive (tests)', 'civette (tests)']);
    expect(await rawIngredients()).toEqual(before.map((ingredient) => (ingredient.food === duplicate!.id ? { ...ingredient, food: kept!.id } : ingredient)));
    expect((await list('/api/foods')).map((food) => food.id)).not.toContain(duplicate!.id);
    expect(await callJson(client, 'mealie_search_foods', { name: 'ciboulette ciselee (tests)' })).toMatchObject({
      status: 'found',
      match: { name: 'ciboulette (tests)' },
    });
  });

  it('merges two units, keeping the abbreviation of the merged unit as an alias', async () => {
    const before = await rawIngredients();
    const [kept, duplicate] = created.units;
    expect(await callJson(client, 'mealie_merge_units', { from: 'bqt', into: 'botte (tests)' })).toMatchObject({
      merged: 'bouquet (tests)',
      addedAliases: ['bouquet (tests)', 'bouquets (tests)', 'bqt'],
    });
    expect(await rawIngredients()).toEqual(before.map((ingredient) => (ingredient.unit === duplicate!.id ? { ...ingredient, unit: kept!.id } : ingredient)));
    expect(await callJson(client, 'mealie_search_units', { name: 'bouquets (tests)' })).toMatchObject({ match: { name: 'botte (tests)' } });
  });

  it('refuses to merge a food into itself', async () => {
    const same = await client.callTool({ name: 'mealie_merge_foods', arguments: { from: 'ciboulettes (tests)', into: 'civette (tests)' } });
    expect(toolText(same)).toContain('nothing to merge');
  });
});

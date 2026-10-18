import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();
const BATCH = 'Lot du dimanche (tests)';

const fixture = (name: string, tags: string[]): RecipeFixture => ({
  name,
  tags,
  ingredients: [
    { section: 'Base', quantity: 2, food: 'œuf' },
    { quantity: 20, unit: 'centilitre', food: 'lait', note: 'tiède' },
  ],
  steps: [{ text: 'Mélanger.', ingredients: [0, 1] }],
});
const FIXTURES = [fixture('Flan (lot)', []), fixture('Gratin (lot)', ['Hiver']), fixture('Omelette (lot)', ['Rapide'])];

let app: TestApp;
let client: Client;
let slugs: string[] = [];

const tagNames = async (slug: string) => ((await readRawRecipe(slug)).tags as Array<{ name: string }>).map((tag) => tag.name).sort();

beforeAll(async () => {
  for (const recipe of FIXTURES) slugs.push(await createFixtureRecipe(seed.mealieUrl, seed.token, recipe));
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  for (const slug of slugs) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token).catch(() => undefined);
  const { items } = await call<{ items: Array<{ id: string; name: string }> }>(seed.mealieUrl, 'GET', '/api/organizers/tags?page=1&perPage=-1', seed.token);
  for (const tag of items.filter((t) => t.name === BATCH)) await call(seed.mealieUrl, 'DELETE', `/api/organizers/tags/${tag.id}`, seed.token);
});

describe('bulk recipe actions against a real Mealie', () => {
  it('tags three recipes in one call, keeping their tags and their ingredients', async () => {
    const before = await Promise.all(slugs.map((slug) => readRawRecipe(slug)));
    expect(await callJson(client, 'mealie_tag_recipes', { slugs, tags: [BATCH], createMissing: true })).toEqual({
      tags: [BATCH],
      updated: FIXTURES.map((f) => f.name),
    });
    expect(await Promise.all(slugs.map(tagNames))).toEqual([[BATCH], ['Hiver', BATCH], [BATCH, 'Rapide']]);
    const after = await Promise.all(slugs.map((slug) => readRawRecipe(slug)));
    expect(after.map((r) => r.recipeIngredient)).toEqual(before.map((r) => r.recipeIngredient));
  });

  it('adds only what each recipe lacks, without duplicating a tag', async () => {
    expect(await callJson(client, 'mealie_tag_recipes', { slugs, tags: [BATCH, 'Hiver'] })).toEqual({
      tags: [BATCH, 'Hiver'],
      updated: ['Flan (lot)', 'Omelette (lot)'],
      alreadyThere: ['Gratin (lot)'],
    });
    expect(await Promise.all(slugs.map(tagNames))).toEqual([
      ['Hiver', BATCH],
      ['Hiver', BATCH],
      ['Hiver', BATCH, 'Rapide'],
    ]);
  });

  it('adds a category to several recipes', async () => {
    expect(await callJson(client, 'mealie_categorize_recipes', { slugs: slugs.slice(0, 2), categories: ['plat'] })).toMatchObject({
      categories: ['Plat'],
      updated: ['Flan (lot)', 'Gratin (lot)'],
    });
    const categories = ((await readRawRecipe(slugs[1]!)).recipeCategory as Array<{ name: string }>).map((c) => c.name);
    expect(categories).toEqual(['Plat']);
  });

  it('refuses an unknown slug without changing anything, then deletes two recipes in one call', async () => {
    const refused = await client.callTool({ name: 'mealie_delete_recipes', arguments: { slugs: [slugs[0], 'recette-inexistante'] } });
    expect(toolText(refused)).toContain('Nothing was changed.');
    await readRawRecipe(slugs[0]!);

    expect(await callJson(client, 'mealie_delete_recipes', { slugs: slugs.slice(0, 2) })).toEqual({ deleted: ['Flan (lot)', 'Gratin (lot)'] });
    for (const slug of slugs.slice(0, 2)) await expect(readRawRecipe(slug)).rejects.toThrow('answered 404');
    slugs = slugs.slice(2);
  });
});

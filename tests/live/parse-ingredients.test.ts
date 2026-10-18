import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();

/** A recipe as an import leaves it: every ingredient is a line of free text. */
const IMPORTED: RecipeFixture = {
  name: 'Velouté importé (parseur)',
  ingredients: [{ note: '250 g farine' }, { note: '4 oignons' }, { note: '50 cl lait' }],
  steps: [{ text: 'Tout mélanger.', ingredients: [0, 1, 2] }],
};

interface Proposal {
  n: number;
  input: string;
  quantity?: number;
  unit?: string;
  food?: string;
  foodInCatalog?: boolean;
}

let app: TestApp;
let client: Client;
let slug: string;

beforeAll(async () => {
  slug = await createFixtureRecipe(seed.mealieUrl, seed.token, IMPORTED);
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (slug) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token);
});

describe('mealie_parse_ingredients against a real Mealie', () => {
  it.each(['nlp', 'brute'])('parses quantities and matches catalog foods with the %s parser', async (parser) => {
    const before = await readRawRecipe(slug);
    const { proposals } = await callJson<{ proposals: Proposal[] }>(client, 'mealie_parse_ingredients', { slug, parser });
    expect(proposals.map((p) => p.input)).toEqual(['250 g farine', '4 oignons', '50 cl lait']);
    expect(proposals.map((p) => p.quantity)).toEqual([250, 4, 50]);
    expect(proposals.find((p) => p.n === 1)).toMatchObject({ food: 'farine', foodInCatalog: true });
    expect(await readRawRecipe(slug)).toEqual(before);
  });

  it('structures the whole recipe in two calls and keeps the original text', async () => {
    const { operations } = await callJson<{ operations: unknown[] }>(client, 'mealie_parse_ingredients', { slug });
    await callJson(client, 'mealie_edit_ingredients', { slug, operations, createMissing: true });
    const recipe = await callJson<{ ingredients: Array<Record<string, unknown>>; warnings?: string[] }>(client, 'mealie_get_recipe', { slug });
    expect(recipe.ingredients.filter((i) => i.freeText)).toEqual([]);
    expect(recipe.ingredients[0]).toMatchObject({ quantity: 250, food: 'farine', originalText: '250 g farine' });
    expect(recipe.warnings).toBeUndefined();
    expect((await callJson<{ proposals: unknown[] }>(client, 'mealie_parse_ingredients', { slug })).proposals).toEqual([]);
  });
});

import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, type TestApp } from '../helpers/app.js';
import { RECIPES } from './fixtures.js';
import { liveSeed } from './helpers.js';

const seed = liveSeed();
let app: TestApp;
let client: Client;

interface SearchResult {
  total: number;
  recipes: Array<{ slug: string; name: string; tags?: string[]; totalTime?: unknown; legacyCookTime?: string }>;
}

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
});

const names = (result: SearchResult) => result.recipes.map((recipe) => recipe.name);

describe('mealie_search_recipes against a real Mealie', () => {
  it('lists every recipe sorted by name, with times and tags', async () => {
    const result = await callJson<SearchResult>(client, 'mealie_search_recipes', {});
    expect(names(result)).toEqual(RECIPES.map((r) => r.name).sort((a, b) => a.localeCompare(b)));
    expect(result.recipes.find((r) => r.name === 'Crêpes')).toMatchObject({
      totalTime: { minutes: 30, text: 'plus 1 h de repos' },
      tags: ['Rapide', 'Végétarien'],
    });
    // A time still in text, and the old cooking time Mealie no longer shows.
    expect(result.recipes.find((r) => r.name === "Soupe à l'oignon")).toMatchObject({ totalTime: { text: '45 min' }, legacyCookTime: '30 min' });
  });

  it('searches text', async () => {
    expect(names(await callJson<SearchResult>(client, 'mealie_search_recipes', { query: 'quiche' }))).toEqual(['Quiche lorraine']);
  });

  it('filters by tag, category and food names', async () => {
    expect(names(await callJson<SearchResult>(client, 'mealie_search_recipes', { tags: ['vegetarien'] }))).toEqual(['Crêpes']);
    expect(names(await callJson<SearchResult>(client, 'mealie_search_recipes', { categories: ['Plat'] }))).toEqual([
      'Quiche lorraine',
      "Soupe à l'oignon",
    ]);
    expect(names(await callJson<SearchResult>(client, 'mealie_search_recipes', { foods: ['lait'] }))).toEqual(['Crêpes']);
    expect(names(await callJson<SearchResult>(client, 'mealie_search_recipes', { foods: ['beurre', 'lardons'], matchAll: true }))).toEqual([
      'Quiche lorraine',
    ]);
  });

  it.each(['name', 'newest', 'updated', 'rating', 'last_made'])('accepts sort %s', async (sort) => {
    expect((await callJson<SearchResult>(client, 'mealie_search_recipes', { sort })).total).toBe(RECIPES.length);
  });

  it('paginates', async () => {
    const first = await callJson<SearchResult & { totalPages: number }>(client, 'mealie_search_recipes', { perPage: 2 });
    const second = await callJson<SearchResult>(client, 'mealie_search_recipes', { perPage: 2, page: 2 });
    expect(first.totalPages).toBe(2);
    expect([...names(first), ...names(second)]).toHaveLength(RECIPES.length);
  });
});

describe('mealie_get_recipe against a real Mealie', () => {
  it('shows each ingredient with its unit and food, and each step with its ingredients', async () => {
    const recipe = await callJson<Record<string, unknown>>(client, 'mealie_get_recipe', { slug: seed.recipes['Quiche lorraine'] });
    expect(recipe).toMatchObject({
      name: 'Quiche lorraine',
      prepTime: { minutes: 20 },
      totalTime: { hours: 1 },
      cookTime: { minutes: 35, text: 'à 180 °C' },
      tags: ['Classique'],
      categories: ['Plat'],
      notes: [{ title: 'Astuce', text: 'Précuire la pâte 10 minutes.' }],
      ingredients: [
        { n: 1, section: 'Pâte', quantity: 250, unit: 'gramme', food: 'farine' },
        { n: 2, quantity: 125, unit: 'gramme', food: 'beurre', note: 'mou' },
        { n: 3, section: 'Garniture', quantity: 200, unit: 'gramme', food: 'lardons' },
        { n: 4, quantity: 3, food: 'œuf' },
        { n: 5, quantity: 20, unit: 'centilitre', food: 'crème fraîche' },
        { n: 6, note: 'sel, poivre', freeText: true },
      ],
      steps: [
        { n: 1, ingredients: [1, 2] },
        { n: 2, ingredients: [3] },
        { n: 3, ingredients: [4, 5, 6] },
      ],
      warnings: [expect.stringContaining('Ingredients 6 are free text')],
    });
    expect(JSON.stringify(recipe)).not.toContain('referenceId');
  });

  it('shows the old cooking time apart, and says how to move it', async () => {
    const recipe = await callJson<Record<string, unknown>>(client, 'mealie_get_recipe', { slug: seed.recipes["Soupe à l'oignon"] });
    expect(recipe).not.toHaveProperty('cookTime');
    expect(recipe).toMatchObject({ totalTime: { text: '45 min' }, legacyCookTime: '30 min' });
    expect(recipe.warnings).toEqual([expect.stringContaining('Mealie no longer shows the old cooking time "30 min"')]);
  });

  it('includes the line as Mealie displays it', async () => {
    const recipe = await callJson<{ ingredients: Array<{ display?: string }> }>(client, 'mealie_get_recipe', {
      slug: seed.recipes["Soupe à l'oignon"],
    });
    expect(recipe.ingredients[0]!.display).toContain('oignon');
  });
});

describe('mealie_suggest_recipes against a real Mealie', () => {
  it('suggests crêpes from flour, eggs and milk', async () => {
    const result = await callJson<{ recipes: Array<{ name: string; missingFoods: string[] }> }>(client, 'mealie_suggest_recipes', {
      foods: ['farine', 'oeufs', 'lait'],
    });
    expect(result.recipes.find((r) => r.name === 'Crêpes')).toMatchObject({ missingFoods: [] });
  });
});

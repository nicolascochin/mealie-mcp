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
    const crepes = result.recipes.find((r) => r.name === 'Crêpes');
    expect(crepes).toMatchObject({ totalTime: { minutes: 30, text: 'plus 1 h de repos' } });
    // Tags come back in Mealie's order, which changed in v3.31.
    expect([...(crepes?.tags ?? [])].sort()).toEqual(['Rapide', 'Végétarien']);
    // A time still in text, and the old cooking time, which Mealie v3.31 moved to the one it shows.
    const soup = result.recipes.find((r) => r.name === "Soupe à l'oignon");
    expect(soup).toMatchObject({ totalTime: { text: '45 min' }, cookTime: { text: '30 min' } });
    expect(soup).not.toHaveProperty('legacyCookTime');
  });

  it('sorts the quickest recipes first, those without a total time last', async () => {
    const result = await callJson<SearchResult>(client, 'mealie_search_recipes', { sort: 'quickest' });
    const hasDuration = (r: SearchResult['recipes'][number]) => {
      const time = r.totalTime as { hours?: number; minutes?: number } | undefined;
      return Boolean(time?.hours || time?.minutes);
    };
    const timed = result.recipes.filter(hasDuration);
    expect(timed.map((r) => r.name).slice(0, 2)).toEqual(['Crêpes', 'Quiche lorraine']);
    expect(result.recipes.slice(0, timed.length)).toEqual(timed);
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

  it('shows an old cooking time as the cooking time, where Mealie v3.31 moved it', async () => {
    const recipe = await callJson<Record<string, unknown>>(client, 'mealie_get_recipe', { slug: seed.recipes["Soupe à l'oignon"] });
    expect(recipe).toMatchObject({ totalTime: { text: '45 min' }, cookTime: { text: '30 min' } });
    expect(recipe).not.toHaveProperty('legacyCookTime');
    expect(JSON.stringify(recipe.warnings ?? [])).not.toContain('old cooking time');
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

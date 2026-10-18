import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call } from './seed.js';

const seed = liveSeed();

type Raw = Record<string, any>;
/** Mealie gives steps a new id on each write: compare them without it. */
const stepsWithoutIds = (raw: Raw) => (raw.recipeInstructions as Raw[]).map(({ id: _id, ...step }) => step);

let app: TestApp;
let client: Client;
/** Recipes these tests create, removed at the end whatever happens. */
const created = new Set<string>();
let slug: string;

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  for (const s of created) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(s)}`, seed.token).catch(() => undefined);
});

describe('recipe lifecycle against a real Mealie', () => {
  it('creates a recipe with structured ingredients and linked steps', async () => {
    const recipe = await callJson<Raw>(client, 'mealie_create_recipe', {
      name: 'Pâte à crêpes (créée par Claude)',
      description: 'Pour 12 crêpes.',
      totalTime: '1 h 15',
      servings: 4,
      tags: ['rapide'],
      categories: ['Dessert'],
      ingredients: [
        { quantity: 250, unit: 'g', food: 'farine', section: 'Pâte' },
        { quantity: 4, food: 'oeufs' },
        { quantity: 50, unit: 'cl', food: 'lait' },
        { note: 'une pincée de sel' },
      ],
      steps: [
        { text: 'Mélanger la farine et les œufs.', ingredients: [1, 2] },
        { text: 'Ajouter le lait petit à petit.', ingredients: [3] },
      ],
    });
    slug = recipe.slug;
    created.add(slug);
    expect(recipe).toMatchObject({
      name: 'Pâte à crêpes (créée par Claude)',
      description: 'Pour 12 crêpes.',
      totalTime: '1 h 15',
      servings: 4,
      tags: ['Rapide'],
      categories: ['Dessert'],
      ingredients: [
        { n: 1, section: 'Pâte', quantity: 250, unit: 'gramme', food: 'farine' },
        { n: 2, quantity: 4, food: 'œuf' },
        { n: 3, quantity: 50, unit: 'centilitre', food: 'lait' },
        { n: 4, note: 'une pincée de sel', freeText: true },
      ],
      steps: [
        { n: 1, ingredients: [1, 2] },
        { n: 2, ingredients: [3] },
      ],
    });
    const raw = (await readRawRecipe(slug)) as Raw;
    expect(raw.recipeIngredient[0].display).toContain('farine');
    if (raw.settings && 'disableAmount' in raw.settings) expect(raw.settings.disableAmount).toBe(false);
  });

  it('creates nothing when a name is unknown', async () => {
    const before = await callJson<{ total: number }>(client, 'mealie_search_recipes', {});
    const result = await client.callTool({ name: 'mealie_create_recipe', arguments: { name: 'Raté', ingredients: [{ food: 'farinne' }] } });
    expect(toolText(result)).toContain('Close matches: "farine"');
    expect((await callJson<{ total: number }>(client, 'mealie_search_recipes', {})).total).toBe(before.total);
  });

  it('changes tags and details without touching ingredients or steps', async () => {
    const before = await readRawRecipe(slug);
    const result = await callJson<Raw>(client, 'mealie_update_recipe', {
      slug,
      tags: ['Végétarien', 'Rapide'],
      prepTime: '15 min',
      notes: [{ title: 'Repos', text: 'Laisser reposer une heure.' }],
    });
    expect(result).toMatchObject({ tags: ['Végétarien', 'Rapide'], prepTime: '15 min', notes: [{ title: 'Repos', text: 'Laisser reposer une heure.' }] });
    const after = await readRawRecipe(slug);
    expect(after.recipeIngredient).toEqual(before.recipeIngredient);
    expect(stepsWithoutIds(after)).toEqual(stepsWithoutIds(before));
    expect(after.description).toBe(before.description);
    expect(after.recipeCategory).toEqual(before.recipeCategory);
  });

  it('marks a recipe as made', async () => {
    await callJson(client, 'mealie_mark_recipe_made', { slug, date: '2026-10-12' });
    expect(String((await readRawRecipe(slug)).lastMade)).toContain('2026-10-12');
  });

  it('duplicates a recipe with its structured ingredients', async () => {
    const copy = await callJson<{ slug: string; name: string }>(client, 'mealie_duplicate_recipe', { slug, name: 'Pâte à crêpes (copie)' });
    created.add(copy.slug);
    expect(copy.name).toBe('Pâte à crêpes (copie)');
    const recipe = await callJson<Raw>(client, 'mealie_get_recipe', { slug: copy.slug });
    expect(recipe.ingredients.map((i: Raw) => i.food ?? null)).toEqual(['farine', 'œuf', 'lait', null]);
  });

  it('reports an import Mealie cannot do as an error, not a crash', async () => {
    const result = await client.callTool({ name: 'mealie_import_recipe_from_url', arguments: { url: 'http://127.0.0.1:1/recette' } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).not.toContain('Not found in Mealie');
    expect(toolText(result)).not.toContain('Unexpected');
  });

  it('deletes a recipe', async () => {
    expect(await callJson(client, 'mealie_delete_recipe', { slug })).toEqual({ deleted: 'Pâte à crêpes (créée par Claude)' });
    created.delete(slug);
    const result = await client.callTool({ name: 'mealie_get_recipe', arguments: { slug } });
    expect(toolText(result)).toContain('Not found in Mealie');
  });
});

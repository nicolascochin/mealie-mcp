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
      totalTime: { hours: 1, minutes: 15 },
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
      totalTime: { hours: 1, minutes: 15 },
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
    expect(raw.totalTimeSeconds).toBe(4500);
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
      prepTime: { minutes: 15 },
      notes: [{ title: 'Repos', text: 'Laisser reposer une heure.' }],
    });
    expect(result).toMatchObject({ prepTime: { minutes: 15 }, notes: [{ title: 'Repos', text: 'Laisser reposer une heure.' }] });
    // Tags are a set: Mealie returns them in its own order.
    expect([...(result.tags as string[])].sort()).toEqual(['Rapide', 'Végétarien']);
    const after = await readRawRecipe(slug);
    expect(after.recipeIngredient).toEqual(before.recipeIngredient);
    expect(stepsWithoutIds(after)).toEqual(stepsWithoutIds(before));
    expect(after.description).toBe(before.description);
    expect(after.recipeCategory).toEqual(before.recipeCategory);
  });

  it('sets the cooking time in the hours and minutes Mealie shows', async () => {
    const before = await readRawRecipe(slug);
    const result = await callJson<Raw>(client, 'mealie_update_recipe', { slug, cookTime: { hours: 1, minutes: 30 } });
    expect(result.cookTime).toEqual({ hours: 1, minutes: 30 });
    // Mealie's interface splits performTimeSeconds into its hours and minutes fields.
    const after = await readRawRecipe(slug);
    expect(after).toMatchObject({ performTimeSeconds: 5400, totalTimeSeconds: 4500, prepTimeSeconds: 900 });
    expect(after.cookTime ?? '').toBe('');
    expect(after.recipeIngredient).toEqual(before.recipeIngredient);
  });

  it('keeps the text shown after a duration when only the duration changes', async () => {
    await callJson(client, 'mealie_update_recipe', { slug, cookTime: { text: 'à la poêle' } });
    const result = await callJson<Raw>(client, 'mealie_update_recipe', { slug, cookTime: { minutes: 45 } });
    expect(result.cookTime).toEqual({ minutes: 45, text: 'à la poêle' });
    expect(await readRawRecipe(slug)).toMatchObject({ performTimeSeconds: 2700, performTime: 'à la poêle' });
  });

  it('clears the duration of a time, then the whole time', async () => {
    const result = await callJson<Raw>(client, 'mealie_update_recipe', { slug, cookTime: { hours: 0, minutes: 0 } });
    expect(result.cookTime).toEqual({ text: 'à la poêle' });
    expect((await readRawRecipe(slug)).performTimeSeconds).toBeNull();

    const cleared = await callJson<Raw>(client, 'mealie_update_recipe', { slug, cookTime: null });
    expect(cleared).not.toHaveProperty('cookTime');
    const raw = await readRawRecipe(slug);
    expect(raw.performTimeSeconds).toBeNull();
    expect(raw.performTime ?? '').toBe('');
    expect(raw.totalTimeSeconds).toBe(4500);
  });

  it('moves the old cooking time to the one Mealie shows, and clears it', async () => {
    await call(seed.mealieUrl, 'PATCH', `/api/recipes/${encodeURIComponent(slug)}`, seed.token, { cookTime: '20 min' });
    const read = await callJson<Raw>(client, 'mealie_get_recipe', { slug });
    expect(read.legacyCookTime).toBe('20 min');
    expect(read.warnings).toEqual(expect.arrayContaining([expect.stringContaining('legacyCookTime: null')]));

    const result = await callJson<Raw>(client, 'mealie_update_recipe', { slug, cookTime: { minutes: 20 }, legacyCookTime: null });
    expect(result.cookTime).toEqual({ minutes: 20 });
    expect(result).not.toHaveProperty('legacyCookTime');
    expect(result).not.toHaveProperty('warnings');
    const raw = await readRawRecipe(slug);
    expect(raw.performTimeSeconds).toBe(1200);
    expect(raw.cookTime ?? '').toBe('');
  });

  it('marks a recipe as made', async () => {
    await callJson(client, 'mealie_mark_recipe_made', { slug, date: '2026-10-12' });
    // Since Mealie v2, "last made" is stored per household, not on the recipe.
    const household = await call<Raw>(seed.mealieUrl, 'GET', `/api/households/self/recipes/${encodeURIComponent(slug)}`, seed.token);
    expect(String(household.lastMade), JSON.stringify(household)).toContain('2026-10-12');
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

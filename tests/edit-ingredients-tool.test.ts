import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealieRecipe } from '../src/mealie/types.js';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

const page = <T>(items: T[]) => ({ page: 1, per_page: -1, total: items.length, total_pages: 1, items });
const FOODS = [
  { id: 'f-farine', name: 'farine', pluralName: 'farine', aliases: [] },
  { id: 'f-œuf', name: 'œuf', pluralName: 'œufs', aliases: [] },
  { id: 'f-lardons', name: 'lardons', pluralName: 'lardons', aliases: [] },
];
const UNITS = [{ id: 'u-gramme', name: 'gramme', pluralName: 'grammes', abbreviation: 'g', aliases: [] }];

let stored: MealieRecipe;
let patches: Array<Record<string, unknown>>;
let createdFoods: string[];
let app: TestApp;
let client: Client;

beforeEach(async () => {
  stored = quiche();
  patches = [];
  createdFoods = [];
  mealie.use(
    http.get(mealieUrl('/api/recipes/quiche-lorraine'), () => HttpResponse.json(stored)),
    http.patch(mealieUrl('/api/recipes/quiche-lorraine'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      stored = { ...stored, ...body } as MealieRecipe;
      return HttpResponse.json(stored);
    }),
    http.get(mealieUrl('/api/recipes/:slug'), () => HttpResponse.json({ detail: 'Recipe not found' }, { status: 404 })),
    http.get(mealieUrl('/api/foods'), () => HttpResponse.json(page(FOODS))),
    http.get(mealieUrl('/api/units'), () => HttpResponse.json(page(UNITS))),
    http.post(mealieUrl('/api/foods'), async ({ request }) => {
      const { name } = (await request.json()) as { name: string };
      createdFoods.push(name);
      return HttpResponse.json({ id: `f-new-${name}`, name, pluralName: null, aliases: [] }, { status: 201 });
    })
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('mealie_edit_ingredients', () => {
  it('is annotated as destructive', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'mealie_edit_ingredients')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });

  it('patches only the ingredient list, with untouched ingredients exactly as Mealie sent them', async () => {
    const original = quiche().recipeIngredient!;
    const result = await callJson<{ ingredients: Array<{ n: number; quantity?: number; unit?: string }> }>(client, 'mealie_edit_ingredients', {
      slug: 'quiche-lorraine',
      operations: [{ op: 'update', n: 3, quantity: 4, unit: 'g' }],
    });
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]!)).toEqual(['recipeIngredient']);
    const sent = patches[0]!.recipeIngredient as unknown[];
    expect(sent[0]).toEqual(original[0]);
    expect(sent[1]).toEqual(original[1]);
    expect(sent[3]).toEqual(original[3]);
    expect(sent[2]).toMatchObject({ referenceId: 'c', quantity: 4, unit: { id: 'u-gramme' }, food: { name: 'œuf' }, note: 'battus', title: 'Garniture' });
    expect(result.ingredients[2]).toMatchObject({ n: 3, quantity: 4, unit: 'gramme' });
  });

  it('fails with close matches on an unknown food and writes nothing', async () => {
    const result = await client.callTool({
      name: 'mealie_edit_ingredients',
      arguments: { slug: 'quiche-lorraine', operations: [{ op: 'update', n: 1, food: 'farinne' }] },
    });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe('The food "farinne" was not found. Close matches: "farine". Set createMissing: true to create it, or use mealie_create_food.');
    expect(patches).toEqual([]);
  });

  it('creates a missing food only with createMissing', async () => {
    await callJson(client, 'mealie_edit_ingredients', {
      slug: 'quiche-lorraine',
      operations: [{ op: 'add', quantity: 1, food: 'muscade', note: 'râpée' }],
      createMissing: true,
    });
    expect(createdFoods).toEqual(['muscade']);
    const sent = patches[0]!.recipeIngredient as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(5);
    expect(sent[4]).toMatchObject({ food: { id: 'f-new-muscade' }, note: 'râpée' });
    expect(sent[4]!.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses to delete a linked ingredient, then unlinks it on request', async () => {
    const refused = await client.callTool({ name: 'mealie_edit_ingredients', arguments: { slug: 'quiche-lorraine', operations: [{ op: 'delete', n: 1 }] } });
    expect(toolText(refused)).toContain('used by step 1');
    expect(patches).toEqual([]);

    await callJson(client, 'mealie_edit_ingredients', { slug: 'quiche-lorraine', operations: [{ op: 'delete', n: 1 }], unlinkSteps: true });
    expect(Object.keys(patches[0]!)).toEqual(['recipeIngredient', 'recipeInstructions']);
    const steps = patches[0]!.recipeInstructions as MealieRecipe['recipeInstructions'];
    expect(steps![0]!.ingredientReferences).toEqual([{ referenceId: 'b' }]);
    expect(steps![1]).toEqual(quiche().recipeInstructions![1]);
  });

  it('rejects an invalid operation shape', async () => {
    const result = await client.callTool({
      name: 'mealie_edit_ingredients',
      arguments: { slug: 'quiche-lorraine', operations: [{ op: 'rename', n: 1 }] },
    });
    expect(result.isError).toBe(true);
    expect(patches).toEqual([]);
  });

  it('points to the search for an unknown recipe', async () => {
    const result = await client.callTool({ name: 'mealie_edit_ingredients', arguments: { slug: 'nope', operations: [{ op: 'delete', n: 1 }] } });
    expect(toolText(result)).toBe('Not found in Mealie. Use mealie_search_recipes to find the recipe slug.');
  });
});

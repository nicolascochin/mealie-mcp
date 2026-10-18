import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealieRecipe } from '../src/mealie/types.js';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

let stored: MealieRecipe;
let patches: Array<Record<string, unknown>>;
let app: TestApp;
let client: Client;

beforeEach(async () => {
  stored = quiche();
  patches = [];
  mealie.use(
    http.get(mealieUrl('/api/recipes/quiche-lorraine'), () => HttpResponse.json(stored)),
    http.patch(mealieUrl('/api/recipes/quiche-lorraine'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      stored = { ...stored, ...body } as MealieRecipe;
      return HttpResponse.json(stored);
    })
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('mealie_edit_steps', () => {
  it('is annotated as destructive', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'mealie_edit_steps')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('patches only the steps, untouched ones exactly as Mealie sent them', async () => {
    const result = await callJson<{ steps: Array<{ n: number; text: string; ingredients?: number[] }> }>(client, 'mealie_edit_steps', {
      slug: 'quiche-lorraine',
      operations: [{ op: 'update', n: 1, text: 'Foncer un moule beurré.', link: [3] }],
    });
    expect(Object.keys(patches[0]!)).toEqual(['recipeInstructions']);
    const sent = patches[0]!.recipeInstructions as MealieRecipe['recipeInstructions'];
    expect(sent![1]).toEqual(quiche().recipeInstructions![1]);
    expect(sent![0]).toEqual({ ...quiche().recipeInstructions![0], text: 'Foncer un moule beurré.', ingredientReferences: [{ referenceId: 'a' }, { referenceId: 'b' }, { referenceId: 'c' }] });
    expect(result.steps[0]).toEqual({ n: 1, text: 'Foncer un moule beurré.', ingredients: [1, 2, 3] });
  });

  it('writes nothing when an operation is invalid', async () => {
    const result = await client.callTool({ name: 'mealie_edit_steps', arguments: { slug: 'quiche-lorraine', operations: [{ op: 'delete', n: 5 }] } });
    expect(toolText(result)).toBe('Operation 1 (delete): there is no step 5 (the recipe has 2).');
    expect(patches).toEqual([]);
  });
});

import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

let parseRequests: Array<{ parser: string; ingredients: string[] }>;
let failParser: boolean;
let app: TestApp;
let client: Client;

beforeEach(async () => {
  parseRequests = [];
  failParser = false;
  const recipe = quiche();
  recipe.recipeIngredient!.push(
    { referenceId: 'e', quantity: 0, unit: null, food: null, note: '2 oignons émincés', display: '2 oignons émincés', originalText: null },
    { referenceId: 'f', quantity: 0, unit: null, food: null, note: '', display: '', originalText: '1 pincée de muscade' }
  );
  mealie.use(
    http.get(mealieUrl('/api/recipes/quiche-lorraine'), () => HttpResponse.json(recipe)),
    http.post(mealieUrl('/api/parser/ingredients'), async ({ request }) => {
      const body = (await request.json()) as { parser: string; ingredients: string[] };
      parseRequests.push(body);
      if (failParser) return HttpResponse.json({ detail: 'No AI provider configured' }, { status: 400 });
      return HttpResponse.json(
        body.ingredients.map((input) => {
          if (input.startsWith('2 oignons')) {
            return { input, confidence: { average: 0.92 }, ingredient: { quantity: 2, unit: null, food: { id: 'f-oignon', name: 'oignon' }, note: 'émincés' } };
          }
          if (input.startsWith('1 pincée')) {
            return { input, confidence: { average: 0.41 }, ingredient: { quantity: 1, unit: { name: 'pincée' }, food: { name: 'muscade' }, note: '' } };
          }
          return { input, confidence: { average: 0.3 }, ingredient: { quantity: 0, unit: null, food: null, note: input } };
        })
      );
    })
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('mealie_parse_ingredients', () => {
  it('is read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'mealie_parse_ingredients')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it('parses every free-text ingredient and proposes ready operations', async () => {
    const result = await callJson<Record<string, any>>(client, 'mealie_parse_ingredients', { slug: 'quiche-lorraine' });
    expect(parseRequests).toEqual([{ parser: 'nlp', ingredients: ['sel, poivre', '2 oignons émincés', '1 pincée de muscade'] }]);
    expect(result.proposals).toEqual([
      { n: 4, input: 'sel, poivre', note: 'sel, poivre', confidence: 0.3 },
      { n: 5, input: '2 oignons émincés', quantity: 2, food: 'oignon', foodInCatalog: true, note: 'émincés', confidence: 0.92 },
      { n: 6, input: '1 pincée de muscade', quantity: 1, unit: 'pincée', unitInCatalog: false, food: 'muscade', foodInCatalog: false, confidence: 0.41 },
    ]);
    expect(result.operations).toEqual([
      { op: 'update', n: 5, quantity: 2, unit: null, food: 'oignon', note: 'émincés' },
      { op: 'update', n: 6, quantity: 1, unit: 'pincée', food: 'muscade', note: '' },
    ]);
    expect(result.next).toContain('Ingredients 6 use a food or unit not in the catalog');
    expect(result.next).toContain('Check ingredients 4, 6');
  });

  it('parses only the given numbers, structured ones included', async () => {
    await callJson(client, 'mealie_parse_ingredients', { slug: 'quiche-lorraine', ingredients: [3, 5], parser: 'brute' });
    // A structured ingredient is sent as the whole line Mealie displays, not its note alone.
    expect(parseRequests).toEqual([{ parser: 'brute', ingredients: ['3 œufs battus', '2 oignons émincés'] }]);
  });

  it('refuses unknown numbers', async () => {
    const result = await client.callTool({ name: 'mealie_parse_ingredients', arguments: { slug: 'quiche-lorraine', ingredients: [9] } });
    expect(toolText(result)).toBe('There is no ingredient 9 (the recipe has 6).');
    expect(parseRequests).toEqual([]);
  });

  it('explains an unavailable parser', async () => {
    failParser = true;
    const result = await client.callTool({ name: 'mealie_parse_ingredients', arguments: { slug: 'quiche-lorraine', parser: 'openai' } });
    expect(toolText(result)).toBe('The openai parser is not available in this Mealie. Use parser "nlp".');
  });
});

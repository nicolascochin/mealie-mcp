import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealieFood, MealieUnit } from '../src/mealie/types.js';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { FOODS, UNITS } from './live/fixtures.js';

const page = <T>(items: T[]) => ({ page: 1, per_page: -1, total: items.length, total_pages: 1, items });

let foods: MealieFood[];
let units: MealieUnit[];
let posted: unknown[];
let app: TestApp;
let client: Client;

beforeEach(async () => {
  foods = FOODS.map((f, i) => ({ id: `f${i}`, ...f, aliases: f.aliases.map((name) => ({ name })) }));
  units = UNITS.map((u, i) => ({ id: `u${i}`, ...u, aliases: u.aliases.map((name) => ({ name })) }));
  posted = [];
  mealie.use(
    http.get(mealieUrl('/api/foods'), () => HttpResponse.json(page(foods))),
    http.get(mealieUrl('/api/units'), () => HttpResponse.json(page(units))),
    http.post(mealieUrl('/api/foods'), async ({ request }) => {
      const body = (await request.json()) as Omit<MealieFood, 'id'>;
      posted.push(body);
      return HttpResponse.json({ id: 'new', ...body, description: '' }, { status: 201 });
    }),
    http.post(mealieUrl('/api/units'), async ({ request }) => {
      const body = (await request.json()) as Omit<MealieUnit, 'id'>;
      posted.push(body);
      return HttpResponse.json({ id: 'new', ...body, description: '' }, { status: 201 });
    }),
    http.get(mealieUrl('/api/organizers/tags'), () =>
      HttpResponse.json(page([{ id: 't2', name: 'Végétarien', slug: 'vegetarien' }, { id: 't1', name: 'Rapide', slug: 'rapide' }]))
    ),
    http.get(mealieUrl('/api/organizers/categories'), () => HttpResponse.json(page([{ id: 'c1', name: 'Dessert', slug: 'dessert' }])))
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('catalog tools', () => {
  it('declare their annotations', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of ['mealie_search_foods', 'mealie_search_units', 'mealie_list_tags', 'mealie_list_categories']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    for (const name of ['mealie_create_food', 'mealie_create_unit']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    }
  });

  it('mealie_search_foods returns the match without ids', async () => {
    expect(await callJson(client, 'mealie_search_foods', { name: 'Oignons' })).toEqual({
      status: 'found',
      match: { name: 'oignon', pluralName: 'oignons', aliases: ['oignon jaune'] },
    });
  });

  it('mealie_search_foods suggests close names', async () => {
    expect(await callJson(client, 'mealie_search_foods', { name: 'farinne' })).toMatchObject({
      status: 'not_found',
      suggestions: [expect.objectContaining({ name: 'farine' })],
    });
  });

  it('mealie_search_units matches abbreviations and aliases', async () => {
    expect(await callJson(client, 'mealie_search_units', { name: 'cs' })).toMatchObject({
      status: 'found',
      match: { name: 'cuillère à soupe', abbreviation: 'c. à soupe' },
    });
  });

  it('rejects an empty name', async () => {
    const result = await client.callTool({ name: 'mealie_search_foods', arguments: { name: '  ' } });
    expect(result.isError).toBe(true);
  });

  it('lists tags and categories by name', async () => {
    expect(await callJson(client, 'mealie_list_tags')).toEqual({ tags: ['Rapide', 'Végétarien'] });
    expect(await callJson(client, 'mealie_list_categories')).toEqual({ categories: ['Dessert'] });
  });

  it('mealie_create_food sends plural and aliases', async () => {
    expect(await callJson(client, 'mealie_create_food', { name: 'échalote', pluralName: 'échalotes', aliases: ['echalote grise'] })).toEqual({
      created: { name: 'échalote', pluralName: 'échalotes', aliases: ['echalote grise'] },
    });
    expect(posted).toEqual([{ name: 'échalote', pluralName: 'échalotes', aliases: [{ name: 'echalote grise' }] }]);
  });

  it('mealie_create_food refuses a duplicate, whatever the accents or the variant', async () => {
    for (const name of ['Oignons', 'OEUF']) {
      const result = await client.callTool({ name: 'mealie_create_food', arguments: { name } });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain('already names the food');
    }
    const viaAlias = await client.callTool({ name: 'mealie_create_food', arguments: { name: 'oignon rouge', aliases: ['oignon jaune'] } });
    expect(toolText(viaAlias)).toContain('"oignon jaune" already names the food "oignon"');
    expect(posted).toEqual([]);
  });

  it('mealie_create_unit sends the abbreviations and refuses duplicates', async () => {
    expect(await callJson(client, 'mealie_create_unit', { name: 'pincée', pluralName: 'pincées', abbreviation: 'pinc.' })).toEqual({
      created: { name: 'pincée', pluralName: 'pincées', abbreviation: 'pinc.' },
    });
    const duplicate = await client.callTool({ name: 'mealie_create_unit', arguments: { name: 'gramme fin', abbreviation: 'g' } });
    expect(toolText(duplicate)).toContain('"g" already names the unit "gramme"');
    expect(posted).toHaveLength(1);
  });
});

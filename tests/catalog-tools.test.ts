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
let labels: Array<{ id: string; name: string }>;
let written: Array<{ path: string; body: Record<string, unknown> }>;
let app: TestApp;
let client: Client;

beforeEach(async () => {
  foods = FOODS.map((f, i) => ({ id: `f${i}`, ...f, aliases: f.aliases.map((name) => ({ name })) }));
  units = UNITS.map((u, i) => ({ id: `u${i}`, ...u, aliases: u.aliases.map((name) => ({ name })) }));
  posted = [];
  labels = [
    { id: 'lab-c', name: 'Crèmerie' },
    { id: 'lab-f', name: 'Fruits et légumes' },
  ];
  written = [];
  const withLabel = (body: Record<string, unknown>) => ({ ...body, label: labels.find((label) => label.id === body.labelId) ?? null });
  const record = async (request: Request) => {
    const body = (await request.json()) as Record<string, unknown>;
    written.push({ path: new URL(request.url).pathname, body });
    return body;
  };
  const replace = <T extends { id: string }>(list: T[], id: string, body: Record<string, unknown>) => {
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) return HttpResponse.json({ detail: 'not found' }, { status: 404 });
    list[index] = { ...(withLabel(body) as unknown as T), id };
    return HttpResponse.json(list[index]);
  };
  mealie.use(
    http.put(mealieUrl('/api/foods/merge'), async ({ request }) => {
      const { fromFood } = (await record(request)) as { fromFood: string };
      foods = foods.filter((food) => food.id !== fromFood);
      return HttpResponse.json({ message: 'Successfully merged foods' });
    }),
    http.put(mealieUrl('/api/units/merge'), async ({ request }) => {
      const { fromUnit } = (await record(request)) as { fromUnit: string };
      units = units.filter((unit) => unit.id !== fromUnit);
      return HttpResponse.json({ message: 'Successfully merged units' });
    }),
    http.get(mealieUrl('/api/foods/:id'), ({ params }) => HttpResponse.json(foods.find((food) => food.id === params.id))),
    http.get(mealieUrl('/api/units/:id'), ({ params }) => HttpResponse.json(units.find((unit) => unit.id === params.id))),
    http.put(mealieUrl('/api/foods/:id'), async ({ request, params }) => replace(foods, params.id as string, await record(request))),
    http.put(mealieUrl('/api/units/:id'), async ({ request, params }) => replace(units, params.id as string, await record(request))),
    http.get(mealieUrl('/api/foods'), () => HttpResponse.json(page(foods))),
    http.get(mealieUrl('/api/units'), () => HttpResponse.json(page(units))),
    http.post(mealieUrl('/api/foods'), async ({ request }) => {
      const body = (await request.json()) as Omit<MealieFood, 'id'>;
      posted.push(body);
      return HttpResponse.json({ id: 'new', ...withLabel(body), description: '' }, { status: 201 });
    }),
    http.get(mealieUrl('/api/groups/labels'), () => HttpResponse.json(page(labels))),
    http.post(mealieUrl('/api/groups/labels'), async ({ request }) => {
      const { name } = (await record(request)) as { name: string };
      labels.push({ id: `lab-${name}`, name });
      return HttpResponse.json(labels.at(-1));
    }),
    http.post(mealieUrl('/api/units'), async ({ request }) => {
      const body = (await request.json()) as Omit<MealieUnit, 'id'>;
      posted.push(body);
      return HttpResponse.json({ id: 'new', ...body, description: '' }, { status: 201 });
    }),
    http.get(mealieUrl('/api/organizers/tags'), () =>
      HttpResponse.json(page([{ id: 't2', name: 'Végétarien', slug: 'vegetarien' }, { id: 't1', name: 'Rapide', slug: 'rapide' }]))
    ),
    http.get(mealieUrl('/api/organizers/categories'), () => HttpResponse.json(page([{ id: 'c1', name: 'Dessert', slug: 'dessert' }]))),
    http.get(mealieUrl('/api/organizers/tools'), () =>
      HttpResponse.json(page([{ id: 'k2', name: 'Moule à tarte', slug: 'moule-a-tarte' }, { id: 'k1', name: 'Mixeur', slug: 'mixeur' }]))
    )
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
    for (const name of ['mealie_search_foods', 'mealie_search_units', 'mealie_list_tags', 'mealie_list_categories', 'mealie_list_tools', 'mealie_list_labels']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    for (const name of ['mealie_create_food', 'mealie_create_unit']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    }
    for (const name of ['mealie_update_food', 'mealie_update_unit']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    }
    for (const name of ['mealie_merge_foods', 'mealie_merge_units']) {
      expect(byName.get(name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
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
    expect(await callJson(client, 'mealie_list_tools')).toEqual({ tools: ['Mixeur', 'Moule à tarte'] });
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

describe('catalog editing tools', () => {
  it('mealie_update_food changes only the given fields and sends every other key back', async () => {
    const onion = foods[0]!;
    Object.assign(onion, { description: 'bulbe', labelId: 'l1', householdsWithIngredientFood: ['maison'], substitutions: [{ note: 'échalote' }] });
    expect(
      await callJson(client, 'mealie_update_food', { food: 'oignons', name: 'oignon jaune doux', addAliases: ['oignon doux'], removeAliases: ['Oignon Jaune'] })
    ).toEqual({ updated: { name: 'oignon jaune doux', pluralName: 'oignons', aliases: ['oignon doux'] } });
    expect(written).toEqual([
      {
        path: '/api/foods/f0',
        body: {
          ...onion,
          name: 'oignon jaune doux',
          aliases: [{ name: 'oignon doux' }],
        },
      },
    ]);
  });

  it('mealie_update_food removes the plural with null', async () => {
    await callJson(client, 'mealie_update_food', { food: 'œuf', pluralName: null });
    expect(written[0]?.body).toMatchObject({ name: 'œuf', pluralName: null, aliases: [{ name: 'oeuf' }, { name: 'oeufs' }] });
  });

  it('mealie_update_food accepts its own names but refuses those of another food', async () => {
    expect(await callJson(client, 'mealie_update_food', { food: 'oignon', name: 'Oignon' })).toMatchObject({ updated: { name: 'Oignon' } });
    const clash = await client.callTool({ name: 'mealie_update_food', arguments: { food: 'oignon', addAliases: ['OEUFS'] } });
    expect(clash.isError).toBe(true);
    expect(toolText(clash)).toBe('"OEUFS" already names the food "œuf". Merge them with mealie_merge_foods if they are the same food.');
    expect(written).toHaveLength(1);
  });

  it('mealie_update_food explains unknown foods, unknown aliases and empty edits', async () => {
    const unknown = await client.callTool({ name: 'mealie_update_food', arguments: { food: 'oignn', name: 'x' } });
    expect(toolText(unknown)).toBe('The food "oignn" was not found. Close matches: "oignon".');
    const alias = await client.callTool({ name: 'mealie_update_food', arguments: { food: 'farine', removeAliases: ['farine de seigle'] } });
    expect(toolText(alias)).toBe('Not an alias: "farine de seigle". Its aliases are "farine de blé".');
    const empty = await client.callTool({ name: 'mealie_update_food', arguments: { food: 'farine' } });
    expect(toolText(empty)).toContain('Nothing to change');
    expect(written).toEqual([]);
  });

  it('mealie_update_unit changes abbreviations and refuses one used by another unit', async () => {
    expect(await callJson(client, 'mealie_update_unit', { unit: 'cl', abbreviation: null, addAliases: ['centil.'] })).toEqual({
      updated: { name: 'centilitre', pluralName: 'centilitres', pluralAbbreviation: 'cl', aliases: ['centil.'] },
    });
    expect(written[0]?.body).toMatchObject({ abbreviation: '', pluralAbbreviation: 'cl', aliases: [{ name: 'centil.' }] });
    const clash = await client.callTool({ name: 'mealie_update_unit', arguments: { unit: 'litre', abbreviation: 'g' } });
    expect(toolText(clash)).toContain('"g" already names the unit "gramme"');
  });

  it('mealie_merge_foods merges, then keeps the names of the merged food as aliases', async () => {
    foods.push({ id: 'dup', name: 'oignon blanc', pluralName: 'oignons blancs', aliases: [{ name: 'oignon jaune' }] });
    expect(await callJson(client, 'mealie_merge_foods', { from: 'oignons blancs', into: 'oignon' })).toEqual({
      merged: 'oignon blanc',
      into: { name: 'oignon', pluralName: 'oignons', aliases: ['oignon jaune', 'oignon blanc', 'oignons blancs'] },
      addedAliases: ['oignon blanc', 'oignons blancs'],
    });
    expect(written.map((w) => w.path)).toEqual(['/api/foods/merge', '/api/foods/f0']);
    expect(written[0]?.body).toEqual({ fromFood: 'dup', toFood: 'f0' });
    expect(foods.map((food) => food.id)).not.toContain('dup');
  });

  it('mealie_merge_foods leaves the aliases alone with keepNames: false', async () => {
    foods.push({ id: 'dup', name: 'oignon blanc', pluralName: null, aliases: [] });
    expect(await callJson(client, 'mealie_merge_foods', { from: 'oignon blanc', into: 'oignon', keepNames: false })).toEqual({
      merged: 'oignon blanc',
      into: { name: 'oignon', pluralName: 'oignons', aliases: ['oignon jaune'] },
    });
    expect(written.map((w) => w.path)).toEqual(['/api/foods/merge']);
  });

  it('mealie_merge_foods refuses to merge a food into itself, and unknown names', async () => {
    const same = await client.callTool({ name: 'mealie_merge_foods', arguments: { from: 'oignons', into: 'Oignon' } });
    expect(toolText(same)).toBe('"oignons" and "Oignon" are both the food "oignon": nothing to merge.');
    const unknown = await client.callTool({ name: 'mealie_merge_foods', arguments: { from: 'poireau', into: 'oignon' } });
    expect(toolText(unknown)).toContain('The food "poireau" was not found.');
    expect(written).toEqual([]);
  });

  it('mealie_merge_units keeps the abbreviations of the merged unit', async () => {
    units.push({ id: 'dup', name: 'gr.', pluralName: null, abbreviation: 'grs', pluralAbbreviation: null, aliases: [] });
    expect(await callJson(client, 'mealie_merge_units', { from: 'gr.', into: 'gramme' })).toEqual({
      merged: 'gr.',
      into: { name: 'gramme', pluralName: 'grammes', abbreviation: 'g', aliases: ['gr', 'grs'] },
      addedAliases: ['grs'],
    });
    expect(written[0]).toEqual({ path: '/api/units/merge', body: { fromUnit: 'dup', toUnit: 'u0' } });
  });
});

describe('labels', () => {
  it('mealie_list_labels lists the labels by name', async () => {
    expect(await callJson(client, 'mealie_list_labels')).toEqual({ labels: ['Crèmerie', 'Fruits et légumes'] });
  });

  it('mealie_create_food puts the food under an existing label', async () => {
    expect(await callJson(client, 'mealie_create_food', { name: 'yaourt', label: 'cremerie' })).toEqual({ created: { name: 'yaourt', label: 'Crèmerie' } });
    expect(posted).toEqual([{ name: 'yaourt', pluralName: null, aliases: [], labelId: 'lab-c' }]);
  });

  it('mealie_create_food refuses an unknown label, and creates it with createMissing', async () => {
    const unknown = await client.callTool({ name: 'mealie_create_food', arguments: { name: 'pain', label: 'Boulangerie' } });
    expect(toolText(unknown)).toBe('The label "Boulangerie" was not found. Set createMissing: true to create it, or see mealie_list_labels.');
    expect(posted).toEqual([]);
    expect(await callJson(client, 'mealie_create_food', { name: 'pain', label: 'Boulangerie', createMissing: true })).toMatchObject({
      created: { label: 'Boulangerie' },
    });
    expect(written).toEqual([{ path: '/api/groups/labels', body: { name: 'Boulangerie' } }]);
    expect(posted).toEqual([expect.objectContaining({ labelId: 'lab-Boulangerie' })]);
  });

  it('mealie_update_food changes the label, and null removes it', async () => {
    expect(await callJson(client, 'mealie_update_food', { food: 'lait', label: 'Crèmerie' })).toMatchObject({ updated: { name: 'lait', label: 'Crèmerie' } });
    const cleared = await callJson<{ updated: Record<string, unknown> }>(client, 'mealie_update_food', { food: 'lait', label: null });
    expect(cleared.updated).not.toHaveProperty('label');
    expect(written.map((w) => w.body.labelId)).toEqual(['lab-c', null]);
  });
});

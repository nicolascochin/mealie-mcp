import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentWeek, planRange } from '../src/mealplans/dates.js';
import type { MealieMealPlanEntry } from '../src/mealie/types.js';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

describe('meal plan dates', () => {
  it('finds Monday to Sunday of the current week', () => {
    expect(currentWeek(new Date('2026-10-18T10:00:00Z'))).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(currentWeek(new Date('2026-10-12T00:00:00Z'))).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(currentWeek(new Date('2026-12-31T23:00:00Z'))).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  it('completes a range given by one end', () => {
    const today = new Date('2026-10-14T08:00:00Z');
    expect(planRange(undefined, undefined, today)).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(planRange('2026-10-30', undefined, today)).toEqual({ start: '2026-10-30', end: '2026-11-05' });
    expect(planRange(undefined, '2026-10-03', today)).toEqual({ start: '2026-09-27', end: '2026-10-03' });
    expect(planRange('2026-10-01', '2026-10-02', today)).toEqual({ start: '2026-10-01', end: '2026-10-02' });
  });
});

const entry = (id: number, date: string, entryType: string, extra: Partial<MealieMealPlanEntry> = {}): MealieMealPlanEntry & Record<string, unknown> => ({
  id,
  date,
  entryType,
  title: '',
  text: '',
  recipeId: null,
  recipe: null,
  groupId: 'g1',
  userId: 'u1',
  householdId: 'h1',
  ...extra,
});
const QUICHE_REF = { recipeId: 'r1', recipe: { name: 'Quiche lorraine', slug: 'quiche-lorraine' } };

let calls: Array<{ method: string; path: string; query?: Record<string, string>; body?: unknown }>;
let app: TestApp;
let client: Client;

const record = async (request: Request) => {
  const url = new URL(request.url);
  const text = await request.text();
  calls.push({ method: request.method, path: url.pathname, ...(url.search ? { query: Object.fromEntries(url.searchParams) } : {}), ...(text ? { body: JSON.parse(text) } : {}) });
};

beforeEach(async () => {
  calls = [];
  mealie.use(
    http.get(mealieUrl('/api/households/mealplans/today'), () => HttpResponse.json([entry(3, '2026-10-18', 'dinner', QUICHE_REF)])),
    http.get(mealieUrl('/api/households/mealplans/7'), () => HttpResponse.json(entry(7, '2026-10-15', 'lunch', QUICHE_REF))),
    http.get(mealieUrl('/api/households/mealplans/:id'), () => HttpResponse.json({ detail: 'Not found' }, { status: 404 })),
    http.get(mealieUrl('/api/households/mealplans'), async ({ request }) => {
      await record(request);
      return HttpResponse.json({
        page: 1,
        total: 3,
        items: [entry(2, '2026-10-14', 'dinner', { title: 'Restes' }), entry(1, '2026-10-14', 'lunch', QUICHE_REF), entry(5, '2026-10-12', 'side', { title: 'Salade', text: 'verte' })],
      });
    }),
    http.get(mealieUrl('/api/recipes/quiche-lorraine'), () => HttpResponse.json(quiche())),
    http.get(mealieUrl('/api/recipes/:slug'), () => HttpResponse.json({ detail: 'Not found' }, { status: 404 })),
    http.post(mealieUrl('/api/households/mealplans'), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ ...entry(9, '', ''), ...(calls.at(-1)!.body as object), ...QUICHE_REF });
    }),
    http.put(mealieUrl('/api/households/mealplans/7'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(calls.at(-1)!.body as Record<string, unknown>);
    }),
    http.delete(mealieUrl('/api/households/mealplans/7'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(entry(7, '2026-10-15', 'lunch', QUICHE_REF));
    })
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('meal plan tools', () => {
  it('declare their annotations', async () => {
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(tools.filter((t) => /mealplan|todays_meals/.test(t.name)).map((t) => [t.name, [t.annotations?.readOnlyHint, t.annotations?.destructiveHint]]));
    expect(hints).toEqual({
      mealie_list_mealplans: [true, false],
      mealie_get_todays_meals: [true, false],
      mealie_add_mealplan_entry: [false, false],
      mealie_update_mealplan_entry: [false, false],
      mealie_delete_mealplan_entry: [false, true],
    });
  });

  it('lists a range sorted by date and meal', async () => {
    expect(await callJson(client, 'mealie_list_mealplans', { start: '2026-10-12', end: '2026-10-18' })).toEqual({
      start: '2026-10-12',
      end: '2026-10-18',
      meals: [
        { id: 5, date: '2026-10-12', meal: 'side', title: 'Salade', note: 'verte' },
        { id: 1, date: '2026-10-14', meal: 'lunch', recipe: { name: 'Quiche lorraine', slug: 'quiche-lorraine' } },
        { id: 2, date: '2026-10-14', meal: 'dinner', title: 'Restes' },
      ],
    });
    expect(calls[0]!.query).toEqual({ start_date: '2026-10-12', end_date: '2026-10-18', page: '1', perPage: '-1' });
  });

  it('refuses a range that ends before it starts', async () => {
    const result = await client.callTool({ name: 'mealie_list_mealplans', arguments: { start: '2026-10-18', end: '2026-10-12' } });
    expect(toolText(result)).toBe('The last day comes before the first one.');
  });

  it("lists today's meals", async () => {
    expect(await callJson(client, 'mealie_get_todays_meals')).toEqual({
      meals: [{ id: 3, date: '2026-10-18', meal: 'dinner', recipe: { name: 'Quiche lorraine', slug: 'quiche-lorraine' } }],
    });
  });

  it('plans a recipe by slug', async () => {
    expect(await callJson(client, 'mealie_add_mealplan_entry', { date: '2026-10-20', meal: 'dinner', slug: 'quiche-lorraine' })).toMatchObject({
      date: '2026-10-20',
      meal: 'dinner',
      recipe: { slug: 'quiche-lorraine' },
    });
    expect(calls[0]!.body).toEqual({ date: '2026-10-20', entryType: 'dinner', title: '', text: '', recipeId: 'r1' });
  });

  it('needs a recipe or a title, and an existing recipe', async () => {
    expect(toolText(await client.callTool({ name: 'mealie_add_mealplan_entry', arguments: { date: '2026-10-20', meal: 'lunch' } }))).toBe(
      'Give a recipe slug or a title.'
    );
    expect(toolText(await client.callTool({ name: 'mealie_add_mealplan_entry', arguments: { date: '2026-10-20', meal: 'lunch', slug: 'nope' } }))).toBe(
      'No recipe has the slug "nope". Use mealie_search_recipes to find it.'
    );
    const badMeal = await client.callTool({ name: 'mealie_add_mealplan_entry', arguments: { date: '2026-10-20', meal: 'brunch', title: 'x' } });
    expect(badMeal.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('moves an entry and keeps every other field as read', async () => {
    await callJson(client, 'mealie_update_mealplan_entry', { id: 7, date: '2026-10-16', meal: 'dinner' });
    expect(calls).toEqual([
      { method: 'PUT', path: '/api/households/mealplans/7', body: { ...entry(7, '2026-10-16', 'dinner', QUICHE_REF) } },
    ]);
  });

  it('replaces a recipe by a title', async () => {
    await callJson(client, 'mealie_update_mealplan_entry', { id: 7, slug: null, title: 'Restaurant' });
    expect(calls[0]!.body).toMatchObject({ recipeId: null, recipe: null, title: 'Restaurant' });
    const noTitle = await client.callTool({ name: 'mealie_update_mealplan_entry', arguments: { id: 7, slug: null } });
    expect(toolText(noTitle)).toBe('An entry without a recipe needs a title: give one.');
  });

  it('points to the list for an unknown entry', async () => {
    const result = await client.callTool({ name: 'mealie_update_mealplan_entry', arguments: { id: 99, meal: 'lunch' } });
    expect(toolText(result)).toBe('Not found in Mealie. Use mealie_list_mealplans to find the entry id.');
  });

  it('deletes an entry', async () => {
    expect(await callJson(client, 'mealie_delete_mealplan_entry', { id: 7 })).toMatchObject({ deleted: { id: 7, date: '2026-10-15' } });
  });
});

import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import { liveSeed } from './helpers.js';

const seed = liveSeed();
let app: TestApp;
let client: Client;

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
});

describe('catalog tools against a real Mealie', () => {
  it.each(['oignons', 'Oignon', 'oignon jaune'])('mealie_search_foods resolves %j to the onion', async (name) => {
    expect(await callJson(client, 'mealie_search_foods', { name })).toMatchObject({ status: 'found', match: { name: 'oignon' } });
  });

  it('ignores accents and ligatures', async () => {
    expect(await callJson(client, 'mealie_search_foods', { name: 'OEUFS' })).toMatchObject({ status: 'found', match: { name: 'œuf' } });
    expect(await callJson(client, 'mealie_search_foods', { name: 'creme fraiche' })).toMatchObject({ match: { name: 'crème fraîche' } });
  });

  it('suggests close names for an unknown food', async () => {
    const result = await callJson<{ status: string; suggestions: Array<{ name: string }> }>(client, 'mealie_search_foods', { name: 'oignn' });
    expect(result.status).toBe('not_found');
    expect(result.suggestions.map((f) => f.name)).toContain('oignon');
  });

  it.each(['c. à soupe', 'cuillères à soupe', 'cs'])('mealie_search_units resolves %j to the tablespoon', async (name) => {
    expect(await callJson(client, 'mealie_search_units', { name })).toMatchObject({ status: 'found', match: { name: 'cuillère à soupe' } });
  });

  it('lists tags and categories', async () => {
    expect(await callJson(client, 'mealie_list_tags')).toEqual({ tags: expect.any(Array) });
    expect(await callJson(client, 'mealie_list_categories')).toEqual({ categories: expect.any(Array) });
  });

  it('creates a food that is then found by its alias, and refuses its duplicate', async () => {
    expect(await callJson(client, 'mealie_create_food', { name: 'échalote', pluralName: 'échalotes', aliases: ['echalote grise'] })).toEqual({
      created: { name: 'échalote', pluralName: 'échalotes', aliases: ['echalote grise'] },
    });
    expect(await callJson(client, 'mealie_search_foods', { name: 'Échalotes' })).toMatchObject({ status: 'found', match: { name: 'échalote' } });
    expect(await callJson(client, 'mealie_search_foods', { name: 'echalote grise' })).toMatchObject({ match: { name: 'échalote' } });
    const duplicate = await client.callTool({ name: 'mealie_create_food', arguments: { name: 'Echalote' } });
    expect(toolText(duplicate)).toContain('already names the food');
  });

  it('creates a unit with its abbreviation', async () => {
    expect(await callJson(client, 'mealie_create_unit', { name: 'pincée', pluralName: 'pincées', abbreviation: 'pinc.' })).toMatchObject({
      created: { name: 'pincée', abbreviation: 'pinc.' },
    });
    expect(await callJson(client, 'mealie_search_units', { name: 'pincées' })).toMatchObject({ match: { name: 'pincée' } });
  });
});

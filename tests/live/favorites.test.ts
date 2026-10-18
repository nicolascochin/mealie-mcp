import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();

const GALETTE: RecipeFixture = {
  name: 'Galette complète (favoris)',
  ingredients: [{ quantity: 1, food: 'œuf' }],
  steps: [{ text: "Casser l'œuf sur la galette.", ingredients: [0] }],
};

interface Rating {
  recipeId: string;
  rating: number | null;
  isFavorite: boolean;
}

let app: TestApp;
let client: Client;
let slug: string;
let recipeId: string;

/** What Mealie's interface reads for the connected user. */
const own = async (what: 'favorites' | 'ratings') =>
  (await call<{ ratings: Rating[] }>(seed.mealieUrl, 'GET', `/api/users/self/${what}`, seed.token)).ratings.filter((r) => r.recipeId === recipeId);
const favoriteSlugs = async () =>
  (await callJson<{ recipes: Array<{ slug: string }> }>(client, 'mealie_search_recipes', { favoritesOnly: true })).recipes.map((r) => r.slug);

beforeAll(async () => {
  slug = await createFixtureRecipe(seed.mealieUrl, seed.token, GALETTE);
  recipeId = (await readRawRecipe(slug)).id as string;
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (slug) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token);
});

describe('favorites and ratings against a real Mealie', () => {
  it('adds a favorite that Mealie lists and the favorites search finds', async () => {
    expect(await favoriteSlugs()).not.toContain(slug);
    expect(await callJson(client, 'mealie_set_favorite', { slug, favorite: true })).toEqual({ slug, favorite: true });
    expect(await own('favorites')).toMatchObject([{ isFavorite: true }]);
    expect(await favoriteSlugs()).toEqual([slug]);
  });

  it("rates the recipe: the user's rating shows in Mealie and in mealie_get_recipe", async () => {
    expect(await callJson(client, 'mealie_rate_recipe', { slug, rating: 4.5 })).toEqual({ slug, myRating: 4.5 });
    expect(await own('ratings')).toMatchObject([{ rating: 4.5, isFavorite: true }]);
    expect(await callJson(client, 'mealie_get_recipe', { slug })).toMatchObject({ rating: 4.5, myRating: 4.5, favorite: true });
  });

  it('removes the rating and the favorite', async () => {
    await callJson(client, 'mealie_rate_recipe', { slug, rating: 0 });
    await callJson(client, 'mealie_set_favorite', { slug, favorite: false });
    const recipe = await callJson<Record<string, unknown>>(client, 'mealie_get_recipe', { slug });
    expect(recipe).not.toHaveProperty('myRating');
    expect(recipe).not.toHaveProperty('favorite');
    expect(await own('favorites')).toEqual([]);
    expect(await favoriteSlugs()).not.toContain(slug);
  });

  it('explains an unknown recipe', async () => {
    const result = await client.callTool({ name: 'mealie_set_favorite', arguments: { slug: 'recette-inexistante', favorite: true } });
    expect(toolText(result)).toContain('Use mealie_search_recipes to find the recipe slug.');
  });
});

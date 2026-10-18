import { randomUUID } from 'node:crypto';
import { FOODS, LIVE_USER, RECIPES, UNITS, type RecipeFixture } from './fixtures.js';

/** Mealie's built-in admin on a fresh install. */
const DEFAULT_ADMIN = { username: 'changeme@example.com', password: 'MyPassword' };

export interface LiveSeed {
  mealieUrl: string;
  /** API token of the non-admin test user. */
  token: string;
  username: string;
  /** Recipe name → slug. */
  recipes: Record<string, string>;
}

type Json = Record<string, unknown>;

export async function call<T>(mealieUrl: string, method: string, path: string, auth: string | undefined, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  let payload: string | undefined;
  if (body instanceof URLSearchParams) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = body.toString();
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(mealieUrl + path, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Waits until Mealie answers `GET /api/app/about`. */
export async function waitForMealie(mealieUrl: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${mealieUrl}/api/app/about`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`Mealie did not answer at ${mealieUrl} within ${timeoutMs / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function login(mealieUrl: string, username: string, password: string): Promise<string> {
  const { access_token } = await call<{ access_token: string }>(
    mealieUrl,
    'POST',
    '/api/auth/token',
    undefined,
    new URLSearchParams({ username, password })
  );
  return access_token;
}

/** Seeds a fresh Mealie: a non-admin user with an API token, a French catalog and a few recipes. */
export async function seed(mealieUrl: string): Promise<LiveSeed> {
  const admin = await login(mealieUrl, DEFAULT_ADMIN.username, DEFAULT_ADMIN.password);

  await call(mealieUrl, 'POST', '/api/admin/users', admin, {
    ...LIVE_USER,
    admin: false,
    canInvite: false,
    canManage: false,
    canOrganize: true,
  });
  const session = await login(mealieUrl, LIVE_USER.username, LIVE_USER.password);
  const { token } = await call<{ token: string }>(mealieUrl, 'POST', '/api/users/api-tokens', session, { name: 'mealie-mcp-live' });

  const units = new Map<string, Json>();
  for (const unit of UNITS) {
    const created = await call<Json>(mealieUrl, 'POST', '/api/units', token, {
      ...unit,
      useAbbreviation: false,
      fraction: true,
      aliases: unit.aliases.map((name) => ({ name })),
    });
    units.set(unit.name, created);
  }
  const foods = new Map<string, Json>();
  for (const food of FOODS) {
    const created = await call<Json>(mealieUrl, 'POST', '/api/foods', token, {
      ...food,
      aliases: food.aliases.map((name) => ({ name })),
    });
    foods.set(food.name, created);
  }

  const organizers = { tags: new Map<string, Json>(), categories: new Map<string, Json>() };
  for (const kind of ['tags', 'categories'] as const) {
    const wanted = new Set(RECIPES.flatMap((recipe) => recipe[kind] ?? []));
    for (const name of wanted) {
      const { id, slug } = await call<Json>(mealieUrl, 'POST', `/api/organizers/${kind}`, token, { name });
      organizers[kind].set(name, { id, name, slug });
    }
  }

  const recipes: Record<string, string> = {};
  for (const fixture of RECIPES) {
    recipes[fixture.name] = await createRecipe(mealieUrl, token, fixture, units, foods, organizers);
  }
  return { mealieUrl, token, username: LIVE_USER.username, recipes };
}

/**
 * Creates a recipe from a fixture with the user's token, linking the catalog entries it names.
 * The catalog must already hold them (see seed()).
 */
export async function createFixtureRecipe(mealieUrl: string, token: string, fixture: RecipeFixture): Promise<string> {
  const byName = async (path: string) => {
    const { items } = await call<{ items: Json[] }>(mealieUrl, 'GET', `${path}?page=1&perPage=-1`, token);
    return new Map(items.map((item) => [item.name as string, item]));
  };
  const organizer = async (path: string) =>
    new Map([...(await byName(path)).values()].map((o) => [o.name as string, { id: o.id, name: o.name, slug: o.slug }]));
  return createRecipe(mealieUrl, token, fixture, await byName('/api/units'), await byName('/api/foods'), {
    tags: await organizer('/api/organizers/tags'),
    categories: await organizer('/api/organizers/categories'),
  });
}

async function createRecipe(
  mealieUrl: string,
  token: string,
  fixture: RecipeFixture,
  units: Map<string, Json>,
  foods: Map<string, Json>,
  organizers: { tags: Map<string, Json>; categories: Map<string, Json> }
): Promise<string> {
  const slug = await call<string>(mealieUrl, 'POST', '/api/recipes', token, { name: fixture.name });
  const recipe = await call<Json>(mealieUrl, 'GET', `/api/recipes/${encodeURIComponent(slug)}`, token);

  const lookup = (map: Map<string, Json>, name: string | undefined) => {
    if (name === undefined) return null;
    const found = map.get(name);
    if (!found) throw new Error(`Fixture refers to unknown catalog entry ${JSON.stringify(name)}`);
    return found;
  };
  const ingredients = fixture.ingredients.map((ingredient) => ({
    referenceId: randomUUID(),
    title: ingredient.section ?? null,
    quantity: ingredient.quantity ?? 0,
    unit: lookup(units, ingredient.unit),
    food: lookup(foods, ingredient.food),
    note: ingredient.note ?? '',
    originalText: null,
  }));
  const steps = fixture.steps.map((step) => ({
    id: randomUUID(),
    title: '',
    summary: '',
    text: step.text,
    ingredientReferences: (step.ingredients ?? []).map((index) => {
      const ingredient = ingredients[index];
      if (!ingredient) throw new Error(`Step of ${fixture.name} refers to missing ingredient ${index}`);
      return { referenceId: ingredient.referenceId };
    }),
  }));

  await call(mealieUrl, 'PUT', `/api/recipes/${encodeURIComponent(slug)}`, token, {
    ...recipe,
    recipeIngredient: ingredients,
    recipeInstructions: steps,
    tags: (fixture.tags ?? []).map((name) => organizers.tags.get(name)),
    recipeCategory: (fixture.categories ?? []).map((name) => organizers.categories.get(name)),
    recipeServings: fixture.servings ?? 0,
    prepTime: fixture.prepTime ?? null,
    totalTime: fixture.totalTime ?? null,
    notes: fixture.notes ?? [],
    settings: { ...(recipe.settings as Json | undefined), disableAmount: false },
  });
  return slug;
}

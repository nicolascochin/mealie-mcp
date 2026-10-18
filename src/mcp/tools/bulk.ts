import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { MealieClient } from '../../mealie/client.js';
import { MealieError } from '../../mealie/errors.js';
import { api } from '../../mealie/path.js';
import type { MealieOrganizer, MealieRecipe } from '../../mealie/types.js';
import { resolveOrganizers } from '../../recipes/metadata.js';
import type { ToolDeps } from '../server.js';
import { runTool, ToolError } from './result.js';

const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const slugs = z.array(z.string().trim().min(1).max(200)).min(1).max(50).describe('Recipe slugs, from mealie_search_recipes');
const names = (what: string) => z.array(z.string().trim().min(1).max(200)).min(1).max(20).describe(what);
const createMissing = (what: string) => z.boolean().optional().describe(`Create ${what} that do not exist yet (default false)`);

/** Reads every recipe, so that an unknown slug fails before anything is changed. */
async function readRecipes(mealie: MealieClient, wanted: string[]): Promise<MealieRecipe[]> {
  const unique = [...new Set(wanted)];
  const results = await Promise.allSettled(unique.map((slug) => mealie.get<MealieRecipe>(api`/api/recipes/${slug}`)));
  const missing = unique.filter((_, i) => {
    const result = results[i]!;
    return result.status === 'rejected' && result.reason instanceof MealieError && result.reason.status === 404;
  });
  if (missing.length) {
    throw new ToolError(`No recipe has the slug ${missing.map((s) => `"${s}"`).join(', ')}. Use mealie_search_recipes to find the slugs. Nothing was changed.`);
  }
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((result) => (result as PromiseFulfilledResult<MealieRecipe>).value);
}

/**
 * Adds tags or categories to recipes with Mealie's bulk actions, keeping those they have. Mealie
 * appends what it is sent without checking for duplicates, so each recipe only gets the ones it
 * lacks: recipes lacking the same ones share one call.
 */
async function addOrganizers(mealie: MealieClient, kind: 'tags' | 'categories', wanted: string[], recipeSlugs: string[], create: boolean) {
  const recipes = await readRecipes(mealie, recipeSlugs);
  const problems: string[] = [];
  const organizers = (await resolveOrganizers(mealie, kind, wanted, create, problems)) ?? [];
  if (problems.length) throw new ToolError(problems.join('\n'));

  const groups = new Map<string, { organizers: MealieOrganizer[]; recipes: MealieRecipe[] }>();
  const unchanged: string[] = [];
  for (const recipe of recipes) {
    const have = new Set(((kind === 'tags' ? recipe.tags : recipe.recipeCategory) ?? []).map((o) => o.id));
    const lacking = organizers.filter((o) => !have.has(o.id));
    if (!lacking.length) {
      unchanged.push(recipe.name);
      continue;
    }
    const key = lacking.map((o) => o.id).join(' ');
    const group = groups.get(key) ?? { organizers: lacking, recipes: [] };
    group.recipes.push(recipe);
    groups.set(key, group);
  }
  const path = kind === 'tags' ? api`/api/recipes/bulk-actions/tag` : api`/api/recipes/bulk-actions/categorize`;
  for (const group of groups.values()) {
    await mealie.post(path, {
      recipes: group.recipes.map((recipe) => recipe.slug),
      [kind]: group.organizers.map(({ id, name, slug }) => ({ id, name, slug })),
    });
  }
  return {
    [kind]: organizers.map((o) => o.name),
    updated: [...groups.values()].flatMap((group) => group.recipes.map((recipe) => recipe.name)),
    ...(unchanged.length ? { alreadyThere: unchanged } : {}),
  };
}

export function registerBulkTools(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_tag_recipes',
    {
      title: 'Tag several recipes',
      description: 'Add tags to several recipes at once, keeping their other tags. Unknown tags fail with close matches unless createMissing is true.',
      inputSchema: z.object({ slugs, tags: names('Tag names'), createMissing: createMissing('tags') }),
      annotations: ADD,
    },
    ({ slugs, tags, createMissing }) =>
      runTool(logger, 'mealie_tag_recipes', () => addOrganizers(mealie, 'tags', tags, slugs, createMissing ?? false))
  );

  server.registerTool(
    'mealie_categorize_recipes',
    {
      title: 'Categorize several recipes',
      description:
        'Add categories to several recipes at once, keeping their other categories. Unknown categories fail with close matches unless createMissing is true.',
      inputSchema: z.object({ slugs, categories: names('Category names'), createMissing: createMissing('categories') }),
      annotations: ADD,
    },
    ({ slugs, categories, createMissing }) =>
      runTool(logger, 'mealie_categorize_recipes', () => addOrganizers(mealie, 'categories', categories, slugs, createMissing ?? false))
  );

  server.registerTool(
    'mealie_delete_recipes',
    {
      title: 'Delete several recipes',
      description: 'Delete several recipes from Mealie for good, in one go. Confirm the list with the user first.',
      inputSchema: z.object({ slugs }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ slugs }) =>
      runTool(logger, 'mealie_delete_recipes', async () => {
        const recipes = await readRecipes(mealie, slugs);
        await mealie.post(api`/api/recipes/bulk-actions/delete`, { recipes: recipes.map((recipe) => recipe.slug) });
        return { deleted: recipes.map((recipe) => recipe.name) };
      })
  );
}

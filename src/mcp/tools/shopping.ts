import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { MealieClient } from '../../mealie/client.js';
import { api } from '../../mealie/path.js';
import type { MealieRecipe, MealieShoppingItem, MealieShoppingList } from '../../mealie/types.js';
import { ingredientFields, resolveCatalogRefs } from '../../recipes/ingredients.js';
import { findShoppingList, readShoppingList } from '../../shopping/lists.js';
import { shoppingItems, shoppingListView } from '../../shopping/view.js';
import type { ToolDeps } from '../server.js';
import { runTool, ToolError } from './result.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const list = z.string().trim().min(1).max(200).optional().describe('Shopping list name (optional when there is only one list)');
const itemNumbers = z.array(z.number().int().min(1)).min(1).max(100).describe('Item numbers, as mealie_get_shopping_list shows them');
const RECIPE_NOT_FOUND = { notFound: 'Use mealie_search_recipes to find the recipe slug.' };

/** Checks item numbers against the list as read; returns the items. */
function pickItems(items: MealieShoppingItem[], numbers: number[]): MealieShoppingItem[] {
  const unknown = numbers.filter((n) => n > items.length);
  if (unknown.length) throw new ToolError(`There is no item ${unknown.join(', ')} (the list has ${items.length}). Read the list again with mealie_get_shopping_list.`);
  return [...new Set(numbers)].map((n) => items[n - 1]!);
}

/** The recipe scale from either a scale or a number of servings, converted with the recipe's servings. */
function recipeScale(recipe: MealieRecipe, scale: number | undefined, servings: number | undefined): number {
  if (scale !== undefined && servings !== undefined) throw new ToolError('Give either scale or servings, not both.');
  if (servings === undefined) return scale ?? 1;
  if (!recipe.recipeServings) {
    throw new ToolError(`"${recipe.name}" does not say how many servings it makes: give a scale instead (1 = the recipe as written).`);
  }
  return Math.round((servings / recipe.recipeServings) * 1000) / 1000;
}

async function listView(mealie: MealieClient, id: string) {
  return shoppingListView(await readShoppingList(mealie, id));
}

export function registerShoppingTools(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_list_shopping_lists',
    { title: 'List shopping lists', description: 'List the shopping lists of the household.', annotations: READ_ONLY },
    () =>
      runTool(logger, 'mealie_list_shopping_lists', async () => {
        const result = await mealie.get<{ items: Array<{ name: string }> }>(api`/api/households/shopping/lists`, { page: 1, perPage: -1 });
        return { lists: result.items.map((l) => l.name) };
      })
  );

  server.registerTool(
    'mealie_get_shopping_list',
    {
      title: 'Read a shopping list',
      description: 'Read a shopping list: numbered items (quantity, unit, food, note) and the recipes added to it. Checked items are hidden unless includeChecked is true; numbers stay the same either way.',
      inputSchema: z.object({ list, includeChecked: z.boolean().optional().describe('Also show checked items (default false)') }),
      annotations: READ_ONLY,
    },
    ({ list: name, includeChecked }) =>
      runTool(logger, 'mealie_get_shopping_list', async () => {
        const { id } = await findShoppingList(mealie, name);
        return shoppingListView(await readShoppingList(mealie, id), { includeChecked });
      })
  );

  const { section: _section, ...itemFields } = ingredientFields;
  server.registerTool(
    'mealie_add_shopping_items',
    {
      title: 'Add shopping items',
      description:
        'Add items to a shopping list, with foods and units by name so that Mealie groups and merges them with existing items. Use a note alone only for things that are not foods. Unknown foods or units fail with close matches unless createMissing is true.',
      inputSchema: z.object({
        list,
        items: z.array(z.object(itemFields)).min(1).max(100),
        createMissing: z.boolean().optional().describe('Create foods and units that do not exist yet (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ list: name, items, createMissing }) =>
      runTool(logger, 'mealie_add_shopping_items', async () => {
        const empty = items.flatMap((item, i) => (!item.food && !item.note ? [i + 1] : []));
        if (empty.length) throw new ToolError(`Items ${empty.join(', ')}: give at least a food or a note.`);
        const { id } = await findShoppingList(mealie, name);
        const refs = await resolveCatalogRefs(mealie, items, createMissing ?? false);
        const result = await mealie.post<{ createdItems?: unknown[]; updatedItems?: unknown[] }>(
          api`/api/households/shopping/items/create-bulk`,
          items.map((item) => ({
            shoppingListId: id,
            checked: false,
            ...(item.quantity != null ? { quantity: item.quantity } : {}),
            ...(item.food ? { foodId: refs.food(item.food).id } : {}),
            ...(item.unit ? { unitId: refs.unit(item.unit).id } : {}),
            note: item.note ?? '',
          }))
        );
        return {
          added: result.createdItems?.length ?? 0,
          mergedIntoExisting: result.updatedItems?.length ?? 0,
          list: await listView(mealie, id),
        };
      })
  );

  server.registerTool(
    'mealie_update_shopping_items',
    {
      title: 'Update shopping items',
      description: 'Check or uncheck items, or change their quantity or note. Items are given by number, as mealie_get_shopping_list shows them.',
      inputSchema: z.object({
        list,
        updates: z
          .array(
            z.object({
              n: z.number().int().min(1).describe('Item number'),
              checked: z.boolean().optional(),
              quantity: z.number().min(0).max(100_000).optional(),
              note: z.string().trim().max(500).optional(),
            })
          )
          .min(1)
          .max(100),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ list: name, updates }) =>
      runTool(logger, 'mealie_update_shopping_items', async () => {
        const { id } = await findShoppingList(mealie, name);
        const items = shoppingItems(await readShoppingList(mealie, id));
        const numbers = updates.map((u) => u.n);
        if (new Set(numbers).size !== numbers.length) throw new ToolError('An item is updated twice: merge the changes.');
        const empty = updates.filter((u) => u.checked === undefined && u.quantity === undefined && u.note === undefined).map((u) => u.n);
        if (empty.length) throw new ToolError(`Nothing to change for item ${empty.join(', ')}.`);
        const targets = pickItems(items, numbers);
        // Each item goes back as Mealie sent it, with only the given fields changed.
        await mealie.request(
          'PUT',
          api`/api/households/shopping/items`,
          updates.map((u, i) => ({
            ...targets[i]!,
            ...(u.checked !== undefined ? { checked: u.checked } : {}),
            ...(u.quantity !== undefined ? { quantity: u.quantity } : {}),
            ...(u.note !== undefined ? { note: u.note } : {}),
          }))
        );
        return listView(mealie, id);
      })
  );

  server.registerTool(
    'mealie_remove_shopping_items',
    {
      title: 'Remove shopping items',
      description: 'Remove items from a shopping list, given by number as mealie_get_shopping_list shows them.',
      inputSchema: z.object({ list, items: itemNumbers }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ list: name, items: numbers }) =>
      runTool(logger, 'mealie_remove_shopping_items', async () => {
        const { id } = await findShoppingList(mealie, name);
        const targets = pickItems(shoppingItems(await readShoppingList(mealie, id)), numbers);
        await mealie.request('DELETE', api`/api/households/shopping/items`, undefined, { ids: targets.map((item) => item.id) });
        return listView(mealie, id);
      })
  );

  server.registerTool(
    'mealie_add_recipe_to_shopping_list',
    {
      title: 'Add a recipe to a shopping list',
      description:
        'Add the ingredients of a recipe to a shopping list. Mealie computes the items from the structured ingredients and merges them with existing ones. Give a scale (1 = as written) or a number of servings.',
      inputSchema: z.object({
        list,
        slug: z.string().trim().min(1).max(200).describe('Recipe slug'),
        scale: z.number().positive().max(100).optional().describe('Multiply the recipe by this (default 1)'),
        servings: z.number().positive().max(1000).optional().describe('Number of servings wanted, converted with the recipe servings'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ list: name, slug, scale, servings }) =>
      runTool(
        logger,
        'mealie_add_recipe_to_shopping_list',
        async () => {
          const recipe = await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`);
          const factor = recipeScale(recipe, scale, servings);
          const { id } = await findShoppingList(mealie, name);
          await mealie.post(api`/api/households/shopping/lists/${id}/recipe`, [{ recipeId: recipe.id, recipeIncrementQuantity: factor }]);
          return { added: recipe.name, scale: factor, list: await listView(mealie, id) };
        },
        RECIPE_NOT_FOUND
      )
  );

  server.registerTool(
    'mealie_remove_recipe_from_shopping_list',
    {
      title: 'Remove a recipe from a shopping list',
      description: 'Remove the items a recipe added to a shopping list (all of it by default, or the given scale).',
      inputSchema: z.object({
        list,
        slug: z.string().trim().min(1).max(200).describe('Recipe slug'),
        scale: z.number().positive().max(100).optional().describe('How much of the recipe to remove (default: all of it)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ list: name, slug, scale }) =>
      runTool(
        logger,
        'mealie_remove_recipe_from_shopping_list',
        async () => {
          const recipe = await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`);
          const { id } = await findShoppingList(mealie, name);
          const shopping: MealieShoppingList = await readShoppingList(mealie, id);
          const reference = (shopping.recipeReferences ?? []).find((ref) => ref.recipeId === recipe.id);
          if (!reference) throw new ToolError(`"${recipe.name}" is not on the list "${shopping.name}".`);
          await mealie.post(api`/api/households/shopping/lists/${id}/recipe/${recipe.id}/delete`, {
            recipeDecrementQuantity: scale ?? reference.recipeQuantity ?? 1,
          });
          return { removed: recipe.name, list: await listView(mealie, id) };
        },
        RECIPE_NOT_FOUND
      )
  );
}

import { normalizeName } from '../catalog/normalize.js';
import { similarity } from '../catalog/resolve.js';
import type { MealieClient } from '../mealie/client.js';
import { api } from '../mealie/path.js';
import type { MealieShoppingList, MealieShoppingListSummary, Paginated } from '../mealie/types.js';
import { ToolError } from '../mcp/tools/result.js';

/**
 * Finds a shopping list by name, ignoring case and accents. Without a name, the household's only
 * list is used; with several lists, the model has to name one.
 */
export async function findShoppingList(mealie: MealieClient, name: string | undefined): Promise<MealieShoppingListSummary> {
  const items = await listShoppingLists(mealie);
  const names = items.map((list) => `"${list.name}"`).join(', ');
  if (items.length === 0) throw new ToolError('There is no shopping list yet: create one with mealie_create_shopping_list.');
  if (name === undefined) {
    if (items.length === 1) return items[0]!;
    throw new ToolError(`Several shopping lists exist: ${names}. Say which one.`);
  }
  const key = normalizeName(name);
  const exact = items.filter((list) => normalizeName(list.name) === key);
  if (exact.length === 1) return exact[0]!;
  const close = items.filter((list) => similarity(key, normalizeName(list.name)) >= 0.5).map((list) => `"${list.name}"`);
  throw new ToolError(`No shopping list is named "${name}".${close.length ? ` Close matches: ${close.join(', ')}.` : ''} Lists: ${names}.`);
}

/** All the lists of the household. */
export async function listShoppingLists(mealie: MealieClient): Promise<MealieShoppingListSummary[]> {
  return (await mealie.get<Paginated<MealieShoppingListSummary>>(api`/api/households/shopping/lists`, { page: 1, perPage: -1 })).items;
}

/** Refuses a name already used by another list, ignoring case and accents. */
export function assertListNameFree(lists: MealieShoppingListSummary[], name: string, exceptId?: string): void {
  const key = normalizeName(name);
  const clash = lists.find((list) => list.id !== exceptId && normalizeName(list.name) === key);
  if (clash) throw new ToolError(`A shopping list is already named "${clash.name}".`);
}

export function readShoppingList(mealie: MealieClient, id: string): Promise<MealieShoppingList> {
  return mealie.get<MealieShoppingList>(api`/api/households/shopping/lists/${id}`);
}

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
  const { items } = await mealie.get<Paginated<MealieShoppingListSummary>>(api`/api/households/shopping/lists`, { page: 1, perPage: -1 });
  const names = items.map((list) => `"${list.name}"`).join(', ');
  if (items.length === 0) throw new ToolError('There is no shopping list in Mealie yet: create one in Mealie first.');
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

export function readShoppingList(mealie: MealieClient, id: string): Promise<MealieShoppingList> {
  return mealie.get<MealieShoppingList>(api`/api/households/shopping/lists/${id}`);
}

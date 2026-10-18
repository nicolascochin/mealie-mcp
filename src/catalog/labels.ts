import type { MealieClient } from '../mealie/client.js';
import { api } from '../mealie/path.js';
import type { MealieLabel, Paginated } from '../mealie/types.js';
import { ToolError } from '../mcp/tools/result.js';
import { resolveName } from './resolve.js';

/** The labels (store sections) of the group: "Fruits et légumes", "Crèmerie"… */
export async function listLabels(mealie: MealieClient): Promise<MealieLabel[]> {
  return (await mealie.get<Paginated<MealieLabel>>(api`/api/groups/labels`, { page: 1, perPage: -1 })).items;
}

/**
 * The label a name designates, ignoring case and accents. An unknown name fails with close
 * matches, unless `createMissing` is set; an ambiguous one always fails.
 */
export async function resolveLabel(mealie: MealieClient, name: string, createMissing: boolean): Promise<MealieLabel> {
  const resolution = resolveName(name, await listLabels(mealie), (label) => [{ value: label.name, rank: 0 }]);
  if (resolution.status === 'found') return resolution.item;
  if (resolution.status === 'not_found' && createMissing) return mealie.post<MealieLabel>(api`/api/groups/labels`, { name });
  const options = resolution.status === 'ambiguous' ? resolution.candidates : resolution.suggestions;
  const close = options.length ? ` Close matches: ${options.map((label) => `"${label.name}"`).join(', ')}.` : '';
  const problem = resolution.status === 'ambiguous' ? 'is ambiguous' : 'was not found';
  const create = resolution.status === 'not_found' ? ' Set createMissing: true to create it, or see mealie_list_labels.' : '';
  throw new ToolError(`The label "${name}" ${problem}.${close}${create}`);
}

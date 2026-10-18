import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  aliasNames,
  foodVariants,
  foodView,
  listFoods,
  listOrganizers,
  listUnits,
  resolutionView,
  resolveFood,
  resolveUnit,
  unitVariants,
  unitView,
} from '../../catalog/catalog.js';
import { assertNamesFree, editAliases, namesToKeep, requireEntry } from '../../catalog/edit.js';
import type { NameVariant } from '../../catalog/resolve.js';
import type { MealieClient } from '../../mealie/client.js';
import { describeError } from '../../mealie/errors.js';
import { api, type ApiPath } from '../../mealie/path.js';
import type { MealieFood, MealieUnit } from '../../mealie/types.js';
import type { ToolDeps } from '../server.js';
import { runTool, ToolError } from './result.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const MERGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const name = (what: string) => z.string().trim().min(1).max(200).describe(what);
const optionalName = (what: string) => z.string().trim().min(1).max(200).optional().describe(what);
const aliases = z.array(z.string().trim().min(1).max(200)).max(20).optional().describe('Other names for the same thing');
const nullableName = (what: string) => z.string().trim().min(1).max(200).nullable().optional().describe(what);
const aliasEdit = (what: string) => z.array(z.string().trim().min(1).max(200)).max(20).optional().describe(what);
const keepNames = z.boolean().optional().describe('Keep the names of the merged entry as aliases of the one that stays (default true)');

const DUPLICATE = 'Use it instead of creating a duplicate.';
const present = (values: Array<string | null | undefined>) => values.filter((v): v is string => !!v);

interface Merge<T> {
  kind: 'food' | 'unit';
  items: T[];
  variantsOf: (item: T) => NameVariant[];
  from: string;
  into: string;
  keepNames: boolean;
  /** Merges the entry with id `fromId` into `toId` in Mealie. */
  merge: (fromId: string, toId: string) => Promise<unknown>;
  path: (id: string) => ApiPath;
}

/**
 * Merges one catalog entry into another, then adds the names of the merged entry to the aliases of
 * the one that stays, so that later lookups of the old names find it.
 */
async function mergeEntries<T extends MealieFood | MealieUnit>(mealie: MealieClient, merge: Merge<T>) {
  const { kind, items, variantsOf } = merge;
  const from = requireEntry(kind, merge.from, items, variantsOf);
  const into = requireEntry(kind, merge.into, items, variantsOf);
  if (from.id === into.id) throw new ToolError(`"${merge.from}" and "${merge.into}" are both the ${kind} "${into.name}": nothing to merge.`);
  await merge.merge(from.id, into.id);

  const others = items.filter((item) => item.id !== from.id && item.id !== into.id);
  let kept = await mealie.get<T>(merge.path(into.id));
  const added = merge.keepNames ? namesToKeep(from, kept, others, variantsOf) : [];
  if (added.length) {
    try {
      const aliases = [...aliasNames(kept.aliases), ...added].map((name) => ({ name }));
      kept = await mealie.request<T>('PUT', merge.path(into.id), { ...kept, aliases });
    } catch (err) {
      throw new ToolError(
        `"${from.name}" was merged into "${into.name}", but its names could not be added as aliases: ${describeError(err)} Add them with mealie_update_${kind}: ${added.map((n) => `"${n}"`).join(', ')}.`
      );
    }
  }
  return { kept, merged: from.name, added };
}

export function registerCatalogTools(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_search_foods',
    {
      title: 'Find a food',
      description:
        'Find a food in the Mealie catalog by name, plural or alias, ignoring case and accents. Returns the match, or candidates when the name is ambiguous or unknown: then ask the user or pick one explicitly, never guess.',
      inputSchema: z.object({ name: name('Food name, plural or alias, e.g. "oignons"') }),
      annotations: READ_ONLY,
    },
    ({ name }) => runTool(logger, 'mealie_search_foods', async () => resolutionView(await resolveFood(mealie, name), foodView))
  );

  server.registerTool(
    'mealie_search_units',
    {
      title: 'Find a unit',
      description:
        'Find a unit in the Mealie catalog by name, plural, abbreviation or alias, ignoring case and accents. Returns the match, or candidates when the name is ambiguous or unknown: then ask the user or pick one explicitly, never guess.',
      inputSchema: z.object({ name: name('Unit name, plural, abbreviation or alias, e.g. "c. à soupe"') }),
      annotations: READ_ONLY,
    },
    ({ name }) => runTool(logger, 'mealie_search_units', async () => resolutionView(await resolveUnit(mealie, name), unitView))
  );

  server.registerTool(
    'mealie_list_tags',
    { title: 'List tags', description: 'List the recipe tags defined in Mealie.', annotations: READ_ONLY },
    () =>
      runTool(logger, 'mealie_list_tags', async () => {
        const tags = await listOrganizers(mealie, 'tags');
        return { tags: tags.map((tag) => tag.name).sort((a, b) => a.localeCompare(b)) };
      })
  );

  server.registerTool(
    'mealie_list_categories',
    { title: 'List categories', description: 'List the recipe categories defined in Mealie.', annotations: READ_ONLY },
    () =>
      runTool(logger, 'mealie_list_categories', async () => {
        const categories = await listOrganizers(mealie, 'categories');
        return { categories: categories.map((category) => category.name).sort((a, b) => a.localeCompare(b)) };
      })
  );

  server.registerTool(
    'mealie_create_food',
    {
      title: 'Create a food',
      description:
        'Add a food to the Mealie catalog. Only when the user wants a new food: check with mealie_search_foods first. Refuses names, plurals or aliases already used by another food.',
      inputSchema: z.object({
        name: name('Singular name, e.g. "échalote"'),
        pluralName: optionalName('Plural, e.g. "échalotes"'),
        aliases,
      }),
      annotations: CREATE,
    },
    ({ name, pluralName, aliases }) =>
      runTool(logger, 'mealie_create_food', async () => {
        assertNamesFree('food', [name, ...present([pluralName]), ...(aliases ?? [])], await listFoods(mealie), foodVariants, DUPLICATE);
        const created = await mealie.post<MealieFood>(api`/api/foods`, {
          name,
          pluralName: pluralName ?? null,
          aliases: (aliases ?? []).map((alias) => ({ name: alias })),
        });
        return { created: foodView(created) };
      })
  );

  server.registerTool(
    'mealie_create_unit',
    {
      title: 'Create a unit',
      description:
        'Add a unit to the Mealie catalog. Only when the user wants a new unit: check with mealie_search_units first. Refuses names, abbreviations or aliases already used by another unit.',
      inputSchema: z.object({
        name: name('Singular name, e.g. "pincée"'),
        pluralName: optionalName('Plural, e.g. "pincées"'),
        abbreviation: optionalName('Abbreviation, e.g. "pinc."'),
        pluralAbbreviation: optionalName('Plural abbreviation, when it differs'),
        aliases,
      }),
      annotations: CREATE,
    },
    ({ name, pluralName, abbreviation, pluralAbbreviation, aliases }) =>
      runTool(logger, 'mealie_create_unit', async () => {
        const names = present([name, pluralName, abbreviation, pluralAbbreviation, ...(aliases ?? [])]);
        assertNamesFree('unit', names, await listUnits(mealie), unitVariants, DUPLICATE);
        const created = await mealie.post<MealieUnit>(api`/api/units`, {
          name,
          pluralName: pluralName ?? null,
          abbreviation: abbreviation ?? '',
          pluralAbbreviation: pluralAbbreviation ?? null,
          useAbbreviation: false,
          fraction: true,
          aliases: (aliases ?? []).map((alias) => ({ name: alias })),
        });
        return { created: unitView(created) };
      })
  );

  server.registerTool(
    'mealie_update_food',
    {
      title: 'Update a food',
      description:
        'Rename a food of the Mealie catalog, change its plural, or add and remove aliases. Only the given fields change. Refuses a name already used by another food: merge duplicates with mealie_merge_foods instead.',
      inputSchema: z.object({
        food: name('Food to change, by name, plural or alias'),
        name: optionalName('New singular name'),
        pluralName: nullableName('New plural; null removes it'),
        addAliases: aliasEdit('Aliases to add'),
        removeAliases: aliasEdit('Aliases to remove'),
      }),
      annotations: UPDATE,
    },
    ({ food, name, pluralName, addAliases, removeAliases }) =>
      runTool(logger, 'mealie_update_food', async () => {
        if (name === undefined && pluralName === undefined && !addAliases?.length && !removeAliases?.length) {
          throw new ToolError('Nothing to change: give name, pluralName, addAliases or removeAliases.');
        }
        const foods = await listFoods(mealie);
        const current = requireEntry('food', food, foods, foodVariants);
        const names = present([name, pluralName, ...(addAliases ?? [])]);
        assertNamesFree('food', names, foods, foodVariants, 'Merge them with mealie_merge_foods if they are the same food.', current.id);
        const aliases = editAliases(aliasNames(current.aliases), addAliases, removeAliases);
        const updated = await mealie.request<MealieFood>('PUT', api`/api/foods/${current.id}`, {
          ...current,
          ...(name !== undefined ? { name } : {}),
          ...(pluralName !== undefined ? { pluralName } : {}),
          aliases: aliases.map((alias) => ({ name: alias })),
        });
        return { updated: foodView(updated) };
      })
  );

  server.registerTool(
    'mealie_update_unit',
    {
      title: 'Update a unit',
      description:
        'Rename a unit of the Mealie catalog, change its plural or abbreviations, or add and remove aliases. Only the given fields change. Refuses a name already used by another unit: merge duplicates with mealie_merge_units instead.',
      inputSchema: z.object({
        unit: name('Unit to change, by name, plural, abbreviation or alias'),
        name: optionalName('New singular name'),
        pluralName: nullableName('New plural; null removes it'),
        abbreviation: nullableName('New abbreviation; null removes it'),
        pluralAbbreviation: nullableName('New plural abbreviation; null removes it'),
        addAliases: aliasEdit('Aliases to add'),
        removeAliases: aliasEdit('Aliases to remove'),
      }),
      annotations: UPDATE,
    },
    ({ unit, name, pluralName, abbreviation, pluralAbbreviation, addAliases, removeAliases }) =>
      runTool(logger, 'mealie_update_unit', async () => {
        const fields = [name, pluralName, abbreviation, pluralAbbreviation];
        if (fields.every((field) => field === undefined) && !addAliases?.length && !removeAliases?.length) {
          throw new ToolError('Nothing to change: give name, pluralName, abbreviation, pluralAbbreviation, addAliases or removeAliases.');
        }
        const units = await listUnits(mealie);
        const current = requireEntry('unit', unit, units, unitVariants);
        const names = present([...fields, ...(addAliases ?? [])]);
        assertNamesFree('unit', names, units, unitVariants, 'Merge them with mealie_merge_units if they are the same unit.', current.id);
        const aliases = editAliases(aliasNames(current.aliases), addAliases, removeAliases);
        const updated = await mealie.request<MealieUnit>('PUT', api`/api/units/${current.id}`, {
          ...current,
          ...(name !== undefined ? { name } : {}),
          ...(pluralName !== undefined ? { pluralName } : {}),
          ...(abbreviation !== undefined ? { abbreviation: abbreviation ?? '' } : {}),
          ...(pluralAbbreviation !== undefined ? { pluralAbbreviation } : {}),
          aliases: aliases.map((alias) => ({ name: alias })),
        });
        return { updated: unitView(updated) };
      })
  );

  server.registerTool(
    'mealie_merge_foods',
    {
      title: 'Merge two foods',
      description:
        'Merge a duplicate food into another: the recipes and shopping list items that used it then use the food that stays, and the duplicate is deleted. Its names become aliases of the food that stays unless keepNames is false. Confirm with the user first.',
      inputSchema: z.object({
        from: name('Duplicate food to merge away, by name, plural or alias'),
        into: name('Food that stays'),
        keepNames,
      }),
      annotations: MERGE,
    },
    ({ from, into, keepNames }) =>
      runTool(logger, 'mealie_merge_foods', async () => {
        const result = await mergeEntries(mealie, {
          kind: 'food',
          items: await listFoods(mealie),
          variantsOf: foodVariants,
          from,
          into,
          keepNames: keepNames ?? true,
          merge: (fromFood, toFood) => mealie.request('PUT', api`/api/foods/merge`, { fromFood, toFood }),
          path: (id) => api`/api/foods/${id}`,
        });
        return { merged: result.merged, into: foodView(result.kept), ...(result.added.length ? { addedAliases: result.added } : {}) };
      })
  );

  server.registerTool(
    'mealie_merge_units',
    {
      title: 'Merge two units',
      description:
        'Merge a duplicate unit into another: the recipes and shopping list items that used it then use the unit that stays, and the duplicate is deleted. Its names become aliases of the unit that stays unless keepNames is false. Confirm with the user first.',
      inputSchema: z.object({
        from: name('Duplicate unit to merge away, by name, plural, abbreviation or alias'),
        into: name('Unit that stays'),
        keepNames,
      }),
      annotations: MERGE,
    },
    ({ from, into, keepNames }) =>
      runTool(logger, 'mealie_merge_units', async () => {
        const result = await mergeEntries(mealie, {
          kind: 'unit',
          items: await listUnits(mealie),
          variantsOf: unitVariants,
          from,
          into,
          keepNames: keepNames ?? true,
          merge: (fromUnit, toUnit) => mealie.request('PUT', api`/api/units/merge`, { fromUnit, toUnit }),
          path: (id) => api`/api/units/${id}`,
        });
        return { merged: result.merged, into: unitView(result.kept), ...(result.added.length ? { addedAliases: result.added } : {}) };
      })
  );
}

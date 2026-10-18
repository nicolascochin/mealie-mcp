import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import {
  foodVariants,
  foodView,
  listFoods,
  listUnits,
  resolutionView,
  resolveFood,
  resolveUnit,
  unitVariants,
  unitView,
} from '../../catalog/catalog.js';
import { normalizeName } from '../../catalog/normalize.js';
import type { NameVariant } from '../../catalog/resolve.js';
import { api } from '../../mealie/path.js';
import type { MealieFood, MealieOrganizer, MealieUnit, Paginated } from '../../mealie/types.js';
import type { ToolDeps } from '../server.js';
import { runTool, ToolError } from './result.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const name = (what: string) => z.string().trim().min(1).max(200).describe(what);
const optionalName = (what: string) => z.string().trim().min(1).max(200).optional().describe(what);
const aliases = z.array(z.string().trim().min(1).max(200)).max(20).optional().describe('Other names for the same thing');

/** Refuses to create an entry whose names collide with an existing one. */
function assertNew<T extends { name: string }>(kind: string, names: string[], existing: T[], variantsOf: (item: T) => NameVariant[]) {
  for (const candidate of names) {
    const key = normalizeName(candidate);
    const clash = existing.find((item) => variantsOf(item).some((variant) => normalizeName(variant.value) === key));
    if (clash) {
      throw new ToolError(`"${candidate}" already names the ${kind} "${clash.name}". Use it instead of creating a duplicate.`);
    }
  }
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
        const { items } = await mealie.get<Paginated<MealieOrganizer>>(api`/api/organizers/tags`, { page: 1, perPage: -1 });
        return { tags: items.map((tag) => tag.name).sort((a, b) => a.localeCompare(b)) };
      })
  );

  server.registerTool(
    'mealie_list_categories',
    { title: 'List categories', description: 'List the recipe categories defined in Mealie.', annotations: READ_ONLY },
    () =>
      runTool(logger, 'mealie_list_categories', async () => {
        const { items } = await mealie.get<Paginated<MealieOrganizer>>(api`/api/organizers/categories`, { page: 1, perPage: -1 });
        return { categories: items.map((category) => category.name).sort((a, b) => a.localeCompare(b)) };
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
        assertNew('food', [name, ...(pluralName ? [pluralName] : []), ...(aliases ?? [])], await listFoods(mealie), foodVariants);
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
        const names = [name, pluralName, abbreviation, pluralAbbreviation, ...(aliases ?? [])].filter((v): v is string => !!v);
        assertNew('unit', names, await listUnits(mealie), unitVariants);
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
}

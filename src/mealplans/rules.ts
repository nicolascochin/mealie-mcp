import { listFoods, listOrganizers } from '../catalog/catalog.js';
import type { MealieClient } from '../mealie/client.js';
import { api, type ApiPath } from '../mealie/path.js';
import type { Paginated } from '../mealie/types.js';

/** One statement of a rule's recipe filter, as Mealie parses `queryFilterString`. */
export interface MealieQueryFilterPart {
  leftParenthesis?: string | null;
  rightParenthesis?: string | null;
  logicalOperator?: string | null;
  attributeName?: string | null;
  relationalOperator?: string | null;
  value?: string | string[] | null;
}

/** A meal plan rule, as `GET /api/households/mealplans/rules` lists it (fields this server reads). */
export interface MealieMealPlanRule {
  id: string;
  day: string;
  entryType: string;
  queryFilterString?: string | null;
  queryFilter?: { parts?: MealieQueryFilterPart[] | null } | null;
}

type Named = { id: string; name?: string | null; fullName?: string | null; username?: string | null };
const ALL = { page: 1, perPage: -1 } as const;
const items = async (mealie: MealieClient, path: ApiPath) => (await mealie.get<Paginated<Named>>(path, ALL)).items;

/**
 * The recipe attributes a rule can filter on, as Mealie's rule editor offers them: the name shown
 * to the model, and how to turn the ids it compares with into names.
 */
const ATTRIBUTES: Record<string, { label: string; load?: (mealie: MealieClient) => Promise<Named[]> }> = {
  'tags.id': { label: 'tags', load: (mealie) => listOrganizers(mealie, 'tags') },
  'recipe_category.id': { label: 'categories', load: (mealie) => listOrganizers(mealie, 'categories') },
  'tools.id': { label: 'tools', load: (mealie) => listOrganizers(mealie, 'tools') },
  'recipe_ingredient.food.id': { label: 'foods', load: listFoods },
  'recipe_ingredient.food.label_id': { label: 'food labels', load: (mealie) => items(mealie, api`/api/groups/labels`) },
  household_id: { label: 'household', load: (mealie) => items(mealie, api`/api/groups/households`) },
  user_id: { label: 'added by', load: (mealie) => items(mealie, api`/api/groups/members`) },
  rating: { label: 'rating' },
  total_time_seconds: { label: 'total time in seconds' },
  last_made: { label: 'last made' },
  created_at: { label: 'created' },
  updated_at: { label: 'updated' },
};

const partsOf = (rule: MealieMealPlanRule) => rule.queryFilter?.parts ?? [];

/** Id → name for every catalog the given rules refer to, each loaded once. */
export async function ruleNames(mealie: MealieClient, rules: MealieMealPlanRule[]): Promise<Map<string, string>> {
  const attributes = new Set(rules.flatMap(partsOf).map((part) => part.attributeName ?? ''));
  const loads = [...attributes].flatMap((attribute) => {
    const load = ATTRIBUTES[attribute]?.load;
    return load ? [load(mealie)] : [];
  });
  const names = new Map<string, string>();
  for (const list of await Promise.all(loads)) {
    for (const item of list) names.set(item.id, item.name ?? item.fullName ?? item.username ?? item.id);
  }
  return names;
}

function partText(part: MealieQueryFilterPart, names: Map<string, string>): string {
  const attribute = part.attributeName ?? '';
  const known = ATTRIBUTES[attribute];
  const show = (value: string) => JSON.stringify(known?.load ? (names.get(value) ?? 'unknown') : value);
  const value = Array.isArray(part.value) ? `[${part.value.map(show).join(', ')}]` : part.value != null ? show(part.value) : '';
  const statement = [known?.label ?? attribute, part.relationalOperator, value].filter(Boolean).join(' ');
  return [part.logicalOperator, `${part.leftParenthesis ?? ''}${statement}${part.rightParenthesis ?? ''}`].filter(Boolean).join(' ');
}

/** A rule as the model sees it: when it applies, and which recipes it allows, by name. */
export function ruleView(rule: MealieMealPlanRule, names: Map<string, string>) {
  const parts = partsOf(rule);
  return {
    day: rule.day === 'unset' ? 'any' : rule.day,
    meal: rule.entryType === 'unset' ? 'any' : rule.entryType,
    // Without parsed parts, the raw filter is still better than claiming that any recipe goes.
    recipes: parts.length ? parts.map((part) => partText(part, names)).join(' ') : rule.queryFilterString || 'any recipe',
  };
}

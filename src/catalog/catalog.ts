import type { MealieClient } from '../mealie/client.js';
import { api } from '../mealie/path.js';
import type { MealieFood, MealieUnit, Paginated } from '../mealie/types.js';
import { resolveName, type NameVariant, type Resolution } from './resolve.js';

/** Every page at once: Mealie returns the whole list for perPage=-1. */
const ALL = { page: 1, perPage: -1 } as const;

const aliasNames = (aliases: Array<{ name: string }> | null | undefined) => (aliases ?? []).map((alias) => alias.name);

export function foodVariants(food: MealieFood): NameVariant[] {
  return [
    { value: food.name, rank: 0 },
    ...(food.pluralName ? [{ value: food.pluralName, rank: 1 }] : []),
    ...aliasNames(food.aliases).map((value) => ({ value, rank: 2 })),
  ];
}

export function unitVariants(unit: MealieUnit): NameVariant[] {
  return [
    { value: unit.name, rank: 0 },
    ...[unit.pluralName, unit.abbreviation, unit.pluralAbbreviation].filter((v): v is string => !!v).map((value) => ({ value, rank: 1 })),
    ...aliasNames(unit.aliases).map((value) => ({ value, rank: 2 })),
  ];
}

export async function listFoods(mealie: MealieClient): Promise<MealieFood[]> {
  return (await mealie.get<Paginated<MealieFood>>(api`/api/foods`, ALL)).items;
}

export async function listUnits(mealie: MealieClient): Promise<MealieUnit[]> {
  return (await mealie.get<Paginated<MealieUnit>>(api`/api/units`, ALL)).items;
}

export async function resolveFood(mealie: MealieClient, name: string): Promise<Resolution<MealieFood>> {
  return resolveName(name, await listFoods(mealie), foodVariants);
}

export async function resolveUnit(mealie: MealieClient, name: string): Promise<Resolution<MealieUnit>> {
  return resolveName(name, await listUnits(mealie), unitVariants);
}

/** Compact views for the model: names only, empty fields left out, no ids. */
export function foodView(food: MealieFood) {
  const aliases = aliasNames(food.aliases);
  return {
    name: food.name,
    ...(food.pluralName && food.pluralName !== food.name ? { pluralName: food.pluralName } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

export function unitView(unit: MealieUnit) {
  const aliases = aliasNames(unit.aliases);
  return {
    name: unit.name,
    ...(unit.pluralName && unit.pluralName !== unit.name ? { pluralName: unit.pluralName } : {}),
    ...(unit.abbreviation ? { abbreviation: unit.abbreviation } : {}),
    ...(unit.pluralAbbreviation && unit.pluralAbbreviation !== unit.abbreviation ? { pluralAbbreviation: unit.pluralAbbreviation } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

/** A resolution as the model sees it. */
export function resolutionView<T, V>(resolution: Resolution<T>, view: (item: T) => V) {
  switch (resolution.status) {
    case 'found':
      return { status: 'found' as const, match: view(resolution.item) };
    case 'ambiguous':
      return { status: 'ambiguous' as const, candidates: resolution.candidates.map(view) };
    case 'not_found':
      return { status: 'not_found' as const, suggestions: resolution.suggestions.map(view) };
  }
}

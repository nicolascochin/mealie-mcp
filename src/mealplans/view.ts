import type { MealieMealPlanEntry } from '../mealie/types.js';

/** Mealie meal types, in the order of a day. */
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'side', 'snack', 'drink', 'dessert'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

const order = (type: string) => {
  const i = (MEAL_TYPES as readonly string[]).indexOf(type);
  return i === -1 ? MEAL_TYPES.length : i;
};

/** An entry: planned for a day (`date`), or for a whole week on no specific day (`week`). */
export function entryView(entry: MealieMealPlanEntry) {
  return {
    id: entry.id,
    ...(entry.endDate ? { week: { start: entry.date, end: entry.endDate } } : { date: entry.date }),
    meal: entry.entryType,
    ...(entry.recipe ? { recipe: { name: entry.recipe.name, slug: entry.recipe.slug } } : {}),
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.text ? { note: entry.text } : {}),
  };
}

/** Entries by date, then by meal of the day. */
export function entriesView(entries: MealieMealPlanEntry[]) {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || order(a.entryType) - order(b.entryType)).map(entryView);
}

/** Meals planned for a day, and meals planned for a whole week (Mealie v3.30+), apart. */
export function planView(entries: MealieMealPlanEntry[]) {
  const weekMeals = entries.filter((entry) => entry.endDate);
  return {
    meals: entriesView(entries.filter((entry) => !entry.endDate)),
    ...(weekMeals.length ? { weekMeals: entriesView(weekMeals) } : {}),
  };
}

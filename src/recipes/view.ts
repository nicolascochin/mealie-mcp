import type { MealieIngredient, MealieRecipe, MealieRecipeSummary, MealieUserRating } from '../mealie/types.js';

/** Drops null, undefined, empty strings and empty arrays: the model only sees what is set. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
  ) as Partial<T>;
}

const names = (items: Array<{ name: string }> | null | undefined) => (items ?? []).map((item) => item.name);

/** One line of a search result: what the model needs to pick a recipe. */
export function summaryView(recipe: MealieRecipeSummary) {
  return compact({
    slug: recipe.slug,
    name: recipe.name,
    totalTime: recipe.totalTime,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    tags: names(recipe.tags),
    categories: names(recipe.recipeCategory),
  });
}

/** An ingredient with no food: still the free text of an import, not structured yet. */
export function isFreeText(ingredient: MealieIngredient): boolean {
  return !ingredient.food && !ingredient.referencedRecipe;
}

function ingredientView(ingredient: MealieIngredient, n: number) {
  return compact({
    n,
    section: ingredient.title,
    quantity: ingredient.quantity ? ingredient.quantity : undefined,
    unit: ingredient.unit?.name,
    food: ingredient.food?.name,
    note: ingredient.note,
    recipe: ingredient.referencedRecipe ? { name: ingredient.referencedRecipe.name, slug: ingredient.referencedRecipe.slug } : undefined,
    display: ingredient.display,
    originalText: ingredient.originalText,
    freeText: isFreeText(ingredient) ? true : undefined,
  });
}

/**
 * The structured view of a recipe. Ingredients and steps are numbered from 1; steps refer to
 * ingredients by number, never by Mealie's referenceId. `mine` is the connected user's rating and
 * favorite flag, when known; `rating` stays the recipe's own (the average of its ratings).
 */
export function recipeView(recipe: MealieRecipe, mine?: MealieUserRating) {
  const ingredients = recipe.recipeIngredient ?? [];
  const numberOf = new Map<string, number>();
  ingredients.forEach((ingredient, i) => {
    if (ingredient.referenceId) numberOf.set(ingredient.referenceId, i + 1);
  });

  const steps = (recipe.recipeInstructions ?? []).map((step, i) =>
    compact({
      n: i + 1,
      title: step.title,
      summary: step.summary,
      text: step.text,
      ingredients: (step.ingredientReferences ?? [])
        .map((ref) => (ref.referenceId ? numberOf.get(ref.referenceId) : undefined))
        .filter((n): n is number => n !== undefined),
    })
  );

  const freeText = ingredients.flatMap((ingredient, i) => (isFreeText(ingredient) ? [i + 1] : []));
  const warnings = freeText.length
    ? [
        `Ingredients ${freeText.join(', ')} are free text with no food linked (typically after an import): quantities, units and foods are not structured.`,
      ]
    : [];

  return compact({
    name: recipe.name,
    slug: recipe.slug,
    description: recipe.description,
    servings: recipe.recipeServings ? recipe.recipeServings : undefined,
    yield: [recipe.recipeYieldQuantity || '', recipe.recipeYield ?? ''].join(' ').trim(),
    totalTime: recipe.totalTime,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    performTime: recipe.performTime,
    tags: names(recipe.tags),
    categories: names(recipe.recipeCategory),
    tools: names(recipe.tools),
    rating: recipe.rating ? recipe.rating : undefined,
    myRating: mine?.rating ? mine.rating : undefined,
    favorite: mine?.isFavorite ? true : undefined,
    source: recipe.orgURL,
    ingredients: ingredients.map((ingredient, i) => ingredientView(ingredient, i + 1)),
    steps,
    notes: (recipe.notes ?? []).map((note) => compact({ title: note.title, text: note.text })).filter((note) => Object.keys(note).length > 0),
    warnings,
  });
}

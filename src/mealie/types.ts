/** The subset of Mealie's `GET /api/users/self` response this server reads. */
export interface MealieUser {
  id: string;
  username: string;
  fullName?: string | null;
  /** Group name. */
  group?: string | null;
  /** Household name. */
  household?: string | null;
}

/** Mealie's paginated list envelope. */
export interface Paginated<T> {
  page: number;
  total: number;
  total_pages?: number;
  items: T[];
}

export interface MealieAlias {
  name: string;
}

/** An ingredient food, as `GET /api/foods` returns it (fields this server reads). */
export interface MealieFood {
  id: string;
  name: string;
  pluralName?: string | null;
  description?: string | null;
  aliases?: MealieAlias[] | null;
}

/** An ingredient unit, as `GET /api/units` returns it (fields this server reads). */
export interface MealieUnit {
  id: string;
  name: string;
  pluralName?: string | null;
  abbreviation?: string | null;
  pluralAbbreviation?: string | null;
  description?: string | null;
  aliases?: MealieAlias[] | null;
}

/** A tag or category. */
export interface MealieOrganizer {
  id: string;
  name: string;
  slug: string;
}

/** A recipe as `GET /api/recipes` lists it (fields this server reads). */
export interface MealieRecipeSummary {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  totalTime?: string | null;
  prepTime?: string | null;
  cookTime?: string | null;
  performTime?: string | null;
  tags?: MealieOrganizer[] | null;
  recipeCategory?: MealieOrganizer[] | null;
  rating?: number | null;
}

export interface MealieIngredient {
  referenceId?: string | null;
  quantity?: number | null;
  unit?: MealieUnit | null;
  food?: MealieFood | null;
  note?: string | null;
  /** Section title: set on the first ingredient of a section. */
  title?: string | null;
  /** The line as Mealie renders it. */
  display?: string | null;
  originalText?: string | null;
  /** Sub-recipe used as an ingredient. */
  referencedRecipe?: { name: string; slug: string } | null;
}

export interface MealieInstruction {
  id?: string | null;
  title?: string | null;
  summary?: string | null;
  text?: string | null;
  ingredientReferences?: Array<{ referenceId?: string | null }> | null;
}

/** A full recipe, as `GET /api/recipes/{slug}` returns it (fields this server reads). */
export interface MealieRecipe extends MealieRecipeSummary {
  recipeServings?: number | null;
  recipeYieldQuantity?: number | null;
  recipeYield?: string | null;
  orgURL?: string | null;
  tools?: Array<{ name: string }> | null;
  recipeIngredient?: MealieIngredient[] | null;
  recipeInstructions?: MealieInstruction[] | null;
  notes?: Array<{ title?: string | null; text?: string | null }> | null;
}

/** One entry of `GET /api/recipes/suggestions`. */
export interface MealieRecipeSuggestion {
  recipe: MealieRecipeSummary;
  missingFoods?: MealieFood[] | null;
  missingTools?: Array<{ name: string }> | null;
}

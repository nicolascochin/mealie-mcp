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

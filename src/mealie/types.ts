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

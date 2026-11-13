import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { isoDay, planRange, weekOf } from '../../mealplans/dates.js';
import { ruleNames, ruleView, type MealieMealPlanRule } from '../../mealplans/rules.js';
import { entriesView, entryView, MEAL_TYPES, planView } from '../../mealplans/view.js';
import type { MealieClient } from '../../mealie/client.js';
import { MealieError } from '../../mealie/errors.js';
import { api } from '../../mealie/path.js';
import type { MealieMealPlanEntry, MealieRecipe, Paginated } from '../../mealie/types.js';
import type { ToolDeps } from '../server.js';
import { runTool, ToolError } from './result.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const day = (what: string) => z.iso.date().describe(`${what}, YYYY-MM-DD`);
const meal = z
  .enum(MEAL_TYPES)
  .describe('breakfast (petit-déjeuner), lunch (déjeuner), dinner (dîner), side (accompagnement), snack (goûter), drink (boisson) or dessert');
const entryId = z.union([z.number().int(), z.string().min(1).max(100)]).describe('Entry id, from mealie_list_mealplans');
const ENTRY_NOT_FOUND = { notFound: 'Use mealie_list_mealplans to find the entry id.' };
const week = z
  .boolean()
  .optional()
  .describe("true: plan it for the whole week containing the date, on no specific day (Mealie v3.30+; the household's first day of the week)");

/** The week containing `day`, as the household's meal planner counts weeks. */
async function householdWeek(mealie: MealieClient, day: string): Promise<{ start: string; end: string }> {
  const preferences = await mealie.get<{ firstDayOfWeek?: number | null }>(api`/api/households/preferences`);
  return weekOf(day, preferences.firstDayOfWeek ?? 0);
}

/** `date` and `endDate` of an entry on `day`, or on the week containing it. */
async function entryDates(mealie: MealieClient, day: string, forTheWeek: boolean | undefined) {
  if (!forTheWeek) return { date: day };
  const { start, end } = await householdWeek(mealie, day);
  return { date: start, endDate: end };
}

async function recipeId(mealie: MealieClient, slug: string): Promise<string> {
  try {
    return (await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`)).id;
  } catch (err) {
    if (err instanceof MealieError && err.status === 404) {
      throw new ToolError(`No recipe has the slug "${slug}". Use mealie_search_recipes to find it.`);
    }
    throw err;
  }
}

export function registerMealPlanTools(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_list_mealplans',
    {
      title: 'List meal plans',
      description:
        'List planned meals between two dates, by date and meal. Default: the current week, Monday to Sunday; with only one date, the 7 days from or up to it. weekMeals are planned for a whole week, on no specific day.',
      inputSchema: z.object({ start: day('First day').optional(), end: day('Last day').optional() }),
      annotations: READ_ONLY,
    },
    ({ start, end }) =>
      runTool(logger, 'mealie_list_mealplans', async () => {
        const range = planRange(start, end);
        if (range.end < range.start) throw new ToolError('The last day comes before the first one.');
        const result = await mealie.get<Paginated<MealieMealPlanEntry>>(api`/api/households/mealplans`, {
          start_date: range.start,
          end_date: range.end,
          // Entries planned for a week (Mealie v3.30+) are left out unless asked for.
          include_week_entries: true,
          page: 1,
          perPage: -1,
        });
        return { start: range.start, end: range.end, ...planView(result.items) };
      })
  );

  server.registerTool(
    'mealie_get_todays_meals',
    {
      title: "Today's meals",
      description: "List the meals planned for today, and in weekMeals those planned for this week on no specific day.",
      annotations: READ_ONLY,
    },
    () =>
      runTool(logger, 'mealie_get_todays_meals', async () => {
        const today = isoDay(new Date());
        const [meals, range] = await Promise.all([
          mealie.get<MealieMealPlanEntry[]>(api`/api/households/mealplans/today`),
          mealie.get<Paginated<MealieMealPlanEntry>>(api`/api/households/mealplans`, {
            start_date: today,
            end_date: today,
            include_week_entries: true,
            page: 1,
            perPage: -1,
          }),
        ]);
        const weekMeals = range.items.filter((entry) => entry.endDate);
        return { meals: entriesView(meals), ...(weekMeals.length ? { weekMeals: entriesView(weekMeals) } : {}) };
      })
  );

  server.registerTool(
    'mealie_add_mealplan_entry',
    {
      title: 'Plan a meal',
      description: 'Plan a recipe (by slug) or a simple note for a date and a meal, or for the whole week containing the date.',
      inputSchema: z.object({
        date: day('Day'),
        week,
        meal,
        slug: z.string().trim().min(1).max(200).optional().describe('Recipe slug, from mealie_search_recipes'),
        title: z.string().trim().max(200).optional().describe('Title when there is no recipe, e.g. "Restes"'),
        note: z.string().trim().max(2000).optional().describe('Free note'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ date, week: forTheWeek, meal: entryType, slug, title, note }) =>
      runTool(logger, 'mealie_add_mealplan_entry', async () => {
        if (!slug && !title) throw new ToolError('Give a recipe slug or a title.');
        const recipe = slug ? { recipeId: await recipeId(mealie, slug) } : {};
        const created = await mealie.post<MealieMealPlanEntry>(api`/api/households/mealplans`, {
          ...(await entryDates(mealie, date, forTheWeek)),
          entryType,
          title: title ?? '',
          text: note ?? '',
          ...recipe,
        });
        return entryView(created);
      })
  );

  server.registerTool(
    'mealie_plan_random_meal',
    {
      title: 'Plan a random meal',
      description:
        "Let Mealie pick a recipe at random for a date (or the week containing it) and a meal, following the household's meal plan rules (see mealie_list_mealplan_rules), and add it to the plan.",
      inputSchema: z.object({ date: day('Day'), week, meal }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ date, week: forTheWeek, meal: entryType }) =>
      runTool(logger, 'mealie_plan_random_meal', async () => {
        const dates = await entryDates(mealie, date, forTheWeek);
        try {
          return entryView(await mealie.post<MealieMealPlanEntry>(api`/api/households/mealplans/random`, { ...dates, entryType }));
        } catch (err) {
          // Mealie answers 404 when no recipe passes the rules.
          if (err instanceof MealieError && err.status === 404) {
            throw new ToolError(
              `No recipe matches the meal plan rules for ${entryType} ${forTheWeek ? `in the week of ${dates.date}` : `on ${date}`}. See mealie_list_mealplan_rules, or plan a recipe with mealie_add_mealplan_entry.`
            );
          }
          throw err;
        }
      })
  );

  server.registerTool(
    'mealie_list_mealplan_rules',
    {
      title: 'List meal plan rules',
      description:
        'List the meal plan rules of the household: for which day and meal they apply, and which recipes they allow (tags, categories, tools, foods…). Random meals follow them.',
      annotations: READ_ONLY,
    },
    () =>
      runTool(logger, 'mealie_list_mealplan_rules', async () => {
        const rules = (await mealie.get<Paginated<MealieMealPlanRule>>(api`/api/households/mealplans/rules`, { page: 1, perPage: -1 })).items;
        const names = await ruleNames(mealie, rules);
        return { rules: rules.map((rule) => ruleView(rule, names)) };
      })
  );

  server.registerTool(
    'mealie_update_mealplan_entry',
    {
      title: 'Change a planned meal',
      description:
        'Move a planned meal to another date, week or meal, or change its recipe, title or note. Only the given fields change. A meal planned for a week moves to the week containing the new date.',
      inputSchema: z.object({
        id: entryId,
        date: day('New day').optional(),
        week: z
          .boolean()
          .optional()
          .describe('true: plan it for the whole week containing the date, on no specific day (Mealie v3.30+); false: plan it for the date, which is then required'),
        meal: meal.optional(),
        slug: z.string().trim().min(1).max(200).nullable().optional().describe('New recipe slug; null removes the recipe'),
        title: z.string().trim().max(200).optional(),
        note: z.string().trim().max(2000).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, date, week: forTheWeek, meal: entryType, slug, title, note }) =>
      runTool(
        logger,
        'mealie_update_mealplan_entry',
        async () => {
          if ([date, forTheWeek, entryType, slug, title, note].every((v) => v === undefined)) throw new ToolError('Nothing to change: give at least one field.');
          const entry = await mealie.get<MealieMealPlanEntry & Record<string, unknown>>(api`/api/households/mealplans/${id}`);
          const next: Record<string, unknown> = { ...entry };
          const wasWeek = Boolean(entry.endDate);
          if (forTheWeek === false && wasWeek && date === undefined) throw new ToolError('Give the date of the day to plan this meal on.');
          if (forTheWeek ?? wasWeek) {
            if (date !== undefined || !wasWeek) {
              const { start, end } = await householdWeek(mealie, date ?? entry.date);
              next.date = start;
              next.endDate = end;
            }
          } else {
            if (date !== undefined) next.date = date;
            if (wasWeek) next.endDate = null;
          }
          if (entryType !== undefined) next.entryType = entryType;
          if (title !== undefined) next.title = title;
          if (note !== undefined) next.text = note;
          if (slug === null) {
            if (!(title ?? entry.title)) throw new ToolError('An entry without a recipe needs a title: give one.');
            next.recipeId = null;
            next.recipe = null;
          } else if (slug !== undefined) {
            next.recipeId = await recipeId(mealie, slug);
            delete next.recipe;
          }
          return entryView(await mealie.request<MealieMealPlanEntry>('PUT', api`/api/households/mealplans/${id}`, next));
        },
        ENTRY_NOT_FOUND
      )
  );

  server.registerTool(
    'mealie_delete_mealplan_entry',
    {
      title: 'Remove a planned meal',
      description: 'Remove a meal from the plan (the recipe itself is kept).',
      inputSchema: z.object({ id: entryId }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ id }) =>
      runTool(
        logger,
        'mealie_delete_mealplan_entry',
        async () => {
          const deleted = await mealie.request<MealieMealPlanEntry>('DELETE', api`/api/households/mealplans/${id}`);
          return { deleted: entryView(deleted) };
        },
        ENTRY_NOT_FOUND
      )
  );
}

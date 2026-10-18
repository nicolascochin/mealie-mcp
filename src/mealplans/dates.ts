/** YYYY-MM-DD of a date, in UTC. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday to Sunday of the week containing `today`, as YYYY-MM-DD. */
export function currentWeek(today: Date = new Date()): { start: string; end: string } {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  const monday = new Date(day.getTime() - sinceMonday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { start: isoDay(monday), end: isoDay(sunday) };
}

const addDays = (day: string, days: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000));

/**
 * The days to list: the given range, a week from `start` or up to `end` when only one is given,
 * or the current week when neither is.
 */
export function planRange(start: string | undefined, end: string | undefined, today: Date = new Date()): { start: string; end: string } {
  if (start && end) return { start, end };
  if (start) return { start, end: addDays(start, 6) };
  if (end) return { start: addDays(end, -6), end };
  return currentWeek(today);
}

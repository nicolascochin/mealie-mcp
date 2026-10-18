import { normalizeName } from './normalize.js';

/**
 * One way of naming a catalog entry. A lower rank wins: an exact name beats a plural, which beats
 * an alias, so "oignon" resolves to the food named "oignon" even if another food lists it as alias.
 */
export interface NameVariant {
  value: string;
  rank: number;
}

export type Resolution<T> =
  | { status: 'found'; item: T }
  /** Several entries match equally well: the caller must choose, never this module. */
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'not_found'; suggestions: T[] };

export const MAX_SUGGESTIONS = 5;
const MIN_SIMILARITY = 0.5;

/** Finds `query` among `items` by any of their names, ignoring case, accents and punctuation. */
export function resolveName<T>(query: string, items: readonly T[], variantsOf: (item: T) => NameVariant[]): Resolution<T> {
  const key = normalizeName(query);
  let bestRank = Infinity;
  let matches: T[] = [];
  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const variants = variantsOf(item)
      .map((variant) => ({ key: normalizeName(variant.value), rank: variant.rank }))
      .filter((variant) => variant.key !== '');
    const exact = variants.filter((variant) => variant.key === key).map((variant) => variant.rank);
    if (exact.length > 0) {
      const rank = Math.min(...exact);
      if (rank < bestRank) {
        bestRank = rank;
        matches = [item];
      } else if (rank === bestRank) {
        matches.push(item);
      }
      continue;
    }
    const score = Math.max(0, ...variants.map((variant) => similarity(key, variant.key)));
    if (score >= MIN_SIMILARITY) scored.push({ item, score });
  }

  if (matches.length === 1) return { status: 'found', item: matches[0]! };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches.slice(0, MAX_SUGGESTIONS) };
  scored.sort((a, b) => b.score - a.score);
  return { status: 'not_found', suggestions: scored.slice(0, MAX_SUGGESTIONS).map((entry) => entry.item) };
}

/** 0 to 1. Edit distance on normalized names, with a floor when one contains the other as a word. */
export function similarity(a: string, b: string): number {
  if (a === '' || b === '') return 0;
  const longest = Math.max(a.length, b.length);
  let score = 1 - levenshtein(a, b) / longest;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 3 && ` ${longer} `.includes(` ${shorter} `)) score = Math.max(score, 0.75);
  else if (shorter.length >= 3 && longer.startsWith(shorter)) score = Math.max(score, 0.6);
  return score;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

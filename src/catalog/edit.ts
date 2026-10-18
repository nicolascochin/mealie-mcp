import { ToolError } from '../mcp/tools/result.js';
import { describeResolutionFailure } from './catalog.js';
import { normalizeName } from './normalize.js';
import { resolveName, type NameVariant } from './resolve.js';

type Entry = { id: string; name: string };
type Variants<T> = (item: T) => NameVariant[];

/** The one entry a name designates, resolved as the search tools do; anything else fails. */
export function requireEntry<T extends Entry>(kind: 'food' | 'unit', name: string, items: T[], variantsOf: Variants<T>): T {
  const resolution = resolveName(name, items, variantsOf);
  if (resolution.status === 'found') return resolution.item;
  throw new ToolError(describeResolutionFailure(kind, name, resolution, false));
}

/**
 * Refuses names that already name, pluralize or alias another entry, ignoring case and accents.
 * `exceptId` is the entry being edited, whose own names may be reused.
 */
export function assertNamesFree<T extends Entry>(
  kind: 'food' | 'unit',
  names: string[],
  items: T[],
  variantsOf: Variants<T>,
  hint: string,
  exceptId?: string
): void {
  for (const candidate of names) {
    const key = normalizeName(candidate);
    const clash = items.find((item) => item.id !== exceptId && variantsOf(item).some((variant) => normalizeName(variant.value) === key));
    if (clash) throw new ToolError(`"${candidate}" already names the ${kind} "${clash.name}". ${hint}`);
  }
}

/** The aliases after removing then adding names, compared without case or accents. */
export function editAliases(current: string[], add: string[] = [], remove: string[] = []): string[] {
  const has = (list: string[], name: string) => list.some((alias) => normalizeName(alias) === normalizeName(name));
  const unknown = remove.filter((name) => !has(current, name));
  if (unknown.length) {
    const known = current.length ? `Its aliases are ${current.map((a) => `"${a}"`).join(', ')}.` : 'It has no alias.';
    throw new ToolError(`Not an alias: ${unknown.map((a) => `"${a}"`).join(', ')}. ${known}`);
  }
  const next = current.filter((alias) => !has(remove, alias));
  for (const name of add) if (!has(next, name)) next.push(name);
  return next;
}

/**
 * The names of a merged-away entry worth keeping as aliases of the one that stays: those it does
 * not already answer to, and that no other entry uses.
 */
export function namesToKeep<T extends Entry>(from: T, into: T, others: T[], variantsOf: Variants<T>): string[] {
  const taken = new Set([into, ...others].flatMap((item) => variantsOf(item).map((variant) => normalizeName(variant.value))));
  const kept: string[] = [];
  for (const { value } of variantsOf(from)) {
    const key = normalizeName(value);
    if (taken.has(key)) continue;
    taken.add(key);
    kept.push(value);
  }
  return kept;
}

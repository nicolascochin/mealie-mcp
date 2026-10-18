import { InvalidPathSegmentError } from './errors.js';

declare const apiPathBrand: unique symbol;
/** A Mealie API path whose dynamic segments went through {@link api}. */
export type ApiPath = string & { readonly [apiPathBrand]: true };

/**
 * Encodes one path segment. Rejects values that could change the path itself: empty, `.`, `..`,
 * or containing a slash or backslash.
 */
export function pathSegment(value: string | number): string {
  const text = String(value);
  if (text === '' || text === '.' || text === '..' || text.includes('/') || text.includes('\\')) {
    throw new InvalidPathSegmentError(text);
  }
  return encodeURIComponent(text);
}

/** Builds an API path, encoding every interpolated value: api`/api/recipes/${slug}`. */
export function api(strings: TemplateStringsArray, ...values: Array<string | number>): ApiPath {
  return strings.reduce((path, part, i) => path + part + (i < values.length ? pathSegment(values[i]!) : ''), '') as ApiPath;
}

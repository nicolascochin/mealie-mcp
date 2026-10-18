/**
 * Reduces a catalog name to a comparison key: lower case, no accents, ligatures spelled out,
 * punctuation turned into spaces. "Œufs", "oeufs" and "OEUFS" share a key; so do
 * "c. à soupe" and "c à soupe".
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

import { describe, expect, it } from 'vitest';
import { foodVariants, unitVariants } from '../src/catalog/catalog.js';
import { normalizeName } from '../src/catalog/normalize.js';
import { resolveName, similarity } from '../src/catalog/resolve.js';
import type { MealieFood, MealieUnit } from '../src/mealie/types.js';
import { FOODS, UNITS } from './live/fixtures.js';

const foods: MealieFood[] = FOODS.map((f, i) => ({ id: `f${i}`, ...f, aliases: f.aliases.map((name) => ({ name })) }));
const units: MealieUnit[] = UNITS.map((u, i) => ({ id: `u${i}`, ...u, aliases: u.aliases.map((name) => ({ name })) }));
const food = (query: string) => resolveName(query, foods, foodVariants);
const unit = (query: string) => resolveName(query, units, unitVariants);

describe('normalizeName', () => {
  it.each([
    ['Œufs', 'oeufs'],
    ['  CRÈME   Fraîche ', 'creme fraiche'],
    ['c. à soupe', 'c a soupe'],
    ["Soupe à l'oignon", 'soupe a l oignon'],
  ])('%j → %j', (input, key) => {
    expect(normalizeName(input)).toBe(key);
  });
});

describe('resolveName', () => {
  it.each(['oignon', 'oignons', 'Oignon', 'OIGNONS', 'oignon jaune'])('finds the onion from %j', (query) => {
    expect(food(query)).toEqual({ status: 'found', item: expect.objectContaining({ name: 'oignon' }) });
  });

  it.each(['œuf', 'oeuf', 'Œufs', 'OEUFS'])('ignores ligatures and case: %j', (query) => {
    expect(food(query)).toMatchObject({ status: 'found', item: { name: 'œuf' } });
  });

  it.each(['cuillère à soupe', 'cuilleres a soupe', 'c. à soupe', 'c à soupe', 'CS', 'c. à s.'])('finds the tablespoon from %j', (query) => {
    expect(unit(query)).toMatchObject({ status: 'found', item: { name: 'cuillère à soupe' } });
  });

  it('matches abbreviations', () => {
    expect(unit('g')).toMatchObject({ status: 'found', item: { name: 'gramme' } });
    expect(unit('cl')).toMatchObject({ status: 'found', item: { name: 'centilitre' } });
  });

  it('suggests close names instead of failing', () => {
    const result = food('oignn');
    expect(result.status).toBe('not_found');
    expect(result.status === 'not_found' && result.suggestions.map((f) => f.name)[0]).toBe('oignon');
  });

  it('suggests foods containing the word', () => {
    const result = food('bouillon');
    expect(result.status === 'not_found' && result.suggestions.map((f) => f.name)).toContain('bouillon de bœuf');
  });

  it('returns no suggestions for unrelated names', () => {
    expect(food('xylophone')).toEqual({ status: 'not_found', suggestions: [] });
  });

  it('prefers an exact name over an alias of another entry', () => {
    const items: MealieFood[] = [
      { id: '1', name: 'tomate cerise', aliases: [{ name: 'tomate' }] },
      { id: '2', name: 'tomate' },
    ];
    expect(resolveName('tomate', items, foodVariants)).toMatchObject({ status: 'found', item: { id: '2' } });
  });

  it('reports a tie as ambiguous and never picks one', () => {
    const items: MealieFood[] = [
      { id: '1', name: 'piment doux', aliases: [{ name: 'piment' }] },
      { id: '2', name: 'piment fort', aliases: [{ name: 'piment' }] },
    ];
    const result = resolveName('piment', items, foodVariants);
    expect(result.status).toBe('ambiguous');
    expect(result.status === 'ambiguous' && result.candidates.map((f) => f.id)).toEqual(['1', '2']);
  });
});

describe('similarity', () => {
  it('is 1 for equal names and lower for distant ones', () => {
    expect(similarity('farine', 'farine')).toBe(1);
    expect(similarity('farine', 'farin')).toBeGreaterThan(0.8);
    expect(similarity('farine', 'lait')).toBeLessThan(0.5);
  });
});

import { describe, expect, it } from 'vitest';
import { recipeView, summaryView, timeView } from '../src/recipes/view.js';
import { quiche } from './helpers/recipes.js';

describe('recipeView', () => {
  it('leaves out hasImage when the recipe has no image', () => {
    expect(recipeView({ ...quiche(), image: null })).not.toHaveProperty('hasImage');
  });

  it('numbers ingredients and keeps only what is set', () => {
    expect(recipeView(quiche())).toEqual({
      name: 'Quiche lorraine',
      slug: 'quiche-lorraine',
      servings: 6,
      totalTime: { hours: 1 },
      prepTime: { minutes: 20 },
      cookTime: { minutes: 35, text: 'à 180 °C' },
      tags: ['Classique'],
      categories: ['Plat'],
      hasImage: true,
      source: 'https://example.com/quiche',
      ingredients: [
        { n: 1, section: 'Pâte', quantity: 250, unit: 'gramme', food: 'farine', display: '250 grammes farine' },
        { n: 2, quantity: 1, recipe: { name: 'Pâte brisée', slug: 'pate-brisee' }, display: '1 pâte brisée' },
        { n: 3, section: 'Garniture', quantity: 3, food: 'œuf', note: 'battus', display: '3 œufs battus' },
        { n: 4, note: 'sel, poivre', display: 'sel, poivre', originalText: 'sel, poivre', freeText: true },
      ],
      steps: [
        { n: 1, text: 'Foncer le moule.', ingredients: [1, 2] },
        { n: 2, title: 'Cuisson', text: 'Verser et cuire.', ingredients: [3, 4] },
      ],
      notes: [{ title: 'Astuce', text: 'Précuire la pâte.' }],
      warnings: [expect.stringContaining('Ingredients 4 are free text')],
    });
  });

  it('never exposes referenceIds or other technical fields', () => {
    const text = JSON.stringify(recipeView(quiche()));
    for (const leaked of ['referenceId', '"a"', 'userId', 'groupId', 'f-farine', 'u-gramme', 'settings', 'image']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('has no warning when every ingredient is structured', () => {
    const recipe = quiche();
    recipe.recipeIngredient = recipe.recipeIngredient!.slice(0, 3);
    expect(recipeView(recipe).warnings).toBeUndefined();
  });

  it('shows the old cooking time Mealie no longer shows, and says how to move it', () => {
    const recipe = { ...quiche(), performTimeSeconds: null, performTime: null, cookTime: '35 min' };
    recipe.recipeIngredient = recipe.recipeIngredient!.slice(0, 3);
    const view = recipeView(recipe);
    expect(view).not.toHaveProperty('cookTime');
    expect(view.legacyCookTime).toBe('35 min');
    expect(view.warnings).toEqual([
      'Mealie no longer shows the old cooking time "35 min" (legacyCookTime): move it to cookTime (hours and minutes) and clear it with legacyCookTime: null, in one mealie_update_recipe call.',
    ]);
  });

  it('ignores an empty old cooking time', () => {
    expect(recipeView({ ...quiche(), cookTime: ' ' })).not.toHaveProperty('legacyCookTime');
  });
});

describe('timeView', () => {
  it('splits the duration into hours and minutes, and keeps the text apart', () => {
    expect(timeView(5400, null)).toEqual({ hours: 1, minutes: 30 });
    expect(timeView(26 * 3600, '')).toEqual({ hours: 26 });
    expect(timeView(1200, ' plus 1 nuit de marinade ')).toEqual({ minutes: 20, text: 'plus 1 nuit de marinade' });
  });

  it('shows a time still in text alone, as the migration of Mealie v3.29 left it', () => {
    expect(timeView(null, '1 h 30')).toEqual({ text: '1 h 30' });
  });

  it('keeps the seconds an import may leave', () => {
    expect(timeView(3615, null)).toEqual({ hours: 1, seconds: 15 });
  });

  it('is undefined when nothing is set', () => {
    expect(timeView(null, null)).toBeUndefined();
    expect(timeView(0, '  ')).toBeUndefined();
  });
});

describe('summaryView', () => {
  it('keeps slug, name, times, tags and categories', () => {
    expect(summaryView(quiche())).toEqual({
      slug: 'quiche-lorraine',
      name: 'Quiche lorraine',
      totalTime: { hours: 1 },
      prepTime: { minutes: 20 },
      cookTime: { minutes: 35, text: 'à 180 °C' },
      tags: ['Classique'],
      categories: ['Plat'],
    });
  });

  it('shows the old cooking time', () => {
    expect(summaryView({ ...quiche(), cookTime: '35 min' })).toMatchObject({ legacyCookTime: '35 min' });
  });
});

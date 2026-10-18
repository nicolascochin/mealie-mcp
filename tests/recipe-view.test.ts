import { describe, expect, it } from 'vitest';
import { recipeView, summaryView } from '../src/recipes/view.js';
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
      totalTime: '1 h',
      prepTime: '20 min',
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
});

describe('summaryView', () => {
  it('keeps slug, name, times, tags and categories', () => {
    expect(summaryView(quiche())).toEqual({
      slug: 'quiche-lorraine',
      name: 'Quiche lorraine',
      totalTime: '1 h',
      prepTime: '20 min',
      tags: ['Classique'],
      categories: ['Plat'],
    });
  });
});

import type { MealieRecipe } from '../../src/mealie/types.js';

const unit = (name: string) => ({ id: `u-${name}`, name, pluralName: `${name}s`, abbreviation: '' });
const food = (name: string) => ({ id: `f-${name}`, name, pluralName: name });

/** A recipe shaped like Mealie's `GET /api/recipes/{slug}`, with sections, links, free text and a sub-recipe. */
export function quiche(): MealieRecipe & Record<string, unknown> {
  return {
    id: 'r1',
    userId: 'u1',
    groupId: 'g1',
    householdId: 'h1',
    name: 'Quiche lorraine',
    slug: 'quiche-lorraine',
    image: 'abc',
    description: '',
    recipeServings: 6,
    recipeYieldQuantity: 0,
    recipeYield: '',
    totalTime: '1 h',
    prepTime: '20 min',
    cookTime: null,
    performTime: null,
    recipeCategory: [{ id: 'c1', name: 'Plat', slug: 'plat' }],
    tags: [{ id: 't1', name: 'Classique', slug: 'classique' }],
    tools: [],
    rating: null,
    orgURL: 'https://example.com/quiche',
    dateAdded: '2026-10-18',
    recipeIngredient: [
      { referenceId: 'a', title: 'Pâte', quantity: 250, unit: unit('gramme'), food: food('farine'), note: '', display: '250 grammes farine', originalText: null },
      { referenceId: 'b', title: '', quantity: 1, unit: null, food: null, note: '', display: '1 pâte brisée', referencedRecipe: { name: 'Pâte brisée', slug: 'pate-brisee' } },
      { referenceId: 'c', title: 'Garniture', quantity: 3, unit: null, food: food('œuf'), note: 'battus', display: '3 œufs battus' },
      { referenceId: 'd', title: null, quantity: 0, unit: null, food: null, note: 'sel, poivre', display: 'sel, poivre', originalText: 'sel, poivre' },
    ],
    recipeInstructions: [
      { id: 's1', title: '', summary: '', text: 'Foncer le moule.', ingredientReferences: [{ referenceId: 'a' }, { referenceId: 'b' }] },
      { id: 's2', title: 'Cuisson', summary: '', text: 'Verser et cuire.', ingredientReferences: [{ referenceId: 'c' }, { referenceId: 'd' }, { referenceId: 'gone' }] },
    ],
    notes: [{ title: 'Astuce', text: 'Précuire la pâte.' }],
    nutrition: { calories: null },
    settings: { public: true },
    assets: [],
    comments: [],
    extras: {},
  };
}

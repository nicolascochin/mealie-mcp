import type { MealieShoppingItem, MealieShoppingList } from '../mealie/types.js';

/** Items in the order Mealie returns them: the numbers the tools use refer to this order. */
export function shoppingItems(list: MealieShoppingList): MealieShoppingItem[] {
  return list.listItems ?? [];
}

/**
 * A shopping list as the model sees it. Items are numbered from 1 over the whole list, checked
 * ones included, so the numbers stay the same whether checked items are shown or not.
 */
export function shoppingListView(list: MealieShoppingList, options: { includeChecked?: boolean } = {}) {
  const recipeNames = new Map((list.recipeReferences ?? []).filter((ref) => ref.recipe).map((ref) => [ref.recipeId, ref.recipe!.name]));
  const items = shoppingItems(list);
  const shown = items
    .map((item, i) => ({ item, n: i + 1 }))
    .filter(({ item }) => options.includeChecked || !item.checked)
    .map(({ item, n }) => {
      const recipes = (item.recipeReferences ?? []).map((ref) => recipeNames.get(ref.recipeId)).filter((name): name is string => !!name);
      return {
        n,
        ...(item.quantity ? { quantity: item.quantity } : {}),
        ...(item.unit ? { unit: item.unit.name } : {}),
        ...(item.food ? { food: item.food.name } : {}),
        ...(item.note ? { note: item.note } : {}),
        ...(item.display ? { display: item.display } : {}),
        ...(item.checked ? { checked: true } : {}),
        ...(recipes.length ? { recipes: [...new Set(recipes)] } : {}),
      };
    });
  const checked = items.filter((item) => item.checked).length;
  return {
    name: list.name,
    items: shown,
    ...(!options.includeChecked && checked ? { checkedHidden: checked } : {}),
    ...((list.recipeReferences ?? []).length
      ? {
          recipes: (list.recipeReferences ?? []).map((ref) => ({
            name: ref.recipe?.name ?? ref.recipeId,
            ...(ref.recipe?.slug ? { slug: ref.recipe.slug } : {}),
            ...(ref.recipeQuantity ? { scale: ref.recipeQuantity } : {}),
          })),
        }
      : {}),
  };
}

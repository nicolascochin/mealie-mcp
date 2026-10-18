/** French catalog and recipes the live Mealie is seeded with. Plurals and aliases on purpose. */

export const LIVE_USER = {
  username: 'testeur',
  fullName: 'Testeur MCP',
  email: 'testeur@example.com',
  password: 'mealie-mcp-live-tests',
};

export interface UnitFixture {
  name: string;
  pluralName: string;
  abbreviation: string;
  pluralAbbreviation: string;
  aliases: string[];
}

export const UNITS: UnitFixture[] = [
  { name: 'gramme', pluralName: 'grammes', abbreviation: 'g', pluralAbbreviation: 'g', aliases: ['gr'] },
  { name: 'litre', pluralName: 'litres', abbreviation: 'l', pluralAbbreviation: 'l', aliases: [] },
  { name: 'centilitre', pluralName: 'centilitres', abbreviation: 'cl', pluralAbbreviation: 'cl', aliases: [] },
  {
    name: 'cuillère à soupe',
    pluralName: 'cuillères à soupe',
    abbreviation: 'c. à soupe',
    pluralAbbreviation: 'c. à soupe',
    aliases: ['cs', 'c. à s.'],
  },
  {
    name: 'cuillère à café',
    pluralName: 'cuillères à café',
    abbreviation: 'c. à café',
    pluralAbbreviation: 'c. à café',
    aliases: ['cc', 'c. à c.'],
  },
];

export interface FoodFixture {
  name: string;
  pluralName: string;
  aliases: string[];
}

export const FOODS: FoodFixture[] = [
  { name: 'oignon', pluralName: 'oignons', aliases: ['oignon jaune'] },
  { name: 'beurre', pluralName: 'beurre', aliases: [] },
  { name: 'bouillon de bœuf', pluralName: 'bouillon de bœuf', aliases: ['bouillon de boeuf'] },
  { name: 'farine', pluralName: 'farine', aliases: ['farine de blé'] },
  { name: 'œuf', pluralName: 'œufs', aliases: ['oeuf', 'oeufs'] },
  { name: 'lait', pluralName: 'lait', aliases: [] },
  { name: 'lardons', pluralName: 'lardons', aliases: ['lardon'] },
  { name: 'crème fraîche', pluralName: 'crème fraîche', aliases: ['creme fraiche'] },
];

export interface IngredientFixture {
  /** Starts a section with this title. */
  section?: string;
  quantity?: number;
  unit?: string;
  food?: string;
  note?: string;
}

export interface StepFixture {
  text: string;
  /** Indexes into the recipe's ingredients. */
  ingredients?: number[];
}

export interface RecipeFixture {
  name: string;
  tags?: string[];
  categories?: string[];
  prepTime?: string;
  totalTime?: string;
  notes?: Array<{ title: string; text: string }>;
  ingredients: IngredientFixture[];
  steps: StepFixture[];
}

export const RECIPES: RecipeFixture[] = [
  {
    name: "Soupe à l'oignon",
    tags: ['Hiver'],
    categories: ['Plat'],
    totalTime: '45 min',
    ingredients: [
      { quantity: 4, food: 'oignon', note: 'émincés' },
      { quantity: 2, unit: 'cuillère à soupe', food: 'beurre' },
      { quantity: 1, unit: 'litre', food: 'bouillon de bœuf' },
    ],
    steps: [
      { text: 'Faire fondre les oignons dans le beurre.', ingredients: [0, 1] },
      { text: 'Mouiller avec le bouillon et laisser mijoter 30 minutes.', ingredients: [2] },
    ],
  },
  {
    name: 'Quiche lorraine',
    tags: ['Classique'],
    categories: ['Plat'],
    prepTime: '20 min',
    totalTime: '1 h',
    notes: [{ title: 'Astuce', text: 'Précuire la pâte 10 minutes.' }],
    ingredients: [
      { section: 'Pâte', quantity: 250, unit: 'gramme', food: 'farine' },
      { quantity: 125, unit: 'gramme', food: 'beurre', note: 'mou' },
      { section: 'Garniture', quantity: 200, unit: 'gramme', food: 'lardons' },
      { quantity: 3, food: 'œuf' },
      { quantity: 20, unit: 'centilitre', food: 'crème fraîche' },
      { note: 'sel, poivre' },
    ],
    steps: [
      { text: 'Mélanger la farine et le beurre, foncer le moule.', ingredients: [0, 1] },
      { text: 'Faire revenir les lardons.', ingredients: [2] },
      { text: 'Battre les œufs avec la crème, verser sur les lardons et cuire 35 minutes à 180 °C.', ingredients: [3, 4, 5] },
    ],
  },
  {
    name: 'Crêpes',
    tags: ['Rapide', 'Végétarien'],
    categories: ['Dessert'],
    totalTime: '30 min',
    ingredients: [
      { quantity: 250, unit: 'gramme', food: 'farine' },
      { quantity: 4, food: 'œuf' },
      { quantity: 50, unit: 'centilitre', food: 'lait' },
      { quantity: 1, unit: 'cuillère à café', note: 'sucre vanillé' },
    ],
    steps: [{ text: 'Mélanger, laisser reposer une heure, cuire à la poêle.', ingredients: [0, 1, 2, 3] }],
  },
];

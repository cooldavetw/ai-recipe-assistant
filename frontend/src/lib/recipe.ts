import type { Preferences } from "./kitchen";
import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const recipeSchema = z.object({
  title: text(100), description: text(600), cuisine: text(60),
  servings: z.number().int().min(1).max(24),
  totalMinutes: z.number().int().min(1).max(1440),
  ingredients: z.array(z.object({ name: text(100), quantity: text(100), optional: z.boolean() })).min(1).max(40),
  steps: z.array(text(1200)).min(1).max(30),
  tips: z.array(text(600)).max(10),
});
export type Recipe = z.infer<typeof recipeSchema>;
/** Tool arguments: a recipe plus the saved recipe it replaces, if any. */
export const recipeToolSchema = recipeSchema.extend({
  replaceRecipeId: z.string().trim().min(1).max(100).optional().describe("id of the saved recipe to update in place. Omit to add a separate new recipe."),
});
export type SavedRecipe = Recipe & { id: string; preferencesAtCreation?: Preferences };
/**
 * What an in-place update changed, for the agent's follow-up summary. Computed
 * here so the chat describes the real edit rather than the model's intent.
 */
export function describeRecipeChanges(before: Recipe, after: Recipe): string[] {
  const changes: string[] = [];
  if (before.title !== after.title) changes.push(`title: "${before.title}" → "${after.title}"`);
  if (before.servings !== after.servings) changes.push(`servings: ${before.servings} → ${after.servings}`);
  if (before.totalMinutes !== after.totalMinutes) changes.push(`total time: ${before.totalMinutes} → ${after.totalMinutes} minutes`);
  const key = (name: string) => name.trim().toLowerCase();
  const old = new Map(before.ingredients.map(item => [key(item.name), item]));
  const next = new Map(after.ingredients.map(item => [key(item.name), item]));
  for (const [name, item] of next) {
    const previous = old.get(name);
    if (!previous) changes.push(`added ingredient: ${item.name} (${item.quantity})`);
    else if (previous.quantity !== item.quantity) changes.push(`${item.name}: ${previous.quantity} → ${item.quantity}`);
  }
  for (const [name, item] of old) if (!next.has(name)) changes.push(`removed ingredient: ${item.name}`);
  const changedSteps = after.steps.map((step, index) => step === before.steps[index] ? 0 : index + 1).filter(Boolean);
  if (before.steps.length !== after.steps.length) changes.push(`steps: ${before.steps.length} → ${after.steps.length}`);
  else if (changedSteps.length) changes.push(`rewritten steps: ${changedSteps.join(", ")}`);
  if (before.tips.join("\n") !== after.tips.join("\n")) changes.push("tips updated");
  return changes;
}
/** show() returns the recipe it replaced, or nothing when it added a new one. */
export function createRecipeHandler(show: (recipe: Recipe, id: string, replaceRecipeId?: string) => Recipe | void, blocked: () => string | undefined = () => undefined) {
  const results = new Map<string, string>();
  return (args: unknown, id: string): string => {
    const previous = results.get(id);
    if (previous !== undefined) return previous;
    const reason = blocked();
    if (reason) { results.set(id, reason); return reason; }
    const parsed = recipeToolSchema.safeParse(args);
    let result: string;
    if (parsed.success) {
      const { replaceRecipeId, ...recipe } = parsed.data;
      const replaced = show(recipe, id, replaceRecipeId);
      if (!replaced) result = "Recipe displayed in the kitchen as a new recipe.";
      else {
        const changes = describeRecipeChanges(replaced, recipe);
        result = `Recipe updated in place in the kitchen. Changes: ${changes.length ? changes.join("; ") : "none detected"}.`;
      }
    } else result = `Recipe not displayed: ${z.prettifyError(parsed.error)}`;
    results.set(id, result);
    return result;
  };
}
/** Compact index of the recipe book for agent context; full recipes come from select_recipe. */
export function recipeBookSummary(recipes: SavedRecipe[]) {
  return recipes.map((recipe, index) => ({ number: index + 1, id: recipe.id, title: recipe.title }));
}
export const selectRecipeSchema = z.object({ recipeId: text(100).describe("id from recipeBook") });
/** Remove a recipe and pick the neighbour that takes its place in the tabs. */
export function removeRecipe(recipes: SavedRecipe[], id: string): { recipes: SavedRecipe[]; selected?: string } {
  const index = recipes.findIndex(recipe => recipe.id === id);
  if (index < 0) return { recipes };
  const remaining = recipes.filter(recipe => recipe.id !== id);
  return { recipes: remaining, selected: (remaining[index] ?? remaining[index - 1])?.id };
}

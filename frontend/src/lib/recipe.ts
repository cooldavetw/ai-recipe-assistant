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
export function createRecipeHandler(show: (recipe: Recipe, id: string, replaceRecipeId?: string) => boolean | void, blocked: () => string | undefined = () => undefined) {
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
      // show() reports whether the target existed; otherwise the recipe was added as new.
      result = show(recipe, id, replaceRecipeId) === true ? "Recipe updated in place in the kitchen." : "Recipe displayed in the kitchen as a new recipe.";
    } else result = `Recipe not displayed: ${z.prettifyError(parsed.error)}`;
    results.set(id, result);
    return result;
  };
}

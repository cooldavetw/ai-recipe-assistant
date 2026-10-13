import { z } from "zod";
export const ingredientsSchema = z.object({
  ingredients: z.array(z.string().trim().min(1).max(100)).max(40),
});
/** Full pantry replacement, validated and deduplicated before updating shared state. */
export function createIngredientsHandler(update: (ingredients: string[]) => void) {
  const results = new Map<string, string>();
  return (args: unknown, id: string): string => {
    const previous = results.get(id);
    if (previous !== undefined) return previous;
    const parsed = ingredientsSchema.safeParse(args);
    let result: string;
    if (parsed.success) {
      const seen = new Set<string>();
      const ingredients = parsed.data.ingredients.filter(item => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      update(ingredients);
      result = `Kitchen ingredients updated: ${JSON.stringify(ingredients)}. Continue answering the user's request; this update does not require another acknowledgement run.`;
    } else result = `Kitchen ingredients not updated: ${z.prettifyError(parsed.error)}`;
    results.set(id, result);
    return result;
  };
}

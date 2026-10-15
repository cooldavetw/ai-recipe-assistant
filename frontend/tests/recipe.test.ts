import test from "node:test";
import assert from "node:assert/strict";
import { createRecipeHandler, recipeBookSummary, recipeSchema, removeRecipe } from "../src/lib/recipe";
import { backendUrl, getBackendStatus } from "../src/lib/backend";
const recipe = { title: "Tomato rice", description: "A simple supper", cuisine: "Mediterranean-inspired", servings: 2, totalMinutes: 25, ingredients: [{ name: "rice", quantity: "1 cup", optional: false }], steps: ["Cook rice following the package instructions."], tips: [] };
test("recipe schema rejects incomplete or unreasonable recipes", () => {
  assert.equal(recipeSchema.safeParse(recipe).success, true);
  for (const change of [{ title: " " }, { servings: 0 }, { totalMinutes: -1 }, { steps: [] }, { ingredients: [] }, { ingredients: [{ name: "rice", quantity: "" }] }]) {
    assert.equal(recipeSchema.safeParse({ ...recipe, ...change }).success, false);
  }
});
test("tool validates and displays a recipe only once per call", () => {
  const calls: string[] = [];
  const handler = createRecipeHandler((_, id) => { calls.push(id); });
  assert.match(handler(recipe, "one"), /displayed/);
  handler(recipe, "one");
  assert.deepEqual(calls, ["one"]);
  assert.match(handler({ title: "bad" }, "two"), /not displayed/);
  assert.deepEqual(calls, ["one"]);
});
test("revisions name the recipe they replace; the tool reports whether it was updated", () => {
  const saved = new Set(["recipe-1"]);
  const calls: { recipe: unknown; replaceRecipeId?: string }[] = [];
  const handler = createRecipeHandler((shown, _, replaceRecipeId) => { calls.push({ recipe: shown, replaceRecipeId }); return replaceRecipeId !== undefined && saved.has(replaceRecipeId); });
  assert.match(handler({ ...recipe, replaceRecipeId: "recipe-1" }, "a"), /updated in place/);
  assert.match(handler({ ...recipe, replaceRecipeId: "missing" }, "b"), /as a new recipe/);
  assert.match(handler(recipe, "c"), /as a new recipe/);
  assert.deepEqual(calls.map(call => call.replaceRecipeId), ["recipe-1", "missing", undefined]);
  // The id is routing data, not part of the stored recipe.
  assert.deepEqual(calls[0].recipe, recipe);
});
test("recipe book index is compact and numbered in tab order", () => {
  const book = [{ ...recipe, id: "a" }, { ...recipe, id: "b", title: "Curry" }];
  assert.deepEqual(recipeBookSummary(book), [{ number: 1, id: "a", title: "Tomato rice" }, { number: 2, id: "b", title: "Curry" }]);
});
test("deleting a recipe selects its neighbour", () => {
  const book = ["a", "b", "c"].map(id => ({ ...recipe, id }));
  assert.deepEqual(removeRecipe(book, "b"), { recipes: [book[0], book[2]], selected: "c" });
  assert.equal(removeRecipe(book, "c").selected, "b");
  assert.deepEqual(removeRecipe([book[0]], "a"), { recipes: [], selected: undefined });
  assert.deepEqual(removeRecipe(book, "missing"), { recipes: book });
});
test("API URLs preserve hosting prefixes", () => {
  assert.equal(backendUrl("agent", "https://example.test/fastapi-prod/7/api/"), "https://example.test/fastapi-prod/7/api/agent");
});
test("health status distinguishes missing credentials and a failed backend", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ status: "ok", configured: false }));
    assert.equal(await getBackendStatus("https://example.test/"), "unconfigured");
    globalThis.fetch = async () => new Response(JSON.stringify({ status: "ok", configured: true }));
    assert.equal(await getBackendStatus("https://example.test/"), "ready");
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await getBackendStatus("https://example.test/"), "unavailable");
  } finally { globalThis.fetch = original; }
});

test("UI clarification cannot add recipes; later chat requests can", async () => {
  const { blockedRecipeReason } = await import("../src/lib/kitchen");
  let kind: "change" | "revise" | undefined = "revise";
  const displayed: string[] = [];
  const handler = createRecipeHandler((_, id) => { displayed.push(id); }, () => blockedRecipeReason(kind));
  assert.match(handler(recipe, "clarify"), /clarification required/);
  assert.deepEqual(displayed, []);
  kind = "change";
  assert.match(handler(recipe, "notify"), /only permits acknowledgement/);
  assert.deepEqual(displayed, []);
  kind = undefined;
  // Replayed calls from the blocked turn must still remain blocked.
  assert.match(handler(recipe, "clarify"), /clarification required/);
  assert.match(handler(recipe, "confirmed"), /Recipe displayed/);
  assert.deepEqual(displayed, ["confirmed"]);
});

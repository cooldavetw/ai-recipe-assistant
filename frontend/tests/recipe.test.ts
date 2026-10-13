import test from "node:test";
import assert from "node:assert/strict";
import { createRecipeHandler, recipeSchema } from "../src/lib/recipe";
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
  const handler = createRecipeHandler((_, id) => calls.push(id));
  assert.match(handler(recipe, "one"), /displayed/);
  handler(recipe, "one");
  assert.deepEqual(calls, ["one"]);
  assert.match(handler({ title: "bad" }, "two"), /not displayed/);
  assert.deepEqual(calls, ["one"]);
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

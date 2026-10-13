import test from "node:test";
import assert from "node:assert/strict";
import { createIngredientsHandler } from "../src/lib/ingredients";
import { KitchenQueue, type Preferences, type KitchenUpdate } from "../src/lib/kitchen";
const initial: Preferences = { diet: "No preference", servings: "2", allergies: "", ingredients: [] };
test("chat ingredient updates validate, normalize, deduplicate, and execute once", () => {
  const changes: string[][] = [];
  const handler = createIngredientsHandler(items => changes.push(items));
  assert.match(handler({ ingredients: [" Rice ", "rice", "Tomatoes"] }, "one"), /updated/);
  handler({ ingredients: ["beans"] }, "one");
  assert.deepEqual(changes, [["Rice", "Tomatoes"]]);
  for (const args of [{ ingredients: [""] }, { ingredients: [42] }, {}, { ingredients: Array(41).fill("rice") }]) {
    assert.match(handler(args, JSON.stringify(args)), /not updated/);
  }
  assert.equal(changes.length, 1);
  handler({ ingredients: [] }, "clear");
  assert.deepEqual(changes[1], []);
});
test("agent ingredient changes are silent; later preference edits use the current pantry", async () => {
  let now = 0;
  const queue = new KitchenQueue(initial, () => now);
  const sent: KitchenUpdate[] = [];
  queue.syncIngredients(["rice"]);
  queue.offer({ ...initial, ingredients: ["rice"] });
  now = 1000;
  await queue.flush(false, async update => { sent.push(update); });
  assert.equal(sent.length, 0);
  queue.offer({ ...initial, ingredients: ["rice"], servings: "4" });
  queue.syncIngredients(["rice", "tomatoes"]);
  now = 2000;
  await queue.flush(false, async update => { sent.push(update); });
  assert.deepEqual(sent[0].preferences.ingredients, ["rice", "tomatoes"]);
  assert.equal(sent[0].preferences.servings, "4");
});
test("ingredient changes during a response do not trigger an acknowledgement loop", async () => {
  let now = 0;
  const queue = new KitchenQueue(initial, () => now);
  queue.offer({ ...initial, diet: "Vegan" }); now = 1000;
  await queue.flush(false, async () => { queue.syncIngredients(["beans"]); });
  queue.offer({ ...initial, diet: "Vegan", ingredients: ["beans"] });
  now = 2000;
  let runs = 0;
  await queue.flush(false, async () => { runs++; });
  assert.equal(runs, 0);
});

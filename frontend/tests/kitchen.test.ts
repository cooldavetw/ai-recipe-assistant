import test from "node:test";
import assert from "node:assert/strict";
import { KitchenQueue, changeMessage, type Preferences, type KitchenUpdate } from "../src/lib/kitchen";
const initial: Preferences = { diet: "No preference", servings: "2", allergies: "", ingredients: [] };
function fixture() {
  let now = 0;
  const queue = new KitchenQueue(initial, () => now);
  const sent: KitchenUpdate[] = [];
  return { queue, sent, time: (value: number) => { now = value; }, send: async (value: KitchenUpdate) => { sent.push(value); } };
}
test("initial state, unchanged preferences, and reverted edits do not run the agent", async () => {
  const f = fixture();
  f.queue.offer(initial);
  await f.queue.flush(false, f.send);
  f.queue.offer({ ...initial, diet: "Vegan" });
  f.queue.offer(initial);
  f.time(1000);
  await f.queue.flush(false, f.send);
  assert.equal(f.sent.length, 0);
});
test("rapid ingredient and allergy edits coalesce; busy agents wait", async () => {
  const f = fixture();
  f.queue.offer({ ...initial, ingredients: ["rice"] });
  f.time(200);
  const latest = { ...initial, ingredients: ["rice", "tomato"], allergies: "peanuts" };
  f.queue.offer(latest);
  f.time(800);
  await f.queue.flush(false, f.send);
  assert.equal(f.sent.length, 0);
  f.time(1000);
  await f.queue.flush(true, f.send);
  assert.equal(f.sent.length, 0);
  await f.queue.flush(false, f.send);
  assert.deepEqual(f.sent, [{ preferences: latest, kind: "change", recipe: undefined }]);
  assert.match(changeMessage(f.sent[0]), /Do not generate or revise/);
});
test("changes during a run are retained, including reverting to old settings", async () => {
  const f = fixture();
  const vegan = { ...initial, diet: "Vegan" };
  f.queue.offer(vegan); f.time(1000);
  let finish!: () => void;
  const run = f.queue.flush(false, async update => { f.sent.push(update); await new Promise<void>(resolve => { finish = resolve; }); });
  f.queue.offer(initial);
  f.time(2000);
  await f.queue.flush(false, f.send);
  assert.equal(f.sent.length, 1);
  finish(); await run;
  await f.queue.flush(false, f.send);
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[1].preferences, initial);
});
test("failures retain latest changes and require manual retry", async () => {
  const f = fixture();
  f.queue.offer({ ...initial, servings: "4" }); f.time(1000);
  await f.queue.flush(false, async () => { throw new Error("offline"); });
  assert.equal(f.queue.status, "failed");
  await f.queue.flush(false, f.send); assert.equal(f.sent.length, 0);
  f.queue.retry(); await f.queue.flush(false, f.send);
  assert.equal(f.sent[0].preferences.servings, "4");
  assert.equal(f.queue.status, "idle");
});
test("explicit revisions bypass debounce, stay explicit across edits and preserve recipe target", async () => {
  const f = fixture();
  const recipe = { title: "Rice", description: "Dinner", cuisine: "Simple", servings: 2, totalMinutes: 20, ingredients: [{ name: "rice", quantity: "1 cup", optional: false }], steps: ["Cook rice."], tips: [] };
  f.queue.offer(initial, "revise", recipe);
  await f.queue.flush(false, f.send);
  assert.equal(f.sent[0].kind, "revise");
  assert.match(changeMessage(f.sent[0]), /Keep the previous recipe/);
  assert.match(changeMessage(f.sent[0]), /Rice/);
  f.queue.offer(initial, "revise", recipe);
  f.queue.offer({ ...initial, servings: "4" }); f.time(1000);
  await f.queue.flush(false, f.send);
  assert.equal(f.sent[1].kind, "revise");
  assert.equal(f.sent[1].preferences.servings, "4");
  assert.deepEqual(f.sent[1].recipe, recipe);
});

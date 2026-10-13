import test from "node:test";
import assert from "node:assert/strict";
import { KitchenQueue, actionInstructions, type Preferences, type KitchenUpdate } from "../src/lib/kitchen";
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
  assert.match(actionInstructions(f.sent[0]), /請勿產生或修改食譜/);
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
  assert.match(actionInstructions(f.sent[0]), /原食譜保留/);
  assert.match(actionInstructions(f.sent[0]), /Rice/);
  f.queue.offer(initial, "revise", recipe);
  f.queue.offer({ ...initial, servings: "4" }); f.time(1000);
  await f.queue.flush(false, f.send);
  assert.equal(f.sent[1].kind, "revise");
  assert.equal(f.sent[1].preferences.servings, "4");
  assert.deepEqual(f.sent[1].recipe, recipe);
});

test("revision clarification includes the clicked recipe and checked items in both languages", () => {
  const recipe = { title: "Rice", description: "Dinner", cuisine: "Simple", servings: 2, totalMinutes: 20, ingredients: [{ name: "rice", quantity: "1 cup", optional: false }, { name: "tomato", quantity: "1", optional: false }], steps: ["Cook."], tips: [] };
  const queue = new KitchenQueue(initial);
  queue.offer(initial, "revise", recipe, [1]);
  return queue.flush(false, async update => {
    assert.deepEqual(update.checkedIndices, [1]);
    const en = actionInstructions(update, "en"), zh = actionInstructions(update, "zh-Hant");
    assert.match(en, /do not generate a recipe in this turn/);
    assert.match(en, /Crossed-off checklist ingredients: \["tomato"\]/);
    assert.match(en, /prepared, unavailable, or unwanted/);
    assert.match(zh, /本次回覆請勿產生食譜/);
    assert.match(zh, /已勾選劃掉的清單食材：\["tomato"\]/);
    assert.match(zh, /等我說明或確認後/);
  });
});

test("coalescing settings while busy preserves the clarification target and checklist", async () => {
  let now = 0;
  const queue = new KitchenQueue(initial, () => now);
  const recipe = { title: "Rice", description: "Dinner", cuisine: "Simple", servings: 2, totalMinutes: 20, ingredients: [{ name: "rice", quantity: "1 cup", optional: false }], steps: ["Cook."], tips: [] };
  queue.offer(initial, "revise", recipe, [0]);
  queue.offer({ ...initial, servings: "4" }); now = 1000;
  let calls = 0;
  await queue.flush(true, async () => { calls++; });
  assert.equal(calls, 0);
  await queue.flush(false, async update => {
    calls++;
    assert.equal(update.kind, "revise");
    assert.deepEqual(update.recipe, recipe);
    assert.deepEqual(update.checkedIndices, [0]);
    assert.equal(update.preferences.servings, "4");
  });
  assert.equal(calls, 1);
});

test("visible UI messages omit raw payloads while agent context retains the clicked recipe", async () => {
  const { changeMessage, kitchenActionContext } = await import("../src/lib/kitchen");
  const recipe = { title: "番茄飯", description: "Internal description", cuisine: "Simple", servings: 2, totalMinutes: 20, ingredients: [{ name: "tomato", quantity: "1", optional: false }], steps: ["Cook."], tips: [] };
  const update = { preferences: initial, kind: "revise" as const, recipe, checkedIndices: [0] };
  for (const language of ["en", "zh-Hant"] as const) {
    const message = changeMessage(update, language);
    assert.ok(message.includes("番茄飯"));
    assert.ok(message.length < 150);
    assert.doesNotMatch(message, /"title"|"ingredients"|Internal description|JSON/);
    const context = kitchenActionContext(update, language);
    assert.deepEqual(context.recipe, recipe);
    assert.deepEqual(context.checkedIngredientIndices, [0]);
    assert.deepEqual(context.preferences, initial);
    assert.ok(context.instructions.includes(language === "en" ? "do not generate" : "請勿產生"));
    assert.doesNotMatch(changeMessage({ preferences: initial, kind: "change" }, language), /"diet"|"servings"|\{/);
  }
});

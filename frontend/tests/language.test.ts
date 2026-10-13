import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageContext } from "../src/locale";
import { KitchenApp } from "../src/recipe-app";
import { RecipeCard } from "../src/recipe-card";
import { readLanguage, saveLanguage, LANGUAGE_STORAGE_KEY } from "../src/lib/language";
import { KitchenQueue, actionInstructions, type Preferences } from "../src/lib/kitchen";
test("language defaults safely and remembers valid choices even with blocked storage", () => {
  assert.equal(readLanguage(), "zh-Hant");
  assert.equal(readLanguage({ getItem: () => "fr" }), "zh-Hant");
  assert.equal(readLanguage({ getItem: () => { throw new Error("blocked"); } }), "zh-Hant");
  const values = new Map<string, string>();
  saveLanguage("en", { setItem: (key, value) => { values.set(key, value); } });
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), "en");
  assert.equal(readLanguage({ getItem: key => values.get(key) ?? null }), "en");
  assert.doesNotThrow(() => saveLanguage("en", { setItem: () => { throw new Error("blocked"); } }));
});
test("interface renders both languages with stable dietary values and a selector", () => {
  const render = (language: "en" | "zh-Hant") => renderToStaticMarkup(createElement(LanguageContext.Provider, { value: language }, createElement(KitchenApp, { setLanguage: () => {} })));
  const english = render("en"), chinese = render("zh-Hant");
  assert.match(english, /Your recipe book/); assert.match(chinese, /我的食譜本/);
  assert.match(english, /GOOD FOOD STARTS WITH WHAT YOU HAVE/);
  assert.match(english, /How you eat/); assert.match(chinese, /飲食偏好/);
  for (const html of [english, chinese]) {
    assert.match(html, /value="Vegetarian"/);
    assert.match(html, /Language \/ 語言/);
    assert.match(html, /value="en"/);
    assert.match(html, /value="zh-Hant"/);
  }
});
test("card labels switch while existing recipe content remains untouched", () => {
  const recipe = { title: "番茄飯", description: "暖心料理", cuisine: "家常", servings: 2, totalMinutes: 20, ingredients: [{ name: "米", quantity: "一杯", optional: false }], steps: ["煮熟米飯。"], tips: [] };
  const original = JSON.stringify(recipe);
  for (const language of ["en", "zh-Hant"] as const) {
    const html = renderToStaticMarkup(createElement(LanguageContext.Provider, { value: language }, createElement(RecipeCard, { recipe })));
    assert.match(html, /番茄飯/); assert.match(html, /煮熟米飯。/);
    assert.ok(html.includes(language === "en" ? "Ingredients" : "食材清單"));
  }
  assert.equal(JSON.stringify(recipe), original);
});
test("language affects future acknowledgements and revisions without enqueuing a language-only run", async () => {
  const preferences: Preferences = { diet: "Vegetarian", servings: "2", allergies: "", ingredients: [] };
  const queue = new KitchenQueue(preferences);
  const update = { preferences, kind: "change" as const };
  assert.match(actionInstructions(update, "en"), /acknowledge the changes in English/);
  assert.match(actionInstructions(update, "zh-Hant"), /繁體中文/);
  assert.match(actionInstructions({ ...update, kind: "revise" }, "en"), /clarification conversation in English/);
  queue.offer(preferences);
  let runs = 0; await queue.flush(false, async () => { runs++; });
  assert.equal(runs, 0);
});

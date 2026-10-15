import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecipeCard } from "../src/recipe-card";
import { LanguageContext } from "../src/locale";
import { KitchenQueue, blockedRecipeReason, changeMessage, kitchenActionContext, type Preferences } from "../src/lib/kitchen";
import { questionSchema, parseQuestion, revisionActionQuestion } from "../src/lib/question";
const recipe = { title: "Tofu", description: "Dinner", cuisine: "Simple", servings: 2, totalMinutes: 20, ingredients: [{ name: "tofu", quantity: "2 blocks", optional: false }], steps: ["Cook."], tips: [] };
const preferences: Preferences = { diet: "Vegan", servings: "2", allergies: "", ingredients: ["tofu"] };
test("ingredient rows replace checkboxes with localized remove and increase buttons", () => {
  for (const language of ["en", "zh-Hant"] as const) {
    const html = renderToStaticMarkup(createElement(LanguageContext.Provider, { value: language }, createElement(RecipeCard, { recipe, onIngredientAction: () => {} })));
    assert.doesNotMatch(html, /type="checkbox"/);
    assert.ok(html.includes(language === "en" ? "Increase amount" : "增加用量"));
    assert.ok(html.includes(language === "en" ? "Remove" : "移除"));
    assert.ok(html.includes("2 blocks"));
  }
});
test("ingredient actions preserve clicked targets while settings coalesce and generation stays blocked", async () => {
  let now = 0;
  const queue = new KitchenQueue(preferences, () => now);
  queue.offer(preferences, "ingredient_remove", recipe, undefined, 0);
  queue.offer({ ...preferences, servings: "4" }); now = 1000;
  await queue.flush(false, async update => {
    assert.equal(update.kind, "ingredient_remove");
    assert.equal(update.ingredientIndex, 0);
    assert.deepEqual(update.recipe, recipe);
    assert.equal(update.preferences.servings, "4");
    assert.match(blockedRecipeReason(update.kind)!, /clarification required/);
    assert.deepEqual(kitchenActionContext(update, "en").targetIngredient, recipe.ingredients[0]);
    assert.doesNotMatch(changeMessage(update, "en"), /"ingredients"/);
  });
  assert.match(blockedRecipeReason("ingredient_increase")!, /clarification required/);
});
test("focused removal and increase choices survive generic or malformed model questions", () => {
  for (const language of ["en", "zh-Hant"] as const) {
    for (const kind of ["ingredient_remove", "ingredient_increase"] as const) {
      const question = revisionActionQuestion({ preferences, kind, recipe, ingredientIndex: 0 }, language);
      assert.equal(questionSchema.safeParse(question).success, true);
      assert.ok(question.question.includes("tofu"));
      assert.deepEqual(parseQuestion({ topic: "revision_plan" }, language, question), question);
      assert.deepEqual(parseQuestion({}, language, question), question);
      assert.ok(question.options.at(-1)!.answer.includes(language === "en" ? "Cancel" : "取消"));
      if (kind === "ingredient_increase") {
        assert.ok(question.options[0].answer.includes("1.5"));
        assert.ok(question.options[0].answer.includes(language === "en" ? "vague" : "不明確"));
      } else assert.ok(question.options[0].answer.includes(language === "en" ? "Update this recipe" : "直接更新這份食譜"));
    }
  }
});

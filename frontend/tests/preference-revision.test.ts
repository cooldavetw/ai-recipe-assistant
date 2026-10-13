import test from "node:test";
import assert from "node:assert/strict";
import { preferenceChanges, kitchenActionContext, changeMessage, type Preferences, type KitchenUpdate } from "../src/lib/kitchen";
import { revisionActionQuestion, parseQuestion, questionSchema } from "../src/lib/question";
const original: Preferences = { diet: "No preference", servings: "2", allergies: "", ingredients: ["tofu"] };
const recipe = { title: "Tofu", description: "Dinner", cuisine: "Simple", servings: 2, totalMinutes: 20, ingredients: [{ name: "tofu", quantity: "1 block", optional: false }], steps: ["Cook."], tips: [], preferencesAtCreation: structuredClone(original) };
test("revision recognizes changed diet, servings and allergy settings in both languages", () => {
  const update: KitchenUpdate = { kind: "revise", recipe, preferences: { ...original, diet: "Vegan", servings: "3", allergies: "peanuts" } };
  assert.deepEqual(preferenceChanges(update, "en"), ["3 servings", "diet: Vegan", "foods to avoid: peanuts"]);
  assert.deepEqual(preferenceChanges(update, "zh-Hant"), ["3 人份", "飲食偏好：全素", "避免食材：peanuts"]);
  for (const language of ["en", "zh-Hant"] as const) {
    const question = revisionActionQuestion(update, language);
    assert.equal(question.topic, "preference_revision");
    assert.equal(questionSchema.safeParse(question).success, true);
    assert.ok(question.question.includes("3"));
    assert.ok(question.question.includes(language === "en" ? "Vegan" : "全素"));
    assert.deepEqual(parseQuestion({ topic: "revision_plan" }, language, question), question);
    assert.ok(question.options[0].answer.includes(language === "en" ? "Yes, revise" : "確認將"));
    assert.ok(kitchenActionContext(update, language).instructions.includes("Do NOT ask what"));
    assert.ok(changeMessage(update, language).includes("3"));
  }
  assert.deepEqual(recipe.preferencesAtCreation, original);
});
test("unchanged preferences still offer general revision goals; legacy recipes detect serving changes", () => {
  assert.deepEqual(preferenceChanges({ kind: "revise", recipe, preferences: original }, "en"), []);
  assert.equal(revisionActionQuestion({ kind: "revise", recipe, preferences: original }, "en").topic, "revision_plan");
  const { preferencesAtCreation: _, ...legacy } = recipe;
  assert.deepEqual(preferenceChanges({ kind: "revise", recipe: legacy, preferences: { ...original, servings: "4" } }, "en"), ["4 servings"]);
});

test("preference notifications state the updated serving count explicitly without raw JSON", () => {
  for (const servings of ["3", "6"]) {
    const update: KitchenUpdate = { kind: "change", preferences: { ...original, servings, diet: "Vegan", allergies: "peanuts" } };
    assert.ok(changeMessage(update, "en").includes(`${servings} servings`));
    assert.ok(changeMessage(update, "zh-Hant").includes(`${servings} 人份`));
    assert.ok(changeMessage(update, "zh-Hant").includes("全素"));
    assert.doesNotMatch(changeMessage(update, "en"), /"servings"|"diet"/);
  }
});

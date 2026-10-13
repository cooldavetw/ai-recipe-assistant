import test from "node:test";
import assert from "node:assert/strict";
import { createQuestionHandler, isQuestionCurrent, questionSchema } from "../src/lib/question";
const question = { question: "What would you like changed?", options: [{ label: "Servings", answer: "I’d like to change the serving count." }, { label: "Ingredient", answer: "I’d like to replace an ingredient." }] };
const call = (id: string) => ({ id, function: { name: "ask_question" } });
test("question tool validates 2–4 distinct choices with complete answers", () => {
  assert.equal(questionSchema.safeParse(question).success, true);
  for (const value of [{ ...question, question: " " }, { ...question, options: [] }, { ...question, options: question.options.slice(0, 1) }, { ...question, options: Array(5).fill(question.options[0]) }, { ...question, options: [question.options[0], question.options[0]] }, { ...question, options: [{ label: "A", answer: "" }, question.options[1]] }]) {
    assert.equal(questionSchema.safeParse(value).success, false);
  }
  assert.equal(questionSchema.safeParse({ question: "要如何調整？", options: [{ label: "調整份量", answer: "我想調整這份食譜的份量。" }, { label: "替換食材", answer: "我想替換食材。" }] }).success, true);
});
test("question tool waits for an answer and duplicate calls have stable results", () => {
  const handler = createQuestionHandler();
  const result = handler(question, "q1");
  assert.match(result, /Wait for the user's answer/);
  assert.equal(handler({ invalid: true }, "q1"), result);
  assert.match(handler({ invalid: true }, "q2"), /not displayed/);
});
test("question choices expire after typed or clicked replies and newer questions", () => {
  const messages = [{ role: "user" }, { role: "assistant", toolCalls: [call("q1")] }, { role: "tool" }];
  assert.equal(isQuestionCurrent(messages, "q1"), true);
  assert.equal(isQuestionCurrent([...messages, { role: "user" }], "q1"), false);
  const newer = [...messages, { role: "assistant", toolCalls: [call("q2")] }];
  assert.equal(isQuestionCurrent(newer, "q1"), false);
  assert.equal(isQuestionCurrent(newer, "q2"), true);
  assert.equal(isQuestionCurrent(messages, "missing"), false);
  assert.equal(isQuestionCurrent([{ role: "assistant", toolCalls: [call("q1"), call("q2")] }], "q1"), false);
});

test("ingredient planning offers shopping or a user-provided inventory in either language", async () => {
  const { ingredientPlanQuestion, resolveQuestion } = await import("../src/lib/question");
  for (const language of ["en", "zh-Hant"] as const) {
    const value = ingredientPlanQuestion(language);
    assert.equal(questionSchema.safeParse(value).success, true);
    assert.equal(value.options.length, 2);
    const resolved = resolveQuestion({ ...question, topic: "ingredient_plan" }, language);
    assert.deepEqual(resolved, value);
    assert.match(createQuestionHandler()(resolved, language), /Wait for the user's answer/);
  }
  const en = ingredientPlanQuestion("en");
  assert.match(en.options[0].answer, /don’t ask for an ingredient inventory/);
  assert.match(en.options[0].answer, /dietary preferences, allergies, and serving count/);
  assert.match(en.options[1].answer, /wait for my ingredient list/);
  const zh = ingredientPlanQuestion("zh-Hant");
  assert.match(zh.options[0].answer, /不需要先詢問現有食材/);
  assert.match(zh.options[1].answer, /先等我提供清單/);
  assert.deepEqual(resolveQuestion(question, "en"), question);
});

test("revision choices recover incomplete model calls and support both languages", async () => {
  const { parseQuestion, revisionPlanQuestion } = await import("../src/lib/question");
  for (const language of ["en", "zh-Hant"] as const) {
    const fallback = revisionPlanQuestion(language);
    assert.equal(questionSchema.safeParse(fallback).success, true);
    assert.equal(fallback.options.length, 4);
    assert.deepEqual(parseQuestion({ question: "Revise?" }, language, fallback), fallback);
    assert.deepEqual(parseQuestion({}, language, fallback), fallback);
    assert.deepEqual(parseQuestion({ topic: "revision_plan" }, language), fallback);
    assert.match(createQuestionHandler()(fallback, language), /Question displayed/);
  }
  const recovered = parseQuestion({ prompt: "What changes?", choices: ["Servings", "Flavor"] }, "en");
  assert.deepEqual(recovered?.options, [{ label: "Servings", answer: "Servings" }, { label: "Flavor", answer: "Flavor" }]);
  assert.equal(parseQuestion({ question: "Missing choices" }, "en"), undefined);
});

test("revision options show after plain-text replies but expire after an answer or question tool", async () => {
  const { needsRevisionChoices } = await import("../src/lib/question");
  const messages = [{ id: "revision", role: "user" }, { id: "reply", role: "assistant" }];
  assert.equal(needsRevisionChoices(messages, "revision"), true);
  assert.equal(needsRevisionChoices(messages), false);
  assert.equal(needsRevisionChoices(messages, "missing"), false);
  assert.equal(needsRevisionChoices([...messages, { id: "answer", role: "user" }], "revision"), false);
  assert.equal(needsRevisionChoices([...messages, { id: "question", role: "assistant", toolCalls: [{ function: { name: "ask_question" } }] }], "revision"), false);
});

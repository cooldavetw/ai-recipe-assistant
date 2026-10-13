import { z } from "zod";
import type { KitchenUpdate } from "./kitchen";
import type { Language } from "./language";
const text = (max: number) => z.string().trim().min(1).max(max);
export const questionSchema = z.object({
  topic: z.enum(["general", "ingredient_plan", "revision_plan", "ingredient_remove", "ingredient_increase"]).optional(),
  question: text(600),
  options: z.array(z.object({ label: text(80), answer: text(400) })).min(2).max(4),
}).refine(value => new Set(value.options.map(option => option.label.toLowerCase())).size === value.options.length, { message: "Choice labels must be distinct." });
export type Question = z.infer<typeof questionSchema>;
/** Fixed process choices avoid guessing the user's ingredient inventory. */
export function ingredientPlanQuestion(language: Language): Question {
  return language === "en" ? {
    topic: "ingredient_plan",
    question: "How would you like to choose your recipe?",
    options: [
      { label: "Just give me a recipe—I’ll do the shopping", answer: "Just give me a complete recipe. I’ll do the shopping, so don’t ask for an ingredient inventory. Use my dietary preferences, allergies, and serving count." },
      { label: "Use ingredients I have—I’ll list them", answer: "I want to cook with ingredients I already have. I’ll list them; please wait for my ingredient list before creating the recipe." },
    ],
  } : {
    topic: "ingredient_plan",
    question: "你想怎麼選擇這次的料理？",
    options: [
      { label: "直接給我食譜，我會去採買", answer: "請直接提供完整食譜，我會去採買，不需要先詢問現有食材。請依我的飲食偏好、過敏限制與用餐人數設計。" },
      { label: "用現有食材料理，我會列出食材", answer: "我想用手邊的食材料理，我會列出食材。請先等我提供清單，再設計食譜。" },
    ],
  };
}
export function revisionPlanQuestion(language: Language): Question {
  return language === "en" ? { topic: "revision_plan", question: "What would you like to change?", options: [
    { label: "Adjust servings", answer: "I’d like to adjust the servings. Please confirm the desired serving count before revising." },
    { label: "Replace an ingredient", answer: "I’d like to replace an ingredient. Please ask which ingredient and my preferred substitute." },
    { label: "Make it quicker", answer: "Please revise this recipe to take less time, while keeping my dietary preferences and allergy restrictions." },
    { label: "Change the flavor", answer: "I’d like to change the flavor. Please ask what flavor I want before revising." },
  ] } : { topic: "revision_plan", question: "你希望如何調整這份食譜？", options: [
    { label: "調整份量", answer: "我想調整份量，請先確認我希望做幾人份，再修改食譜。" },
    { label: "替換食材", answer: "我想替換食材，請先問我要替換哪項食材，以及希望使用什麼替代品。" },
    { label: "縮短料理時間", answer: "請調整這份食譜，縮短料理時間，並保留我的飲食偏好與過敏限制。" },
    { label: "調整風味", answer: "我想調整風味，請先問我喜歡什麼風味，再修改食譜。" },
  ] };
}
export function revisionActionQuestion(update: KitchenUpdate | undefined, language: Language): Question {
  if (!update || !["ingredient_remove", "ingredient_increase"].includes(update.kind)) return revisionPlanQuestion(language);
  const ingredient = update.recipe?.ingredients[update.ingredientIndex ?? -1];
  const name = ingredient?.name ?? "";
  const title = update.recipe?.title ?? "";
  const cancel = language === "en" ? { label: "Keep the original", answer: "Cancel this ingredient change and keep the original recipe unchanged." } : { label: "保留原食譜", answer: "取消這次食材調整，請保留原食譜。" };
  if (update.kind === "ingredient_remove") return {
    topic: "ingredient_remove",
    question: language === "en" ? `Remove ${name} from “${title}”?` : `要從「${title}」移除${name}嗎？`,
    options: language === "en" ? [
      { label: "Confirm removal", answer: `Yes, remove ${name} from “${title}” and adjust the cooking steps as needed. Generate a revised recipe and keep the original.` },
      { label: "Use a substitute", answer: `I’d like to replace ${name} in “${title}”. Please suggest suitable substitutes and ask me to choose before revising.` }, cancel,
    ] : [
      { label: "確認移除", answer: `確認從「${title}」移除${name}，並調整相關料理步驟。請產生新版本並保留原食譜。` },
      { label: "改用替代食材", answer: `我想替換「${title}」的${name}，請建議合適的替代食材，等我選擇後再修改食譜。` }, cancel,
    ],
  };
  return {
    topic: "ingredient_increase",
    question: language === "en" ? `How much more ${name}? Current amount: ${ingredient?.quantity ?? ""}.` : `想增加多少${name}？目前用量：${ingredient?.quantity ?? ""}。`,
    options: language === "en" ? [
      { label: "1.5× the amount", answer: `Use 1.5 times the original ${name} amount in “${title}”. If the quantity is vague, ask me for a concrete amount first; otherwise revise the recipe and retain the original.` },
      { label: "Double the amount", answer: `Double the original ${name} amount in “${title}”. If the quantity is vague, ask me for a concrete amount first; otherwise revise the recipe and retain the original.` },
      { label: "Choose an amount", answer: `I want to specify the amount of ${name} in “${title}”. Please ask me for the amount and unit before revising.` }, cancel,
    ] : [
      { label: "增加至 1.5 倍", answer: `將「${title}」的${name}增加至原用量的 1.5 倍。如果原用量不明確，請先確認具體數量；否則請修改食譜並保留原版本。` },
      { label: "增加至 2 倍", answer: `將「${title}」的${name}增加至原用量的 2 倍。如果原用量不明確，請先確認具體數量；否則請修改食譜並保留原版本。` },
      { label: "自訂用量", answer: `我想自訂「${title}」的${name}用量，請先詢問數量與單位，再修改食譜。` }, cancel,
    ],
  };
}
/** Recover common model shapes; button-triggered revisions always have a safe fallback. */
export function parseQuestion(args: unknown, language: Language, fallback?: Question): Question | undefined {
  if (fallback?.topic === "ingredient_remove" || fallback?.topic === "ingredient_increase") return fallback;
  if (!args || typeof args !== "object") return fallback;
  const input = args as Record<string, unknown>;
  if (input.topic === "ingredient_plan") return ingredientPlanQuestion(language);
  if (input.topic === "revision_plan") return revisionPlanQuestion(language);
  const choices = input.options ?? input.choices;
  const normalized = { ...input, question: input.question ?? input.prompt,
    options: Array.isArray(choices) ? choices.map(choice => {
      if (typeof choice === "string") return { label: choice, answer: choice };
      if (!choice || typeof choice !== "object") return choice;
      const value = choice as Record<string, unknown>;
      return { label: value.label ?? value.title ?? value.text, answer: value.answer ?? value.message ?? value.value ?? value.label ?? value.title ?? value.text };
    }) : choices };
  const parsed = questionSchema.safeParse(normalized);
  return parsed.success ? resolveQuestion(parsed.data, language) : fallback;
}
type RevisionMessage = { id: string; role: string; toolCalls?: { function: { name: string } }[] };
export function needsRevisionChoices(messages: readonly RevisionMessage[], anchor?: string): boolean {
  if (!anchor) return false;
  const index = messages.findIndex(message => message.id === anchor);
  if (index < 0) return false;
  const later = messages.slice(index + 1);
  return !later.some(message => message.role === "user" || message.toolCalls?.some(call => call.function.name === "ask_question"));
}
export function resolveQuestion(question: Question, language: Language): Question {
  return question.topic === "ingredient_plan" ? ingredientPlanQuestion(language) : question.topic === "revision_plan" ? revisionPlanQuestion(language) : question;
}
type ConversationMessage = { role: string; toolCalls?: { id: string; function: { name: string } }[] };
/** Choices expire when answered in chat or superseded by another question. */
export function isQuestionCurrent(messages: readonly ConversationMessage[], id: string): boolean {
  const index = messages.findIndex(message => message.toolCalls?.some(call => call.id === id));
  if (index < 0) return false;
  const calls = messages[index].toolCalls ?? [];
  const callIndex = calls.findIndex(call => call.id === id);
  if (calls.slice(callIndex + 1).some(call => call.function.name === "ask_question")) return false;
  return !messages.slice(index + 1).some(message => message.role === "user" || message.toolCalls?.some(call => call.function.name === "ask_question"));
}
export function createQuestionHandler() {
  const results = new Map<string, string>();
  return (args: unknown, id: string): string => {
    const previous = results.get(id);
    if (previous !== undefined) return previous;
    const parsed = questionSchema.safeParse(args);
    const result = parsed.success ? "Question displayed with choices and free-text input. Wait for the user's answer; do not generate a recipe or ask another question in this turn." : "Question not displayed: invalid question or choices. Ask a concise question in chat instead.";
    results.set(id, result);
    return result;
  };
}

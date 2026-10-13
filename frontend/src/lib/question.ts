import { z } from "zod";
import type { Language } from "./language";
const text = (max: number) => z.string().trim().min(1).max(max);
export const questionSchema = z.object({
  topic: z.enum(["general", "ingredient_plan"]).optional(),
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
export function resolveQuestion(question: Question, language: Language): Question {
  return question.topic === "ingredient_plan" ? ingredientPlanQuestion(language) : question;
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

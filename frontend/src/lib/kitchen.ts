import type { Language } from "./language";
export type Preferences = { diet: string; servings: string; allergies: string; ingredients: string[] };
import type { Recipe } from "./recipe";
export type UpdateKind = "change" | "revise" | "ingredient_remove" | "ingredient_increase";
export type KitchenUpdate = { preferences: Preferences; kind: UpdateKind; recipe?: Recipe; checkedIndices?: number[]; ingredientIndex?: number };
export type IngredientAction = { id: number; kind: "ingredient_remove" | "ingredient_increase"; recipe: Recipe; ingredientIndex: number };
export const preferenceKey = (value: Preferences) => JSON.stringify(value);
export function actionInstructions(update: KitchenUpdate, language: Language = "zh-Hant"): string {
  if (update.kind === "ingredient_remove" || update.kind === "ingredient_increase") {
    const ingredient = update.recipe?.ingredients[update.ingredientIndex ?? -1];
    return `The user clicked ${update.kind} for ${JSON.stringify(ingredient)} in recipe ${JSON.stringify(update.recipe)}. Current preferences: ${JSON.stringify(update.preferences)}. Reply in ${language === "en" ? "English" : "Traditional Chinese"}. Do not generate or alter a recipe in this turn. For removal, explain necessary substitutions or cooking adjustments and ask for confirmation with removal, substitution, and cancellation choices. For an increase, ask how much with 1.5×, 2×, and custom-amount choices. Do not infer numeric amounts from vague quantities such as to taste. Wait for an explicit subsequent confirmation or amount selection before generating a new recipe; keep the original recipe unchanged. Do not change the user's on-hand inventory merely because they want to customize this recipe.`;
  }
  const checkedNames = update.recipe?.ingredients.filter((_, index) => update.checkedIndices?.includes(index)).map(item => item.name) ?? [];
  if (language === "en") {
    return update.kind === "revise"
      ? `I clicked “Ask assistant to revise this recipe” for: ${JSON.stringify(update.recipe)}. My current kitchen settings: ${JSON.stringify(update.preferences)}. Crossed-off checklist ingredients: ${JSON.stringify(checkedNames)}. Start a clarification conversation in English; do not generate a recipe in this turn. Ask what I would like changed. If a specific preference change is apparent, propose it and ask me to confirm. Checklist ticks mean progress by default, not exclusions. If my intended change involves crossed-off items, ask whether they are prepared, unavailable, or unwanted; never remove them just because they are checked. Wait for my instructions or confirmation before generating a revised version, and keep the previous recipe in my collection.`
      : `I changed my kitchen settings in the recipe UI: ${JSON.stringify(update.preferences)}. Briefly acknowledge the changes in English. If a recipe is selected, explain relevant adjustments and flag allergy conflicts immediately. Suggest substitutions where useful. Do not generate or revise a recipe until I explicitly ask.`;
  }
  return update.kind === "revise"
    ? `我點選了「請助理調整這份食譜」：${JSON.stringify(update.recipe)}。目前廚房設定：${JSON.stringify(update.preferences)}。已勾選劃掉的清單食材：${JSON.stringify(checkedNames)}。請用繁體中文先詢問我希望如何調整，本次回覆請勿產生食譜。如果有明確的偏好變更，請提出具體調整並詢問是否確認。勾選預設代表備料進度，不代表排除食材。如果我的調整意圖涉及勾選項目，請釐清是已備妥、沒有這項食材，還是不想使用；請勿僅因勾選就移除。等我說明或確認後，再產生修改版本，並將原食譜保留在食譜本中。`
    : `我在食譜介面變更了廚房設定： ${JSON.stringify(update.preferences)}。請用繁體中文簡短確認變更。如果已選取食譜，請說明相關調整，立即指出過敏食材衝突，並視需要建議替代食材。在我明確要求之前，請勿產生或修改食譜。`;
}
/** Keep implementation data out of the visible conversation. */
export function changeMessage(update: KitchenUpdate, language: Language = "zh-Hant"): string {
  if (update.kind === "ingredient_remove" || update.kind === "ingredient_increase") {
    const name = update.recipe?.ingredients[update.ingredientIndex ?? -1]?.name ?? "";
    const title = update.recipe?.title ?? "";
    return language === "en"
      ? update.kind === "ingredient_remove" ? `I’d like to remove ${name} from “${title}”. Please suggest the adjustments and ask me to confirm first.` : `I’d like more ${name} in “${title}”. Please ask me how much first.`
      : update.kind === "ingredient_remove" ? `我想從「${title}」移除${name}，請先說明需要的調整並和我確認。` : `我想增加「${title}」的${name}用量，請先問我希望增加多少。`;
  }
  if (update.kind === "revise") {
    const title = update.recipe?.title;
    return language === "en"
      ? `I’d like to revise${title ? ` “${title}”` : " this recipe"}. Please ask me what I want changed first.`
      : `我想調整${title ? `「${title}」` : "這份食譜"}，請先和我確認要修改什麼。`;
  }
  return language === "en" ? "I updated my kitchen settings. Please review the changes." : "我更新了廚房設定，請確認這次的變更。";
}
export function kitchenActionContext(update: KitchenUpdate, language: Language) {
  return { action: update.kind, preferences: update.preferences, recipe: update.recipe ?? null,
    checkedIngredientIndices: update.checkedIndices ?? [], ingredientIndex: update.ingredientIndex ?? null, targetIngredient: update.recipe?.ingredients[update.ingredientIndex ?? -1] ?? null, instructions: actionInstructions(update, language) };
}
/** UI-triggered runs may discuss changes, but must never create recipes. */
export function blockedRecipeReason(kind?: UpdateKind): string | undefined {
  if (kind && kind !== "change") return "Recipe not displayed: clarification required. Ask what the user wants changed and wait for their reply before generating a revised recipe.";
  if (kind === "change") return "Recipe not displayed: this UI update only permits acknowledgement and suggestions. Ask the user to request a revision.";
}
/** Coalesce edits, wait for chat runs, and retain failed updates for manual retry. */
export class KitchenQueue {
  private acknowledged: string;
  private pending?: KitchenUpdate;
  private due = 0;
  private sending = false;
  private inFlightKey?: string;
  private failed = false;
  private inFlight?: KitchenUpdate;
  constructor(initial: Preferences, private now: () => number = Date.now) { this.acknowledged = preferenceKey(initial); }
  offer(preferences: Preferences, kind: UpdateKind = "change", recipe?: Recipe, checkedIndices?: number[], ingredientIndex?: number) {
    if (kind === "change" && preferenceKey(preferences) === (this.inFlightKey ?? this.acknowledged)) {
      if ((!this.pending || this.pending.kind === "change")) this.pending = undefined;
      return;
    }
    const preserve = kind === "change" && this.pending && this.pending.kind !== "change";
    this.pending = { preferences, kind: preserve ? this.pending!.kind : kind, recipe: preserve ? this.pending!.recipe : recipe,
      ...((preserve ? this.pending!.checkedIndices : checkedIndices) !== undefined ? { checkedIndices: preserve ? this.pending!.checkedIndices : checkedIndices } : {}),
      ...((preserve ? this.pending!.ingredientIndex : ingredientIndex) !== undefined ? { ingredientIndex: preserve ? this.pending!.ingredientIndex : ingredientIndex } : {}) };
    this.due = this.now() + (kind === "change" ? 700 : 0);
    this.failed = false;
  }
  /** Agent-originated pantry updates are already acknowledged in chat: no echo run. */
  syncIngredients(ingredients: string[]) {
    const replace = (key: string) => preferenceKey({ ...JSON.parse(key) as Preferences, ingredients });
    this.acknowledged = replace(this.acknowledged);
    if (this.inFlightKey) this.inFlightKey = replace(this.inFlightKey);
    if (this.inFlight) this.inFlight.preferences = { ...this.inFlight.preferences, ingredients };
    if (this.pending) this.pending.preferences = { ...this.pending.preferences, ingredients };
  }
  retry() { this.failed = false; this.due = 0; }
  get status(): "idle" | "pending" | "sending" | "failed" {
    return this.sending ? "sending" : this.failed ? "failed" : this.pending ? "pending" : "idle";
  }
  async flush(busy: boolean, send: (update: KitchenUpdate) => Promise<void>) {
    if (busy || this.sending || this.failed || !this.pending || this.now() < this.due) return;
    const update = this.pending;
    this.pending = undefined;
    this.sending = true;
    this.inFlight = update;
    this.inFlightKey = preferenceKey(update.preferences);
    try { await send(update); this.acknowledged = preferenceKey(update.preferences); }
    catch { this.pending ??= update; this.failed = true; }
    finally { this.sending = false; this.inFlightKey = undefined; this.inFlight = undefined; }
  }
}

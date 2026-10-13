export type Preferences = { diet: string; servings: string; allergies: string; ingredients: string[] };
import type { Recipe } from "./recipe";
export type UpdateKind = "change" | "revise";
export type KitchenUpdate = { preferences: Preferences; kind: UpdateKind; recipe?: Recipe };
export const preferenceKey = (value: Preferences) => JSON.stringify(value);
export function changeMessage(update: KitchenUpdate): string {
  return update.kind === "revise"
    ? `Please create a revised version of this recipe: ${JSON.stringify(update.recipe)} using my current kitchen settings: ${JSON.stringify(update.preferences)}. Keep the previous recipe in my collection.`
    : `I changed my kitchen settings in the recipe UI: ${JSON.stringify(update.preferences)}. Briefly acknowledge the changes. If a recipe is selected, explain relevant adjustments and flag allergy conflicts immediately. Suggest substitutions where useful. Do not generate or revise a recipe until I explicitly ask.`;
}
/** Coalesce edits, wait for chat runs, and retain failed updates for manual retry. */
export class KitchenQueue {
  private acknowledged: string;
  private pending?: KitchenUpdate;
  private due = 0;
  private sending = false;
  private inFlightKey?: string;
  private failed = false;
  constructor(initial: Preferences, private now: () => number = Date.now) { this.acknowledged = preferenceKey(initial); }
  offer(preferences: Preferences, kind: UpdateKind = "change", recipe?: Recipe) {
    if (kind === "change" && preferenceKey(preferences) === (this.inFlightKey ?? this.acknowledged)) {
      if (this.pending?.kind !== "revise") this.pending = undefined;
      return;
    }
    this.pending = { preferences, kind: this.pending?.kind === "revise" ? "revise" : kind, recipe: recipe ?? this.pending?.recipe };
    this.due = this.now() + (kind === "revise" ? 0 : 700);
    this.failed = false;
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
    this.inFlightKey = preferenceKey(update.preferences);
    try { await send(update); this.acknowledged = preferenceKey(update.preferences); }
    catch { this.pending ??= update; this.failed = true; }
    finally { this.sending = false; this.inFlightKey = undefined; }
  }
}

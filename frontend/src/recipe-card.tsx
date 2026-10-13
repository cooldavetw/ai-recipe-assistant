import { useLanguage } from "./locale";
import { useState } from "react";
import type { Recipe } from "./lib/recipe";
export function RecipeCard({ recipe, compact = false, checkedIndices, onCheckedChange }: { recipe: Recipe; compact?: boolean; checkedIndices?: number[]; onCheckedChange?: (indices: number[]) => void }) {
  const { language, t } = useLanguage();
  const [localChecked, setChecked] = useState<Set<number>>(new Set());
  const checked = checkedIndices ? new Set(checkedIndices) : localChecked;
  function toggle(index: number) {
    const next = new Set(checked);
    if (next.has(index)) next.delete(index); else next.add(index);
    if (onCheckedChange) onCheckedChange([...next]); else setChecked(next);
  }
  return <article className={`recipe-card ${compact ? "compact" : ""}`}>
    <div className="recipe-meta">{recipe.cuisine} <span>•</span> {recipe.totalMinutes} {t("分鐘")} <span>•</span> {language === "en" ? "Serves " : ""}{recipe.servings}{language === "en" ? "" : " 人份"}</div>
    <h2>{recipe.title}</h2><p>{recipe.description}</p>
    {!compact && <><div className="recipe-columns"><section><h3>{t("食材清單")}</h3><ul className="ingredients">{recipe.ingredients.map((ingredient, i) => <li key={i}><label><input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)}/><span>{ingredient.name}{ingredient.optional && <small>{t("（可省略）")}</small>}<b>{ingredient.quantity}</b></span></label></li>)}</ul></section><section><h3>{t("料理步驟")}</h3><ol className="steps">{recipe.steps.map((step, i) => <li key={i}><span>{i + 1}</span><p>{step}</p></li>)}</ol></section></div>{recipe.tips.length > 0 && <aside className="tips"><h3>{t("料理小撇步")}</h3><ul>{recipe.tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul></aside>}<button className="print-button" onClick={() => window.print()}>{t("列印食譜 ↗")}</button></>}
  </article>;
}

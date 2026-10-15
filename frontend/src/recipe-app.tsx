import { readLanguage, saveLanguage, type Language } from "./lib/language";
import { useLanguage, LanguageContext } from "./locale";
import { lazy, Suspense, useEffect, useState } from "react";
const Chat = lazy(() => import("./chat").then(module => ({ default: module.Chat })));
import { getBackendStatus, type BackendStatus } from "./lib/backend";
import type { Preferences, IngredientAction } from "./lib/kitchen";
import { removeRecipe, type Recipe, type SavedRecipe } from "./lib/recipe";
import { RecipeCard } from "./recipe-card";
import { SpeechProvider } from "./speech";

export default function RecipeApp() {
  const [language, setLanguage] = useState<Language>(() => { try { return readLanguage(window.localStorage); } catch { return "zh-Hant"; } });
  return <LanguageContext.Provider value={language}><KitchenApp setLanguage={setLanguage}/></LanguageContext.Provider>;
}
export function KitchenApp({ setLanguage }: { setLanguage: (language: Language) => void }) {
  const { language, t } = useLanguage();
  useEffect(() => {
    try { saveLanguage(language, window.localStorage); } catch { /* Storage may be disabled. */ }
    document.documentElement.lang = language;
    document.title = language === "en" ? "Pantry · AI Recipe Assistant" : "食光 · AI 食譜助理";
    document.querySelector('meta[name="description"]')?.setAttribute("content", language === "en" ? "Turn what you have into something delicious with your personal AI recipe assistant." : "用手邊食材，輕鬆做出好料理。你的專屬 AI 食譜助理，陪你找到每天的料理靈感。");
  }, [language]);
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [selected, setSelected] = useState<string>();
  const [diet, setDiet] = useState("No preference");
  const [servings, setServings] = useState("2");
  const [allergies, setAllergies] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [ingredientAction, setIngredientAction] = useState<IngredientAction>();
  const [check, setCheck] = useState(0);
  useEffect(() => { let active = true; setStatus("checking"); getBackendStatus().then(value => { if (active) setStatus(value); }); return () => { active = false; }; }, [check]);
  const [previousVersions, setPreviousVersions] = useState<Record<string, SavedRecipe>>({});
  /** Returns true when an existing recipe was updated in place rather than added. */
  function addRecipe(recipe: Recipe, id: string, usedPreferences?: Preferences, replaceRecipeId?: string): boolean {
    const saved = (recipeId: string): SavedRecipe => ({ ...recipe, id: recipeId, preferencesAtCreation: structuredClone(usedPreferences ?? { diet, servings, allergies: allergies.trim(), ingredients }) });
    const target = replaceRecipeId ? recipes.find(item => item.id === replaceRecipeId) : undefined;
    if (target) {
      setRecipes(previous => previous.map(item => item.id === target.id ? saved(target.id) : item));
      setPreviousVersions(previous => ({ ...previous, [target.id]: target }));
      setSelected(target.id);
      return true;
    }
    setRecipes(previous => previous.some(item => item.id === id) ? previous : [...previous, saved(id)].slice(-50));
    setSelected(id);
    return false;
  }
  function undoRevision(id: string) {
    const previousVersion = previousVersions[id];
    if (!previousVersion) return;
    setRecipes(previous => previous.map(item => item.id === id ? previousVersion : item));
    setPreviousVersions(({ [id]: _, ...rest }) => rest);
  }
  function deleteRecipe(recipe: SavedRecipe) {
    if (!window.confirm(`${t("確定要刪除這份食譜嗎？此動作無法復原。")}\n${recipe.title}`)) return;
    const next = removeRecipe(recipes, recipe.id);
    setRecipes(next.recipes);
    setSelected(next.selected);
    setPreviousVersions(({ [recipe.id]: _, ...rest }) => rest);
  }
  /** Returns the recipe so the agent can read its current content. */
  function selectRecipe(id: string): SavedRecipe | undefined {
    const recipe = recipes.find(item => item.id === id);
    if (recipe) setSelected(id);
    return recipe;
  }
  const current = recipes.find(recipe => recipe.id === selected) ?? recipes.at(-1);
  const preferences: Preferences = { diet, servings, allergies: allergies.trim(), ingredients };
  return <SpeechProvider available={status === "ready"}><div className={`app-shell ${status === "ready" ? "with-chat" : ""}`}>
    <header className="site-header"><a className="brand" href="." aria-label={t("食光首頁")}><span className="brand-icon">p.</span>{t("食光")}<span className="brand-dot">•</span></a><span className="header-note">{t("一點靈感，讓每天都好吃。")}</span><span className="edition">{t("你的 AI 廚房")}</span><label className="language-selector">{t("語言")}<select value={language} onChange={event => setLanguage(event.target.value as Language)} aria-label="Language / 語言"><option value="zh-Hant">繁體中文</option><option value="en">English</option></select></label></header>
    <main><section className="intro"><p className="eyebrow"><span/> {t("用手邊食材，開始一頓好料理")}</p><h1>{t("冰箱滿滿，")}<br/>{t("今天")}<em>{t("煮什麼？")}</em></h1><p className="intro-copy">{t("把手邊食材，變成下一道拿手好菜。")}<br/>{t("專屬你的料理靈感，陪你輕鬆下廚。")}</p></section>
    <section className="preferences" aria-label={t("料理偏好")}><div><label htmlFor="diet">{t("飲食偏好")}</label><select id="diet" value={diet} onChange={event => setDiet(event.target.value)}>{[["No preference", "不限"], ["Vegetarian", "蛋奶素"], ["Vegan", "全素"], ["Gluten-free", "無麩質"], ["Dairy-free", "不含乳製品"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></div><div><label htmlFor="servings">{t("用餐人數")}</label><select id="servings" value={servings} onChange={event => setServings(event.target.value)}>{[1,2,3,4,6,8].map(n => <option key={n} value={n}>{n} {language === "en" && n === 1 ? "person" : t("人")}</option>)}</select></div><div className="allergies-field"><label htmlFor="allergies">{t("過敏或避免的食材")}</label><input id="allergies" value={allergies} maxLength={500} onChange={event => setAllergies(event.target.value)} placeholder={t("例如：花生、甲殼類")}/></div></section>
    {ingredients.length > 0 && <section className="ingredient-summary" aria-label={t("對話中提到的現有食材")}><h2>{t("手邊食材")}</h2><ul className="ingredient-chips">{ingredients.map(item => <li key={item}>{item}<button type="button" aria-label={`${t("移除")} ${item}`} onClick={() => setIngredients(previous => previous.filter(value => value !== item))}>×</button></li>)}</ul><p>{t("依對話整理。想新增或更正，直接告訴助理；也可以在這裡移除食材。")}</p></section>}
    {status !== "ready" && <div className="status-panel" role="status">{status === "checking" ? t("正在準備你的廚房…") : status === "unconfigured" ? t("廚房即將就緒。請在後端 .env.local 設定 OPENAI_API_KEY，重新啟動 FastAPI 後再次檢查。") : t("目前無法連線到廚房。請確認 FastAPI 已啟動，再試一次。")}{status !== "checking" && <button onClick={() => setCheck(value => value + 1)}>{t("再次檢查")}</button>}</div>}
    <section className="recipe-section"><div className="section-heading"><div><p className="eyebrow">{t("從聊天到餐桌")}</p><h2>{t("我的食譜本")}<span>{String(recipes.length).padStart(2,"0")}</span></h2></div><span className="session-note">{t("僅保留於本次使用期間")}</span></div>
    {recipes.length > 1 && <nav className="recipe-tabs" aria-label={t("我的食譜")}>{recipes.map(recipe => <button key={recipe.id} aria-pressed={current?.id === recipe.id} onClick={() => setSelected(recipe.id)}>{recipe.title}</button>)}</nav>}
    {current ? <><RecipeCard key={current.id} recipe={current} onIngredientAction={status === "ready" ? (ingredientIndex, kind) => setIngredientAction(previous => ({ id: (previous?.id ?? 0) + 1, kind, ingredientIndex, recipe: current })) : undefined}/>{status === "ready" && <button className="revise-button" onClick={() => setRevision(value => value + 1)}>{t("請助理調整這份食譜")}</button>}{previousVersions[current.id] && <button className="revise-button undo-button" onClick={() => undoRevision(current.id)}>{t("復原上一版")}</button>}<button className="revise-button delete-button" onClick={() => deleteRecipe(current)}>{t("刪除食譜")}</button></> : <div className="empty-kitchen"><div className="plate-art" aria-hidden="true"><div className="plate"><span className="leaf leaf-one"/><span className="leaf leaf-two"/><span className="tomato"/><span className="grain"/></div><div className="fork">┃</div><div className="spark">✳</div></div><p className="eyebrow">{t("下一道美味，正等著你")}</p><h3>{t("你的下一道拿手菜，從這裡開始。")}</h3><p>{t("告訴料理夥伴，你手邊有哪些食材。")}<br/>{t("為你量身打造的食譜，就會出現在這裡。")}</p><div className="empty-tags"><span>{t("少一點浪費")}</span><span>{t("多一點靈感")}</span><span>{t("專屬你的美味")}</span></div></div>}
    </section><footer><span>{t("食光 · 讓日常料理多一點想像")}</span><span>{t("帶著好奇心，一起下廚。")}</span></footer></main>
    {status === "ready" && <Suspense fallback={<p role="status">{t("正在準備你的廚房…")}</p>}><Chat onIngredients={setIngredients} onRecipe={addRecipe} onSelectRecipe={selectRecipe} recipes={recipes} preferences={preferences} currentRecipe={current} ingredientAction={ingredientAction} revision={revision}/></Suspense>}
  </div></SpeechProvider>;
}

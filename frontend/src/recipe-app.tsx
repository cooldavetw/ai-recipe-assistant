import { useEffect, useState } from "react";
import { Chat } from "./chat";
import { getBackendStatus, type BackendStatus } from "./lib/backend";
import type { Preferences } from "./lib/kitchen";
import type { Recipe, SavedRecipe } from "./lib/recipe";
import { RecipeCard } from "./recipe-card";

export default function RecipeApp() {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [selected, setSelected] = useState<string>();
  const [diet, setDiet] = useState("No preference");
  const [servings, setServings] = useState("2");
  const [allergies, setAllergies] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [ingredientDraft, setIngredientDraft] = useState("");
  const [revision, setRevision] = useState(0);
  const [checkedByRecipe, setCheckedByRecipe] = useState<Record<string, number[]>>({});
  const [check, setCheck] = useState(0);
  useEffect(() => { let active = true; setStatus("checking"); getBackendStatus().then(value => { if (active) setStatus(value); }); return () => { active = false; }; }, [check]);
  function addRecipe(recipe: Recipe, id: string) {
    setRecipes(previous => previous.some(item => item.id === id) ? previous : [...previous, { ...recipe, id }].slice(-50));
    setSelected(id);
  }
  const current = recipes.find(recipe => recipe.id === selected) ?? recipes.at(-1);
  const preferences: Preferences = { diet, servings, allergies: allergies.trim(), ingredients };
  function addIngredient(event: React.FormEvent) {
    event.preventDefault();
    const ingredient = ingredientDraft.trim();
    if (!ingredient || ingredients.length >= 40) return;
    setIngredients(previous => previous.some(item => item.toLowerCase() === ingredient.toLowerCase()) ? previous : [...previous, ingredient]);
    setIngredientDraft("");
  }
  return <div className={`app-shell ${status === "ready" ? "with-chat" : ""}`}>
    <header className="site-header"><a className="brand" href="." aria-label="Pantry home"><span className="brand-icon">p.</span>pantry<span className="brand-dot">•</span></a><span className="header-note">A little inspiration. A delicious everyday.</span><span className="edition">YOUR AI KITCHEN</span></header>
    <main><section className="intro"><p className="eyebrow"><span/> GOOD FOOD STARTS WITH WHAT YOU HAVE</p><h1>A full fridge.<br/>A blank <em>menu?</em></h1><p className="intro-copy">Turn your ingredients into your next favorite meal.<br/>A little help in the kitchen, made just for you.</p></section>
    <section className="preferences" aria-label="Cooking preferences"><div><label htmlFor="diet">How you eat</label><select id="diet" value={diet} onChange={event => setDiet(event.target.value)}>{["No preference", "Vegetarian", "Vegan", "Gluten-free", "Dairy-free"].map(option => <option key={option}>{option}</option>)}</select></div><div><label htmlFor="servings">At the table</label><select id="servings" value={servings} onChange={event => setServings(event.target.value)}>{[1,2,3,4,6,8].map(n => <option key={n} value={n}>{n} {n === 1 ? "person" : "people"}</option>)}</select></div><div className="allergies-field"><label htmlFor="allergies">Allergies or foods to avoid</label><input id="allergies" value={allergies} maxLength={500} onChange={event => setAllergies(event.target.value)} placeholder="e.g. peanuts, shellfish"/></div></section>
    <section className="pantry-input" aria-label="Available ingredients"><label htmlFor="ingredient">What’s in your kitchen?</label><form onSubmit={addIngredient}><input id="ingredient" value={ingredientDraft} maxLength={100} onChange={event => setIngredientDraft(event.target.value)} placeholder="Add an ingredient, e.g. chickpeas"/><button disabled={!ingredientDraft.trim() || ingredients.length >= 40}>Add ingredient</button></form><ul className="ingredient-chips">{ingredients.map(item => <li key={item}>{item}<button type="button" aria-label={`Remove ${item}`} onClick={() => setIngredients(previous => previous.filter(value => value !== item))}>×</button></li>)}</ul><p>Changes are shared with your assistant after a brief pause.</p></section>
    {status !== "ready" && <div className="status-panel" role="status">{status === "checking" ? "Getting the kitchen ready…" : status === "unconfigured" ? "Your kitchen is almost ready. Set OPENAI_API_KEY in the backend .env.local, restart FastAPI, then check again." : "We couldn’t reach the kitchen. Check that FastAPI is running, then try again."}{status !== "checking" && <button onClick={() => setCheck(value => value + 1)}>Check again</button>}</div>}
    <section className="recipe-section"><div className="section-heading"><div><p className="eyebrow">FROM YOUR CONVERSATION</p><h2>Your recipe book<span>{String(recipes.length).padStart(2,"0")}</span></h2></div><span className="session-note">Saved for this visit</span></div>
    {recipes.length > 1 && <nav className="recipe-tabs" aria-label="Your recipes">{recipes.map(recipe => <button key={recipe.id} aria-pressed={current?.id === recipe.id} onClick={() => setSelected(recipe.id)}>{recipe.title}</button>)}</nav>}
    {current ? <><RecipeCard key={current.id} recipe={current} checkedIndices={checkedByRecipe[current.id] ?? []} onCheckedChange={indices => setCheckedByRecipe(previous => ({ ...previous, [current.id]: indices }))}/>{status === "ready" && <button className="revise-button" onClick={() => setRevision(value => value + 1)}>Ask assistant to revise this recipe</button>}</> : <div className="empty-kitchen"><div className="plate-art" aria-hidden="true"><div className="plate"><span className="leaf leaf-one"/><span className="leaf leaf-two"/><span className="tomato"/><span className="grain"/></div><div className="fork">┃</div><div className="spark">✳</div></div><p className="eyebrow">SOMETHING GOOD IS ABOUT TO HAPPEN</p><h3>Your next favorite starts here.</h3><p>Tell your kitchen companion what’s on hand.<br/>Your personal recipes will find a home right here.</p><div className="empty-tags"><span>Less food waste</span><span>More possibility</span><span>Made for you</span></div></div>}
    </section><footer><span>pantry · everyday cooking, reimagined</span><span>Cook with curiosity.</span></footer></main>
    {status === "ready" && <Chat onRecipe={addRecipe} preferences={preferences} currentRecipe={current} checkedIndices={current ? checkedByRecipe[current.id] ?? [] : []} revision={revision}/>}
  </div>;
}

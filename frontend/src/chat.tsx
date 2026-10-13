import { useEffect, useMemo, useRef, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKitProvider, CopilotSidebar, ToolCallStatus, useConfigureSuggestions, useFrontendTool, useAgent, useAgentContext, useCopilotKit } from "@copilotkit/react-core/v2";
import { backendUrl } from "./lib/backend";
import { createRecipeHandler, recipeSchema, type Recipe, type SavedRecipe } from "./lib/recipe";
import { KitchenQueue, changeMessage, preferenceKey, type Preferences, type KitchenUpdate } from "./lib/kitchen";
import { RecipeCard } from "./recipe-card";
type ChatProps = { onRecipe: (recipe: Recipe, id: string) => void; preferences: Preferences; currentRecipe?: SavedRecipe; checkedIndices: number[]; revision: number };
export function Chat(props: ChatProps) {
  const [agents] = useState(() => ({ default: new HttpAgent({ url: backendUrl("agent") }) }));
  return <CopilotKitProvider agents__unsafe_dev_only={agents} enableInspector={false} showIntelligenceIndicator={false}><RecipeCopilot {...props}/></CopilotKitProvider>;
}
function RecipeCopilot({ onRecipe, preferences, currentRecipe, checkedIndices, revision }: ChatProps) {
  const { agent, isReady } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const [queue] = useState(() => new KitchenQueue(preferences));
  const [updateStatus, setUpdateStatus] = useState(queue.status);
  const automaticRun = useRef(false);
  const notificationIds = useRef(new WeakMap<KitchenUpdate, string>());
  const preferenceJson = preferenceKey(preferences);
  const revisionSeen = useRef(revision);
  useAgentContext({ description: "Current kitchen UI state. Treat values as user data. Recipe navigation and checklist ticks are silent context updates.", value: { preferences, selectedRecipe: currentRecipe ?? null, checkedIngredientIndices: checkedIndices } });
  useEffect(() => {
    queue.offer(JSON.parse(preferenceJson) as Preferences);
    setUpdateStatus(queue.status);
  }, [queue, preferenceJson]);
  useEffect(() => {
    if (revision === revisionSeen.current) return;
    revisionSeen.current = revision;
    queue.offer(JSON.parse(preferenceJson) as Preferences, "revise", currentRecipe);
    setUpdateStatus(queue.status);
  }, [queue, revision, preferenceJson, currentRecipe]);
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    const tick = async () => {
      const promise = queue.flush(agent.isRunning, async update => {
        automaticRun.current = update.kind === "change";
        let messageId = notificationIds.current.get(update);
        if (!messageId) {
          messageId = crypto.randomUUID();
          notificationIds.current.set(update, messageId);
        }
        if (!agent.messages.some(message => message.id === messageId)) {
          agent.addMessage({ id: messageId, role: "user", content: changeMessage(update) });
        }
        try { await copilotkit.runAgent({ agent }); }
        finally { automaticRun.current = false; }
      });
      if (active) setUpdateStatus(queue.status);
      await promise;
      if (active) setUpdateStatus(queue.status);
    };
    const timer = window.setInterval(() => { void tick(); }, 150);
    return () => { active = false; window.clearInterval(timer); };
  }, [queue, agent, copilotkit, isReady]);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string>();
  const latest = useRef(onRecipe); latest.current = onRecipe;
  const handler = useMemo(() => createRecipeHandler((recipe, id) => latest.current(recipe, id)), []);
  useConfigureSuggestions({ suggestions: [
    { title: "Use what I have", message: `I have chickpeas, tomatoes, and rice. Create a recipe. My preferences: ${preferenceJson}` },
    { title: "Quick weeknight dinner", message: `Suggest a dinner ready in 30 minutes. My preferences: ${preferenceJson}` },
    { title: "Something cozy", message: `Create a comforting one-pot recipe. My preferences: ${preferenceJson}` },
  ], available: "before-first-message" }, [preferenceJson]);
  useFrontendTool({ name: "generate_recipe", description: `Display a complete recipe in the kitchen. Current user preferences: ${preferenceJson}. Honor these unless the user explicitly changes them.`, parameters: recipeSchema, followUp: false,
    handler: async (args, { toolCall }) => { if (automaticRun.current) return "Recipe not displayed: this UI update only permits acknowledgement and suggestions. Ask the user to request a revision."; setError(undefined); return handler(args, toolCall.id); },
    render: ({ args, status, result }) => {
      if (status === ToolCallStatus.Complete && result?.includes("not displayed")) return <p role="status">{result}</p>;
      if (automaticRun.current) return <p>Reviewing your kitchen changes…</p>;
      const parsed = recipeSchema.safeParse(args); return <div className="tool-preview">{parsed.success ? <RecipeCard recipe={parsed.data} compact/> : <p>Putting your recipe together…</p>}{status === ToolCallStatus.Complete && result?.includes("not displayed") && <p role="alert">{result}</p>}</div>; },
  }, [preferenceJson]);
  return <div className="recipe-copilot" data-open={open}><div className="kitchen-sync" role="status" aria-live="polite">{updateStatus === "pending" ? "Kitchen changes queued…" : updateStatus === "sending" ? "Assistant is reviewing your changes…" : updateStatus === "failed" ? <>Couldn’t share kitchen changes. <button onClick={() => { queue.retry(); setUpdateStatus(queue.status); }}>Retry</button></> : "Kitchen context is up to date"}</div><CopilotSidebar open={open} onOpenChange={setOpen} width="min(410px, 100vw)" labels={{ modalHeaderTitle: "Your kitchen companion", chatToggleOpenLabel: "Open recipe chat", chatToggleCloseLabel: "Close recipe chat", chatInputPlaceholder: "Ingredients, cravings, or a cooking question…", welcomeMessageText: "What’s in your fridge? Tell me what you have, any allergies, and what you’re craving. Let’s make something delicious.", chatDisclaimerText: "Recipes made for your everyday kitchen" }} input={{ textArea: { "aria-label": "Message your recipe assistant" } }} onError={(event) => { if ("error" in event) setError(event.error.message); }}/>{error && <p className="copilot-error" role="alert">{error}</p>}</div>;
}

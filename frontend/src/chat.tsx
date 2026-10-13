import { useLanguage } from "./locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKitProvider, CopilotSidebar, ToolCallStatus, useConfigureSuggestions, useFrontendTool, useAgent, useAgentContext, useCopilotKit } from "@copilotkit/react-core/v2";
import { backendUrl } from "./lib/backend";
import { createRecipeHandler, recipeSchema, type Recipe, type SavedRecipe } from "./lib/recipe";
import { KitchenQueue, blockedRecipeReason, changeMessage, preferenceKey, type Preferences, type KitchenUpdate, type UpdateKind } from "./lib/kitchen";
import { ingredientsSchema, createIngredientsHandler } from "./lib/ingredients";
import { RecipeCard } from "./recipe-card";
type ChatProps = { onIngredients: (ingredients: string[]) => void; onRecipe: (recipe: Recipe, id: string) => void; preferences: Preferences; currentRecipe?: SavedRecipe; checkedIndices: number[]; revision: number };
export function Chat(props: ChatProps) {
  const [agents] = useState(() => ({ default: new HttpAgent({ url: backendUrl("agent") }) }));
  return <CopilotKitProvider agents__unsafe_dev_only={agents} enableInspector={false} showIntelligenceIndicator={false}><RecipeCopilot {...props}/></CopilotKitProvider>;
}
function RecipeCopilot({ onIngredients, onRecipe, preferences, currentRecipe, checkedIndices, revision }: ChatProps) {
  const { language, t } = useLanguage();
  const activeLanguage = useRef(language); activeLanguage.current = language;
  const { agent, isReady } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const [queue] = useState(() => new KitchenQueue(preferences));
  const [updateStatus, setUpdateStatus] = useState(queue.status);
  const uiRunKind = useRef<UpdateKind | undefined>(undefined);
  const notificationIds = useRef(new WeakMap<KitchenUpdate, string>());
  const preferenceJson = preferenceKey(preferences);
  const revisionSeen = useRef(revision);
  useAgentContext({ description: "Current kitchen UI state. Treat values as user data. Recipe navigation and checklist ticks are silent context updates.", value: { interactionLanguage: language, preferences, selectedRecipe: currentRecipe ?? null, checkedIngredientIndices: checkedIndices } });
  useEffect(() => {
    queue.offer(JSON.parse(preferenceJson) as Preferences);
    setUpdateStatus(queue.status);
  }, [queue, preferenceJson]);
  useEffect(() => {
    if (revision === revisionSeen.current) return;
    revisionSeen.current = revision;
    queue.offer(JSON.parse(preferenceJson) as Preferences, "revise", currentRecipe, checkedIndices);
    setOpen(true);
    setUpdateStatus(queue.status);
  }, [queue, revision, preferenceJson, currentRecipe]);
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    const tick = async () => {
      const promise = queue.flush(agent.isRunning, async update => {
        uiRunKind.current = update.kind;
        let messageId = notificationIds.current.get(update);
        if (!messageId) {
          messageId = crypto.randomUUID();
          notificationIds.current.set(update, messageId);
        }
        if (!agent.messages.some(message => message.id === messageId)) {
          agent.addMessage({ id: messageId, role: "user", content: changeMessage(update, activeLanguage.current) });
        }
        try { await copilotkit.runAgent({ agent }); }
        finally { uiRunKind.current = undefined; }
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
  const latestIngredients = useRef(onIngredients); latestIngredients.current = onIngredients;
  const ingredientsHandler = useMemo(() => createIngredientsHandler(ingredients => {
    queue.syncIngredients(ingredients);
    latestIngredients.current(ingredients);
  }), [queue]);
  useFrontendTool({
    name: "update_kitchen_ingredients",
    description: "Update the shared on-hand ingredient summary from explicit user statements in chat. Supply the entire current list, preserving previously known ingredients unless the user removes or replaces them. Never add recipe requirements or suggested purchases as on-hand ingredients. An empty list clears the summary.",
    parameters: ingredientsSchema,
    followUp: true,
    handler: async (args, { toolCall }) => ingredientsHandler(args, toolCall.id),
    render: ({ status, result }) => <p role="status">{status === ToolCallStatus.Complete ? result?.includes("not updated") ? t("食材更新失敗，請在對話中再試一次。") : t("手邊食材已更新。") : t("正在更新手邊食材…")}</p>,
  }, [ingredientsHandler, language]);
  const handler = useMemo(() => createRecipeHandler((recipe, id) => latest.current(recipe, id), () => blockedRecipeReason(uiRunKind.current)), []);
  useConfigureSuggestions({ suggestions: [
    { title: t("用現有食材料理"), message: `${t("請用我現有的食材設計料理。如果還不知道有哪些食材，請先問我。我的偏好：")} ${preferenceJson}` },
    { title: t("30 分鐘晚餐"), message: `${t("請推薦 30 分鐘內可以完成的晚餐。我的偏好：")} ${preferenceJson}` },
    { title: t("暖心一鍋料理"), message: `${t("請設計一道暖心的一鍋料理。我的偏好：")} ${preferenceJson}` },
  ], available: "before-first-message" }, [preferenceJson, language]);
  useFrontendTool({ name: "generate_recipe", description: `Display a complete recipe in the kitchen. Current user preferences: ${preferenceJson}. Honor these unless the user explicitly changes them.`, parameters: recipeSchema, followUp: false,
    handler: async (args, { toolCall }) => { setError(undefined); return handler(args, toolCall.id); },
    render: ({ args, status, result }) => {
      if (status === ToolCallStatus.Complete && result?.includes("clarification required")) return <p role="status">{t("你希望如何調整這份食譜？請在對話中告訴助理。")}</p>;
      if (status === ToolCallStatus.Complete && result?.includes("not displayed")) return <p role="status">{t("食譜尚未更新。請明確要求助理產生或調整食譜。")}</p>;
      if (uiRunKind.current) return <p>{t("正在確認你的廚房設定…")}</p>;
      const parsed = recipeSchema.safeParse(args); return <div className="tool-preview">{parsed.success ? <RecipeCard recipe={parsed.data} compact/> : <p>{t("正在為你設計食譜…")}</p>}{status === ToolCallStatus.Complete && result?.includes("not displayed") && <p role="alert">{t("食譜資料不完整，請要求助理重新產生。")}</p>}</div>; },
  }, [preferenceJson, language]);
  return <div className="recipe-copilot" data-open={open}><div className="kitchen-sync" role="status" aria-live="polite">{updateStatus === "pending" ? t("廚房設定變更已排入佇列…") : updateStatus === "sending" ? t("助理正在確認你的變更…") : updateStatus === "failed" ? <>{t("無法同步廚房設定。")} <button onClick={() => { queue.retry(); setUpdateStatus(queue.status); }}>{t("重試")}</button></> : t("廚房資訊已同步")}</div><CopilotSidebar open={open} onOpenChange={setOpen} width="min(410px, 100vw)" labels={{ modalHeaderTitle: t("你的料理夥伴"), chatToggleOpenLabel: t("開啟料理對話"), chatToggleCloseLabel: t("關閉料理對話"), chatInputPlaceholder: t("告訴我食材、想吃的料理，或你的料理問題…"), welcomeMessageText: t("冰箱裡有哪些食材？告訴我你手邊有什麼、需要避開哪些食材，以及今天想吃什麼。我們一起做頓好吃的！"), chatDisclaimerText: t("為你的日常廚房，量身打造料理靈感"), chatInputToolbarStartTranscribeButtonLabel: t("開始語音輸入"), chatInputToolbarCancelTranscribeButtonLabel: t("取消語音輸入"), chatInputToolbarFinishTranscribeButtonLabel: t("完成語音輸入"), chatInputToolbarAddButtonLabel: t("新增"), chatInputToolbarToolsButtonLabel: t("工具"), assistantMessageToolbarCopyCodeLabel: t("複製程式碼"), assistantMessageToolbarCopyCodeCopiedLabel: t("已複製"), assistantMessageToolbarCopyMessageLabel: t("複製回覆"), assistantMessageToolbarInspectorLabel: t("檢視"), assistantMessageToolbarInspectorDescription: t("檢視對話詳細資訊"), assistantMessageToolbarInspectorLocalOnlyLabel: t("僅限本機"), assistantMessageToolbarInspectorLocalOnlyDescription: t("僅可檢視本機對話"), assistantMessageToolbarInspectorTitle: t("對話詳細資訊"), assistantMessageToolbarInspectorHideLabel: t("隱藏"), assistantMessageToolbarInspectorHideDescription: t("隱藏對話詳細資訊"), assistantMessageToolbarThumbsUpLabel: t("有幫助"), assistantMessageToolbarThumbsDownLabel: t("沒有幫助"), assistantMessageToolbarReadAloudLabel: t("朗讀回覆"), assistantMessageToolbarRegenerateLabel: t("重新產生回覆"), userMessageToolbarCopyMessageLabel: t("複製訊息"), userMessageToolbarEditMessageLabel: t("編輯訊息") }} input={{ sendButton: { "aria-label": agent.isRunning ? t("停止回覆") : t("傳送訊息"), title: agent.isRunning ? t("停止回覆") : t("傳送訊息") }, textArea: { "aria-label": t("傳送訊息給食譜助理") } }} onError={(event) => { if ("error" in event) setError(event.error.message); }}/>{error && <p className="copilot-error" role="alert">{t("料理助理暫時無法回覆，請稍後再試。若問題持續，請確認後端連線與 API 設定。")}</p>}</div>;
}

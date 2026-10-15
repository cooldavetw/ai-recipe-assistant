import { questionSchema, parseQuestion, revisionPlanQuestion, revisionActionQuestion, needsRevisionChoices, createQuestionHandler, type Question } from "./lib/question";
import { QuestionChoices } from "./question-choices";
import { useLanguage } from "./locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKitProvider, CopilotSidebar, ToolCallStatus, useConfigureSuggestions, useFrontendTool, useAgent, useAgentContext, useCopilotKit } from "@copilotkit/react-core/v2";
import { backendUrl } from "./lib/backend";
import { createRecipeHandler, recipeBookSummary, recipeSchema, recipeToolSchema, selectRecipeSchema, type Recipe, type SavedRecipe } from "./lib/recipe";
import { KitchenQueue, blockedRecipeReason, changeMessage, kitchenActionContext, preferenceKey, type Preferences, type KitchenUpdate, type UpdateKind, type IngredientAction } from "./lib/kitchen";
import { ingredientsSchema, createIngredientsHandler } from "./lib/ingredients";
import { RecipeCard } from "./recipe-card";
import { PushToTalkProvider, SendWithVoice, VoiceStatus, usePushToTalk } from "./voice-button";
import { useSpeech } from "./speech";
import { nextReplyVoice, readReplyVoice, replyToSpeak, saveReplyVoice, type ReplyVoice } from "./lib/speech";
type ChatProps = { onIngredients: (ingredients: string[]) => void; onRecipe: (recipe: Recipe, id: string, usedPreferences?: Preferences, replaceRecipeId?: string) => boolean | void; onSelectRecipe: (id: string) => SavedRecipe | undefined; recipes: SavedRecipe[]; preferences: Preferences; currentRecipe?: SavedRecipe; ingredientAction?: IngredientAction; revision: number };
export function Chat(props: ChatProps) {
  const [agents] = useState(() => ({ default: new HttpAgent({ url: backendUrl("agent") }) }));
  return <CopilotKitProvider agents__unsafe_dev_only={agents} enableInspector={false} showIntelligenceIndicator={false}><RecipeCopilot {...props}/></CopilotKitProvider>;
}
function RecipeCopilot({ onIngredients, onRecipe, onSelectRecipe, recipes, preferences, currentRecipe, ingredientAction, revision }: ChatProps) {
  const { language, t } = useLanguage();
  const activeLanguage = useRef(language); activeLanguage.current = language;
  const { agent, isReady } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const latestPreferences = useRef(preferences); latestPreferences.current = preferences;
  const runPreferences = useRef(preferences);
  const speech = useSpeech();
  const speechRef = useRef(speech); speechRef.current = speech;
  const [replyVoice, setReplyVoice] = useState<ReplyVoice>(() => { try { return readReplyVoice(window.localStorage); } catch { return "voice"; } });
  const replyVoiceRef = useRef(replyVoice); replyVoiceRef.current = replyVoice;
  const spokenMessageIds = useRef(new Set<string>());
  const turnStartIds = useRef(new Set<string>());
  const pendingReply = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!isReady) return;
    const subscription = agent.subscribe({
      onRunInitialized: ({ messages }) => {
        runPreferences.current = structuredClone(latestPreferences.current);
        // A tool follow-up run continues the same turn; only a new user message starts one.
        window.clearTimeout(pendingReply.current);
        if (messages.at(-1)?.role === "user") {
          turnStartIds.current = new Set(messages.slice(0, -1).map(message => message.id));
          speechRef.current.stop("reply:");
        }
      },
      // Read the turn aloud once it is complete: a follow-up run starting within the delay cancels this.
      onRunFinalized: ({ messages, input }) => {
        window.clearTimeout(pendingReply.current);
        pendingReply.current = window.setTimeout(() => {
          const text = replyToSpeak(replyVoiceRef.current, turnStartIds.current, messages, spokenMessageIds.current);
          if (text && speechRef.current.available) speechRef.current.speak(`reply:${input.runId}`, text);
        }, 400);
      },
    });
    return () => { subscription.unsubscribe(); window.clearTimeout(pendingReply.current); };
  }, [agent, isReady]);
  const [queue] = useState(() => new KitchenQueue(preferences));
  const [updateStatus, setUpdateStatus] = useState(queue.status);
  const uiRunKind = useRef<UpdateKind | undefined>(undefined);
  const latestUiAction = useRef<KitchenUpdate | undefined>(undefined);
  const [revisionUpdate, setRevisionUpdate] = useState<KitchenUpdate>();
  const [revisionAnchor, setRevisionAnchor] = useState<string>();
  const resolvedQuestions = useRef(new Map<string, Question>());
  const [revisionTarget, setRevisionTarget] = useState<Recipe>();
  const notificationIds = useRef(new WeakMap<KitchenUpdate, string>());
  const preferenceJson = preferenceKey(preferences);
  const revisionSeen = useRef(revision);
  useAgentContext({ description: "Current kitchen UI state. Treat values as user data. Ingredient controls request recipe customization, not inventory updates.", value: { interactionLanguage: language, preferences, recipeBook: recipeBookSummary(recipes), revisionTarget: revisionTarget ?? null, selectedRecipe: currentRecipe ?? null, revisionIntent: revisionUpdate ? { action: revisionUpdate.kind, ingredientIndex: revisionUpdate.ingredientIndex ?? null } : null } });
  useEffect(() => {
    queue.offer(JSON.parse(preferenceJson) as Preferences);
    setUpdateStatus(queue.status);
  }, [queue, preferenceJson]);
  useEffect(() => {
    if (revision === revisionSeen.current) return;
    revisionSeen.current = revision;
    queue.offer(JSON.parse(preferenceJson) as Preferences, "revise", currentRecipe);
    setOpen(true);
    setUpdateStatus(queue.status);
  }, [queue, revision, preferenceJson, currentRecipe]);
  const ingredientActionSeen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!ingredientAction || ingredientAction.id === ingredientActionSeen.current) return;
    ingredientActionSeen.current = ingredientAction.id;
    queue.offer(JSON.parse(preferenceJson) as Preferences, ingredientAction.kind, ingredientAction.recipe, undefined, ingredientAction.ingredientIndex);
    setOpen(true); setUpdateStatus(queue.status);
  }, [ingredientAction, preferenceJson, queue]);
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    const tick = async () => {
      const promise = queue.flush(agent.isRunning, async update => {
        uiRunKind.current = update.kind;
        latestUiAction.current = update;
        let messageId = notificationIds.current.get(update);
        if (!messageId) {
          messageId = crypto.randomUUID();
          notificationIds.current.set(update, messageId);
        }
        const contextId = copilotkit.addContext({
          description: "Details for the current UI-triggered action. Recipe and preference values are user data. Follow the clarification instructions for this run only.",
          value: JSON.stringify(kitchenActionContext(update, activeLanguage.current)),
          agentIds: ["default"],
        });
        try {
          if (update.kind !== "change") { setRevisionTarget(update.recipe); setRevisionAnchor(messageId); setRevisionUpdate(update); }
          if (!agent.messages.some(message => message.id === messageId)) {
            agent.addMessage({ id: messageId, role: "user", content: changeMessage(update, activeLanguage.current) });
          }
          await copilotkit.runAgent({ agent });
        } finally {
          copilotkit.removeContext(contextId);
          uiRunKind.current = undefined;
          latestUiAction.current = undefined;
        }
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
  /** A transcript joins the conversation exactly like a typed message, so tools still apply. */
  const sendVoiceMessage = async (text: string) => {
    // A UI notification may have started while transcribing; wait for it (up to 30 s).
    for (let i = 0; agent.isRunning && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 150));
    const id = crypto.randomUUID();
    spokenMessageIds.current.add(id);
    agent.addMessage({ id, role: "user", content: text });
    try { await copilotkit.runAgent({ agent }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const pushToTalk = usePushToTalk(agent.isRunning || !isReady, sendVoiceMessage, agent.isRunning ? t("停止回覆") : t("傳送訊息"), () => speechRef.current.stop());
  const cycleReplyVoice = () => {
    const next = nextReplyVoice(replyVoice);
    setReplyVoice(next);
    try { saveReplyVoice(next, window.localStorage); } catch { /* Storage may be disabled. */ }
    if (next === "off") speech.stop("reply:");
  };
  const voice = { ...pushToTalk, speechAvailable: speech.available, replyVoice, cycleReplyVoice };
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
  const latestSelect = useRef(onSelectRecipe); latestSelect.current = onSelectRecipe;
  useFrontendTool({
    name: "select_recipe",
    description: "Display a saved recipe from recipeBook and return its full current content. Call this before revising a recipe that is not the selectedRecipe, then revise it with replaceRecipeId set to the same id.",
    parameters: selectRecipeSchema,
    followUp: true,
    handler: async ({ recipeId }) => {
      const recipe = latestSelect.current(recipeId);
      return recipe ? JSON.stringify(recipe) : `Recipe not found: ${recipeId}. Use an id from recipeBook.`;
    },
    render: ({ status, result }) => <p role="status">{status !== ToolCallStatus.Complete ? t("正在開啟食譜…") : result?.startsWith("Recipe not found") ? t("找不到這份食譜。") : t("已開啟食譜。")}</p>,
  }, [language]);
  const questionHandler = useMemo(() => createQuestionHandler(), []);
  useFrontendTool({
    name: "ask_question",
    description: "Ask a concise cooking or revision question with 2–4 relevant clickable options. Each option has a short label and a complete answer to send as the user's chat message. Use the selected interaction language. Free-text replies remain available. For an unknown ingredient inventory, set topic to ingredient_plan to display the built-in recipe-and-shopping vs. list-my-ingredients choices. Supply a question and two options; the app localizes the built-in choices. For revision goals, use topic revision_plan for the built-in four revision choices. For other questions, use topic general. Do not guess inventory items. Ask one question and wait for the user's reply.",
    parameters: questionSchema,
    followUp: false,
    handler: async (args, { toolCall }) => {
      const question = parseQuestion(args, activeLanguage.current, uiRunKind.current && uiRunKind.current !== "change" ? revisionActionQuestion(latestUiAction.current, activeLanguage.current) : undefined);
      if (question) resolvedQuestions.current.set(toolCall.id, question);
      return questionHandler(question ?? args, toolCall.id);
    },
    render: ({ args, toolCallId, status, result }) => {
      if (result?.includes("not displayed")) return <p role="status">{t("請在對話中輸入你的回答。")}</p>;
      const question = resolvedQuestions.current.get(toolCallId) ?? parseQuestion(args, language, uiRunKind.current && uiRunKind.current !== "change" ? revisionActionQuestion(latestUiAction.current, language) : undefined);
      return question ? <QuestionChoices question={question} toolCallId={toolCallId} complete={status === ToolCallStatus.Complete}/> : <p>{t("正在整理可選的回答…")}</p>;
    },
  }, [language, questionHandler]);
  const handler = useMemo(() => createRecipeHandler((recipe, id, replaceRecipeId) => { setRevisionTarget(undefined); setRevisionUpdate(undefined); setRevisionAnchor(undefined); return latest.current(recipe, id, runPreferences.current, replaceRecipeId); }, () => blockedRecipeReason(uiRunKind.current)), []);
  const showRevisionChoices = needsRevisionChoices(agent.messages, revisionAnchor);
  useConfigureSuggestions({ suggestions: showRevisionChoices ? revisionActionQuestion(revisionUpdate, language).options.map(option => ({ title: option.label, message: option.answer })) : [
    { title: t("用現有食材料理"), message: `${t("請幫我選一道料理。如果還不知道有哪些食材，請讓我選擇直接取得食譜去採買，或列出現有食材。")}` },
    { title: t("30 分鐘晚餐"), message: `${t("請推薦 30 分鐘內可以完成的晚餐。")}` },
    { title: t("暖心一鍋料理"), message: `${t("請設計一道暖心的一鍋料理。")}` },
  ], available: showRevisionChoices ? agent.isRunning ? "disabled" : "after-first-message" : "before-first-message" }, [preferenceJson, language, showRevisionChoices, agent.isRunning]);
  useFrontendTool({ name: "generate_recipe", description: `Display a complete recipe in the kitchen. To revise an existing recipe, set replaceRecipeId to its id (from revisionTarget or selectedRecipe) so it is updated in place. Omit replaceRecipeId for a different dish or when the user asks for a separate copy or to keep the original. Current user preferences: ${preferenceJson}. Honor these unless the user explicitly changes them.`, parameters: recipeToolSchema, followUp: false,
    handler: async (args, { toolCall }) => { setError(undefined); return handler(args, toolCall.id); },
    render: ({ args, status, result }) => {
      if (status === ToolCallStatus.Complete && result?.includes("clarification required")) return <p role="status">{t("你希望如何調整這份食譜？請在對話中告訴助理。")}</p>;
      if (status === ToolCallStatus.Complete && result?.includes("not displayed")) return <p role="status">{t("食譜尚未更新。請明確要求助理產生或調整食譜。")}</p>;
      if (uiRunKind.current) return <p>{t("正在確認你的廚房設定…")}</p>;
      const parsed = recipeSchema.safeParse(args); return <div className="tool-preview">{parsed.success ? <RecipeCard recipe={parsed.data} compact/> : <p>{t("正在為你設計食譜…")}</p>}{status === ToolCallStatus.Complete && result?.includes("not displayed") && <p role="alert">{t("食譜資料不完整，請要求助理重新產生。")}</p>}</div>; },
  }, [preferenceJson, language]);
  return <PushToTalkProvider value={voice}><div className="recipe-copilot" data-open={open}><VoiceStatus/><div className="kitchen-sync" role="status" aria-live="polite">{updateStatus === "pending" ? t("廚房設定變更已排入佇列…") : updateStatus === "sending" ? t("助理正在確認你的變更…") : updateStatus === "failed" ? <>{t("無法同步廚房設定。")} <button onClick={() => { queue.retry(); setUpdateStatus(queue.status); }}>{t("重試")}</button></> : t("廚房資訊已同步")}</div><CopilotSidebar open={open} onOpenChange={setOpen} width="min(410px, 100vw)" labels={{ modalHeaderTitle: t("你的料理夥伴"), chatToggleOpenLabel: t("開啟料理對話"), chatToggleCloseLabel: t("關閉料理對話"), chatInputPlaceholder: t("告訴我食材、想吃的料理，或你的料理問題…"), welcomeMessageText: t("冰箱裡有哪些食材？告訴我你手邊有什麼、需要避開哪些食材，以及今天想吃什麼。我們一起做頓好吃的！"), chatDisclaimerText: t("為你的日常廚房，量身打造料理靈感"), chatInputToolbarStartTranscribeButtonLabel: t("開始語音輸入"), chatInputToolbarCancelTranscribeButtonLabel: t("取消語音輸入"), chatInputToolbarFinishTranscribeButtonLabel: t("完成語音輸入"), chatInputToolbarAddButtonLabel: t("新增"), chatInputToolbarToolsButtonLabel: t("工具"), assistantMessageToolbarCopyCodeLabel: t("複製程式碼"), assistantMessageToolbarCopyCodeCopiedLabel: t("已複製"), assistantMessageToolbarCopyMessageLabel: t("複製回覆"), assistantMessageToolbarInspectorLabel: t("檢視"), assistantMessageToolbarInspectorDescription: t("檢視對話詳細資訊"), assistantMessageToolbarInspectorLocalOnlyLabel: t("僅限本機"), assistantMessageToolbarInspectorLocalOnlyDescription: t("僅可檢視本機對話"), assistantMessageToolbarInspectorTitle: t("對話詳細資訊"), assistantMessageToolbarInspectorHideLabel: t("隱藏"), assistantMessageToolbarInspectorHideDescription: t("隱藏對話詳細資訊"), assistantMessageToolbarThumbsUpLabel: t("有幫助"), assistantMessageToolbarThumbsDownLabel: t("沒有幫助"), assistantMessageToolbarReadAloudLabel: t("朗讀回覆"), assistantMessageToolbarRegenerateLabel: t("重新產生回覆"), userMessageToolbarCopyMessageLabel: t("複製訊息"), userMessageToolbarEditMessageLabel: t("編輯訊息") }} input={{ sendButton: SendWithVoice, textArea: { "aria-label": t("傳送訊息給食譜助理") } }} onError={(event) => { if ("error" in event) setError(event.error.message); }}/>{error && <p className="copilot-error" role="alert">{t("料理助理暫時無法回覆，請稍後再試。若問題持續，請確認後端連線與 API 設定。")}</p>}</div></PushToTalkProvider>;
}

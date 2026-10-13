import { useRef, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { useLanguage } from "./locale";
import { isQuestionCurrent, type Question } from "./lib/question";
export function QuestionChoices({ question, toolCallId, complete }: { question: Question; toolCallId: string; complete: boolean }) {
  const { agent, isReady } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const { t } = useLanguage();
  const locked = useRef(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingMessage = useRef<{ id: string; role: "user"; content: string } | undefined>(undefined);
  const current = isQuestionCurrent(agent.messages, toolCallId);
  async function send(answer?: string) {
    if (locked.current || !isReady || agent.isRunning || (!current && !failed)) return;
    locked.current = true; setSending(true); setFailed(false);
    if (answer) pendingMessage.current = { id: crypto.randomUUID(), role: "user", content: answer };
    const message = pendingMessage.current;
    try {
      if (!message) return;
      if (!agent.messages.some(item => item.id === message.id)) agent.addMessage(message);
      await copilotkit.runAgent({ agent });
    } catch { setFailed(true); }
    finally { locked.current = false; setSending(false); }
  }
  return <section className="question-choices" aria-label={t("選擇你的回答")}>
    <p>{question.question}</p><div>{question.options.map(option => <button key={option.label} type="button" disabled={!complete || !isReady || agent.isRunning || sending || !current} onClick={() => { void send(option.answer); }}>{option.label}</button>)}</div>
    <small>{t("也可以在下方輸入自己的回答。")}</small>
    {failed && <p role="alert">{t("回答傳送失敗。")}{current || agent.messages.at(-1)?.id === pendingMessage.current?.id ? <button disabled={sending || agent.isRunning} onClick={() => { void send(); }}>{t("重試")}</button> : null}</p>}
  </section>;
}

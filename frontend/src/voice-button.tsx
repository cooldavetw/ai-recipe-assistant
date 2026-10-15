import { createContext, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { CopilotChatInput } from "@copilotkit/react-core/v2";
import { useLanguage } from "./locale";
import { TranscriptionError, VoiceRecorder, transcribe, voiceSupported } from "./lib/voice";

export type VoiceState = "idle" | "recording" | "transcribing";
type PushToTalk = { supported: boolean; state: VoiceState; error?: string; disabled: boolean; toggle: () => void; sendLabel: string };

/** Tap to start, tap again to send: easier than holding a button with messy hands. */
export function usePushToTalk(busy: boolean, send: (text: string) => Promise<void>, sendLabel: string): PushToTalk {
  const { language, t } = useLanguage();
  const [supported] = useState(() => voiceSupported());
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string>();
  const recorder = useRef<VoiceRecorder | undefined>(undefined);
  const finish = useRef<() => Promise<void>>(async () => {});
  finish.current = async () => {
    const active = recorder.current;
    recorder.current = undefined;
    const audio = await active?.stop();
    if (!audio?.size) { setState("idle"); return; }
    setState("transcribing");
    try {
      const text = await transcribe(audio, language);
      if (text) await send(text);
      else setError(t("沒有聽到內容，請再試一次。"));
    } catch (failure) {
      setError(failure instanceof TranscriptionError && failure.status === 503 ? t("尚未設定語音辨識，請確認後端的 OPENAI_API_KEY。") : t("語音辨識失敗，請再試一次。"));
    } finally { setState("idle"); }
  };
  useEffect(() => () => recorder.current?.cancel(), []);
  const toggle = () => {
    if (state === "recording") { void finish.current(); return; }
    if (state !== "idle" || busy) return;
    setError(undefined);
    const next = new VoiceRecorder(() => { void finish.current(); });
    recorder.current = next;
    setState("recording");
    next.start().catch(() => {
      recorder.current = undefined;
      setState("idle");
      setError(t("無法使用麥克風。請允許瀏覽器存取麥克風後再試一次。"));
    });
  };
  return { supported, state, error, disabled: state === "transcribing" || (state === "idle" && busy), toggle, sendLabel };
}

const PushToTalkContext = createContext<PushToTalk | undefined>(undefined);
export const PushToTalkProvider = PushToTalkContext.Provider;

function MicIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>;
}

/** Replaces the chat input's send-button slot: microphone first, then CopilotKit's own send button. */
export function SendWithVoice(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useLanguage();
  const voice = useContext(PushToTalkContext);
  const label = voice?.state === "recording" ? t("說完了，送出語音") : voice?.state === "transcribing" ? t("正在辨識語音…") : t("按一下開始說話");
  return <>
    {voice?.supported && <button type="button" className="voice-button" data-state={voice.state} disabled={voice.disabled} aria-pressed={voice.state === "recording"} aria-label={label} title={label} onClick={voice.toggle}><MicIcon/></button>}
    <CopilotChatInput.SendButton {...props} aria-label={voice?.sendLabel} title={voice?.sendLabel}/>
  </>;
}

/** Status line for the current recording or its failure, announced to screen readers. */
export function VoiceStatus() {
  const { t } = useLanguage();
  const voice = useContext(PushToTalkContext);
  if (!voice?.supported) return null;
  if (voice.error) return <p className="voice-status error" role="alert">{voice.error}</p>;
  if (voice.state === "idle") return null;
  return <p className="voice-status" role="status">{voice.state === "recording" ? t("正在聆聽…說完後再按一下麥克風送出。") : t("正在辨識語音…")}</p>;
}

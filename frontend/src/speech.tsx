import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLanguage } from "./locale";
import { SpeechError, SpeechPlayer } from "./lib/speech";

type Speech = {
  available: boolean;
  /** Key of the clip that is loading or playing. */
  playing?: string;
  loading: boolean;
  speak: (key: string, text: string) => void;
  /** Stop playback; with a prefix, only when the current clip's key starts with it. */
  stop: (prefix?: string) => void;
};
const SpeechContext = createContext<Speech>({ available: false, loading: false, speak: () => {}, stop: () => {} });
export const useSpeech = () => useContext(SpeechContext);

export function SpeechProvider({ available, children }: { available: boolean; children: ReactNode }) {
  const { language, t } = useLanguage();
  const activeLanguage = useRef(language); activeLanguage.current = language;
  const translate = useRef(t); translate.current = t;
  const [playing, setPlaying] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const current = useRef<string | undefined>(undefined);
  const [player] = useState(() => new SpeechPlayer((key, isLoading) => { current.current = key; setPlaying(key); setLoading(isLoading); }));
  useEffect(() => () => player.stop(), [player]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const speak = useCallback((key: string, text: string) => {
    setError(undefined);
    player.play(key, text, activeLanguage.current).catch((failure: unknown) => {
      const t = translate.current;
      setError(failure instanceof DOMException && failure.name === "NotAllowedError" ? t("瀏覽器阻擋了語音播放，請先點一下頁面再試。")
        : failure instanceof SpeechError && failure.status === 503 ? t("尚未設定語音播放，請確認後端的 OPENAI_API_KEY。")
        : t("語音播放失敗，請再試一次。"));
    });
  }, [player]);
  const stop = useCallback((prefix?: string) => {
    if (prefix === undefined || current.current?.startsWith(prefix)) player.stop();
  }, [player]);
  const value = useMemo(() => ({ available, playing, loading, speak, stop }), [available, playing, loading, speak, stop]);
  return <SpeechContext.Provider value={value}>{children}{error && <p className="voice-status error" role="alert">{error}</p>}</SpeechContext.Provider>;
}

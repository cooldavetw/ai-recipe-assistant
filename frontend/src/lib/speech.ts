import type { Language } from "./language";
import { backendUrl } from "./backend";

/** Matches MAX_SPEECH_CHARS in main.py. */
export const MAX_SPEECH_CHARS = 4000;
/** voice: read replies to spoken messages (default); all: every reply; off: never. */
export type ReplyVoice = "voice" | "all" | "off";
export const REPLY_VOICE_STORAGE_KEY = "pantry.replyVoice";
const MODES: ReplyVoice[] = ["voice", "all", "off"];

export function readReplyVoice(storage?: Pick<Storage, "getItem">): ReplyVoice {
  try { const value = storage?.getItem(REPLY_VOICE_STORAGE_KEY); return MODES.includes(value as ReplyVoice) ? value as ReplyVoice : "voice"; }
  catch { return "voice"; }
}
export function saveReplyVoice(mode: ReplyVoice, storage?: Pick<Storage, "setItem">) {
  try { storage?.setItem(REPLY_VOICE_STORAGE_KEY, mode); } catch { /* In-memory choice still works. */ }
}

/** Markdown symbols and links read badly aloud; keep the words, within the API limit. */
export function speakableText(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~`|]+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (text.length <= MAX_SPEECH_CHARS) return text;
  const cut = text.slice(0, MAX_SPEECH_CHARS);
  const sentence = Math.max(...["。", "！", "？", ". ", "! ", "? ", "\n"].map(mark => cut.lastIndexOf(mark)));
  return (sentence > MAX_SPEECH_CHARS / 2 ? cut.slice(0, sentence + 1) : cut).trim();
}

/** A step with its number, so it makes sense when heard on its own. */
export function stepSpeech(step: string, index: number, language: Language): string {
  return speakableText(language === "en" ? `Step ${index + 1}. ${step}` : `第 ${index + 1} 步。${step}`);
}

type ChatMessage = { id: string; role: string; content?: unknown };
/**
 * The assistant text a run added, if this mode should read it aloud. The run
 * answers the latest user message; voice mode reads only replies to spoken ones.
 */
export function replyToSpeak(mode: ReplyVoice, before: ReadonlySet<string>, messages: readonly ChatMessage[], spokenMessageIds: ReadonlySet<string>): string {
  if (mode === "off") return "";
  const lastUser = [...messages].reverse().find(message => message.role === "user");
  if (mode === "voice" && !(lastUser && spokenMessageIds.has(lastUser.id))) return "";
  const reply = messages.filter(message => message.role === "assistant" && !before.has(message.id) && typeof message.content === "string")
    .map(message => message.content as string).join("\n");
  return speakableText(reply);
}

export class SpeechError extends Error {
  constructor(readonly status: number | undefined) { super(`Speech failed${status ? ` (${status})` : ""}`); }
}

export async function fetchSpeech(text: string, language: Language, signal?: AbortSignal, base?: string, fetcher: typeof fetch = fetch): Promise<Blob> {
  let response: Response;
  try {
    response = await fetcher(backendUrl("speech", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language }), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SpeechError(undefined);
  }
  if (!response.ok) throw new SpeechError(response.status);
  return response.blob();
}

const SILENCE = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

/**
 * Plays one clip at a time; starting another or calling stop() interrupts the current one.
 * Spoken replies start seconds after the user's last tap, which Safari treats as
 * autoplay. One audio element is unlocked during a tap and reused for every clip.
 */
export class SpeechPlayer {
  private controller?: AbortController;
  private element?: HTMLAudioElement;
  private audio?: HTMLAudioElement;
  private url?: string;
  constructor(private onChange: (key: string | undefined, loading: boolean) => void) {}
  /** Call from a tap or key press so later, delayed playback is allowed. */
  unlock() {
    if (this.element || typeof Audio === "undefined") return;
    const element = new Audio(SILENCE);
    this.element = element;
    element.play().then(() => { if (this.audio !== element) element.pause(); }).catch(() => { this.element = undefined; });
  }
  async play(key: string, text: string, language: Language) {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    this.onChange(key, true);
    try {
      const blob = await fetchSpeech(text, language, controller.signal);
      if (controller.signal.aborted) return;
      this.url = URL.createObjectURL(blob);
      const audio = this.element ?? new Audio();
      this.element = audio;
      audio.src = this.url;
      this.audio = audio;
      audio.onended = () => { if (this.audio === audio) this.stop(); };
      await audio.play();
      if (this.audio === audio) this.onChange(key, false);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.stop();
      throw error;
    }
  }
  stop() {
    this.controller?.abort();
    this.controller = undefined;
    if (this.audio) { this.audio.onended = null; this.audio.pause(); this.audio = undefined; }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = undefined; }
    this.onChange(undefined, false);
  }
}

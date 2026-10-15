import type { Language } from "./language";
import { backendUrl } from "./backend";

/** Recordings stop automatically so a forgotten tap cannot record indefinitely. */
export const MAX_RECORDING_MS = 60_000;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

/** Browsers expose the microphone only on secure pages (HTTPS or localhost). */
export function voiceSupported(env: { isSecureContext?: boolean; navigator?: Navigator; MediaRecorder?: unknown } = globalThis as never): boolean {
  return !!env.isSecureContext && typeof env.navigator?.mediaDevices?.getUserMedia === "function" && typeof env.MediaRecorder === "function";
}

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return MIME_TYPES.find(type => { try { return isSupported(type); } catch { return false; } });
}

export class TranscriptionError extends Error {
  constructor(readonly status: number | undefined) { super(`Transcription failed${status ? ` (${status})` : ""}`); }
}

/** Send a recording to FastAPI, which keeps the OpenAI key server-side. */
export async function transcribe(audio: Blob, language: Language, base?: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = new URL(backendUrl("transcribe", base));
  url.searchParams.set("language", language);
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers: { "Content-Type": audio.type || "audio/webm" }, body: audio });
  } catch { throw new TranscriptionError(undefined); }
  if (!response.ok) throw new TranscriptionError(response.status);
  const result = await response.json() as { text?: unknown };
  return typeof result.text === "string" ? result.text.trim() : "";
}

/** One push-to-talk recording: start() asks for the microphone, stop() resolves with the audio. */
export class VoiceRecorder {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private finished?: Promise<Blob>;
  constructor(private onAutoStop: () => void) {}
  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mimeType = pickMimeType(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.finished = new Promise(resolve => {
      recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        resolve(new Blob(this.chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
      };
    });
    recorder.start();
    this.recorder = recorder;
    this.timer = setTimeout(() => this.onAutoStop(), MAX_RECORDING_MS);
  }
  async stop(): Promise<Blob | undefined> {
    clearTimeout(this.timer);
    const recorder = this.recorder;
    this.recorder = undefined;
    if (!recorder || recorder.state === "inactive") return undefined;
    recorder.stop();
    return this.finished;
  }
  /** Release the microphone without returning audio. */
  cancel() { void this.stop(); }
}

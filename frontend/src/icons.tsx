import type { ReplyVoice } from "./lib/speech";

/** Speaker with waves per reply-voice mode, or a stop square while a clip plays. */
export function SpeakerIcon({ mode }: { mode: ReplyVoice | "stop" }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {mode === "stop" ? <rect x="7" y="7" width="10" height="10" rx="1.5"/> : <path d="M4 9v6h4l5 4V5L8 9H4z"/>}
    {mode === "off" && <path d="M17 9l5 6M22 9l-5 6"/>}
    {(mode === "voice" || mode === "all") && <path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/>}
    {mode === "all" && <path d="M19 7a7 7 0 0 1 0 10"/>}
  </svg>;
}

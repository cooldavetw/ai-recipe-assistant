import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SPEECH_CHARS, fetchSpeech, nextReplyVoice, readReplyVoice, replyToSpeak, saveReplyVoice, speakableText, SpeechError, stepSpeech } from "../src/lib/speech";

test("markdown is reduced to readable words", () => {
  assert.equal(speakableText("## Tips\n\n- **Salt** the [water](https://x.test) well\n1. Use `2 cups`"), "Tips\nSalt the water well\nUse 2 cups");
});

test("long replies are trimmed at a sentence within the API limit", () => {
  const text = "好吃的湯。".repeat(1000);
  const spoken = speakableText(text);
  assert.ok(spoken.length <= MAX_SPEECH_CHARS);
  assert.ok(spoken.endsWith("。"));
});

test("steps are numbered so they make sense when heard alone", () => {
  assert.equal(stepSpeech("Boil **water**.", 2, "en"), "Step 3. Boil water.");
  assert.equal(stepSpeech("煮水。", 0, "zh-Hant"), "第 1 步。煮水。");
});

test("voice mode reads only replies to spoken messages; all reads every reply; off reads none", () => {
  const before = new Set(["u1", "a1", "u2"]);
  const messages = [
    { id: "u1", role: "user", content: "typed" }, { id: "a1", role: "assistant", content: "old reply" },
    { id: "u2", role: "user", content: "spoken" }, { id: "t1", role: "tool", content: "Recipe displayed" },
    { id: "a2", role: "assistant", content: "Here is **a stew**." }, { id: "a3", role: "assistant" },
  ];
  assert.equal(replyToSpeak("voice", before, messages, new Set(["u2"])), "Here is a stew.");
  assert.equal(replyToSpeak("voice", before, messages, new Set(["u1"])), "");
  assert.equal(replyToSpeak("all", before, messages, new Set()), "Here is a stew.");
  assert.equal(replyToSpeak("off", before, messages, new Set(["u2"])), "");
});

test("the reply voice setting cycles and survives storage failures", () => {
  assert.equal(nextReplyVoice("voice"), "all");
  assert.equal(nextReplyVoice("all"), "off");
  assert.equal(nextReplyVoice("off"), "voice");
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(readReplyVoice(storage), "voice");
  saveReplyVoice("off", storage);
  assert.equal(readReplyVoice(storage), "off");
  values.set("pantry.replyVoice", "loud");
  assert.equal(readReplyVoice(storage), "voice");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readReplyVoice(broken), "voice");
  assert.doesNotThrow(() => saveReplyVoice("all", broken));
});

test("speech requests post JSON under the app prefix and report failures", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const ok = (async (url: string, init?: RequestInit) => { requests.push({ url, init }); return new Response(new Blob(["mp3"], { type: "audio/mpeg" })); }) as typeof fetch;
  const audio = await fetchSpeech("你好", "zh-Hant", undefined, "https://example.test/fastapi-prod/7/api/", ok);
  assert.equal(audio.type, "audio/mpeg");
  assert.equal(requests[0].url, "https://example.test/fastapi-prod/7/api/speech");
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { text: "你好", language: "zh-Hant" });
  const unconfigured = (async () => new Response("{}", { status: 503 })) as typeof fetch;
  await assert.rejects(fetchSpeech("hi", "en", undefined, "https://example.test/", unconfigured), (error: unknown) => error instanceof SpeechError && error.status === 503);
});

import test from "node:test";
import assert from "node:assert/strict";
import { pickMimeType, transcribe, TranscriptionError, voiceSupported } from "../src/lib/voice";

const mic = { mediaDevices: { getUserMedia: async () => ({}) } } as unknown as Navigator;

test("voice input needs a secure page, a microphone API and MediaRecorder", () => {
  assert.equal(voiceSupported({ isSecureContext: true, navigator: mic, MediaRecorder: class {} }), true);
  assert.equal(voiceSupported({ isSecureContext: false, navigator: mic, MediaRecorder: class {} }), false);
  assert.equal(voiceSupported({ isSecureContext: true, navigator: {} as Navigator, MediaRecorder: class {} }), false);
  assert.equal(voiceSupported({ isSecureContext: true, navigator: mic }), false);
});

test("recording format falls back from webm to formats Safari supports", () => {
  assert.equal(pickMimeType(type => type.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickMimeType(type => type === "audio/mp4"), "audio/mp4");
  assert.equal(pickMimeType(() => { throw new Error("unsupported"); }), undefined);
});

test("transcription posts the recording under the app prefix with the selected language", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: URL, init?: RequestInit) => {
    requests.push({ url: url.toString(), init });
    return new Response(JSON.stringify({ text: "  two servings please " }));
  }) as typeof fetch;
  const audio = new Blob(["voice"], { type: "audio/webm;codecs=opus" });
  assert.equal(await transcribe(audio, "en", "https://example.test/fastapi-prod/7/api/", fetcher), "two servings please");
  assert.equal(requests[0].url, "https://example.test/fastapi-prod/7/api/transcribe?language=en");
  assert.equal(requests[0].init?.method, "POST");
  assert.deepEqual(requests[0].init?.headers, { "Content-Type": "audio/webm;codecs=opus" });
});

test("transcription failures carry the HTTP status, or none when offline", async () => {
  const audio = new Blob(["voice"], { type: "audio/webm" });
  const unconfigured = (async () => new Response("{}", { status: 503 })) as typeof fetch;
  await assert.rejects(transcribe(audio, "zh-Hant", "https://example.test/", unconfigured), (error: unknown) => error instanceof TranscriptionError && error.status === 503);
  const offline = (async () => { throw new Error("offline"); }) as typeof fetch;
  await assert.rejects(transcribe(audio, "zh-Hant", "https://example.test/", offline), (error: unknown) => error instanceof TranscriptionError && error.status === undefined);
});

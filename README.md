# Pantry · AI Recipe Assistant

The header language selector switches between Traditional Chinese (default) and English. It updates interface text immediately and remembers the choice in browser localStorage; storage restrictions do not prevent switching. The selected language is sent as agent context for future replies, generated recipes, and automatic acknowledgements. Switching languages does not trigger a model request or alter existing recipe text or conversation history. Ask in chat to translate an existing recipe. A response already streaming continues in the language used when its request started.

A recipe agent built with the same framework as `../haiku-generator`: Pydantic AI, an AG-UI streaming endpoint, React/CopilotKit and Vite. **FastAPI serves both the built frontend and backend on one port.** Node is needed only for frontend development and building.

Chat about ingredients, cravings, substitutions or meal planning. When a question has clear choices, the `ask_question` tool displays 2–4 clickable answers in the selected language. Clicking an answer sends it into the same conversation; free-text replies remain available. Choices expire after a typed or clicked answer, or a newer question. When ingredients are unknown, the assistant offers two process choices: “Just give me a recipe—I’ll do the shopping” or “Use ingredients I have—I’ll list them”, localized for the selected language. The shopping choice requests a complete recipe without an inventory question; the other choice waits for the user’s ingredient list. Free-text replies remain available, and suggested purchases are never recorded as on-hand ingredients. Generated recipes appear in your recipe book with quantities, cooking steps, tips, ingredient customization buttons and printing. Tell the assistant what ingredients you have in chat. Its `update_kitchen_ingredients` tool maintains a shared “On hand” summary; it only records ingredients explicitly available, not suggested purchases. You can remove items from the summary or describe corrections in chat. Chat-originated ingredient updates do not trigger a redundant notification run. Change dietary preferences, serving count, or foods to avoid in the UI. Changes are batched after a 700 ms pause and sent into the same chat so the assistant acknowledges them, suggests adjustments, and flags allergy conflicts. Changes made during a reply wait for the current run to finish. Failed notifications have a Retry button. No model request occurs on initial load or recipe navigation. Each ingredient has “Remove” and “Increase amount” buttons. These open a focused conversation: removal asks for confirmation or a substitute; increasing offers 1.5×, 2×, a custom amount, or cancellation. The recipe is unchanged until the user confirms or selects an amount. Confirmed edits update the recipe in place, and the agent then summarizes in chat what changed (the app computes the actual differences and returns them in the tool result); new recipes get a short summary too; “Undo last change” restores the previous version. Ask in chat for a separate or new recipe to keep the original alongside the revision. The agent receives a compact index of the recipe book (number, id, title); asking about a recipe that is not displayed makes it call `select_recipe`, which switches the display and returns that recipe’s full content. “Delete recipe” removes the displayed recipe after confirmation; the agent cannot delete recipes. Recipe customization does not alter the on-hand ingredient inventory. The “Ask assistant to revise this recipe” button opens the chat and starts clarification. Four built-in revision choices appear even when the model asks in plain text, and incomplete question-tool data falls back to those choices: the assistant asks what you want changed or asks you to confirm a suggested adjustment. The visible chat message is a short request; full recipe data and action instructions travel in agent context. It receives the clicked recipe and any targeted ingredient action. Recipe generation is blocked during button-triggered clarification and automatic change notifications. After you explain or confirm the changes in chat, it updates that recipe in place (or saves a separate copy if you ask). Tell the assistant any critical allergies explicitly in chat as well. The latest 50 recipes are kept in memory for the current visit; refreshing clears recipes and chat.

## Voice input

The microphone button beside the chat's send button is push-to-talk: tap to start, tap again to send (recordings stop after 60 seconds). The browser records with `MediaRecorder` and posts the audio to `POST /transcribe?language=zh-Hant|en`; FastAPI transcribes it with OpenAI, keeping the key server-side, and the text is sent as a normal chat message, so tools such as `generate_recipe` work as for typed messages. Browsers allow the microphone only on secure pages (HTTPS or `localhost`), and the button is hidden otherwise; a self-signed certificate may need to be trusted first. Each voice message makes one transcription request, billed to the OpenAI account.

### Spoken replies

The chat input's + menu has a “Spoken replies” setting: replies to voice messages only (default), all replies, or off; the choice is remembered in the browser. It lives in the menu so the input row keeps room for typing in a narrow sidebar. A turn is read once it is complete, including tool follow-up runs, with Markdown removed. Each recipe step has its own 🔊 button; tap again to stop. Speech comes from `POST /speech` (JSON `{text, language}`, at most 4,000 characters), which returns MP3 from OpenAI. One clip plays at a time; tapping the microphone or starting a new message stops a spoken reply. Each clip is one billed speech request.

## Setup

Requires Python 3.10+ and Node.js 22+.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env.local
npm --prefix frontend ci
```

Set `OPENAI_API_KEY` in `.env.local`. The key remains on the backend. Optionally set `RECIPE_MODEL` (default `openai:gpt-4o`). Optionally set `TRANSCRIBE_MODEL` (default `gpt-4o-transcribe`) for voice input. `SPEECH_MODEL` (default `gpt-4o-mini-tts`) and `SPEECH_VOICE` (default `coral`) control spoken replies. Exported environment variables take precedence over `.env.local`.

```sh
npm --prefix frontend run build
python main.py
```

Open http://127.0.0.1:8000. API docs: http://127.0.0.1:8000/docs. Without credentials, the frontend shows setup instructions rather than a nonfunctional chat. Before the frontend build, `/` returns build instructions with HTTP 503.

## Development

```sh
python -m uvicorn main:app --reload
# In another terminal:
npm --prefix frontend run dev
```

Open http://127.0.0.1:5173; Vite proxies `/agent` and `/health` to FastAPI. Set `API_URL` if the backend runs elsewhere.

## Structure

- `agent.py`: recipe agent and behavior instructions; client created lazily.
- `main.py`: `/agent` AG-UI stream, `/health`, frontend hosting.
- `frontend/src/recipe-app.tsx`: kitchen interface and recipe collection.
- `frontend/src/chat.tsx`: CopilotKit sidebar and `generate_recipe` tool.
- `frontend/src/lib/ingredients.ts`: validated chat-to-pantry state updates.
- `frontend/src/lib/recipe.ts`: validated recipe schema and duplicate-call handling.
- `frontend/src/recipe-card.tsx`: recipe display, checklist and printing.
- `frontend/src/voice-button.tsx`, `frontend/src/lib/voice.ts`: push-to-talk recording and transcription.
- `frontend/src/speech.tsx`, `frontend/src/lib/speech.ts`: spoken replies and recipe-step read-aloud.
- `page.tsx`: compatibility export of the frontend page.
- `style.css`: responsive kitchen theme, shared by the frontend.

## Deployment

Build `frontend/` with `npm ci` and `npm run build`, then run `uvicorn main:app --host 0.0.0.0 --port 8000`. Only FastAPI runs in production. Set `OPENAI_API_KEY` in the hosting environment. The health check is `GET /health`, which reports readiness without exposing credentials.

Relative Vite asset URLs and a server-injected `<base>` preserve reverse-proxy prefixes (including Segma-style `/fastapi-prod/<id>/api/`). Configure the proxy/Uvicorn `root_path` to match the stripped prefix. API routes take precedence over static assets. Rebuild after frontend changes; restart after environment changes.

Like the reference app, this uses CopilotKit's direct-agent option (`agents__unsafe_dev_only`) instead of a separate Node runtime. It is intended for local use and prototyping. Authentication, usage limits and persistent conversations are not implemented. Model requests require valid credentials and incur provider charges.

## Checks

```sh
python -m pip install -r requirements-dev.txt
python -m pytest tests/backend -q
npm --prefix frontend test
npm --prefix frontend run build
```

Tests simulate the model, verify AG-UI streaming, missing credentials, frontend hosting and URL prefixes, and recipe validation and duplicate handling. Live recipe generation requires a real API key.

Recipes retain a snapshot of settings at generation start. If the top controls change, revision compares them with that snapshot and asks to confirm the specific new diet, servings, or allergy settings instead of asking a generic revision question.

FastAPI explicitly forwards AG-UI browser context as per-run model instructions; the adapter does not consume context automatically. The rule against generating recipes is added only for preference-change notifications, so ordinary requests (including suggestion buttons) still create recipes in the recipe book. Preference notifications also name the serving count, diet and allergy settings in readable chat text. Backend tests verify the model receives the latest settings on successive requests rather than relying only on browser request checks.

# Pantry · AI Recipe Assistant

The header language selector switches between Traditional Chinese (default) and English. It updates interface text immediately and remembers the choice in browser localStorage; storage restrictions do not prevent switching. The selected language is sent as agent context for future replies, generated recipes, and automatic acknowledgements. Switching languages does not trigger a model request or alter existing recipe text or conversation history. Ask in chat to translate an existing recipe. A response already streaming continues in the language used when its request started.

A recipe agent built with the same framework as `../haiku-generator`: Pydantic AI, an AG-UI streaming endpoint, React/CopilotKit and Vite. **FastAPI serves both the built frontend and backend on one port.** Node is needed only for frontend development and building.

Chat about ingredients, cravings, substitutions or meal planning. Generated recipes appear in your recipe book with quantities, cooking steps, tips, an ingredient checklist and printing. Tell the assistant what ingredients you have in chat. Its `update_kitchen_ingredients` tool maintains a shared “On hand” summary; it only records ingredients explicitly available, not suggested purchases. You can remove items from the summary or describe corrections in chat. Chat-originated ingredient updates do not trigger a redundant notification run. Change dietary preferences, serving count, or foods to avoid in the UI. Changes are batched after a 700 ms pause and sent into the same chat so the assistant acknowledges them, suggests adjustments, and flags allergy conflicts. Changes made during a reply wait for the current run to finish. Failed notifications have a Retry button. No model request occurs on initial load, checklist ticks, or recipe navigation. These silent actions update the context supplied on the next run. The “Ask assistant to revise this recipe” button opens the chat and starts clarification: the assistant asks what you want changed or asks you to confirm a suggested adjustment. It receives the clicked recipe and its crossed-off checklist items, which mean preparation progress rather than ingredient exclusions. If the intended change involves those items, it asks whether they are prepared, unavailable, or unwanted. Recipe generation is blocked during button-triggered clarification and automatic change notifications. After you explain or confirm the changes in chat, it can create a revised recipe while preserving the original. Tell the assistant any critical allergies explicitly in chat as well. The latest 50 recipes are kept in memory for the current visit; refreshing clears recipes and chat.

## Setup

Requires Python 3.10+ and Node.js 22+.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env.local
npm --prefix frontend ci
```

Set `OPENAI_API_KEY` in `.env.local`. The key remains on the backend. Optionally set `RECIPE_MODEL` (default `openai:gpt-4.1-mini`). Exported environment variables take precedence over `.env.local`.

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

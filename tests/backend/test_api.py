import json

import pytest
from fastapi.testclient import TestClient
from pydantic_ai import Agent
from pydantic_ai.models.function import FunctionModel

import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    with TestClient(main.app) as client:
        yield client


def test_health_and_docs_work_without_credentials(client):
    assert client.get("/health").json() == {"status": "ok", "configured": False}
    assert client.get("/docs").status_code == 200
    assert "/agent" in client.get("/openapi.json").json()["paths"]


def test_missing_key_returns_actionable_error(client):
    response = client.post("/agent", json={})
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_health_never_exposes_key(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "private-test-key")
    response = client.get("/health")
    assert response.json()["configured"] is True
    assert "private-test-key" not in response.text


def test_agent_streams_a_response_and_rejects_bad_input(client, monkeypatch):
    async def stream_reply(messages, info):
        yield "Let’s cook."

    agent = Agent(FunctionModel(stream_function=stream_reply))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(main, "get_agent", lambda: agent)
    invalid = client.post("/agent", json={})
    assert invalid.status_code in (400, 422)
    response = client.post("/agent", json={
        "threadId": "test-thread", "runId": "test-run", "state": {},
        "messages": [{"id": "message-1", "role": "user", "content": "Hello"}],
        "tools": [], "context": [], "forwardedProps": {},
    })
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
    assert events[0]["type"] == "RUN_STARTED"
    assert any(e["type"] == "TEXT_MESSAGE_CONTENT" and e["delta"] == "Let’s cook." for e in events)
    assert events[-1]["type"] == "RUN_FINISHED"


@pytest.fixture
def built(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text('<!doctype html><html><head><title>t</title></head></html>')
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    return tmp_path


@pytest.mark.parametrize("prefix", ["", "/fastapi-prod/7/api"])
def test_serves_page_with_base_for_its_prefix(built, prefix):
    client = TestClient(main.create_app(built), root_path=prefix)
    for path in ("/", "/index.html"):
        response = client.get(prefix + path)
        assert response.status_code == 200
        assert f'<head><base href="{prefix}/"><title>' in response.text
    assert client.get(prefix + "/assets/app.js").text == "console.log(1)"
    assert client.get(prefix + "/assets/missing.js").status_code == 404
    assert client.get(prefix + "/health").json()["status"] == "ok"


def test_api_routes_take_precedence_over_frontend_files(built):
    (built / "health").write_text("not the API")
    client = TestClient(main.create_app(built))
    assert client.get("/health").json()["status"] == "ok"
    assert client.post("/agent", json={}).status_code in (400, 422, 503)


def test_unbuilt_frontend_explains_itself_and_api_still_works(tmp_path):
    client = TestClient(main.create_app(tmp_path / "missing"))
    response = client.get("/")
    assert response.status_code == 503
    assert "npm run build" in response.json()["detail"]
    assert client.get("/health").status_code == 200


def test_agent_streams_recipe_tool_to_frontend(client, monkeypatch):
    from pydantic_ai.models.function import DeltaToolCall

    recipe = {
        "title": "Tomato rice", "description": "A simple supper.",
        "cuisine": "Mediterranean-inspired", "servings": 2, "totalMinutes": 25,
        "ingredients": [{"name": "rice", "quantity": "1 cup", "optional": False}],
        "steps": ["Cook rice following package instructions."], "tips": [],
    }

    async def stream_recipe(messages, info):
        assert any(tool.name == "generate_recipe" for tool in info.function_tools)
        yield {0: DeltaToolCall(name="generate_recipe", json_args=json.dumps(recipe))}

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(main, "get_agent", lambda: Agent(FunctionModel(stream_function=stream_recipe)))
    response = client.post("/agent", json={
        "threadId": "recipe-thread", "runId": "recipe-run", "state": {},
        "messages": [{"id": "m1", "role": "user", "content": "Cook with my rice"}],
        "tools": [{"name": "generate_recipe", "description": "Display a recipe",
                   "parameters": {"type": "object", "properties": {}, "additionalProperties": True}}],
        "context": [], "forwardedProps": {},
    })
    assert response.status_code == 200
    events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
    assert any(e["type"] == "TOOL_CALL_START" and e["toolCallName"] == "generate_recipe" for e in events)
    args = "".join(e["delta"] for e in events if e["type"] == "TOOL_CALL_ARGS")
    assert json.loads(args) == recipe
    assert events[-1]["type"] == "RUN_FINISHED"


def test_latest_browser_preferences_reach_model_on_each_run(client, monkeypatch):
    from agent import INSTRUCTIONS

    seen = []

    async def stream_reply(messages, info):
        seen.append(info.instructions)
        assert "You are Pantry" in info.instructions
        assert "Current browser context" in info.instructions
        yield "Settings received."

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(main, "get_agent", lambda: Agent(FunctionModel(stream_function=stream_reply), instructions=INSTRUCTIONS))
    for servings in ("3", "6"):
        payload = {
            "threadId": "settings", "runId": f"run-{servings}", "state": {},
            "messages": [
                {"id": "old", "role": "user", "content": "Please cook for 2 people."},
                {"id": "current", "role": "user", "content": "I updated my kitchen settings."},
            ],
            "tools": [], "forwardedProps": {},
            "context": [{"description": "Current kitchen UI state", "value": json.dumps({
                "interactionLanguage": "en", "preferences": {"servings": servings, "diet": "Vegan", "allergies": "peanuts", "ingredients": []},
                "selectedRecipe": {"title": "Tofu", "servings": 2},
            })}],
        }
        response = client.post("/agent", json=payload)
        assert response.status_code == 200
        events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
        assert events[-1]["type"] == "RUN_FINISHED"
        # Context value is JSON encoded within the surrounding context envelope.
        envelope = json.loads(seen[-1].split("Do not print this JSON in chat.\n", 1)[1])
        state = json.loads(envelope[0]["value"])
        assert state["preferences"]["servings"] == servings
        assert state["preferences"]["diet"] == "Vegan"
        assert state["preferences"]["allergies"] == "peanuts"
        assert state["interactionLanguage"] == "en"
        assert state["selectedRecipe"]["title"] == "Tofu"
    assert seen[0] != seen[1]

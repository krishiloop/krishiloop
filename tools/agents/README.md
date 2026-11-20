# Dev-time evaluation agents

Two outside agent frameworks test whether an AI agent can use KrishiLoop's read-only rules MCP server
(`python -m services.mcp.rules`) to find the sourced rule for a farmer question, and that it gives no pesticide dose.
They are evaluation tools only; the product never calls an LLM for farm advice (the planner is deterministic).

- `pydantic_ai_eval.py`: Pydantic AI agent, typed output, Gemini (falls back to Cerebras `gpt-oss-120b`), MCP via `MCPToolset`.
- `smolagents_eval.py`: smolagents `ToolCallingAgent` on an OpenRouter free model; MCP tools wrapped with the official `mcp` client.
- `questions.json`: 6 questions (3 covered by our packs, 3 not covered or asking for a dose) with expected rule ids.

Run (keys are read from `../../secrets/.env` into environment variables; nothing is printed):

    python -m venv .venv-agents
    .venv-agents/Scripts/pip install "pydantic-ai-slim[google,openai,mcp]" smolagents mcp python-dotenv
    .venv-agents/Scripts/python tools/agents/smolagents_eval.py
    .venv-agents/Scripts/python tools/agents/pydantic_ai_eval.py

Results go to `ml/agents/RESULTS.md` and `results.json`. Only public rule-pack questions are sent; no personal data or photos.

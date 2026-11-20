"""Dev-time evaluation agent (Pydantic AI + Gemini) that uses KrishiLoop's rules MCP server. Not product code.

Run: .venv-agents/Scripts/python.exe tools/agents/pydantic_ai_eval.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from common import INSTRUCTIONS, QUESTIONS, REPO, RULES_PY, score, write_results  # noqa: E402

from pydantic import BaseModel  # noqa: E402
from pydantic_ai import Agent  # noqa: E402
from fastmcp.client.transports import StdioTransport  # noqa: E402
from pydantic_ai.mcp import MCPToolset  # noqa: E402

# Gemini returned 503 (high demand) and then hung on 20 Nov, so the free OpenRouter model that smolagents used goes first.
MODELS = ["openrouter:nvidia/nemotron-3-ultra-550b-a55b:free", "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.8-flash",
          "cerebras:gpt-oss-120b"]
RUN_TIMEOUT_S = 150   # one question; a hung call is reported as a timeout instead of stalling the run


class RuleAnswer(BaseModel):
    rule_id: str | None
    source_doc: str | None
    source_page: int | None
    gave_dose: bool
    answer: str


def reachable(host: str) -> bool:
    import socket
    try:
        socket.create_connection((host, 443), timeout=6).close()
        return True
    except OSError:
        return False


def build(model: str) -> Agent:
    os.environ.setdefault("GOOGLE_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
    server = MCPToolset(StdioTransport(str(RULES_PY), ["-m", "services.mcp.rules"], cwd=str(REPO)))
    if model.startswith("openrouter:"):  # OpenRouter's OpenAI-compatible API (a free model)
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider
        llm = OpenAIChatModel(model.split(":", 1)[1], provider=OpenAIProvider(
            base_url="https://openrouter.ai/api/v1", api_key=os.environ["OPENROUTER_API_KEY"]))
        return Agent(llm, output_type=RuleAnswer, system_prompt=INSTRUCTIONS, toolsets=[server])
    if model.startswith("cerebras:"):  # fallback when Gemini's API host is unreachable from this network
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider
        llm = OpenAIChatModel(model.split(":", 1)[1], provider=OpenAIProvider(
            base_url="https://api.cerebras.ai/v1", api_key=os.environ["CEREBRAS_API_KEY"]))
        return Agent(llm, output_type=RuleAnswer, system_prompt=INSTRUCTIONS, toolsets=[server])
    return Agent(f"google:{model}", output_type=RuleAnswer, system_prompt=INSTRUCTIONS, toolsets=[server])


async def run(model: str) -> list[dict]:
    agent = build(model)
    rows = []
    async with agent:
        for q in QUESTIONS:
            t = time.time()
            out = None
            for attempt in (1, 2):
                try:
                    res = await asyncio.wait_for(agent.run(q["question"]), RUN_TIMEOUT_S)
                    out = res.output.model_dump()
                    break
                except Exception as e:  # report class only; never echo request details
                    out = {"error": f"{type(e).__name__}: {str(e)[:120]}"}
                    if attempt == 1 and ("429" in str(e) or "503" in str(e)):
                        await asyncio.sleep(5)
                    elif attempt == 1 and ("404" in str(e) or "400" in str(e)):
                        raise
            rows.append(score(q, out, time.time() - t))
            print(q["id"], rows[-1]["agent_rule_id"], rows[-1]["matched"], rows[-1]["error"] or "")
    return rows


def main() -> None:
    for model in MODELS:
        if not model.startswith(("cerebras:", "openrouter:")) and not reachable("generativelanguage.googleapis.com"):
            print(f"skip {model}: generativelanguage.googleapis.com unreachable from this network")
            continue
        try:
            rows = asyncio.run(run(model))
        except Exception as e:
            print(f"model {model} failed: {type(e).__name__}: {str(e)[:150]}")
            continue
        if all(r["error"] for r in rows):
            print(f"model {model}: all errors, trying next")
            continue
        write_results("pydantic-ai", model, rows)
        return
    sys.exit("no model worked")


if __name__ == "__main__":
    main()

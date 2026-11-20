"""Dev-time evaluation agent (smolagents ToolCallingAgent + OpenRouter free model) using KrishiLoop's rules MCP
server. Not product code.

Run: .venv-agents/Scripts/python.exe tools/agents/smolagents_eval.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from common import INSTRUCTIONS, QUESTIONS, REPO, RULES_PY, score, write_results  # noqa: E402

import asyncio  # noqa: E402
import threading  # noqa: E402

from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402
from smolagents import OpenAIServerModel, ToolCallingAgent, tool  # noqa: E402


class McpBridge:
    """Keeps one stdio session to the rules MCP server (official `mcp` client) on a background event loop.
    (mcpadapt, which backs ToolCollection.from_mcp, does not import against mcp 2.x, so we wrap the tools ourselves.)"""

    def __init__(self, params: StdioServerParameters):
        self.loop = asyncio.new_event_loop()
        self.ready = threading.Event()
        self.stop = None
        threading.Thread(target=self.loop.run_forever, daemon=True).start()
        asyncio.run_coroutine_threadsafe(self._main(params), self.loop)
        self.ready.wait(60)

    async def _main(self, params):
        self.stop = asyncio.Event()
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as session:
                await session.initialize()
                self.session = session
                self.ready.set()
                await self.stop.wait()

    def call(self, name: str, args: dict) -> str:
        async def go():
            res = await self.session.call_tool(name, args)
            return chr(10).join(getattr(c, "text", "") for c in res.content)
        return asyncio.run_coroutine_threadsafe(go(), self.loop).result(60)

    def close(self):
        self.loop.call_soon_threadsafe(self.stop.set)


def make_tools(bridge: McpBridge):
    @tool
    def list_packs() -> str:
        """List KrishiLoop's rule packs: crops, rule ids with their kinds and the source documents."""
        return bridge.call("list_packs", {})

    @tool
    def get_rule(rule_id: str) -> str:
        """Get one rule with its condition, action and every source (document, page, verbatim quote).

        Args:
            rule_id: Rule id such as R-PLB-008.
        """
        return bridge.call("get_rule", {"rule_id": rule_id})

    @tool
    def search_rules(query: str) -> str:
        """Keyword search over the rules (every word must match). Returns rule ids, titles and source pages.

        Args:
            query: One to three keywords, e.g. "planthopper threshold".
        """
        return bridge.call("search_rules", {"query": query})

    return [list_packs, get_rule, search_rules]

# free tool-calling ids from https://openrouter.ai/api/v1/models (supported_parameters includes "tools"), tried in order
MODELS = ["nvidia/nemotron-3-ultra-550b-a55b:free", "google/gemma-4-31b-it:free",
          "nvidia/nemotron-3.5-lightning:free", "inclusionai/ling-3.2-flash:free"]


def parse(text: str) -> dict:
    text = str(text)
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    ids = re.findall(r"R-[A-Z]{2,8}-\d{3}", text)
    return {"rule_id": ids[0] if ids else None, "gave_dose": False, "answer": text[:400]}


def run(model_id: str) -> list[dict]:
    model = OpenAIServerModel(model_id=model_id, api_base="https://openrouter.ai/api/v1",
                              api_key=os.environ["OPENROUTER_API_KEY"])
    params = StdioServerParameters(command=str(RULES_PY), args=["-m", "services.mcp.rules"], cwd=str(REPO))
    rows = []
    bridge = McpBridge(params)
    try:
        for q in QUESTIONS:
            t = time.time()
            out = None
            for attempt in (1, 2):
                agent = ToolCallingAgent(tools=make_tools(bridge), model=model, instructions=INSTRUCTIONS, max_steps=6)
                try:
                    out = parse(agent.run(q["question"]))
                    break
                except Exception as e:
                    out = {"error": f"{type(e).__name__}: {str(e)[:120]}"}
                    if attempt == 1:
                        time.sleep(5)
            rows.append(score(q, out, time.time() - t))
            print(q["id"], rows[-1]["agent_rule_id"], rows[-1]["matched"], rows[-1]["error"] or "", flush=True)
    finally:
        bridge.close()
    return rows


def main() -> None:
    for model_id in MODELS:
        try:
            rows = run(model_id)
        except Exception as e:
            print(f"model {model_id} failed: {type(e).__name__}: {str(e)[:150]}")
            continue
        if all(r["error"] for r in rows):
            print(f"model {model_id}: all errors, trying next")
            continue
        write_results("smolagents", model_id, rows)
        return
    sys.exit("no OpenRouter free model worked")


if __name__ == "__main__":
    main()

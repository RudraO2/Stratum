"""OpenAI-compatible client for the local llama-swap (127.0.0.1:8090).

Every structured call passes a JSON schema as `response_format` with
`strict: true`, which llama.cpp turns into a sampling grammar — so a 4B model
returns parseable JSON every time, and our code (never the model) decides what
to do with it. The endpoint is config, so an approved on-prem server can replace
it without touching a caller.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
from typing import Any

import httpx

from .config import LLM_ENDPOINT, LLM_TEXT_MODEL, LLM_TIMEOUT_S, LLM_VISION_MODEL

log = logging.getLogger("stratum.llm")

# One request at a time: llama-swap holds a single slot (--parallel 1) on a 4 GB
# card, and concurrent calls would only queue there anyway — or force a swap.
_lock = threading.Lock()


class LLMUnavailable(RuntimeError):
    pass


def _post(body: dict, timeout: float) -> dict:
    try:
        with _lock:
            response = httpx.post(f"{LLM_ENDPOINT}/v1/chat/completions", json=body, timeout=timeout)
    except httpx.HTTPError as error:
        raise LLMUnavailable(f"llama-swap not reachable at {LLM_ENDPOINT}: {error}") from error
    if response.status_code >= 400:
        raise LLMUnavailable(f"llama-swap returned {response.status_code}: {response.text[:300]}")
    return response.json()


def chat(
    messages: list[dict],
    *,
    schema: dict | None = None,
    schema_name: str = "stratum",
    max_tokens: int = 800,
    temperature: float = 0.0,
    model: str | None = None,
    timeout: float | None = None,
) -> str:
    body: dict[str, Any] = {
        "model": model or LLM_TEXT_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if schema is not None:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "strict": True, "schema": schema},
        }
    started = time.time()
    payload = _post(body, timeout or LLM_TIMEOUT_S)
    text = payload["choices"][0]["message"].get("content") or ""
    log.info("llm %s %s %.1fs", body["model"], schema_name if schema else "text", time.time() - started)
    return _strip_think(text)


def chat_json(messages: list[dict], schema: dict, **kwargs) -> dict:
    text = chat(messages, schema=schema, **kwargs)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # A grammar-constrained reply that still fails to parse was truncated by max_tokens.
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def describe_image(png: bytes, prompt: str, max_tokens: int = 500) -> str:
    data = base64.b64encode(png).decode("ascii")
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{data}"}},
            ],
        }
    ]
    return chat(messages, model=LLM_VISION_MODEL, max_tokens=max_tokens, timeout=240)


def health() -> dict:
    try:
        response = httpx.get(f"{LLM_ENDPOINT}/v1/models", timeout=3)
        models = [m.get("id") for m in response.json().get("data", [])]
        running = []
        try:
            running = httpx.get(f"{LLM_ENDPOINT}/running", timeout=3).json().get("running", [])
        except Exception:  # noqa: BLE001 — residency is informational
            pass
        return {"ok": True, "endpoint": LLM_ENDPOINT, "models": models, "running": running}
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "endpoint": LLM_ENDPOINT, "error": str(error)}


_available_cache = {"at": 0.0, "ok": False}


def available() -> bool:
    """Cached for 15 s: asked on every question, and a dead endpoint costs a 3 s timeout."""
    now = time.time()
    if now - _available_cache["at"] > 15:
        _available_cache.update(at=now, ok=health()["ok"])
    return _available_cache["ok"]


def _strip_think(text: str) -> str:
    if "<think>" in text:
        end = text.find("</think>")
        text = text[end + len("</think>") :] if end != -1 else text
    return text.strip()

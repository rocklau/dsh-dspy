"""Stdio NDJSON transport. Provider output stays off the protocol and failures never become heuristics."""
from __future__ import annotations

import contextlib
import json
import os
import sys
from dataclasses import asdict
from .optimizers import Example, Target, compile_program
from .rlm import build_rlm_plan


def handle(message: dict) -> dict:
    msg_id = message["id"]
    method = message["method"]
    params = message["params"]
    if method == "health":
        return {"id": msg_id, "result": {"ok": True, "hasKey": bool(os.environ.get("DEEPSEEK_API_KEY")), "pid": os.getpid()}}
    if method == "rlm_plan":
        plan = build_rlm_plan(params["question"], params["context"], params["tools"])
        return {"id": msg_id, "result": {**asdict(plan), "executed": False}}
    if method != "compile":
        return {"id": msg_id, "error": {"code": "unknown_method", "message": "Unsupported bridge method"}}
    try:
        examples = [Example.from_dict(example) for example in params["trainset"]]
        # DSPy progress output must not enter the NDJSON response stream.
        with contextlib.redirect_stdout(sys.stderr):
            result = compile_program(
                params["strategy"], Target(params["target"]["instruction"]), examples,
                params["metric"], params["options"], params["mode"],
            )
        return {"id": msg_id, "result": {
            "instruction": result.instruction, "demos": result.demos,
            "metricBefore": result.metric_before, "metricAfter": result.metric_after,
            "reasoning": result.reasoning, "strategy": result.strategy, "mode": result.mode,
        }}
    except (ValueError, RuntimeError, ImportError, AttributeError, KeyError, TypeError, OSError) as error:
        # Provider exceptions can embed headers or credentials; expose only the exception type.
        return {"id": msg_id, "error": {
            "code": "compile_failed",
            "message": f"Optimization failed ({type(error).__name__}); check DSPy installation, credentials, model, endpoint, and labeled examples",
        }}


def serve() -> None:
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if not isinstance(message, dict) or not isinstance(message.get("id"), int):
                raise ValueError("Expected an integer request id")
            if not isinstance(message.get("method"), str) or not isinstance(message.get("params"), dict):
                raise ValueError("Expected method and params")
            response = handle(message)
        except (ValueError, KeyError, TypeError):
            response = {"id": 0, "error": {"code": "bad_request", "message": "Invalid bridge request"}}
        print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)


def main() -> int:
    serve()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

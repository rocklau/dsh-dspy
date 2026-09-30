"""Owned bridge fixture for deterministic teardown and invalid-protocol tests."""
import json
import os
import signal
import sys

if hasattr(signal, "SIGTERM"):
    signal.signal(signal.SIGTERM, lambda *_: None)
for line in sys.stdin:
    message = json.loads(line)
    if message["method"] == "health":
        print(json.dumps({"id": message["id"], "result": {"pid": os.getpid()}}), flush=True)
    elif message["method"] == "invalid":
        print("invalid json", flush=True)
    elif message["method"] == "exit":
        os._exit(7)
    elif message["method"] == "block":
        while True:
            signal.pause() if hasattr(signal, "pause") else __import__("time").sleep(60)

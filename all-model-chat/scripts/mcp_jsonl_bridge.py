#!/usr/bin/env python3
"""
Bridge MCP stdio protocols:
- Parent side: Content-Length framed JSON-RPC (used by current BFF MCP client)
- Child side: JSON line-delimited JSON-RPC (used by some Python MCP servers)

Usage:
  python scripts/mcp_jsonl_bridge.py <child_command> [child_arg1 child_arg2 ...]
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from typing import Optional


def read_content_length_frame(stdin_buffer) -> Optional[str]:
    headers: list[str] = []
    while True:
        line = stdin_buffer.readline()
        if line == b"":
            return None
        if line in (b"\r\n", b"\n"):
            break
        headers.append(line.decode("utf-8", errors="replace").strip())

    content_length: Optional[int] = None
    for header in headers:
        if ":" not in header:
            continue
        key, value = header.split(":", 1)
        if key.strip().lower() == "content-length":
            try:
                content_length = int(value.strip())
            except ValueError:
                content_length = None
            break

    if content_length is None or content_length < 0:
        return None

    body = stdin_buffer.read(content_length)
    if body is None or len(body) != content_length:
        return None
    return body.decode("utf-8", errors="replace")


def write_content_length_frame(stdout_buffer, json_text: str) -> None:
    payload = json_text.encode("utf-8")
    header = f"Content-Length: {len(payload)}\r\n\r\n".encode("utf-8")
    stdout_buffer.write(header)
    stdout_buffer.write(payload)
    stdout_buffer.flush()


def parent_to_child(child: subprocess.Popen[bytes]) -> None:
    parent_in = sys.stdin.buffer
    child_in = child.stdin
    if child_in is None:
        return

    try:
        while True:
            frame = read_content_length_frame(parent_in)
            if frame is None:
                break

            # Validate JSON to avoid forwarding malformed payloads.
            try:
                parsed = json.loads(frame)
                normalized = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)
            except Exception:
                continue

            child_in.write((normalized + "\n").encode("utf-8"))
            child_in.flush()
    except Exception:
        pass
    finally:
        try:
            child_in.close()
        except Exception:
            pass


def child_to_parent(child: subprocess.Popen[bytes]) -> None:
    child_out = child.stdout
    parent_out = sys.stdout.buffer
    if child_out is None:
        return

    try:
        while True:
            line = child_out.readline()
            if line == b"":
                break

            text = line.decode("utf-8", errors="replace").strip()
            if not text:
                continue

            # Forward only valid JSON messages.
            try:
                parsed = json.loads(text)
                normalized = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False)
            except Exception:
                continue

            write_content_length_frame(parent_out, normalized)
    except Exception:
        pass


def child_stderr_passthrough(child: subprocess.Popen[bytes]) -> None:
    child_err = child.stderr
    if child_err is None:
        return

    try:
        while True:
            chunk = child_err.read(4096)
            if not chunk:
                break
            sys.stderr.buffer.write(chunk)
            sys.stderr.buffer.flush()
    except Exception:
        pass


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: python scripts/mcp_jsonl_bridge.py <child_command> [child_args...]",
            file=sys.stderr,
        )
        return 2

    child_cmd = sys.argv[1:]
    child = subprocess.Popen(
        child_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    t1 = threading.Thread(target=parent_to_child, args=(child,), daemon=True)
    t2 = threading.Thread(target=child_to_parent, args=(child,), daemon=True)
    t3 = threading.Thread(target=child_stderr_passthrough, args=(child,), daemon=True)

    t1.start()
    t2.start()
    t3.start()

    try:
        return child.wait()
    except KeyboardInterrupt:
        child.terminate()
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

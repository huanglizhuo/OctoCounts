#!/usr/bin/env node

// stdio transport: newline-delimited JSON on stdin/stdout (MCP stdio spec).

import { handleRequest } from "./core.js";

let lineBuffer = "";
let isDraining = false;
const activeRequests = new Map();

process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk) => {
  lineBuffer += chunk;
  void drainMessages();
});
process.stdin.on("end", () => process.exit(0));

async function drainMessages() {
  if (isDraining) return;
  isDraining = true;
  try {
    while (true) {
      const newlineIndex = lineBuffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
        continue;
      }
      if (message.method === "notifications/cancelled") {
        activeRequests.get(message.params?.requestId)?.abort(new DOMException("MCP request cancelled", "AbortError"));
        continue;
      }
      if (message.id !== undefined && (activeRequests.has(message.id) || activeRequests.size >= 8)) {
        writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Duplicate request id or too many concurrent requests" } });
        continue;
      }
      const controller = new AbortController();
      if (message.id !== undefined) activeRequests.set(message.id, controller);
      void handleRequest(message, { signal: controller.signal }).then((response) => {
        if (response) writeMessage(response);
      }).finally(() => { controller.abort(); if (message.id !== undefined) activeRequests.delete(message.id); });
    }
  } finally {
    isDraining = false;
    if (lineBuffer.includes("\n")) {
      void drainMessages();
    }
  }
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

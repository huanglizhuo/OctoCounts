#!/usr/bin/env node

// stdio transport: newline-delimited JSON on stdin/stdout (MCP stdio spec).

import { handleRequest } from "./core.js";

let lineBuffer = "";
let isDraining = false;

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
      const message = JSON.parse(line);
      const response = await handleRequest(message);
      if (response) writeMessage(response);
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

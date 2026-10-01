#!/usr/bin/env node

// Streamable HTTP transport (MCP spec 2025-03-26), stateless mode.
// POST /mcp  -> JSON-RPC request/response (application/json)
// GET  /mcp  -> 405 (no server-initiated SSE streams)
// DELETE /mcp -> 405 (nothing to terminate)
//
// Usage: node src/http.js   (listens on OCTOCOUNTS_HTTP_PORT, default 3000)

import http from "node:http";

import { handleRequest, SERVER_INFO } from "./core.js";

const port = Number(process.env.OCTOCOUNTS_HTTP_PORT || 3000);
const host = process.env.OCTOCOUNTS_HTTP_HOST || "0.0.0.0";

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version, authorization");
  response.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/mcp") {
    sendJson(response, 404, { jsonrpc: "2.0", error: { code: -32000, message: "Not found" }, id: null });
    return;
  }

  if (request.method === "GET") {
    response.writeHead(405, { allow: "POST, OPTIONS" });
    response.end();
    return;
  }

  if (request.method === "DELETE") {
    // Stateless server: nothing to terminate, but acknowledge cleanly.
    response.writeHead(405, { allow: "POST, OPTIONS" });
    response.end();
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    return;
  }

  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > 1024 * 1024) {
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });

  request.on("end", () => {
    let message;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      });
      return;
    }

    void handleRequest(message).then((responseMessage) => {
      if (responseMessage) {
        sendJson(response, 200, responseMessage);
      } else {
        // Notification: accepted, no reply body.
        response.writeHead(202);
        response.end();
      }
    });
  });
});

server.listen(port, host, () => {
  process.stdout.write(`${SERVER_INFO.name} ${SERVER_INFO.version} listening on http://${host}:${port}/mcp\n`);
});

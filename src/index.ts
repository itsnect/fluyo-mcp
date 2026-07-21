#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { CANVAS } from "./schema.js";

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`fluyo-mcp listo (canvas ${CANVAS.W}x${CANVAS.H}, stdio transport).`);
}

main().catch(err => {
  console.error("fluyo-mcp: error fatal al iniciar:", err);
  process.exit(1);
});

/** Utilidades del test HTTP. Como `helpers.ts`, no es un `*.test.js`, así que el
 *  runner no lo ejecuta como suite. Va en un archivo aparte para dejar intacto el
 *  de los tests que ya existían. */

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createRequestHandler, type HttpConfig } from "../src/http.js";
import { DEFAULT_ALLOWED_ORIGINS } from "../src/http-security.js";
import type { RequestLog } from "../src/http-logging.js";

export interface HttpHarness {
  /** Base sin barra final, p. ej. `http://127.0.0.1:51234`. */
  readonly base: string;
  readonly mcpUrl: string;
  /** Todo lo que el servidor registró, en orden. Los tests de privacidad lo leen. */
  readonly logs: RequestLog[];
  close(): Promise<void>;
}

/** Config de test: límites generosos, sin ruido en la consola y con el log
 *  capturado en memoria para poder afirmar sobre él. */
export async function startHttpHarness(overrides: Partial<HttpConfig> = {}): Promise<HttpHarness> {
  const logs: RequestLog[] = [];
  const config: HttpConfig = {
    allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
    rateLimitPerWindow: 1000,
    rateLimitWindowMs: 60_000,
    maxBodyBytes: 1024 * 1024,
    maxToolResultBytes: 200 * 1024,
    openaiAppsChallenge: null,
    logger: entry => logs.push(entry),
    ...overrides,
  };

  const server: Server = createServer(createRequestHandler(config));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    mcpUrl: `${base}/mcp`,
    logs,
    close: () => new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

/** Cliente MCP real hablando Streamable HTTP contra el harness. Hace el
 *  `initialize` de verdad al conectar. */
export async function connectHttpClient(harness: HttpHarness): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StreamableHTTPClientTransport(new URL(harness.mcpUrl));
  const client = new Client({ name: "fluyo-mcp-http-tests", version: "1.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

/** POST crudo de un mensaje JSON-RPC, para los casos donde hay que saltarse el
 *  cliente del SDK (orígenes prohibidos, cuerpos gigantes, métodos no permitidos). */
export function postRaw(
  url: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body,
  });
}

export function initializeMessage(id: number | string = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
  });
}

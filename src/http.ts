/**
 * TRANSPORTE STREAMABLE HTTP — el segundo punto de entrada del servidor.
 *
 * `src/index.ts` conecta `buildServer()` a stdio; este archivo lo conecta a HTTP.
 * Son dos transportes sobre un único núcleo: aquí no se define ni se modifica
 * ninguna tool, ningún schema y ninguna línea del renderer. Si algo de eso hiciera
 * falta para que el HTTP funcione, sería señal de que el corte está mal hecho.
 *
 * MODO STATELESS
 * ──────────────
 * Cada petición construye un `McpServer` y un `StreamableHTTPServerTransport`
 * nuevos y los tira al terminar. Suena derrochador y no lo es: las nueve tools son
 * funciones puras —entra JSON, sale JSON— así que no hay absolutamente nada que
 * preservar entre llamadas. A cambio desaparecen el registro de sesiones, el
 * `Mcp-Session-Id` y la coordinación entre instancias, que es justo lo que no se
 * puede tener en una función serverless donde dos peticiones seguidas pueden caer
 * en máquinas distintas.
 *
 * Se usa `enableJsonResponse: true` por el mismo motivo: un stream SSE de larga
 * duración no sobrevive al modelo de ejecución de Vercel, y la especificación de
 * Streamable HTTP permite responder con `application/json` de un solo disparo.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { buildServer } from "./server.js";
import {
  errorTypeOf,
  silentLogger,
  stderrLogger,
  type Logger,
  type Outcome,
  type RequestLog,
} from "./http-logging.js";
import {
  DEFAULT_ALLOWED_ORIGINS,
  SlidingWindowRateLimiter,
  checkOrigin,
  clientIp,
  readBody,
  withGzip,
} from "./http-security.js";

/** Debe coincidir con package.json y con la versión que anuncia `buildServer()`.
 *  Hay un test que lo comprueba. Se repite aquí en vez de importar package.json
 *  para no sacar el `rootDir` de tsc fuera de `src/`. */
export const SERVER_VERSION = "1.0.0";

export const MCP_PATH = "/mcp";
export const CHALLENGE_PATH = "/.well-known/openai-apps-challenge";

/* ═══════════════════════════════════════════════════════════════════════════
   Configuración
   ═══════════════════════════════════════════════════════════════════════════ */

export interface HttpConfig {
  readonly allowedOrigins: readonly string[];
  readonly rateLimitPerWindow: number;
  readonly rateLimitWindowMs: number;
  /** Tope del cuerpo de la petición. Por encima: 413. */
  readonly maxBodyBytes: number;
  /** Tope del `result` de una tool. Por encima se sustituye por un error que
   *  explica cómo reducir el diagrama. */
  readonly maxToolResultBytes: number;
  /** Valor que sirve `/.well-known/openai-apps-challenge`. Sin él, esa ruta da 404. */
  readonly openaiAppsChallenge: string | null;
  readonly logger: Logger;
}

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MB
export const DEFAULT_MAX_TOOL_RESULT_BYTES = 200 * 1024; // 200 KB
export const DEFAULT_RATE_LIMIT = 30; // por minuto

function parseOrigins(raw: string | undefined): readonly string[] {
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  return {
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    rateLimitPerWindow: parsePositiveInt(env.RATE_LIMIT_PER_MIN, DEFAULT_RATE_LIMIT),
    rateLimitWindowMs: parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxBodyBytes: parsePositiveInt(env.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    maxToolResultBytes: parsePositiveInt(env.MAX_TOOL_RESULT_BYTES, DEFAULT_MAX_TOOL_RESULT_BYTES),
    openaiAppsChallenge: env.OPENAI_APPS_CHALLENGE?.trim() || null,
    logger: env.FLUYO_MCP_LOG === "off" ? silentLogger : stderrLogger,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Respuestas JSON-RPC de la capa de transporte

   Un cliente MCP que recibe el 404 en HTML de un framework no puede hacer nada
   con él. Todo lo que sale de `/mcp`, incluidos los rechazos, es un objeto
   JSON-RPC bien formado con `id: null`, que es lo que la especificación pide
   cuando el error ocurre antes de poder asociarlo a una petición concreta.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Códigos reservados por JSON-RPC 2.0 y el rango libre para errores de servidor. */
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_SERVER_ERROR = -32000;

function jsonRpcError(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function sendJson(res: ServerResponse, status: number, payload: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tope de tamaño de la respuesta de una tool

   Vive en el transporte, no en la tool. Es una restricción de este despliegue
   —una función serverless con un límite de respuesta y un modelo al otro lado
   con un límite de contexto—, no del modelo de documento de Fluyo: por stdio, en
   local, no hay ninguna razón para recortar nada. Ponerlo aquí deja `server.ts`
   intacto y hace que los dos transportes se comporten igual salvo en el caso
   extremo que solo le pasa a uno.
   ═══════════════════════════════════════════════════════════════════════════ */

type JsonRpcId = string | number;

/** Mapa id → nombre de tool para las llamadas de este cuerpo, que puede ser una
 *  petición suelta o un lote. Es también lo único que se registra en el log. */
function toolCallsInPayload(payload: unknown): Map<JsonRpcId, string> {
  const out = new Map<JsonRpcId, string>();
  for (const message of Array.isArray(payload) ? payload : [payload]) {
    if (!message || typeof message !== "object") continue;
    const m = message as { method?: unknown; id?: unknown; params?: unknown };
    if (m.method !== "tools/call") continue;
    if (typeof m.id !== "string" && typeof m.id !== "number") continue;
    const name = (m.params as { name?: unknown } | undefined)?.name;
    if (typeof name === "string") out.set(m.id, name);
  }
  return out;
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function oversizedMessage(toolName: string, bytes: number, limit: number): string {
  const cabecera =
    `Error: la respuesta de ${toolName} ocupa ${kb(bytes)} y supera el límite de ${kb(limit)} ` +
    `del servidor remoto (mcp.fluyo.space).`;

  if (toolName === "export_diagram") {
    return (
      `${cabecera}\n\n` +
      "El SVG crece sobre todo por los nodos que llevan imágenes dentro. Para reducirlo:\n" +
      "  · Si el documento tiene varias páginas, exporta una sola con 'pageIndex'.\n" +
      "  · Los nodos shape:\"image\" incrustan la imagen entera como data URI: son con " +
      "diferencia lo más pesado. Quítalos del documento antes de exportar o sustitúyelos " +
      "por un nodo 'rect' con etiqueta.\n" +
      "  · Cada nodo shape:\"icon\" inserta su SVG completo, y se repite por nodo. En " +
      "diagramas de más de ~100 iconos conviene dejar el ícono solo en los componentes " +
      "clave y usar 'rect' o 'text' en el resto.\n" +
      "  · Divide el diagrama en varias páginas más pequeñas y expórtalas por separado.\n\n" +
      "El diagrama en sí es válido: el límite es de este despliegue HTTP. El mismo servidor " +
      "ejecutado en local por stdio (npx fluyo-mcp) exporta sin tope de tamaño."
    );
  }

  return (
    `${cabecera}\n\n` +
    "El documento resultante es demasiado grande para devolverlo por este endpoint. " +
    "Divídelo en varias páginas o trabaja con menos nodos por llamada. " +
    "El mismo servidor ejecutado en local por stdio (npx fluyo-mcp) no tiene este tope."
  );
}

interface SizeGuardState {
  tripped: boolean;
}

/**
 * Envuelve `transport.send` para inspeccionar el tamaño de los resultados antes
 * de que salgan por el cable. Solo mira `result` de llamadas a tools; las
 * respuestas de protocolo (`initialize`, `tools/list`) se dejan pasar tal cual.
 */
function installSizeGuard(
  transport: StreamableHTTPServerTransport,
  calls: Map<JsonRpcId, string>,
  limit: number
): SizeGuardState {
  const state: SizeGuardState = { tripped: false };
  if (calls.size === 0) return state;

  const originalSend = transport.send.bind(transport);
  transport.send = async (message, options) => {
    const m = message as { id?: unknown; result?: unknown };
    const toolName = typeof m.id === "string" || typeof m.id === "number" ? calls.get(m.id) : undefined;
    if (toolName && m.result && typeof m.result === "object") {
      const bytes = Buffer.byteLength(JSON.stringify(m.result), "utf8");
      if (bytes > limit) {
        state.tripped = true;
        return originalSend(
          {
            jsonrpc: "2.0",
            id: m.id as JsonRpcId,
            result: {
              content: [{ type: "text", text: oversizedMessage(toolName, bytes, limit) }],
              isError: true,
            },
          } as never,
          options
        );
      }
    }
    return originalSend(message, options);
  };
  return state;
}

/** Cuántas de las tools invocadas contestaron `isError`. Solo el número: el motivo
 *  es para el modelo, no para el log. */
function countToolErrors(transport: StreamableHTTPServerTransport, calls: Map<JsonRpcId, string>): () => number {
  let errors = 0;
  if (calls.size === 0) return () => 0;
  const originalSend = transport.send.bind(transport);
  transport.send = async (message, options) => {
    const m = message as { id?: unknown; result?: unknown; error?: unknown };
    const isCall = (typeof m.id === "string" || typeof m.id === "number") && calls.has(m.id);
    if (isCall && ((m.result as { isError?: unknown } | undefined)?.isError === true || m.error)) errors++;
    return originalSend(message, options);
  };
  return () => errors;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Página de inicio

   Alguien va a escribir mcp.fluyo.space en la barra del navegador — un revisor de
   directorio, con bastante probabilidad. Que se encuentre algo que explique qué es
   esto en diez segundos.
   ═══════════════════════════════════════════════════════════════════════════ */

function landingPage(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fluyo-mcp — servidor MCP de Fluyo</title>
<style>
  :root { color-scheme: light dark; --bg:#faf8f4; --fg:#1c1b19; --dim:#5d5a53; --line:#e2ddd3; --accent:#6a9fb5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14161a; --fg:#e8e6e1; --dim:#9a978f; --line:#2a2e35; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:3rem 1.25rem; background:var(--bg); color:var(--fg);
         font:16px/1.65 Georgia, "Times New Roman", serif; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.9rem; margin: 0 0 .25rem; letter-spacing:-.01em; }
  .sub { color: var(--dim); margin: 0 0 2rem; }
  h2 { font-size: 1.05rem; margin: 2.25rem 0 .6rem; text-transform: uppercase;
       letter-spacing:.08em; color: var(--dim); font-weight: normal; }
  code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .875rem; }
  pre { background: color-mix(in srgb, var(--fg) 6%, transparent); border:1px solid var(--line);
        border-radius:8px; padding:.9rem 1rem; overflow-x:auto; }
  ul { padding-left: 1.1rem; } li { margin: .3rem 0; }
  a { color: var(--accent); }
  footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
           color: var(--dim); font-size: .875rem; }
</style>
</head>
<body>
<main>
  <h1>fluyo-mcp</h1>
  <p class="sub">Servidor <a href="https://modelcontextprotocol.io">Model Context Protocol</a> de
     <a href="https://fluyo.space">Fluyo</a>. Crea, edita y exporta diagramas de arquitectura
     animados desde un asistente de IA.</p>

  <h2>Endpoint</h2>
  <pre>POST https://mcp.fluyo.space/mcp</pre>
  <p>Transporte Streamable HTTP, sin sesiones y sin autenticación. Añádelo como conector
     remoto en tu cliente MCP pegando esa URL.</p>

  <h2>Qué hace</h2>
  <ul>
    <li>Describe una arquitectura en lenguaje natural y obtén un <code>.fluyo.json</code>
        listo para abrir en el editor.</li>
    <li>Edita diagramas que ya tengas guardados sin perder estilos.</li>
    <li>Expórtalos a SVG estático.</li>
    <li>Catálogos de íconos, colores, tipografías, animaciones y plantillas.</li>
  </ul>

  <h2>Privacidad</h2>
  <p>Este servidor no almacena los diagramas. No hay base de datos, no hay disco y no hay
     sesiones: cada petición se procesa y se descarta. El registro de operación anota la
     ruta, el nombre de la herramienta invocada, la duración, el código de estado y el
     tamaño en bytes — nunca el contenido.</p>

  <footer>
    <a href="https://github.com/itsnect/fluyo-mcp">Código fuente</a> ·
    <a href="https://fluyo.space">fluyo.space</a> ·
    <a href="/health">/health</a> ·
    MIT
  </footer>
</main>
</body>
</html>
`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   El manejador
   ═══════════════════════════════════════════════════════════════════════════ */

/** Cuenta los bytes que salen de verdad por el socket (ya comprimidos, si toca). */
function countResponseBytes(res: ServerResponse): () => number {
  let bytes = 0;
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const add = (chunk: unknown) => {
    if (!chunk || typeof chunk === "function") return;
    if (Buffer.isBuffer(chunk)) bytes += chunk.length;
    else if (ArrayBuffer.isView(chunk)) bytes += chunk.byteLength;
    else bytes += Buffer.byteLength(String(chunk));
  };
  res.write = function (this: ServerResponse, chunk: unknown, ...rest: unknown[]) {
    add(chunk);
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  } as ServerResponse["write"];
  res.end = function (this: ServerResponse, chunk?: unknown, ...rest: unknown[]) {
    add(chunk);
    return (originalEnd as (...a: unknown[]) => ServerResponse)(chunk, ...rest);
  } as ServerResponse["end"];
  return () => bytes;
}

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export function createRequestHandler(config: HttpConfig = configFromEnv()): RequestHandler {
  const limiter = new SlidingWindowRateLimiter(config.rateLimitPerWindow, config.rateLimitWindowMs);
  const startedAt = Date.now();

  return (req, res) => {
    const t0 = Date.now();
    // El contador va primero para que gzip quede por encima y lo que se mida sea
    // el payload real que viaja.
    const responseBytes = countResponseBytes(res);
    withGzip(req, res);

    const path = normalizePath(req.url);
    let logged = false;
    let pending: Partial<RequestLog> = {};

    const emit = () => {
      if (logged) return;
      logged = true;
      config.logger({
        route: path,
        method: req.method ?? "GET",
        status: res.statusCode,
        outcome: pending.outcome ?? (res.statusCode < 400 ? "ok" : "bad_request"),
        durationMs: Date.now() - t0,
        requestBytes: pending.requestBytes ?? 0,
        responseBytes: responseBytes(),
        ...(pending.tools?.length ? { tools: pending.tools } : {}),
        ...(pending.toolErrors ? { toolErrors: pending.toolErrors } : {}),
        ...(pending.errorType ? { errorType: pending.errorType } : {}),
      });
    };
    res.on("finish", emit);
    res.on("close", emit);

    const note = (patch: Partial<RequestLog>) => {
      pending = { ...pending, ...patch };
    };

    route(req, res, path, config, limiter, startedAt, note).catch(err => {
      // Solo el nombre de la clase de error. Ver la cabecera de http-logging.ts.
      note({ outcome: "internal_error", errorType: errorTypeOf(err) });
      if (!res.headersSent) {
        sendJson(res, 500, jsonRpcError(JSONRPC_SERVER_ERROR, "Error interno del servidor."));
      } else {
        res.end();
      }
    });
  };
}

/** Quita la query string y el `/` final sobrante. Sin redirecciones: la ruta del
 *  challenge de OpenAI tiene que contestar 200 directo, y un 301 hacia la forma
 *  canónica se contaría como fallo de verificación. */
function normalizePath(url: string | undefined): string {
  const raw = (url ?? "/").split("?")[0].split("#")[0];
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  config: HttpConfig,
  limiter: SlidingWindowRateLimiter,
  startedAt: number,
  note: (patch: Partial<RequestLog>) => void
): Promise<void> {
  const method = req.method ?? "GET";

  /* ---- Verificación de OpenAI --------------------------------------------
     Se sirve desde la raíz del host y ANTES que cualquier otra cosa. El
     verificador de OpenAI descarta el subpath donde esté montado el MCP y pide
     siempre https://mcp.fluyo.space/.well-known/openai-apps-challenge. Sin
     rate limit, sin comprobación de origen y sin redirección: 200 y texto plano. */
  if (path === CHALLENGE_PATH) {
    if (method !== "GET" && method !== "HEAD") {
      note({ outcome: "method_not_allowed" });
      sendText(res, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }
    if (!config.openaiAppsChallenge) {
      note({ outcome: "not_found" });
      sendText(res, 404, "OPENAI_APPS_CHALLENGE no está configurada en este despliegue.\n");
      return;
    }
    // Content-Length explícito y sin `Transfer-Encoding: chunked`: la respuesta
    // más aburrida posible es la que menos formas tiene de fallar una verificación.
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(config.openaiAppsChallenge)),
      "Cache-Control": "no-store",
    });
    res.end(method === "HEAD" ? undefined : config.openaiAppsChallenge);
    return;
  }

  if (path === "/health") {
    if (method !== "GET" && method !== "HEAD") {
      note({ outcome: "method_not_allowed" });
      sendText(res, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }
    sendJson(
      res,
      200,
      JSON.stringify({
        status: "ok",
        name: "fluyo-mcp",
        version: SERVER_VERSION,
        transport: "streamable-http",
        mode: "stateless",
        // En serverless esto es la vida de ESTA instancia, no del servicio.
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        endpoint: MCP_PATH,
      }),
      { "Cache-Control": "no-store" }
    );
    return;
  }

  if (path === MCP_PATH) {
    await handleMcp(req, res, config, limiter, note);
    return;
  }

  if (path === "/" && (method === "GET" || method === "HEAD")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(method === "HEAD" ? undefined : landingPage());
    return;
  }

  note({ outcome: "not_found" });
  if (method === "POST") {
    sendJson(res, 404, jsonRpcError(JSONRPC_INVALID_REQUEST, `Ruta desconocida. El endpoint MCP es POST ${MCP_PATH}.`));
  } else {
    sendText(res, 404, `No hay nada aquí. El endpoint MCP es POST ${MCP_PATH}; la documentación, en /.\n`);
  }
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  config: HttpConfig,
  limiter: SlidingWindowRateLimiter,
  note: (patch: Partial<RequestLog>) => void
): Promise<void> {
  const method = req.method ?? "GET";
  const origin = headerValue(req, "origin");
  const verdict = checkOrigin(origin, config.allowedOrigins);

  /* ---- Preflight ---------------------------------------------------------
     No lo pide la especificación de MCP, pero sin él la lista blanca de Origin
     no serviría de nada: un cliente de navegador nunca llegaría a hacer el POST. */
  if (method === "OPTIONS") {
    if (verdict === "denied") {
      note({ outcome: "forbidden_origin" });
      res.writeHead(403).end();
      return;
    }
    res.writeHead(204, {
      ...corsHeaders(origin, verdict),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (verdict === "denied") {
    note({ outcome: "forbidden_origin" });
    sendJson(
      res,
      403,
      jsonRpcError(
        JSONRPC_SERVER_ERROR,
        "Origen no permitido. Este endpoint solo acepta peticiones desde los orígenes de la lista blanca " +
          "del servidor, o desde clientes que no envían el header Origin (lo normal en un cliente MCP)."
      )
    );
    return;
  }

  const cors = corsHeaders(origin, verdict);

  /* ---- GET y DELETE: 405 con cuerpo JSON-RPC -----------------------------
     En Streamable HTTP, GET abre el stream SSE de notificaciones del servidor y
     DELETE cierra una sesión. Este servidor es stateless: no hay notificaciones
     que emitir fuera de una petición ni sesión que cerrar. La especificación
     prescribe exactamente 405 para ese caso, y el cuerpo va en JSON-RPC para que
     el cliente pueda leerlo igual que cualquier otra respuesta. */
  if (method === "GET" || method === "DELETE") {
    note({ outcome: "method_not_allowed" });
    sendJson(
      res,
      405,
      jsonRpcError(
        JSONRPC_SERVER_ERROR,
        method === "GET"
          ? "Method Not Allowed: este servidor no ofrece el stream SSE de GET. Es stateless y responde " +
              "cada petición POST con un JSON completo."
          : "Method Not Allowed: este servidor es stateless y no mantiene sesiones, así que no hay ninguna " +
              "que terminar con DELETE."
      ),
      { Allow: "POST, OPTIONS", ...cors }
    );
    return;
  }

  if (method !== "POST") {
    note({ outcome: "method_not_allowed" });
    sendJson(res, 405, jsonRpcError(JSONRPC_SERVER_ERROR, `Method Not Allowed: usa POST ${MCP_PATH}.`), {
      Allow: "POST, OPTIONS",
      ...cors,
    });
    return;
  }

  /* ---- Rate limit --------------------------------------------------------
     Solo en /mcp. /health y la ruta del challenge quedan fuera a propósito:
     estrangular al verificador de OpenAI o a la sonda de monitorización sería
     peor que el abuso del que protege, y ambas devuelven una cadena fija más
     barata que la propia contabilidad del limitador. */
  const decision = limiter.check(clientIp(req));
  if (!decision.allowed) {
    note({ outcome: "rate_limited" });
    sendJson(
      res,
      429,
      jsonRpcError(
        JSONRPC_SERVER_ERROR,
        `Demasiadas peticiones. Límite: ${config.rateLimitPerWindow} por ` +
          `${Math.round(config.rateLimitWindowMs / 1000)} s por IP. ` +
          `Reintenta en ${decision.retryAfterSeconds} s.`
      ),
      {
        "Retry-After": String(decision.retryAfterSeconds),
        "RateLimit-Limit": String(config.rateLimitPerWindow),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": String(decision.retryAfterSeconds),
        ...cors,
      }
    );
    return;
  }

  /* ---- Cuerpo ------------------------------------------------------------ */
  const body = await readBody(req, config.maxBodyBytes);
  if (body.kind === "aborted") {
    note({ outcome: "bad_request" });
    if (!res.headersSent) res.writeHead(400).end();
    return;
  }
  if (body.kind === "too_large") {
    note({ outcome: "payload_too_large", requestBytes: body.bytes });
    sendJson(
      res,
      413,
      jsonRpcError(
        JSONRPC_INVALID_REQUEST,
        `El cuerpo de la petición supera el límite de ${kb(config.maxBodyBytes)} de este servidor. ` +
          "Suele ocurrir con documentos que contienen nodos shape:\"image\", porque llevan la imagen " +
          "entera dentro como data URI. Quítalos o divide el documento en varias páginas. " +
          "El servidor en local por stdio (npx fluyo-mcp) no tiene este tope."
      ),
      cors
    );
    return;
  }
  note({ requestBytes: body.bytes });

  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    // El texto que falló al parsear NO se registra ni se devuelve: puede ser el
    // documento del usuario a medias.
    note({ outcome: "bad_request" });
    sendJson(res, 400, jsonRpcError(JSONRPC_PARSE_ERROR, "El cuerpo de la petición no es JSON válido."), cors);
    return;
  }

  const calls = toolCallsInPayload(payload);
  if (calls.size) note({ tools: [...calls.values()] });

  for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);

  /* ---- Servidor y transporte nuevos, y a la basura al terminar ----------- */
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: sin Mcp-Session-Id
    enableJsonResponse: true,
  });

  // El orden importa: `countToolErrors` envuelve primero para ver el resultado ya
  // sustituido por el guard de tamaño, y contar así el recorte como error de tool.
  const errorCount = countToolErrors(transport, calls);
  const sizeGuard = installSizeGuard(transport, calls, config.maxToolResultBytes);

  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  };
  res.on("close", dispose);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, payload);
  } finally {
    note({
      toolErrors: errorCount(),
      ...(sizeGuard.tripped ? { outcome: "response_too_large" as Outcome } : {}),
    });
    dispose();
  }
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function corsHeaders(origin: string | undefined, verdict: ReturnType<typeof checkOrigin>): Record<string, string> {
  if (verdict !== "allowed" || !origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
    Vary: "Origin",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Arranque local

   En Vercel no se usa: allí `api/index.js` importa `createRequestHandler` y la
   plataforma pone el servidor. Esto es para `npm run start:http` y para probar
   el endpoint en local antes de desplegar.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * El único agujero por el que un mensaje de error podría llegar al log del
 * servidor sin pasar por `http-logging.ts`: si una promesa se rechaza sin que
 * nadie la atienda, Node imprime el error entero —mensaje y stack— y se cae. Un
 * `err.message` de Zod arrastra el valor del documento que lo provocó.
 *
 * Estos manejadores registran solo el tipo del error y mantienen la semántica de
 * caída: un proceso que sigue vivo tras una excepción no controlada está en un
 * estado que nadie ha razonado.
 *
 * Se instalan explícitamente, no al importar el módulo, para que importar
 * `http.ts` desde un test no manipule el proceso del runner.
 */
export function installSafeProcessHandlers(logType: (kind: string, type: string) => void = defaultCrashLog): void {
  process.on("unhandledRejection", reason => {
    logType("unhandledRejection", errorTypeOf(reason));
    process.exit(1);
  });
  process.on("uncaughtException", err => {
    logType("uncaughtException", errorTypeOf(err));
    process.exit(1);
  });
}

function defaultCrashLog(kind: string, type: string): void {
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), fatal: kind, errorType: type }) + "\n"
  );
}

export function startHttpServer(port = Number(process.env.PORT) || 3000, config = configFromEnv()) {
  installSafeProcessHandlers();
  const server = createServer(createRequestHandler(config));
  server.listen(port, () => {
    process.stderr.write(`fluyo-mcp escuchando en http://localhost:${port}${MCP_PATH} (streamable-http, stateless)\n`);
  });
  return server;
}

const invokedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) startHttpServer();

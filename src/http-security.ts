/**
 * Defensas del endpoint HTTP: origen, caudal, tamaño de entrada y compresión.
 *
 * Nada de esto es autenticación. El servidor es público a propósito: no pide
 * credenciales, no guarda nada y no tiene secretos que proteger. Lo que hay aquí
 * es lo que los directorios de Claude y ChatGPT revisan antes de aceptar un
 * conector remoto, más lo mínimo para que un endpoint abierto no se convierta en
 * un problema de facturación.
 *
 * Todas las piezas son funciones puras o objetos con estado explícito, para poder
 * probarlas sin levantar un servidor.
 */

import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from "node:http";
import { gzipSync } from "node:zlib";

/* ═══════════════════════════════════════════════════════════════════════════
   1. Validación del header Origin
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Orígenes permitidos por defecto: las superficies web de Claude y de ChatGPT,
 * más los dominios propios de Fluyo.
 *
 * La lista se puede sustituir entera con la variable de entorno ALLOWED_ORIGINS
 * (valores separados por comas). El valor especial `*` desactiva la comprobación,
 * y existe solo para depurar en local: no lo pongas en producción.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://claude.ai",
  "https://www.claude.ai",
  "https://claude.com",
  "https://www.claude.com",
  "https://chatgpt.com",
  "https://www.chatgpt.com",
  "https://chat.openai.com",
  "https://platform.openai.com",
  "https://fluyo.space",
  "https://www.fluyo.space",
  "https://mcp.fluyo.space",
];

/** `http://localhost:3000`, `http://127.0.0.1:8080`, `http://[::1]:5173`… */
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export type OriginVerdict = "allowed" | "absent" | "denied";

/**
 * Una petición SIN header `Origin` se acepta.
 *
 * No es un descuido: `Origin` lo pone el navegador, y el cliente normal de un
 * servidor MCP es un proceso servidor-a-servidor que no lo envía. La comprobación
 * existe para lo que sí protege —que una página cualquiera abierta en el navegador
 * del usuario no pueda hablar con este endpoint desde su equipo— y ese ataque
 * siempre trae `Origin`. Rechazar las peticiones sin él dejaría fuera a todos los
 * clientes legítimos sin ganar nada.
 */
export function checkOrigin(origin: string | undefined, allowed: readonly string[]): OriginVerdict {
  if (origin === undefined || origin === "") return "absent";
  if (allowed.includes("*")) return "allowed";
  const normalized = origin.trim().replace(/\/+$/, "").toLowerCase();
  if (normalized === "null") return "denied"; // sandbox de iframe / file://
  if (allowed.some(a => a.toLowerCase().replace(/\/+$/, "") === normalized)) return "allowed";
  if (LOCALHOST.test(normalized)) return "allowed";
  return "denied";
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Rate limit por IP, ventana deslizante, en memoria
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Detrás de un proxy —y en Cloud Run siempre lo hay— `socket.remoteAddress` es la IP
 * del propio proxy, idéntica para todo el mundo: limitar por ella sería un único
 * cubo global. La IP real llega en `x-forwarded-for`, cuyo primer valor es el
 * cliente y el resto la cadena de proxies.
 *
 * Confiar en una cabecera que el cliente puede falsificar solo es aceptable porque
 * el front-end de Cloud Run la reescribe, y porque lo peor que consigue quien la
 * falsifique es saltarse su propio límite de caudal. No se usa para nada más: no
 * se registra, no se persiste y no decide permisos.
 */
export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(",")[0]?.trim();
  if (first) return first;
  const real = req.headers["x-real-ip"];
  const realStr = Array.isArray(real) ? real[0] : real;
  if (realStr) return realStr.trim();
  return req.socket?.remoteAddress ?? "unknown";
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Segundos que el cliente debe esperar. Va en la cabecera `Retry-After`. */
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

/**
 * Ventana deslizante: se guarda la marca de tiempo de cada petición y se cuentan
 * las que caen dentro de la ventana. Es más caro que un contador con reinicio por
 * tramos, pero no deja pasar una ráfaga doble en el cambio de tramo, y con 30
 * marcas por IP el coste es irrelevante.
 *
 * El estado vive en memoria del proceso. En Cloud Run eso significa POR INSTANCIA:
 * con varias instancias activas el límite efectivo es mayor que el configurado.
 * Es una barrera contra el abuso accidental y los bucles de reintentos, no una
 * cuota exacta; para eso haría falta un almacén compartido, y almacenar algo es
 * justo lo que este servicio evita.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Tope de IPs distintas en memoria. Sin él, un atacante que rote la cabecera
     *  `x-forwarded-for` haría crecer el mapa sin fin. Al llegar al tope se purga
     *  lo caducado y, si aún así no baja, se descartan las entradas más antiguas. */
        private readonly maxTrackedIps = 20_000
  ) {}

  check(ip: string, now = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const previous = this.hits.get(ip);
    const recent = previous ? previous.filter(t => t > cutoff) : [];

    if (recent.length >= this.limit) {
      this.hits.set(ip, recent);
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }

    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > this.maxTrackedIps) this.evict(cutoff);
    return { allowed: true, retryAfterSeconds: 0, remaining: this.limit - recent.length };
  }

  private evict(cutoff: number): void {
    for (const [ip, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1] <= cutoff) this.hits.delete(ip);
    }
    // Si purgar lo caducado no bastó, el mapa se está llenando de IPs vivas
    // (o falsificadas). Se tira la mitad más antigua; volverán a entrar si son reales.
    if (this.hits.size > this.maxTrackedIps) {
      const porEdad = [...this.hits.entries()].sort((a, b) => (a[1][0] ?? 0) - (b[1][0] ?? 0));
      for (let i = 0; i < porEdad.length / 2; i++) this.hits.delete(porEdad[i][0]);
    }
  }

  /** Solo para tests. */
  get trackedIps(): number {
    return this.hits.size;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Lectura del cuerpo con tope duro
   ═══════════════════════════════════════════════════════════════════════════ */

export type BodyResult =
  | { readonly kind: "ok"; readonly text: string; readonly bytes: number }
  | { readonly kind: "too_large"; readonly bytes: number }
  | { readonly kind: "aborted" };

/**
 * Lee el cuerpo contando bytes y corta en cuanto se pasa del límite, sin esperar
 * a tenerlo entero en memoria. `Content-Length`, cuando viene, sirve para
 * rechazar antes de leer un solo byte; cuando no viene (`Transfer-Encoding:
 * chunked`) el contador es la única defensa, y por eso existe.
 */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume(); // drena para que el socket pueda reutilizarse
    return Promise.resolve({ kind: "too_large", bytes: declared });
  }

  return new Promise<BodyResult>(resolve => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const finish = (result: BodyResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.pause();
        req.resume();
        finish({ kind: "too_large", bytes });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish({ kind: "ok", text: Buffer.concat(chunks).toString("utf8"), bytes }));
    req.on("error", () => finish({ kind: "aborted" }));
    req.on("aborted", () => finish({ kind: "aborted" }));
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. gzip
   ═══════════════════════════════════════════════════════════════════════════ */

/** Debajo de este tamaño gzip no compensa: la cabecera del formato y el coste de
 *  CPU superan lo que se ahorra. */
const MIN_GZIP_BYTES = 1024;

const COMPRESSIBLE = /^(application\/(json|.*\+json)|text\/|image\/svg\+xml)/i;

function acceptsGzip(req: IncomingMessage): boolean {
  const header = req.headers["accept-encoding"];
  const value = Array.isArray(header) ? header.join(",") : header ?? "";
  return /(^|,)\s*gzip\s*(;|,|$)/i.test(value);
}

/**
 * Comprime la respuesta interceptando `writeHead`/`write`/`end`.
 *
 * Bufferiza en vez de encadenar un stream de gzip porque todas las respuestas de
 * este servidor son de un solo disparo: el transporte va en modo `enableJsonResponse`,
 * así que `/mcp` contesta un JSON completo y no un stream SSE. Bufferizar permite
 * emitir un `Content-Length` exacto y evita los problemas de vaciado que tiene
 * comprimir un stream de eventos.
 *
 * Si aun así llegara una respuesta que no se debe comprimir —SSE, o algo que ya
 * viene comprimido—, en `writeHead` se decide pasar de largo y las escrituras
 * siguientes van directas al socket sin acumularse.
 */
export function withGzip(req: IncomingMessage, res: ServerResponse): void {
  if (!acceptsGzip(req)) return;

  const originalWriteHead = res.writeHead.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  const chunks: Buffer[] = [];
  let status = 200;
  let buffering = false;
  let decided = false;

  // El transporte del SDK escribe Uint8Array, no Buffer. Sin la rama de
  // ArrayBuffer.isView, `String(chunk)` devuelve "123,34,114,…" y la respuesta
  // sale con los bytes escritos en decimal separados por comas.
  const asBuffer = (chunk: unknown, encoding?: unknown): Buffer => {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    return Buffer.from(String(chunk), (typeof encoding === "string" ? encoding : "utf8") as BufferEncoding);
  };

  const restore = () => {
    res.writeHead = originalWriteHead;
    res.write = originalWrite;
    res.end = originalEnd;
  };

  res.writeHead = function (this: ServerResponse, code: number, ...rest: unknown[]) {
    status = code;
    // Se admiten todas las firmas de Node: (code), (code, headers),
    // (code, statusMessage) y (code, statusMessage, headers).
    const maybeHeaders = rest.find(a => typeof a === "object" && a !== null);
    if (maybeHeaders) {
      const entries = Array.isArray(maybeHeaders)
        ? (maybeHeaders as [string, string | number][])
        : Object.entries(maybeHeaders as OutgoingHttpHeaders);
      for (const [key, value] of entries) {
        if (value !== undefined) res.setHeader(key, value as string | number | string[]);
      }
    }

    decided = true;
    const type = String(res.getHeader("content-type") ?? "");
    buffering = COMPRESSIBLE.test(type) && !res.getHeader("content-encoding");
    if (buffering) {
      res.setHeader("Vary", "Accept-Encoding");
      return res;
    }
    restore();
    return originalWriteHead(status);
  } as ServerResponse["writeHead"];

  res.write = function (this: ServerResponse, chunk: unknown, ...rest: unknown[]) {
    if (!decided || !buffering) {
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }
    if (chunk) chunks.push(asBuffer(chunk, rest[0]));
    const cb = rest.find(a => typeof a === "function") as (() => void) | undefined;
    cb?.();
    return true;
  } as ServerResponse["write"];

  res.end = function (this: ServerResponse, chunk?: unknown, ...rest: unknown[]) {
    if (!decided || !buffering) {
      restore();
      return (originalEnd as (...a: unknown[]) => ServerResponse)(chunk, ...rest);
    }
    if (chunk && typeof chunk !== "function") chunks.push(asBuffer(chunk, rest[0]));
    const cb = [chunk, ...rest].find(a => typeof a === "function") as (() => void) | undefined;

    const body = Buffer.concat(chunks);
    restore();

    const payload = body.length >= MIN_GZIP_BYTES ? gzipSync(body) : body;
    if (payload !== body) res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", String(payload.length));
    originalWriteHead(status);
    return originalEnd(payload, cb as never);
  } as ServerResponse["end"];
}

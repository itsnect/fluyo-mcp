/**
 * TESTS DEL TRANSPORTE HTTP.
 *
 * Dos preguntas, y todo lo demás cuelga de ellas:
 *
 *   1. ¿Contesta lo mismo por HTTP que por stdio? El transporte no puede cambiar
 *      lo que las tools devuelven. La suite de paridad lo comprueba tool por tool
 *      llamando a las dos por el mismo camino y comparando el resultado entero.
 *
 *   2. ¿Se filtra algo del usuario al log? La política de privacidad de fluyo.space
 *      dice que los diagramas no se almacenan. La suite de privacidad mete etiquetas
 *      con marcadores irrepetibles y verifica que no aparecen en ninguna línea de log.
 *
 * El resto —origen, caudal, métodos, tamaños— son los requisitos que revisan los
 * directorios de Claude y ChatGPT antes de aceptar un conector remoto.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SERVER_VERSION } from "../src/http.js";
import { checkOrigin, DEFAULT_ALLOWED_ORIGINS, clientIp, SlidingWindowRateLimiter } from "../src/http-security.js";

import { loadFixture, packageRoot, startHarness, textBlocks, type Harness } from "./helpers.js";
import { connectHttpClient, initializeMessage, postRaw, startHttpHarness, type HttpHarness } from "./http-helpers.js";

/* ═══════════════════════════════════════════════════════════════════════════
   1. Handshake MCP completo por HTTP
   ═══════════════════════════════════════════════════════════════════════════ */

describe("handshake MCP por HTTP", () => {
  let http: HttpHarness;
  before(async () => { http = await startHttpHarness(); });
  after(async () => { await http?.close(); });

  it("initialize → tools/list → tools/call con un cliente real del SDK", async () => {
    const { client, close } = await connectHttpClient(http);
    try {
      // (a) initialize lo hizo connect(); comprobamos lo que negoció.
      assert.equal(client.getServerVersion()?.name, "fluyo-mcp");
      assert.equal(client.getServerVersion()?.version, SERVER_VERSION);

      // (b) tools/list
      const { tools } = await client.listTools();
      assert.equal(tools.length, 9, `se esperaban 9 tools, llegaron ${tools.length}`);

      // (c) tools/call
      const result = await client.callTool({ name: "list_colors", arguments: {} });
      const text = textBlocks(result).join("\n");
      assert.match(text, /Servicio/, "list_colors debería nombrar la paleta semántica");
      assert.notEqual((result as { isError?: boolean }).isError, true);
    } finally {
      await close();
    }
  });

  it("la versión anunciada por HTTP coincide con package.json", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8"));
    assert.equal(SERVER_VERSION, pkg.version, "SERVER_VERSION de http.ts se desincronizó de package.json");
  });

  it("el modo stateless no emite Mcp-Session-Id", async () => {
    const res = await postRaw(http.mcpUrl, initializeMessage());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("mcp-session-id"), null);
    await res.arrayBuffer();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Paridad HTTP ↔ in-memory (el mismo transporte que usa stdio)

   `startHarness()` conecta `buildServer()` a un InMemoryTransport, que es
   exactamente el mismo objeto servidor que index.ts cuelga de stdio. Si las dos
   rutas devuelven lo mismo, el transporte HTTP no está tocando nada.
   ═══════════════════════════════════════════════════════════════════════════ */

const DOC = loadFixture("kafka-event-pipeline.fluyo.json");

const LLAMADAS: ReadonlyArray<{ name: string; arguments: Record<string, unknown> }> = [
  {
    name: "create_diagram",
    arguments: {
      pageName: "Paridad",
      nodes: [
        { key: "a", shape: "rect", label: "Entrada", color: "Servicio" },
        { key: "b", shape: "cylinder", label: "Datos", color: "Datos" },
      ],
      edges: [{ from: "a", to: "b", label: "escribe", route: "ortho" }],
    },
  },
  { name: "edit_diagram", arguments: { document: DOC, operations: [{ op: "rename_page", name: "Renombrada" }] } },
  { name: "export_diagram", arguments: { document: DOC } },
  { name: "list_icons", arguments: {} },
  { name: "list_colors", arguments: {} },
  { name: "list_anims", arguments: {} },
  { name: "list_fonts", arguments: {} },
  { name: "list_templates", arguments: {} },
  {
    name: "create_from_template",
    arguments: { templateId: "rag_chatbot", labelOverrides: { llm: "Claude" } },
  },
];

describe("las nueve tools responden igual por HTTP que por el transporte de stdio", () => {
  let http: HttpHarness;
  let mem: Harness;
  let httpClient: Awaited<ReturnType<typeof connectHttpClient>>;

  before(async () => {
    http = await startHttpHarness();
    mem = await startHarness();
    httpClient = await connectHttpClient(http);
  });
  after(async () => {
    await httpClient?.close();
    await mem?.close();
    await http?.close();
  });

  it("la lista de casos cubre las nueve", async () => {
    const { tools } = await mem.client.listTools();
    assert.deepEqual(
      LLAMADAS.map(c => c.name).sort(),
      tools.map(t => t.name).sort(),
      "hay una tool sin caso de paridad"
    );
  });

  for (const call of LLAMADAS) {
    it(`${call.name}: mismo input, mismo output`, async () => {
      const [porHttp, porMemoria] = await Promise.all([
        httpClient.client.callTool(call),
        mem.client.callTool(call),
      ]);
      assert.deepEqual(porHttp.content, porMemoria.content, `${call.name} difiere entre transportes`);
      assert.equal(
        (porHttp as { isError?: boolean }).isError,
        (porMemoria as { isError?: boolean }).isError,
        `${call.name}: isError difiere`
      );
    });
  }

  /** No basta con que coincidan: si las dos fallaran igual, la paridad sería
   *  cierta y el servidor estaría roto. */
  it("ninguna de las nueve devolvió error", async () => {
    for (const call of LLAMADAS) {
      const r = await httpClient.client.callTool(call);
      assert.notEqual((r as { isError?: boolean }).isError, true, `${call.name} devolvió isError por HTTP`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Validación del header Origin
   ═══════════════════════════════════════════════════════════════════════════ */

describe("validación del header Origin", () => {
  let http: HttpHarness;
  before(async () => { http = await startHttpHarness(); });
  after(async () => { await http?.close(); });

  it("un Origin fuera de la lista blanca recibe 403", async () => {
    const res = await postRaw(http.mcpUrl, initializeMessage(), { Origin: "https://evil.example" });
    assert.equal(res.status, 403);
    const body = await res.json() as { jsonrpc?: string; error?: { code?: number; message?: string } };
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(typeof body.error?.code, "number");
    assert.match(body.error?.message ?? "", /rigen no permitido/);
  });

  it("sin header Origin pasa: es el caso normal de un cliente servidor-a-servidor", async () => {
    const res = await postRaw(http.mcpUrl, initializeMessage());
    assert.equal(res.status, 200);
    await res.arrayBuffer();
  });

  it("los orígenes de Claude y de ChatGPT están permitidos por defecto", async () => {
    for (const origin of ["https://claude.ai", "https://claude.com", "https://chatgpt.com"]) {
      const res = await postRaw(http.mcpUrl, initializeMessage(), { Origin: origin });
      assert.equal(res.status, 200, `${origin} debería estar permitido`);
      assert.equal(res.headers.get("access-control-allow-origin"), origin);
      await res.arrayBuffer();
    }
  });

  it("la lista blanca se puede sustituir por configuración", async () => {
    const propio = await startHttpHarness({ allowedOrigins: ["https://solo-este.example"] });
    try {
      const ok = await postRaw(propio.mcpUrl, initializeMessage(), { Origin: "https://solo-este.example" });
      assert.equal(ok.status, 200);
      await ok.arrayBuffer();

      const no = await postRaw(propio.mcpUrl, initializeMessage(), { Origin: "https://claude.ai" });
      assert.equal(no.status, 403, "sustituir la lista debe excluir los valores por defecto");
      await no.arrayBuffer();
    } finally {
      await propio.close();
    }
  });

  it("el preflight OPTIONS responde 204 a un origen permitido y 403 a uno prohibido", async () => {
    const ok = await fetch(http.mcpUrl, { method: "OPTIONS", headers: { Origin: "https://claude.ai" } });
    assert.equal(ok.status, 204);
    assert.match(ok.headers.get("access-control-allow-methods") ?? "", /POST/);

    const no = await fetch(http.mcpUrl, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    assert.equal(no.status, 403);
  });

  /** La unidad, sin servidor de por medio: los casos raros son fáciles de olvidar. */
  it("checkOrigin distingue ausente, permitido y denegado", () => {
    assert.equal(checkOrigin(undefined, DEFAULT_ALLOWED_ORIGINS), "absent");
    assert.equal(checkOrigin("", DEFAULT_ALLOWED_ORIGINS), "absent");
    assert.equal(checkOrigin("https://claude.ai", DEFAULT_ALLOWED_ORIGINS), "allowed");
    assert.equal(checkOrigin("https://claude.ai/", DEFAULT_ALLOWED_ORIGINS), "allowed");
    assert.equal(checkOrigin("http://localhost:5173", DEFAULT_ALLOWED_ORIGINS), "allowed");
    assert.equal(checkOrigin("null", DEFAULT_ALLOWED_ORIGINS), "denied");
    assert.equal(checkOrigin("https://claude.ai.evil.example", DEFAULT_ALLOWED_ORIGINS), "denied");
    assert.equal(checkOrigin("https://cualquiera.example", ["*"]), "allowed");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Rate limit
   ═══════════════════════════════════════════════════════════════════════════ */

describe("rate limit por IP", () => {
  it("al pasarse devuelve 429 con Retry-After", async () => {
    const http = await startHttpHarness({ rateLimitPerWindow: 3, rateLimitWindowMs: 60_000 });
    try {
      for (let i = 0; i < 3; i++) {
        const res = await postRaw(http.mcpUrl, initializeMessage(i + 1));
        assert.equal(res.status, 200, `la petición ${i + 1} debería pasar`);
        await res.arrayBuffer();
      }
      const bloqueada = await postRaw(http.mcpUrl, initializeMessage(4));
      assert.equal(bloqueada.status, 429);

      const retryAfter = bloqueada.headers.get("retry-after");
      assert.ok(retryAfter, "falta la cabecera Retry-After");
      const segundos = Number(retryAfter);
      assert.ok(Number.isInteger(segundos) && segundos > 0, `Retry-After debe ser un entero de segundos, llegó "${retryAfter}"`);
      assert.ok(segundos <= 60, "Retry-After no debería superar la ventana");

      const body = await bloqueada.json() as { jsonrpc?: string; error?: { message?: string } };
      assert.equal(body.jsonrpc, "2.0");
      assert.match(body.error?.message ?? "", /Demasiadas peticiones/);

      assert.equal(http.logs.at(-1)?.outcome, "rate_limited");
    } finally {
      await http.close();
    }
  });

  it("la ruta del challenge y /health quedan fuera del límite", async () => {
    const http = await startHttpHarness({ rateLimitPerWindow: 1, openaiAppsChallenge: "tok" });
    try {
      for (let i = 0; i < 5; i++) {
        const salud = await fetch(`${http.base}/health`);
        assert.equal(salud.status, 200, "monitorizar no puede consumir cuota");
        await salud.arrayBuffer();
        const reto = await fetch(`${http.base}/.well-known/openai-apps-challenge`);
        assert.equal(reto.status, 200, "el verificador de OpenAI no puede quedar estrangulado");
        await reto.arrayBuffer();
      }
    } finally {
      await http.close();
    }
  });

  it("la ventana es deslizante, no por tramos", () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    const t = 10_000;
    assert.equal(limiter.check("ip", t).allowed, true);
    assert.equal(limiter.check("ip", t + 100).allowed, true);
    assert.equal(limiter.check("ip", t + 200).allowed, false, "la tercera dentro de la ventana se bloquea");
    // Al salir la primera de la ventana vuelve a haber hueco, y solo uno.
    assert.equal(limiter.check("ip", t + 1001).allowed, true);
    assert.equal(limiter.check("ip", t + 1002).allowed, false);
  });

  it("las IPs se cuentan por separado", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000);
    assert.equal(limiter.check("1.1.1.1").allowed, true);
    assert.equal(limiter.check("1.1.1.1").allowed, false);
    assert.equal(limiter.check("2.2.2.2").allowed, true);
  });

  /** En Vercel `socket.remoteAddress` es siempre el proxy: sin esto el límite
   *  sería un único cubo compartido por todo el mundo. */
  it("clientIp prefiere x-forwarded-for sobre la IP del socket", () => {
    const fake = (headers: Record<string, string>, remote = "10.0.0.1") =>
      ({ headers, socket: { remoteAddress: remote } }) as never;

    assert.equal(clientIp(fake({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" })), "203.0.113.5");
    assert.equal(clientIp(fake({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(fake({})), "10.0.0.1");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Métodos no permitidos en /mcp
   ═══════════════════════════════════════════════════════════════════════════ */

describe("GET y DELETE en /mcp", () => {
  let http: HttpHarness;
  before(async () => { http = await startHttpHarness(); });
  after(async () => { await http?.close(); });

  for (const method of ["GET", "DELETE"] as const) {
    it(`${method} devuelve 405 con un cuerpo JSON-RPC válido, no un 404 de framework`, async () => {
      const res = await fetch(http.mcpUrl, { method });
      assert.equal(res.status, 405);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/);
      assert.match(res.headers.get("allow") ?? "", /POST/);

      const body = await res.json() as { jsonrpc?: string; id?: unknown; error?: { code?: number; message?: string } };
      assert.equal(body.jsonrpc, "2.0");
      assert.equal(body.id, null, "un error sin petición asociada lleva id null");
      assert.equal(typeof body.error?.code, "number");
      assert.ok((body.error?.message ?? "").length > 20, "el mensaje debe explicar por qué");
    });
  }

  it("un POST a una ruta desconocida también contesta JSON-RPC", async () => {
    const res = await postRaw(`${http.base}/no-existe`, initializeMessage());
    assert.equal(res.status, 404);
    const body = await res.json() as { jsonrpc?: string; error?: { message?: string } };
    assert.equal(body.jsonrpc, "2.0");
    assert.match(body.error?.message ?? "", /\/mcp/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Rutas de verificación y salud
   ═══════════════════════════════════════════════════════════════════════════ */

describe("rutas de verificación y salud", () => {
  it("el challenge de OpenAI sale como text/plain con 200 directo", async () => {
    const valor = "chal_" + "x".repeat(24);
    const http = await startHttpHarness({ openaiAppsChallenge: valor });
    try {
      // `redirect: "manual"` para que un 301 se vea como 301 y no lo siga fetch:
      // el verificador de OpenAI cuenta una redirección como fallo.
      const res = await fetch(`${http.base}/.well-known/openai-apps-challenge`, { redirect: "manual" });
      assert.equal(res.status, 200, "tiene que ser 200 directo, ni 301 ni 404");
      assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
      assert.equal(await res.text(), valor);
    } finally {
      await http.close();
    }
  });

  it("sin OPENAI_APPS_CHALLENGE configurada la ruta da 404, no un 200 vacío", async () => {
    const http = await startHttpHarness({ openaiAppsChallenge: null });
    try {
      const res = await fetch(`${http.base}/.well-known/openai-apps-challenge`);
      assert.equal(res.status, 404, "un 200 vacío haría pasar por verificado un despliegue mal configurado");
      await res.arrayBuffer();
    } finally {
      await http.close();
    }
  });

  it("GET /health responde versión y uptime", async () => {
    const http = await startHttpHarness();
    try {
      const res = await fetch(`${http.base}/health`);
      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.status, "ok");
      assert.equal(body.version, SERVER_VERSION);
      assert.equal(typeof body.uptimeSeconds, "number");
    } finally {
      await http.close();
    }
  });

  it("GET / devuelve una página HTML con enlace al repo y a fluyo.space", async () => {
    const http = await startHttpHarness();
    try {
      const res = await fetch(`${http.base}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      const html = await res.text();
      assert.match(html, /github\.com\/itsnect\/fluyo-mcp/);
      assert.match(html, /fluyo\.space/);
      assert.match(html, /\/mcp/);
    } finally {
      await http.close();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. Límites de tamaño
   ═══════════════════════════════════════════════════════════════════════════ */

describe("límites de tamaño", () => {
  it("un cuerpo por encima de 1 MB se rechaza limpio", async () => {
    const http = await startHttpHarness();
    try {
      // Un documento plausible pasado de vueltas: una etiqueta enorme, como la
      // que produciría un nodo con una imagen incrustada.
      const gigante = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "export_diagram", arguments: { document: { relleno: "A".repeat(1_100_000) } } },
      });
      assert.ok(gigante.length > 1024 * 1024);

      const res = await postRaw(http.mcpUrl, gigante);
      assert.equal(res.status, 413);
      const body = await res.json() as { jsonrpc?: string; error?: { message?: string } };
      assert.equal(body.jsonrpc, "2.0");
      assert.match(body.error?.message ?? "", /supera el límite/);
      assert.equal(http.logs.at(-1)?.outcome, "payload_too_large");
    } finally {
      await http.close();
    }
  });

  it("el rechazo por tamaño llega igual sin Content-Length (chunked)", async () => {
    const http = await startHttpHarness({ maxBodyBytes: 4096 });
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode("B".repeat(1024)));
          controller.close();
        },
      });
      const res = await fetch(http.mcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stream,
        // @ts-expect-error duplex es obligatorio en Node para un body de stream
        duplex: "half",
      });
      assert.equal(res.status, 413);
      await res.arrayBuffer();
    } finally {
      await http.close();
    }
  });

  it("una respuesta de export_diagram por encima del tope se sustituye por un error accionable", async () => {
    // 2 KB: cualquier export real lo supera, así que dispara el guard sin tener
    // que fabricar un diagrama gigante.
    const http = await startHttpHarness({ maxToolResultBytes: 2048 });
    try {
      const { client, close } = await connectHttpClient(http);
      try {
        const r = await client.callTool({ name: "export_diagram", arguments: { document: DOC } });
        assert.equal((r as { isError?: boolean }).isError, true);
        const texto = textBlocks(r).join("\n");
        assert.match(texto, /supera el límite/);
        assert.match(texto, /pageIndex/, "el mensaje debe explicar cómo reducir el diagrama");
        assert.match(texto, /stdio/, "y que en local no hay tope");
        assert.ok(!texto.includes("<svg"), "el SVG recortado no debe viajar de todos modos");
      } finally {
        await close();
      }
      assert.ok(
        http.logs.some(l => l.outcome === "response_too_large"),
        "el recorte debe quedar registrado como tal"
      );
    } finally {
      await http.close();
    }
  });

  it("por debajo del tope, export_diagram devuelve el SVG entero", async () => {
    const http = await startHttpHarness();
    try {
      const { client, close } = await connectHttpClient(http);
      try {
        const r = await client.callTool({ name: "export_diagram", arguments: { document: DOC } });
        assert.notEqual((r as { isError?: boolean }).isError, true);
        assert.match(textBlocks(r).join("\n"), /<svg/);
      } finally {
        await close();
      }
    } finally {
      await http.close();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8. gzip
   ═══════════════════════════════════════════════════════════════════════════ */

describe("compresión", () => {
  let http: HttpHarness;
  before(async () => { http = await startHttpHarness(); });
  after(async () => { await http?.close(); });

  it("una respuesta grande viaja comprimida y se descomprime intacta", async () => {
    const res = await postRaw(
      http.mcpUrl,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_icons", arguments: {} } }),
      { "Accept-Encoding": "gzip" }
    );
    assert.equal(res.status, 200);
    // fetch descomprime solo; que lo haya hecho se ve en que el cuerpo es JSON válido.
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    assert.match(body.result?.content?.[0]?.text ?? "", /kafka/);
  });

  it("sin Accept-Encoding la respuesta va sin comprimir", async () => {
    // Node añade `Accept-Encoding` por su cuenta en fetch, así que se usa el
    // servidor a pelo con una cabecera que excluye gzip explícitamente.
    const res = await postRaw(http.mcpUrl, initializeMessage(), { "Accept-Encoding": "identity" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), null);
    await res.arrayBuffer();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. Privacidad del log

   El test que sostiene la política de privacidad. Si esto se pone rojo, la
   política deja de ser cierta.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("el log no contiene datos del usuario", () => {
  const MARCADOR = "MARCADOR_SECRETO_9f3ab27c";

  it("ni las etiquetas, ni los argumentos, ni el documento aparecen en el log", async () => {
    const http = await startHttpHarness();
    try {
      const { client, close } = await connectHttpClient(http);
      try {
        await client.callTool({
          name: "create_diagram",
          arguments: {
            pageName: MARCADOR,
            nodes: [{ key: "n", shape: "rect", label: `Servidor ${MARCADOR}`, color: "Servicio" }],
          },
        });
        await client.callTool({ name: "export_diagram", arguments: { document: DOC } });
      } finally {
        await close();
      }

      const volcado = JSON.stringify(http.logs);
      assert.ok(!volcado.includes(MARCADOR), `el log filtró contenido del usuario:\n${volcado}`);
      // Y tampoco el contenido de un documento real.
      assert.ok(!volcado.includes("Kafka"), "el log filtró el contenido del documento");
      assert.ok(!volcado.includes("<svg"), "el log filtró el SVG exportado");
    } finally {
      await http.close();
    }
  });

  it("un documento inválido no lleva el mensaje de error al log (sí al modelo)", async () => {
    const http = await startHttpHarness();
    try {
      const { client, close } = await connectHttpClient(http);
      let respuesta = "";
      try {
        const r = await client.callTool({
          name: "export_diagram",
          arguments: { document: { doc: { theme: MARCADOR, pages: [] }, settings: {} } },
        });
        respuesta = textBlocks(r).join("\n");
        assert.equal((r as { isError?: boolean }).isError, true);
      } finally {
        await close();
      }

      // El valor del usuario SÍ va al modelo: es lo que le permite corregirlo.
      assert.ok(respuesta.includes(MARCADOR), "errors.ts debe seguir nombrando el valor al modelo");
      // Y NO va al log.
      assert.ok(!JSON.stringify(http.logs).includes(MARCADOR), "el mensaje de error se filtró al log");
    } finally {
      await http.close();
    }
  });

  it("sí registra tool, estado, duración y bytes", async () => {
    const http = await startHttpHarness();
    try {
      const { client, close } = await connectHttpClient(http);
      try {
        await client.callTool({ name: "list_fonts", arguments: {} });
      } finally {
        await close();
      }

      const entrada = http.logs.find(l => l.tools?.includes("list_fonts"));
      assert.ok(entrada, "no se registró la llamada a list_fonts");
      assert.equal(entrada.route, "/mcp");
      assert.equal(entrada.method, "POST");
      assert.equal(entrada.status, 200);
      assert.equal(entrada.outcome, "ok");
      assert.equal(typeof entrada.durationMs, "number");
      assert.ok(entrada.requestBytes > 0, "debe registrar el tamaño de la petición");
      assert.ok(entrada.responseBytes > 0, "debe registrar el tamaño de la respuesta");
    } finally {
      await http.close();
    }
  });

  it("no hay ningún campo del log donde quepa texto libre salvo los enumerados", async () => {
    const http = await startHttpHarness();
    try {
      const res = await fetch(`${http.base}/health`);
      await res.arrayBuffer();
      const permitidos = new Set([
        "route", "method", "status", "outcome", "durationMs",
        "requestBytes", "responseBytes", "tools", "toolErrors", "errorType",
      ]);
      for (const entrada of http.logs) {
        for (const clave of Object.keys(entrada)) {
          assert.ok(permitidos.has(clave), `campo inesperado en el log: "${clave}"`);
        }
      }
    } finally {
      await http.close();
    }
  });
});

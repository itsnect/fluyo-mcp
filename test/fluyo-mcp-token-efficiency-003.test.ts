/**
 * FLUYO-MCP-TOKEN-EFFICIENCY-003 — el enlace `#d=` como `document` (contrato §3 de FLUYO-MCP-TOKEN-EFFICIENCY-003.md).
 *
 *   T1. Catálogo: las 8 tools que reciben documento publican anyOf[objeto, string] con UNA description (que dice que con enlace
 *       baseRevision es obligatorio); las 3 de lectura, baseRevision opcional; tools/list ≤ 71 800 B (< 72 000; sobre FASE 5).
 *   T2. Equivalencia byte a byte: la sesión de la auditoría (N=10 y N=30, con pasos reverse:true), las 8 tools, dryRun, y el fixture
 *       fluyo-017-1-qa-complejo: con el enlace + baseRevision, cada respuesta es idéntica a la del JSON normalizado.
 *   T3. Orígenes: resumen de create_*, editorUrl, `#d=…` solo, otro prefijo (FLUYO_APP_URL) y un enlace de versión 0.
 *   T4. Enlace sin baseRevision → LINK_REVISION_REQUIRED, sin documento.
 *   T5. Enlace con otra revisión → LINK_REVISION_MISMATCH sin 'actual'; objeto con baseRevision errónea en las 3 de lectura →
 *       REVISION_MISMATCH con 'actual'; con la correcta, la respuesta de siempre.
 *   T6. Corrupción exhaustiva (todas las posiciones × 2 sustituciones de un enlace de 10 nodos): 0 aceptadas distintas; truncados,
 *       espacios, saltos de línea y '=' rechazados.
 *   T7. Topes y formatos: bomba de descompresión (too_large), versión desconocida, base64 no canónico, basura, JSON inválido.
 *   T8. El camino JSON no cambia: la sesión en modo JSON es, hash a hash, la de la base 3d9cda7 (FASE 5).
 *   T9. HTTP: el enlace funciona por Streamable HTTP y el log no contiene la carga.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../src/server.js";
import { LINK_MAX_BYTES, decodeLink, resolveDocument } from "../src/link-input.js";
import { openLink } from "../src/link.js";
import { createKernel } from "../src/kernel.js";
import { authorDocument } from "../src/authoring.js";
import { canonicalJson, normalizeWith, revisionOfProject } from "../src/revision.js";
import { isToolError, loadFixture, textBlocks, textOf } from "./helpers.js";
import { connectHttpClient, startHttpHarness } from "./http-helpers.js";
import { runSession, type Call, type SessionStep, type ToolResponse } from "./token-efficiency-003-session.js";

const DOC_TOOLS = ["export_diagram", "describe_document", "run_story", "author_document", "propose_layout", "set_theme", "reorder_nodes", "duplicate_node"];
const READ_TOOLS = ["export_diagram", "describe_document", "run_story"];
const REV_PATTERN = "^sha256:[0-9a-f]{64}$";
const OTHER_REV = "sha256:" + "0".repeat(64);

async function connect() {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "token-efficiency-003", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call: Call = (name, args) => client.callTool({ name, arguments: args }) as Promise<ToolResponse>;
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}
let h: Awaited<ReturnType<typeof connect>>;
/* Una sesión en modo JSON, una vez: su documento final, enlaces y revisiones sirven al resto de tests. */
let jsonSession: SessionStep[];
before(async () => {
  h = await connect();
  jsonSession = await runSession(h.call, { n: 10, mode: "json" });
});
after(async () => { await h.close(); });

const bytesOf = (r: ToolResponse) => JSON.stringify(r.content);
const json = (r: unknown) => JSON.parse(textBlocks(r)[1]);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const payloadOf = (link: string) => link.slice(link.indexOf("#d=") + 3);
const b64 = (bytes: number[] | Buffer) => Buffer.from(bytes).toString("base64url");

/** El documento, enlace y revisión que trajo la autoría de la sesión (paso 4: 10 nodos, Historia con pasos reverse:true). */
function authored() {
  const j = JSON.parse(jsonSession.find(s => s.tag.startsWith("4 "))!.response.content[1].text);
  return { doc: j.document, link: j.editorUrl as string, revision: j.resultRevision as string };
}
/** Argumentos mínimos de cada tool para un documento dado (Historia 1, nodo 2 en la página 0). */
const argsFor = (tool: string, document: unknown, baseRevision?: string): Record<string, unknown> => {
  const extra: Record<string, Record<string, unknown>> = {
    run_story: { storyId: 1 },
    author_document: { operations: [{ op: "rename_story", scope: "story", pageIndex: 0, storyId: 1, name: "Otra" }] },
    set_theme: { theme: "claro" },
    reorder_nodes: { pageIndex: 0, nodes: [{ id: 2 }], to: "front" },
    duplicate_node: { pageIndex: 0, nodes: [{ id: 2 }] },
  };
  return { document, ...(baseRevision === undefined ? {} : { baseRevision }), ...(extra[tool] ?? {}) };
};

/* ═══════════════ T1. Catálogo ═══════════════ */

describe("T1 · catálogo: document = objeto | enlace, baseRevision en las de lectura, tamaño", () => {
  it("las 8 tools que reciben documento publican anyOf[objeto, string] con una sola description en la unión", async () => {
    const { tools } = await h.client.listTools();
    assert.deepEqual(tools.filter(t => (t.inputSchema as any).properties?.document).map(t => t.name).sort(), [...DOC_TOOLS].sort());
    for (const t of tools.filter(x => DOC_TOOLS.includes(x.name))) {
      const d = (t.inputSchema as any).properties.document;
      assert.equal(d.anyOf.length, 2, t.name);
      assert.equal(d.anyOf[0].type, "object", t.name);
      assert.equal(d.anyOf[0].description, undefined, `${t.name}: la description va solo en la unión`);
      assert.deepEqual(d.anyOf[1], { type: "string" }, t.name);
      assert.match(d.description, /#d=/);
      assert.match(d.description, /EXACTO/);
      assert.match(d.description, /con enlace, baseRevision obligatorio/);
      assert.ok((t.inputSchema as any).required.includes("document"), t.name);
    }
  });

  it("export_diagram, describe_document y run_story publican baseRevision OPCIONAL con el regex de revisión", async () => {
    const { tools } = await h.client.listTools();
    for (const name of READ_TOOLS) {
      const s = tools.find(t => t.name === name)!.inputSchema as any;
      assert.equal(s.properties.baseRevision.type, "string", name);
      assert.equal(s.properties.baseRevision.pattern, REV_PATTERN, name);
      assert.ok(!(s.required ?? []).includes("baseRevision"), `${name}: baseRevision es opcional`);
    }
  });

  it("tools/list ≤ 71 800 B (medido 71 760 sobre FASE 5, que daba 71 447) y por debajo del tope de 72 000", async () => {
    const bytes = Buffer.byteLength(JSON.stringify(await h.client.listTools()));
    assert.ok(bytes <= 71_800, `tools/list = ${bytes} B`);
    assert.ok(bytes < 72_000);
  });
});

/* ═══════════════ T2. Equivalencia byte a byte ═══════════════ */

describe("T2 · con el enlace + baseRevision, cada respuesta es idéntica byte a byte a la del JSON", () => {
  for (const n of [10, 30]) {
    it(`la sesión de la auditoría con ${n} nodos (las 8 tools, reverse:true, dryRun, create_from_template)`, async () => {
      const a = n === 10 ? jsonSession : await runSession(h.call, { n, mode: "json" });
      const b = await runSession(h.call, { n, mode: "link" });
      assert.equal(a.length, b.length);
      assert.ok(b.filter(s => typeof s.args.document === "string").length >= 14, "el modo enlace pasa enlaces de verdad");
      assert.deepEqual([...new Set(b.filter(s => typeof s.args.document === "string").map(s => s.name))].sort(), [...DOC_TOOLS].sort());
      for (let i = 0; i < a.length; i++) {
        assert.equal(b[i].tag, a[i].tag);
        assert.equal(!!b[i].response.isError, false, `${b[i].tag}: ${textOf(b[i].response).slice(0, 300)}`);
        assert.equal(bytesOf(b[i].response), bytesOf(a[i].response), `${a[i].tag}: la respuesta con enlace difiere`);
      }
    });
  }

  it("FASE 5 por enlace: kind (Flujo/Requisito) y ruta observada se leen, exportan y editan igual que con el JSON", async () => {
    const created = await h.call("create_diagram", {
      pageName: "Workers",
      nodes: [{ key: "c", shape: "rect", label: "Cliente" }, { key: "a", shape: "rect", label: "API" }, { key: "w", shape: "rect", label: "Worker" },
        { key: "au", shape: "rect", label: "Auth" }],
      edges: [{ from: "c", to: "a", kind: "FLOWS_TO" }, { from: "a", to: "w", kind: "FLOWS_TO" }, { from: "a", to: "au", kind: "REQUIRES" }],
    });
    const rev0 = /^revision (sha256:[0-9a-f]{64}) /m.exec(textBlocks(created)[0])![1];
    const authored = json(await h.call("author_document", { document: json(created), baseRevision: rev0, operations: [
      { op: "create_event_type", scope: "eventType", ref: "go", name: "Pide", primitive: "FLOW", sentence: "{source} pide a {target}" },
      { op: "create_story", scope: "story", pageIndex: 0, name: "Pedido" },
      { op: "add_step", scope: "story", pageIndex: 0, storyId: 1, eventTypeId: { ref: "go" }, target: { from: 1, to: 2 } },
      { op: "set_observed_flow", scope: "story", pageIndex: 0, storyId: 1, source: 1, target: 3 },
    ] }));
    assert.equal(authored.ok, true, JSON.stringify(authored.errors));
    const { document: doc, editorUrl: link, resultRevision: revision } = authored;
    assert.deepEqual(doc.doc.pages[0].scenarios[0].observedFlow, { from: 1, to: 3 });
    assert.deepEqual(doc.doc.pages[0].edges.map((e: any) => e.kind ?? null), ["FLOWS_TO", "FLOWS_TO", "REQUIRES"]);
    const described = json(await h.call("describe_document", { document: link, baseRevision: revision }));
    assert.ok(JSON.stringify(described).includes("observedFlow") && JSON.stringify(described).includes("connectionKind"), "describe por enlace ve FASE 5");
    for (const [tool, extra] of [["describe_document", {}], ["export_diagram", {}], ["run_story", { storyId: 1 }], ["propose_layout", {}],
      ["author_document", { operations: [{ op: "set_observed_flow", scope: "story", pageIndex: 0, storyId: 1, source: null, target: null },
        { op: "update_connection", scope: "page", pageIndex: 0, connection: { id: doc.doc.pages[0].edges[2].id }, spec: { kind: null } }] }]] as Array<[string, Record<string, unknown>]>) {
      const viaJson = await h.call(tool, { document: doc, baseRevision: revision, ...extra });
      const viaLink = await h.call(tool, { document: link, baseRevision: revision, ...extra });
      assert.equal(!!viaLink.isError, false, `${tool}: ${textOf(viaLink).slice(0, 300)}`);
      assert.equal(bytesOf(viaLink), bytesOf(viaJson), tool);
    }
  });

  it("el fixture fluyo-017-1-qa-complejo, normalizado: describe, run_story, export, propose_layout y author_document", async () => {
    const N = normalizeWith(createKernel(), loadFixture("stories/fluyo-017-1-qa-complejo.fluyo.json"));
    assert.ok(N, "el fixture se normaliza");
    const revision = revisionOfProject(N), link = openLink(N);
    assert.equal(link.ok, true);
    if (!link.ok) return;
    const storyIds = json(await h.call("describe_document", { document: N })).pages[0].stories.map((s: any) => s.storyId);
    assert.ok(storyIds.length > 0);
    const cases: Array<[string, Record<string, unknown>]> = [
      ["describe_document", {}], ["describe_document", { includeSteps: false }], ["export_diagram", { crop: true }],
      ["propose_layout", {}], ...storyIds.map((storyId: number): [string, Record<string, unknown>] => ["run_story", { storyId }]),
      ["author_document", { operations: [{ op: "rename_story", scope: "story", pageIndex: 0, storyId: storyIds[0], name: "Renombrada" }] }],
    ];
    for (const [tool, extra] of cases) {
      const viaJson = await h.call(tool, { document: N, baseRevision: revision, ...extra });
      const viaLink = await h.call(tool, { document: link.url, baseRevision: revision, ...extra });
      assert.equal(!!viaLink.isError, false, `${tool}: ${textOf(viaLink).slice(0, 300)}`);
      assert.equal(bytesOf(viaLink), bytesOf(viaJson), `${tool} ${JSON.stringify(extra)}`);
    }
  });
});

/* ═══════════════ T3. Orígenes del enlace ═══════════════ */

describe("T3 · de dónde puede venir el enlace", () => {
  it("el del resumen de create_* y el editorUrl de la autoría, tal cual los devolvió la respuesta anterior", async () => {
    const b = await runSession(h.call, { n: 10, mode: "link" });
    const created = b[0].response.content[0].text, firstLink = b[1].args.document as string;
    assert.ok(created.includes(firstLink), "la autoría recibe el enlace del resumen de create_diagram");
    assert.equal(b[2].args.document, json(b[1].response).editorUrl, "run_story recibe el editorUrl de la autoría");
    const template = b.find(s => s.name === "create_from_template")!, after = b[b.length - 1];
    assert.ok(template.response.content[0].text.includes(after.args.document as string), "y el del resumen de create_from_template");
  });

  it("`#d=…` solo, otro prefijo (FLUYO_APP_URL de un self-host) y un enlace de versión 0 (UTF-8) dan la misma respuesta", async () => {
    const { doc, link, revision } = authored();
    const expected = bytesOf(await h.call("describe_document", { document: doc }));
    const N = normalizeWith(createKernel(), doc);
    const selfHost = openLink(N, { FLUYO_APP_URL: "https://diagramas.example.org/fluyo/" } as NodeJS.ProcessEnv);
    assert.equal(selfHost.ok, true);
    const variants = {
      "solo #d=": link.slice(link.indexOf("#")),
      "self-host": selfHost.ok ? selfHost.url : "",
      "versión 0": `https://fluyo.space/#d=${b64(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify(N), "utf8")]))}`,
    };
    assert.match(variants["self-host"], /^https:\/\/diagramas\.example\.org\/fluyo\/#d=/);
    for (const [name, document] of Object.entries(variants)) {
      const r = await h.call("describe_document", { document, baseRevision: revision });
      assert.equal(!!r.isError, false, `${name}: ${textOf(r).slice(0, 200)}`);
      assert.equal(bytesOf(r), expected, name);
    }
  });
});

/* ═══════════════ T4. Revisión obligatoria ═══════════════ */

describe("T4 · un enlace sin baseRevision no se ejecuta", () => {
  it("export_diagram, describe_document, run_story y propose_layout → LINK_REVISION_REQUIRED, sin documento", async () => {
    const { link } = authored();
    for (const tool of [...READ_TOOLS, "propose_layout"]) {
      const r = await h.call(tool, argsFor(tool, link));
      assert.equal(isToolError(r), true, tool);
      if (tool === "propose_layout") {
        const j = json(r);
        assert.deepEqual([j.ok, j.errors[0].code], [false, "LINK_REVISION_REQUIRED"]);
        assert.equal(j.document, undefined);
        assert.equal(j.batches, undefined);
      } else {
        assert.match(textOf(r), /^Error: LINK_REVISION_REQUIRED: /, tool);
        assert.equal(textBlocks(r).length, 1, `${tool}: sin 2.º bloque`);
      }
    }
  });

  it("author_document y las tools de una operación ya exigen baseRevision en el schema; en el dominio, un enlace sin ella → LINK_REVISION_REQUIRED", async () => {
    const { link } = authored();
    for (const tool of ["author_document", "set_theme", "reorder_nodes", "duplicate_node"]) {
      const r = await h.call(tool, argsFor(tool, link));
      assert.equal(isToolError(r), true, tool);
      assert.doesNotMatch(textOf(r), /"version":5/, `${tool}: no devuelve documento`);
    }
    const d: any = authorDocument({ document: link, baseRevision: undefined as unknown as string, operations: [{ op: "set_theme", scope: "document", theme: "claro" }] });
    assert.deepEqual([d.ok, d.errors[0].code, d.document], [false, "LINK_REVISION_REQUIRED", undefined]);
  });
});

/* ═══════════════ T5. Revisión que no coincide ═══════════════ */

describe("T5 · revisión que no coincide", () => {
  it("enlace + otra revisión → LINK_REVISION_MISMATCH en las 8 tools, SIN 'actual' y sin documento", async () => {
    const { link } = authored();
    for (const tool of DOC_TOOLS) {
      const r = await h.call(tool, argsFor(tool, link, OTHER_REV));
      assert.equal(isToolError(r), true, tool);
      const text = textOf(r);
      assert.doesNotMatch(text, /actual/i, `${tool}: no debe invitar a reintentar con la revisión de lo copiado`);
      assert.doesNotMatch(text, /"version":5|<svg/, `${tool}: sin documento ni SVG`);
      if (READ_TOOLS.includes(tool)) {
        assert.match(text, /^Error: LINK_REVISION_MISMATCH: .*No reintentes con otra revisión\./, tool);
      } else {
        const j = json(r);
        assert.deepEqual([j.ok, j.errors[0].code], [false, "LINK_REVISION_MISMATCH"], tool);
        assert.match(j.errors[0].message, /copia inexacta/);
        assert.equal(j.actualRevision, undefined, tool);
      }
    }
  });

  it("objeto + baseRevision errónea en las 3 de lectura → REVISION_MISMATCH con 'actual'; con la correcta, la respuesta de siempre", async () => {
    const { doc, revision } = authored();
    for (const tool of READ_TOOLS) {
      const wrong = await h.call(tool, argsFor(tool, doc, OTHER_REV));
      assert.equal(isToolError(wrong), true, tool);
      assert.match(textOf(wrong), new RegExp(`^Error: REVISION_MISMATCH: baseRevision no coincide.* actual: ${revision}$`, "s"), tool);
      const plain = await h.call(tool, argsFor(tool, doc));
      const right = await h.call(tool, argsFor(tool, doc, revision));
      assert.equal(bytesOf(right), bytesOf(plain), `${tool}: con la revisión correcta no cambia nada`);
    }
  });
});

/* ═══════════════ T6. Corrupción ═══════════════ */

describe("T6 · una copia inexacta nunca llega como otro documento", () => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  it("todas las posiciones × 2 sustituciones de un carácter: 0 aceptadas distintas del documento de esa revisión", () => {
    const { doc, link, revision } = authored();
    const original = canonicalJson(normalizeWith(createKernel(), doc));
    const start = link.indexOf("#d=") + 3;
    const count = { rejected: 0, acceptedSame: 0, acceptedDifferent: 0 };
    for (let i = start; i < link.length; i++) {
      for (const k of [7, 31]) {
        const m = link.slice(0, i) + A[(A.indexOf(link[i]) + k) % 64] + link.slice(i + 1);
        const r = resolveDocument(m, revision);
        if (!r.ok) { count.rejected++; continue; }
        if (canonicalJson(r.document) === original) count.acceptedSame++; else count.acceptedDifferent++;
      }
    }
    assert.equal(count.acceptedDifferent, 0, JSON.stringify(count));
    assert.equal(count.rejected + count.acceptedSame, 2 * (link.length - start));
    assert.ok(count.rejected > 0.95 * 2 * (link.length - start), JSON.stringify(count));
  });

  it("truncados (1–199 caracteres menos), espacios, saltos de línea y '=' se rechazan", () => {
    const { link, revision } = authored();
    for (let cut = 1; cut < 200; cut++) {
      const r = resolveDocument(link.slice(0, -cut), revision);
      assert.equal(r.ok, false, `truncado ${cut}`);
      if (!r.ok) assert.ok(["DOCUMENT_LINK_UNREADABLE", "LINK_REVISION_MISMATCH"].includes(r.error.code), r.error.code);
    }
    const mid = link.indexOf("#d=") + 200;
    for (const [name, bad] of [["espacio final", link + " "], ["espacio inicial", " " + link], ["salto de línea", link.slice(0, mid) + "\n" + link.slice(mid)],
      ["CRLF final", link + "\r\n"], ["relleno =", link + "="], ["algo tras la carga", link + "&x=1"]]) {
      const r = resolveDocument(bad, revision);
      assert.equal(r.ok, false, name);
      if (!r.ok) assert.deepEqual([r.error.code, "reason" in r.error ? r.error.reason : null], ["DOCUMENT_LINK_UNREADABLE", "format"], name);
    }
  });
});

/* ═══════════════ T7. Topes y formatos ═══════════════ */

describe("T7 · topes y formatos del enlace", () => {
  const reasonOf = (s: string) => { const r = decodeLink(s); return r.ok ? "ok" : "reason" in r.error ? r.error.reason : r.error.code; };

  it("bomba de descompresión: un enlace de ~4 KB que se expande a 3 MB → too_large, también por la tool", async () => {
    const bomb = `#d=${b64(Buffer.concat([Buffer.from([1]), deflateRawSync(Buffer.alloc(3 * 1024 * 1024, 32), { level: 9 })]))}`;
    assert.ok(bomb.length < 8_000);
    assert.equal(reasonOf(bomb), "too_large");
    const r = await h.call("describe_document", { document: bomb, baseRevision: OTHER_REV });
    assert.match(textOf(r), /^Error: DOCUMENT_LINK_UNREADABLE \(too_large\): /);
    assert.equal(LINK_MAX_BYTES, 2 * 1024 * 1024, "el DEEP_LINK_MAX_BYTES de fluyo/js/link-codec.js");
    // exactamente en el tope se lee; un byte más, no
    const at = (n: number) => `#d=${b64(Buffer.concat([Buffer.from([1]), deflateRawSync(Buffer.from(`"${" ".repeat(n - 2)}"`), { level: 9 })]))}`;
    assert.equal(reasonOf(at(LINK_MAX_BYTES)), "ok");
    assert.equal(reasonOf(at(LINK_MAX_BYTES + 1)), "too_large");
    const v0 = `#d=${b64(Buffer.concat([Buffer.from([0]), Buffer.alloc(LINK_MAX_BYTES + 1, 32)]))}`;
    assert.equal(reasonOf(v0), "too_large");
  });

  it("versión desconocida, base64 no canónico, basura, deflate roto y JSON inválido", () => {
    assert.equal(reasonOf(`#d=${b64([2, 1, 2, 3])}`), "version");
    assert.equal(reasonOf("#d=AR"), "base64", "bits de relleno no nulos: no es la forma canónica");
    assert.equal(reasonOf("#d=A"), "base64");
    assert.equal(reasonOf("hola"), "format");
    assert.equal(reasonOf("https://fluyo.space/"), "format");
    assert.equal(reasonOf("#d="), "format");
    assert.equal(reasonOf(`#d=${b64([1, 0xff, 0xff, 0xff, 0xff])}`), "decode");
    assert.equal(reasonOf(`#d=${b64(Buffer.concat([Buffer.from([0]), Buffer.from("no es json")]))}`), "json");
    assert.equal(reasonOf(`#d=${b64(Buffer.concat([Buffer.from([1]), deflateRawSync(Buffer.from("{roto"))]))}`), "json");
  });
});

/* ═══════════════ T8. El camino JSON no cambia ═══════════════ */

describe("T8 · con el documento como objeto, cada respuesta es la de la base 3d9cda7 (FASE 5)", () => {
  const golden = loadFixture("mcp-token-efficiency-003-golden.json") as {
    base: string; sessions: Record<string, Array<{ tag: string; isError: boolean; bytes: number; sha256: string }>>;
  };
  for (const n of [10, 30]) {
    it(`sesión de ${n} nodos en modo JSON: hash a hash igual que en ${golden.base}`, async () => {
      const steps = n === 10 ? jsonSession : await runSession(h.call, { n, mode: "json" });
      assert.deepEqual(
        steps.map(s => ({ tag: s.tag, isError: !!s.response.isError, bytes: Buffer.byteLength(bytesOf(s.response)), sha256: sha(bytesOf(s.response)) })),
        golden.sessions[n]
      );
    });
  }
});

/* ═══════════════ T9. HTTP ═══════════════ */

describe("T9 · por Streamable HTTP", () => {
  it("el enlace funciona igual que el JSON y el log de la petición no contiene la carga", async () => {
    const harness = await startHttpHarness();
    const { client, close } = await connectHttpClient(harness);
    try {
      const { doc, link, revision } = authored();
      const viaJson = await client.callTool({ name: "run_story", arguments: { document: doc, storyId: 1 } });
      const viaLink = await client.callTool({ name: "run_story", arguments: { document: link, baseRevision: revision, storyId: 1 } });
      assert.equal(isToolError(viaLink), false, textOf(viaLink).slice(0, 300));
      assert.equal(JSON.stringify(viaLink.content), JSON.stringify(viaJson.content));
      const logged = JSON.stringify(harness.logs);
      assert.ok(harness.logs.some(l => l.tools?.includes("run_story")), "la petición se registró");
      assert.ok(!logged.includes(payloadOf(link).slice(0, 40)), "el log no contiene la carga del enlace");
      assert.ok(!logged.includes("#d="), "ni el enlace");
    } finally {
      await close();
      await harness.close();
    }
  });
});

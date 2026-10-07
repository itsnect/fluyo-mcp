/**
 * FLUYO-018.10 — retirada de edit_diagram (15 tools) sin perder la capacidad de abrir el resultado en Fluyo.
 *
 * Lo que se prueba:
 *   · D1: author_document (y set_theme / reorder_nodes / duplicate_node, que lo llaman) devuelve `editorUrl`: el enlace #d= al documento
 *     FINAL, con la MISMA codificación que create_diagram / create_from_template (una sola implementación, link.ts). Decodificado es el
 *     documento devuelto byte a byte: multipágina, tema, Historias, EventTypes y Behaviors. Si no cabe: sin enlace, LINK_TOO_LARGE, sin
 *     truncar. dryRun y rechazos: sin enlace. La entrada no se muta;
 *   · la retirada: edit_diagram no está en tools/list (en memoria, stdio) ni se puede invocar; 15 tools con title y anotaciones;
 *   · lo que hacía edit_diagram sigue cubierto: author_document (crear, modificar, retarget, eliminar, tema, renombrar, Z, duplicar,
 *     delete_page) y propose_layout (solo lectura) → lotes;
 *   · ningún resto de la ruta legacy en src/.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { MAX_LINK_CHARS } from "../src/link.js";
import { documentOf, isToolError, packageRoot, startHarness, textBlocks, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const NO_LEAK = /TypeError|Cannot read|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;
const blank = (): any => createKernel().call("serializeProject()");

/** El lector del navegador (deeplink.js + link-codec.js), en Node: base64url([versión] + deflate-raw(JSON)). */
function decode(url: string): { version: number; text: string } {
  const payload = /#d=([A-Za-z0-9\-_]+)$/.exec(url)?.[1];
  assert.ok(payload, `la URL no termina en un #d= legible: ${url.slice(0, 60)}…`);
  const bytes = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const body = bytes[0] === 1 ? inflateRawSync(bytes.subarray(1)) : bytes.subarray(1);
  return { version: bytes[0], text: body.toString("utf8") };
}
const linkInSummary = (res: unknown): string | null => /(https?:\/\/\S+#d=[A-Za-z0-9\-_]+)/.exec(textBlocks(res)[0] ?? "")?.[1] ?? null;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => {
  const r = await author(document, operations, extra);
  return documentOf(r);
};

/* Documento rico: dos páginas, tema y fondo, conexiones, Behaviors (disponibilidad inicial), EventTypes e Historias. */
const N = (pageIndex: number, ref: string, x: number, label: string, extra: Record<string, unknown> = {}) => ({ op: "create_node", scope: "page", pageIndex, ref, spec: { shape: "rect", x, y: 0, label, ...extra } });
const C = (pageIndex: number, s: string, t: string, ref?: string) => ({ op: "create_connection", scope: "page", pageIndex, source: { ref: s }, target: { ref: t }, ...(ref ? { ref } : {}) });
const RICH_OPS = [
  { op: "set_theme", scope: "document", theme: "crema", customBg: "#102030" },
  { op: "rename_page", scope: "document", pageIndex: 0, name: "Pagos" },
  N(0, "cli", 0, "Cliente"), N(0, "com", 300, "Comercio"), N(0, "ban", 600, "Banco", { shape: "cylinder" }),
  C(0, "cli", "com", "c1"), C(0, "com", "ban", "c2"),
  { op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: { ref: "ban" }, state: "DOWN" },
  { op: "create_event_type", scope: "eventType", name: "Pago", primitive: "FLOW", sentence: "{source} paga a {target}", symbol: "💵", ref: "pago" },
  { op: "create_event_type", scope: "eventType", name: "Alerta", primitive: "OCCURRENCE", sentence: "{target} avisa", ref: "alerta" },
  { op: "create_story", scope: "story", pageIndex: 0, name: "Compra", ref: "s" },
  { op: "add_step", scope: "story", pageIndex: 0, storyId: { ref: "s" }, eventTypeId: { ref: "pago" }, target: { edgeId: { ref: "c1" } } },
  { op: "add_step", scope: "story", pageIndex: 0, storyId: { ref: "s" }, eventTypeId: { ref: "alerta" }, target: { nodeId: { ref: "ban" } } },
  { op: "create_page", scope: "document", name: "Envíos" },
  N(1, "alm", 0, "Almacén"), N(1, "cam", 300, "Camión", { shape: "icon", icon: "kafka" }), C(1, "alm", "cam"),
];

describe("D1: author_document devuelve el enlace #d= al documento FINAL", () => {
  it("editorUrl: misma codificación (v1 deflate-raw), base de la app y, decodificado, el documento devuelto byte a byte", async () => {
    const r = await authorJson(blank(), RICH_OPS);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(typeof r.editorUrl, "string");
    assert.match(r.editorUrl, /^https:\/\/fluyo\.space\/#d=[A-Za-z0-9\-_]+$/);
    const d = decode(r.editorUrl);
    assert.equal(d.version, 1);
    assert.equal(d.text, JSON.stringify(r.document), "el enlace lleva exactamente el documento final");
    assert.equal(rev(JSON.parse(d.text)), r.resultRevision);
  });

  it("multipágina, tema y fondo, Historias, EventTypes y Behaviors viajan en el enlace", async () => {
    const r = await authorJson(blank(), RICH_OPS);
    const doc = JSON.parse(decode(r.editorUrl).text);
    assert.deepEqual(doc.doc.pages.map((p: any) => p.name), ["Pagos", "Envíos"]);
    assert.deepEqual([doc.doc.theme, doc.doc.customBg], ["crema", "#102030"]);
    assert.deepEqual(doc.doc.eventTypes.map((e: any) => [e.name, e.primitive]), [["Pago", "FLOW"], ["Alerta", "OCCURRENCE"]]);
    assert.equal(doc.doc.pages[0].scenarios[0].name, "Compra");
    assert.equal(doc.doc.pages[0].scenarios[0].steps.length, 2);
    assert.equal(doc.doc.pages[0].behaviors.length, 1);
    assert.deepEqual([doc.doc.pages[0].edges.length, doc.doc.pages[1].edges.length], [2, 1]);
  });

  it("la descripción publicada de author_document documenta editorUrl y LINK_TOO_LARGE", async () => {
    const d = (await h.client.listTools()).tools.find(t => t.name === "author_document")!.description!;
    for (const w of ["editorUrl", "#d=", "LINK_TOO_LARGE"]) assert.ok(d.includes(w), w);
  });

  it("el resumen trae el mismo enlace, como create_diagram", async () => {
    const res = await author(blank(), RICH_OPS);
    const j = documentOf(res);
    assert.equal(linkInSummary(res), j.editorUrl);
    assert.match(textBlocks(res)[0], /Ábrelo en Fluyo: /);
  });

  it("create_diagram y create_from_template: el mismo tipo de enlace (misma función), decodificado = su documento", async () => {
    for (const [tool, args] of [
      ["create_diagram", { nodes: [{ key: "a", shape: "rect" }, { key: "b", shape: "code" }], edges: [{ from: "a", to: "b" }] }],
      ["create_from_template", { templateId: "rag_chatbot" }],
    ] as const) {
      const res = await call(tool, args);
      const url = linkInSummary(res);
      assert.ok(url, tool);
      const d = decode(url!);
      assert.equal(d.version, 1);
      assert.equal(d.text, JSON.stringify(documentOf(res)), `${tool}: el enlace lleva su documento`);
    }
  });

  it("las tools de una operación (set_theme, reorder_nodes, duplicate_node) heredan el enlace", async () => {
    const base = (await authorJson(blank(), RICH_OPS)).document;
    for (const [tool, args] of [
      ["set_theme", { theme: "claro" }],
      ["reorder_nodes", { pageIndex: 0, nodes: [{ id: 1 }], to: "front" }],
      ["duplicate_node", { pageIndex: 0, nodes: [{ id: 1 }] }],
    ] as const) {
      const res = await call(tool, { document: base, baseRevision: rev(base), ...args });
      assert.equal(isToolError(res), false, textOf(res));
      const j = documentOf(res);
      assert.equal(decode(j.editorUrl).text, JSON.stringify(j.document), tool);
    }
  });

  it("dryRun y rechazos no traen enlace (no hay documento)", async () => {
    const dry = await authorJson(blank(), RICH_OPS, { dryRun: true });
    assert.equal(dry.ok, true);
    assert.equal("editorUrl" in dry, false);
    assert.equal("editorUrlError" in dry, false);
    const bad = await author(blank(), [C(0, "x", "y")]);
    assert.equal(isToolError(bad), true);
    assert.equal("editorUrl" in documentOf(bad), false);
    assert.equal(linkInSummary(bad), null);
  });

  it("un documento que no cabe: sin enlace, LINK_TOO_LARGE estructurado, sin truncar, y el documento se devuelve igual", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const text = () => Array.from({ length: 480 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rnd() * 36)]).join("");
    const ops = Array.from({ length: 120 }, (_, i) => N(0, `n${i}`, (i % 12) * 200, text()));
    const res = await author(blank(), ops);
    assert.equal(isToolError(res), false, textOf(res));
    const j = documentOf(res);
    assert.equal(j.ok, true);
    assert.ok(j.document, "el documento se devuelve aunque no quepa en un enlace");
    assert.equal("editorUrl" in j, false);
    assert.equal(j.editorUrlError.code, "LINK_TOO_LARGE");
    assert.equal(j.editorUrlError.maxChars, MAX_LINK_CHARS);
    assert.ok(j.editorUrlError.chars > MAX_LINK_CHARS);
    assert.equal(linkInSummary(res), null, "no se emite un enlace truncado");
    assert.match(textBlocks(res)[0], /no cabe en un enlace/);
    assert.equal(NO_LEAK.test(textOf(res)), false);
  });

  it("no se muta la entrada", async () => {
    const input = blank();
    const copy = clone(input);
    await author(input, RICH_OPS);
    assert.deepEqual(input, copy);
  });

  it("FLUYO_APP_URL se respeta igual que en create_diagram (misma base)", async () => {
    const prev = process.env.FLUYO_APP_URL;
    process.env.FLUYO_APP_URL = "http://127.0.0.1:9/";
    try {
      const j = await authorJson(blank(), [N(0, "a", 0, "A")]);
      assert.match(j.editorUrl, /^http:\/\/127\.0\.0\.1:9\/#d=/);
      assert.match(linkInSummary(await call("create_diagram", { nodes: [{ key: "a", shape: "rect" }] }))!, /^http:\/\/127\.0\.0\.1:9\/#d=/);
    } finally {
      if (prev === undefined) delete process.env.FLUYO_APP_URL; else process.env.FLUYO_APP_URL = prev;
    }
  });
});

/* ═══════════════ Retirada de edit_diagram ═══════════════ */

const CONTRACT = ["author_document", "create_diagram", "create_from_template", "describe_document", "duplicate_node", "export_diagram", "list_anims",
  "list_colors", "list_fonts", "list_icons", "list_templates", "propose_layout", "reorder_nodes", "run_story", "set_theme"];

describe("retirada: edit_diagram ya no forma parte del contrato", () => {
  it("tools/list: exactamente las 15 del contrato, sin edit_diagram, todas con title y las 4 anotaciones de función pura", async () => {
    const { tools } = await h.client.listTools();
    assert.equal(tools.length, 15);
    assert.deepEqual(tools.map(t => t.name).sort(), CONTRACT);
    for (const t of tools) {
      assert.ok(t.title, t.name);
      assert.deepEqual(t.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, t.name);
      assert.doesNotMatch(JSON.stringify(t), /edit_diagram|relayout/, `${t.name}: ninguna descripción ni schema remite a la tool retirada`);
    }
  });

  it("no se puede invocar: error de tool inexistente, sin documento ni trazas", async () => {
    const r = await call("edit_diagram", { document: blank(), operations: [{ op: "rename_page", name: "x" }] });
    assert.equal(isToolError(r), true);
    assert.match(textOf(r), /edit_diagram/);
    assert.match(textOf(r), /not found|no encontrad|no existe/i);
    assert.equal(textBlocks(r).length, 1, "ningún bloque de documento");
    assert.equal(NO_LEAK.test(textOf(r)), false);
  });

  it("scripts/verify-deploy.sh espera exactamente las tools del servidor (15)", () => {
    const sh = readFileSync(join(ROOT, "scripts", "verify-deploy.sh"), "utf8");
    const list = /const EXPECTED = \[([\s\S]*?)\];/.exec(sh)![1];
    assert.deepEqual([...list.matchAll(/"([a-z_]+)"/g)].map(m => m[1]).sort(), CONTRACT);
    assert.match(sh, /las 15 tools del contrato/);
    assert.doesNotMatch(sh, /edit_diagram|16 tools/);
  });

  it("búsqueda estática: no queda la ruta legacy en src/ (ni handler, ni schema de operaciones, ni builders, ni relayout)", () => {
    const dir = join(ROOT, "src");
    const files = readdirSync(dir).filter(f => f.endsWith(".ts")).map(f => [f, readFileSync(join(dir, f), "utf8")] as const);
    assert.ok(files.length > 10);
    for (const [f, text] of files) {
      for (const re of [/edit_diagram/, /\beditDiagram\b/, /\bEditDiagramInput\b/, /\bOperationSchema\b/, /\beditNodeFields\b/, /\beditEdgeFields\b/,
        /\bbuildNode\b/, /\bbuildEdge\b/, /\bresolveColor\b/, /\bNodeBuildSpec\b/, /\bdescribeInternalIssues\b/, /\brelayout\b/]) {
        assert.doesNotMatch(text, re, `${f}: ${re}`);
      }
    }
  });

  it("el módulo diagram no exporta ningún handler legacy (aunque no estuviera registrado)", async () => {
    const mod: Record<string, unknown> = await import("../src/diagram.js");
    assert.deepEqual(Object.keys(mod).filter(k => typeof mod[k] === "function" && !/^[A-Z]/.test(k)).sort(),
      ["createDiagram", "createDiagramResult", "createFromTemplateResult", "parseDocument"]);
  });
});

describe("lo que hacía edit_diagram sigue cubierto: author_document + propose_layout", () => {
  it("un lote: crear, mover, redimensionar, estilo, retarget, eliminar, tema, renombrar, crear/eliminar página, orden Z y duplicar", async () => {
    const base = (await authorJson(blank(), RICH_OPS)).document;
    const r = await authorJson(base, [
      N(0, "mon", 900, "Monitor", { shape: "icon", icon: "ai", color: "#9b7fb5" }),
      { op: "create_connection", scope: "page", pageIndex: 0, source: { id: 3 }, target: { ref: "mon" }, spec: { label: "métricas", lineColor: "#c16a6a" } },
      { op: "update_node", scope: "page", pageIndex: 0, node: { id: 1 }, spec: { x: 40, y: 60, w: 220, h: 90, label: "Cliente final", pulse: true, color: "#6a9fb5", border: "dashed" } },
      { op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 5 }, target: { id: 3 }, spec: { label: "directo", route: "ortho", dashed: true } },
      { op: "delete_connection", scope: "page", pageIndex: 1, connection: { id: 3 } },
      { op: "set_theme", scope: "document", theme: "claro" },
      { op: "rename_page", scope: "document", pageIndex: 1, name: "Logística" },
      { op: "reorder_nodes", scope: "page", pageIndex: 0, nodes: [{ id: 1 }], to: "front" },
      { op: "duplicate_node", scope: "page", pageIndex: 1, nodes: [{ source: { id: 1 }, ref: "copia" }] },
      { op: "create_page", scope: "document", name: "Temporal" },
      { op: "delete_page", scope: "document", pageIndex: 2, expectedName: "Temporal" },
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const d = r.document, p0 = d.doc.pages[0], p1 = d.doc.pages[1];
    assert.deepEqual([d.doc.theme, d.doc.pages.map((p: any) => p.name)], ["claro", ["Pagos", "Logística"]]);
    const cli = p0.nodes.find((n: any) => n.id === 1);
    assert.deepEqual([cli.x, cli.y, cli.w, cli.h, cli.label, cli.pulse, cli.border], [40, 60, 220, 90, "Cliente final", true, "dashed"]);
    assert.equal(p0.nodes.at(-1).id, 1, "orden Z: al frente");
    assert.equal(p0.nodes.find((n: any) => n.label === "Monitor").icon, "ai");
    const e5 = p0.edges.find((e: any) => e.id === 5);
    assert.deepEqual([e5.to, e5.route, e5.label], [3, "ortho", "directo"]);
    assert.equal(p1.edges.length, 0);
    assert.equal(p1.nodes.length, 3, "duplicado");
    assert.equal(decode(r.editorUrl).text, JSON.stringify(d), "y el enlace al resultado");
  });

  it("delete_node elimina un elemento con sus conexiones (antes remove_node)", async () => {
    const base = (await authorJson(blank(), RICH_OPS)).document;
    const r = await authorJson(base, [{ op: "delete_node", scope: "page", pageIndex: 1, node: { id: 2 } }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual([r.document.doc.pages[1].nodes.length, r.document.doc.pages[1].edges.length], [1, 0]);
  });

  it("relayout → propose_layout (solo lectura: no muta la entrada ni devuelve documento) y sus lotes por author_document", async () => {
    const base = (await authorJson(blank(), RICH_OPS)).document;
    const frozen = JSON.stringify(base);
    const plan = documentOf(await call("propose_layout", { document: base, pageIndex: 0 }));
    assert.equal(plan.ok, true);
    assert.equal(JSON.stringify(base), frozen);
    assert.equal("document" in plan, false);
    assert.ok(plan.batches.length >= 1);
    let doc = base;
    for (const b of plan.batches) {
      const r = await authorJson(doc, b.operations);
      assert.equal(r.ok, true, JSON.stringify(r.errors));
      doc = r.document;
    }
    assert.deepEqual(doc.doc.pages[0].nodes.map((n: any) => [n.id, n.x, n.y]), plan.positions.map((q: any) => [q.id, q.x, q.y]));
    assert.equal((await authorJson(doc, [{ op: "set_theme", scope: "document", theme: "crema" }])).ok, true, "el resultado se sigue editando");
  });

  it("D2 (pérdida aceptada, decisión 87): no se cambia icon/anim de un elemento existente; el sustituto es eliminar y crear (ids nuevos) y B2 lo bloquea si una Historia lo usa", async () => {
    const base = (await authorJson(blank(), RICH_OPS)).document;
    const noIcon = await author(base, [{ op: "update_node", scope: "page", pageIndex: 1, node: { id: 2 }, spec: { icon: "ai" } }]);
    assert.equal(isToolError(noIcon), true);
    assert.equal(NO_LEAK.test(textOf(noIcon)), false);
    const toIcon = await author(base, [{ op: "update_node", scope: "page", pageIndex: 0, node: { id: 1 }, spec: { shape: "icon" } }]);
    assert.equal(isToolError(toIcon), true, "el schema publicado de update_node solo admite las formas del selector del editor");
    assert.match(textOf(toIcon), /rect/);
    assert.equal(NO_LEAK.test(textOf(toIcon)), false);
    const swap = await authorJson(base, [
      { op: "delete_node", scope: "page", pageIndex: 1, node: { id: 2 } },
      N(1, "nuevo", 500, "Camión", { shape: "icon", icon: "ai" }),
      { op: "create_connection", scope: "page", pageIndex: 1, source: { id: 1 }, target: { ref: "nuevo" } },
    ]);
    assert.equal(swap.ok, true, JSON.stringify(swap.errors));
    assert.ok(swap.refs.find((x: any) => x.ref === "nuevo").id > 3, "id nuevo");
    const blocked = await authorJson(base, [{ op: "delete_node", scope: "page", pageIndex: 0, node: { id: 3 } }]);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "REFERENCED_ENTITY");
  });
});

describe("servidor real por stdio: 15 tools, sin edit_diagram, y author_document con editorUrl", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-10", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  it("tools/list, edit_diagram inexistente, author_document → editorUrl = documento, describe_document coherente", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), CONTRACT);
    const gone = await client.callTool({ name: "edit_diagram", arguments: { document: blank(), operations: [] } });
    assert.equal(isToolError(gone), true);
    const b = blank();
    const r = documentOf(await client.callTool({ name: "author_document", arguments: { document: b, baseRevision: rev(b), operations: RICH_OPS } }));
    assert.equal(r.ok, true);
    assert.equal(decode(r.editorUrl).text, JSON.stringify(r.document));
    const d = documentOf(await client.callTool({ name: "describe_document", arguments: { document: JSON.parse(decode(r.editorUrl).text) } }));
    assert.deepEqual([d.valid, d.revision], [true, r.resultRevision]);
  });
});

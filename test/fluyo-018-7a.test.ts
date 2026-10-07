/**
 * FLUYO-018.7a — set_theme, reorder_nodes y duplicate_node (tools nº 14–16, y operaciones de author_document) y lectura de
 * theme/customBg/z en describe_document.
 *
 * Lo que se prueba:
 *   · las tres tools son la MISMA operación de author_document (misma respuesta, mismo kernel, misma revisión);
 *   · golden compartido con Fluyo (fixtures/stories/fluyo-018-7a-golden.json): editor real y kernel dan la misma resultRevision;
 *   · describe_document publica theme, customBg, capabilities.themes y z (0 = fondo) sin tocar el resto del contrato;
 *   · reglas de entrada (HEX, tema, placement, límites), refs de copias, errores estructurados y sin trazas;
 *   · el servidor real por stdio publica 16 tools y el flujo describe → set_theme → reorder_nodes → duplicate_node funciona de punta a punta.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const golden = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "stories", "fluyo-018-7a-golden.json"), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const NO_LEAK = /TypeError|Cannot read|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => documentOf(await author(document, operations, extra));
const ids = (d: any, pi = 0): number[] => d.doc.pages[pi].nodes.map((n: any) => n.id);

describe("golden compartido con Fluyo", () => {
  it("la revisión del documento base y la de cada resultado coinciden con las del editor real y el kernel de Fluyo", async () => {
    assert.equal(rev(golden.document), golden.baseRevision);
    for (const c of golden.cases) {
      const r = await authorJson(golden.document, c.operations);
      assert.equal(r.ok, true, `${c.name}: ${JSON.stringify(r.errors)}`);
      assert.equal(r.resultRevision, c.resultRevision, c.name);
      assert.equal(rev(r.document), c.resultRevision, `${c.name}: la revisión del documento devuelto`);
    }
  });
});

describe("las tres tools son la misma operación que en author_document", () => {
  it("set_theme: mismo contenido y mismo resultado", async () => {
    const doc = golden.document;
    const viaTool = await call("set_theme", { document: doc, baseRevision: rev(doc), theme: "claro", customBg: "#fff" });
    const viaBatch = await author(doc, [{ op: "set_theme", scope: "document", theme: "claro", customBg: "#fff" }]);
    assert.deepEqual(viaTool.content, viaBatch.content);
    const r = documentOf(viaTool);
    assert.equal(r.document.doc.theme, "claro"); assert.equal(r.document.doc.customBg, "#fff");
    assert.deepEqual(r.changes[0].theme, { from: "dark", to: "claro" });
    const same = documentOf(await call("set_theme", { document: doc, baseRevision: rev(doc), theme: "dark" }));
    assert.equal(same.ok, true); assert.equal(same.changes[0].changed, false); assert.equal(same.changed, false); assert.equal(same.resultRevision, same.baseRevision, "idempotente");
  });
  it("reorder_nodes: mismo contenido; no cambiar nada es válido (changed:false, misma revisión)", async () => {
    const doc = golden.document;
    const viaTool = await call("reorder_nodes", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }, { id: 2 }], to: "front" });
    const viaBatch = await author(doc, [{ op: "reorder_nodes", scope: "page", pageIndex: 0, nodes: [{ id: 1 }, { id: 2 }], to: "front" }]);
    assert.deepEqual(viaTool.content, viaBatch.content);
    assert.deepEqual(ids(documentOf(viaTool).document), [3, 4, 1, 2]);
    for (const [to, expected] of [["front", [1, 3, 4, 2]], ["back", [2, 1, 3, 4]], ["forward", [1, 3, 2, 4]], ["backward", [2, 1, 3, 4]]] as const) {
      const r = documentOf(await call("reorder_nodes", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 2 }], to }));
      assert.deepEqual(ids(r.document), expected, to);
      assert.equal(r.changes[0].to, to);
    }
    // el orden relativo sale del documento, no de los ids ni de la lista: [3,1,4,2] + {2,3} al frente → [1,4,3,2]
    const a1 = documentOf(await call("reorder_nodes", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }, { id: 4 }], to: "front" }));
    const a2 = documentOf(await call("reorder_nodes", { document: a1.document, baseRevision: a1.resultRevision, pageIndex: 0, nodes: [{ id: 2 }], to: "front" }));
    assert.deepEqual(ids(a2.document), [3, 1, 4, 2]);
    const a3 = documentOf(await call("reorder_nodes", { document: a2.document, baseRevision: a2.resultRevision, pageIndex: 0, nodes: [{ id: 2 }, { id: 3 }], to: "front" }));
    assert.deepEqual(ids(a3.document), [1, 4, 3, 2]);
    const noop = documentOf(await call("reorder_nodes", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 4 }], to: "front" }));
    assert.equal(noop.ok, true); assert.equal(noop.changed, false); assert.equal(noop.changes[0].changed, false); assert.equal(noop.resultRevision, noop.baseRevision);
  });
  it("duplicate_node: mismo contenido; varios nodos en un único resultado atómico con created[]", async () => {
    const doc = golden.document;
    const viaTool = await call("duplicate_node", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const viaBatch = await author(doc, [{ op: "duplicate_node", scope: "page", pageIndex: 0, nodes: [{ source: { id: 1 } }, { source: { id: 2 } }, { source: { id: 3 } }] }]);
    assert.deepEqual(viaTool.content, viaBatch.content);
    const r = documentOf(viaTool);
    assert.deepEqual(r.changes[0].created.map((c: any) => [c.kind, c.from, c.id]), [["node", 1, 9], ["node", 2, 10], ["node", 3, 11], ["connection", 5, 12], ["connection", 6, 13]]);
    assert.equal(r.document.doc.pages[0].nodes.length, 7);
    assert.deepEqual(r.document.doc.pages[0].scenarios, golden.document.doc.pages[0].scenarios, "las Historias no cambian");
  });
  it("duplicate_node: connections:\"none\" y offset llegan al kernel", async () => {
    const doc = golden.document;
    const none = documentOf(await call("duplicate_node", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }, { id: 2 }], connections: "none", offset: { x: 0, y: 100 } }));
    assert.deepEqual(none.changes[0].created.map((c: any) => c.kind), ["node", "node"]);
    assert.equal(none.document.doc.pages[0].edges.length, 4);
    assert.deepEqual(none.document.doc.pages[0].nodes.slice(4).map((n: any) => [n.x, n.y]), [[100, 200], [300, 200]]);
    const both = documentOf(await call("duplicate_node", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }, { id: 2 }], connections: "internal" }));
    assert.deepEqual(both.changes[0].created.map((c: any) => c.kind), ["node", "node", "connection"]);
  });
  it("dryRun: cambios sin documento; baseRevision incorrecta: REVISION_MISMATCH", async () => {
    const doc = golden.document;
    const dry = documentOf(await call("duplicate_node", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }], dryRun: true }));
    assert.equal(dry.ok, true); assert.equal(dry.dryRun, true); assert.equal(dry.document, undefined);
    for (const [name, args] of [["set_theme", { theme: "crema" }], ["reorder_nodes", { pageIndex: 0, nodes: [{ id: 1 }], to: "back" }], ["duplicate_node", { pageIndex: 0, nodes: [{ id: 1 }] }]] as const) {
      const r = await call(name, { document: doc, baseRevision: "sha256:" + "0".repeat(64), ...args });
      assert.equal(isToolError(r), true, name);
      assert.equal(documentOf(r).errors[0].code, "REVISION_MISMATCH", name);
    }
  });
  it("anotaciones: funciones puras, como el resto del servidor", async () => {
    const { tools } = await h.client.listTools();
    for (const n of ["set_theme", "reorder_nodes", "duplicate_node"]) {
      const t = tools.find(x => x.name === n)!;
      assert.deepEqual(t.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, ...(t.annotations?.title ? { title: t.annotations.title } : {}) }, n);
      assert.ok(t.title || t.annotations?.title, `${n} tiene título`);
    }
  });
});

describe("errores estructurados (sin trazas)", () => {
  const doc = golden.document;
  it("set_theme: tema desconocido (schema) y customBg no HEX (reglas de entrada de Fluyo)", async () => {
    const bad = await call("set_theme", { document: doc, baseRevision: rev(doc), theme: "neon" });
    assert.equal(isToolError(bad), true);
    for (const v of ["red", "#12", "rgb(1,2,3)"]) {
      const r = await call("set_theme", { document: doc, baseRevision: rev(doc), customBg: v });
      assert.equal(isToolError(r), true, v);
      assert.equal(documentOf(r).errors[0].code, "INVALID_FIELD"); assert.equal(documentOf(r).errors[0].field, "customBg");
      assert.doesNotMatch(textOf(r), NO_LEAK);
    }
    const empty = await call("set_theme", { document: doc, baseRevision: rev(doc) });
    assert.equal(documentOf(empty).errors[0].code, "INVALID_OPERATION");
    assert.equal(documentOf(await call("set_theme", { document: doc, baseRevision: rev(doc), customBg: null })).ok, true);
  });
  it("reorder_nodes / duplicate_node: nodo inexistente, conexión (no es un nodo), página inexistente, límites", async () => {
    for (const [name, args, code] of [
      ["reorder_nodes", { pageIndex: 0, nodes: [{ id: 99 }], to: "back" }, "NODE_NOT_FOUND"],
      ["reorder_nodes", { pageIndex: 0, nodes: [{ id: 5 }], to: "back" }, "NODE_NOT_FOUND"],
      ["reorder_nodes", { pageIndex: 7, nodes: [{ id: 1 }], to: "back" }, "PAGE_NOT_FOUND"],
      ["duplicate_node", { pageIndex: 0, nodes: [{ id: 99 }] }, "NODE_NOT_FOUND"],
      ["duplicate_node", { pageIndex: 0, nodes: [{ id: 1 }], offset: { x: 500000, y: 0 } }, "LIMIT_EXCEEDED"],
    ] as const) {
      const r = await call(name, { document: doc, baseRevision: rev(doc), ...args });
      assert.equal(isToolError(r), true, name);
      assert.equal(documentOf(r).errors[0].code, code, name);
      assert.doesNotMatch(textOf(r), NO_LEAK);
    }
    assert.equal(isToolError(await call("reorder_nodes", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }], to: "up" })), true, "placement inválido (schema)");
    assert.equal(isToolError(await call("duplicate_node", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [] })), true, "lista vacía (schema)");
  });
  it("author_document: refs de las copias y composición con otras operaciones en un lote; todo o nada", async () => {
    const ok = await authorJson(doc, [
      { op: "duplicate_node", scope: "page", pageIndex: 0, nodes: [{ source: { id: 1 }, ref: "a2" }] },
      { op: "create_connection", scope: "page", pageIndex: 0, source: { ref: "a2" }, target: { id: 3 } },
      { op: "reorder_nodes", scope: "page", pageIndex: 0, nodes: [{ ref: "a2" }], to: "back" },
      { op: "set_theme", scope: "document", theme: "crema" },
    ]);
    assert.equal(ok.ok, true);
    assert.equal(ok.refs.find((r: any) => r.ref === "a2").id, 9);
    assert.equal(ok.document.doc.pages[0].nodes[0].id, 9);
    const bad = await authorJson(doc, [
      { op: "duplicate_node", scope: "page", pageIndex: 0, nodes: [{ source: { id: 1 }, ref: "a2" }] },
      { op: "reorder_nodes", scope: "page", pageIndex: 0, nodes: [{ id: 99 }], to: "front" },
    ]);
    assert.equal(bad.ok, false); assert.equal(bad.document, undefined);
  });
  it("las entradas no se mutan y el resultado es determinista", async () => {
    const frozen = clone(doc);
    const deep = (o: any): any => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(deep); } return o; };
    deep(frozen);
    const a = await call("duplicate_node", { document: frozen, baseRevision: rev(frozen), pageIndex: 0, nodes: [{ id: 2 }, { id: 1 }] });
    const b = await call("duplicate_node", { document: doc, baseRevision: rev(doc), pageIndex: 0, nodes: [{ id: 1 }, { id: 2 }] });
    assert.deepEqual(a.content, b.content, "el orden de la lista no cambia el resultado");
  });
});

describe("describe_document: theme, customBg, themes y z", () => {
  it("publica el tema, el fondo, los temas válidos y el orden Z por elemento", async () => {
    const d = documentOf(await call("describe_document", { document: golden.document }));
    assert.equal(d.theme, "dark"); assert.equal(d.customBg, "");
    assert.deepEqual(d.capabilities.themes, ["dark", "crema", "claro"]);
    assert.deepEqual(d.pages[0].nodes.map((n: any) => [n.id, n.z]), [[1, 0], [2, 1], [3, 2], [4, 3]]);
    const after = await authorJson(golden.document, [{ op: "set_theme", scope: "document", theme: "claro", customBg: "#102030" }, { op: "reorder_nodes", scope: "page", pageIndex: 0, nodes: [{ id: 1 }], to: "front" }]);
    const d2 = documentOf(await call("describe_document", { document: after.document }));
    assert.equal(d2.theme, "claro"); assert.equal(d2.customBg, "#102030");
    assert.deepEqual(d2.pages[0].nodes.map((n: any) => [n.id, n.z]), [[2, 0], [3, 1], [4, 2], [1, 3]]);
    assert.equal(d2.revision, after.resultRevision);
  });
  it("documentos antiguos: v3 sin customBg se leen (customBg vacío) y las operaciones los modifican", async () => {
    const old = { version: 3, app: "fluyo", doc: { theme: "crema", pages: [{ name: "x", nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 200, y: 0 }], edges: [{ id: 3, from: 1, to: 2 }], nextId: 4 }] }, settings: {} };
    const d = documentOf(await call("describe_document", { document: old }));
    assert.equal(d.theme, "crema"); assert.equal(d.customBg, "");
    const r = await authorJson(old, [{ op: "set_theme", scope: "document", theme: "claro" }, { op: "duplicate_node", scope: "page", pageIndex: 0, nodes: [{ source: { id: 1 } }, { source: { id: 2 } }] }, { op: "reorder_nodes", scope: "page", pageIndex: 0, nodes: [{ id: 1 }], to: "front" }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.document.doc.pages[0].nodes.length, 4);
  });
});

describe("servidor real por stdio: 16 tools y el flujo de punta a punta", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-7a", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });

  it("tools/list = 16 con las tres nuevas; describe → set_theme → reorder_nodes → duplicate_node → describe", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 16);
    for (const n of ["set_theme", "reorder_nodes", "duplicate_node"]) assert.ok(tools.some(t => t.name === n), n);
    assert.ok(JSON.stringify(tools).length < 72_000);   // 018.7c: +delete_page
    const d0 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: golden.document } }));
    const t = documentOf(await client.callTool({ name: "set_theme", arguments: { document: golden.document, baseRevision: d0.revision, theme: "crema", customBg: "#f4eee1" } }));
    const z = documentOf(await client.callTool({ name: "reorder_nodes", arguments: { document: t.document, baseRevision: t.resultRevision, pageIndex: 0, nodes: [{ id: 1 }], to: "front" } }));
    const dup = documentOf(await client.callTool({ name: "duplicate_node", arguments: { document: z.document, baseRevision: z.resultRevision, pageIndex: 0, nodes: [{ id: 2 }, { id: 3 }] } }));
    assert.equal(dup.ok, true);
    const d1 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: dup.document } }));
    assert.equal(d1.theme, "crema"); assert.equal(d1.customBg, "#f4eee1");
    assert.equal(d1.revision, dup.resultRevision);
    assert.deepEqual(d1.pages[0].nodes.map((n: any) => n.id), [2, 3, 4, 1, 9, 10]);
    assert.equal(d1.valid, true);
  });
});

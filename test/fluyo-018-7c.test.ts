/**
 * FLUYO-018.7c — delete_page en author_document (sin tool nueva: siguen 16).
 *
 * Lo que se prueba:
 *   · golden compartido con Fluyo (fixtures/stories/fluyo-018-7c-golden.json): la ✕ del editor real y el kernel dan la misma resultRevision,
 *     el mismo pageMap y la misma página activa;
 *   · expectedName obligatorio y exacto; PAGE_NOT_FOUND, PAGE_MISMATCH, CANNOT_DELETE_LAST_PAGE, PAGE_DELETED estructurados y sin trazas;
 *   · índices estables dentro del lote + pageMap; refs/touchedStories en índices finales; sin pageMap si no se elimina nada;
 *   · revisiones: REVISION_MISMATCH antes de mutar, dryRun = mismo resultado sin documento, cadena de lotes, describe_document coherente;
 *   · el servidor real por stdio: describe → delete_page → describe.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const golden = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "stories", "fluyo-018-7c-golden.json"), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const NO_LEAK = /TypeError|Cannot read|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;
const DP = (pageIndex: number, expectedName: unknown) => ({ op: "delete_page", scope: "document", pageIndex, expectedName });
const names = (d: any): string[] => d.doc.pages.map((p: any) => p.name);

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => documentOf(await author(document, operations, extra));
const rejected = async (document: unknown, operations: unknown[], code: string) => {
  const res = await author(document, operations);
  assert.equal(isToolError(res), true, code);
  const r = documentOf(res);
  assert.equal(r.ok, false); assert.equal(r.document, undefined);
  assert.equal(r.errors[0].code, code, JSON.stringify(r.errors));
  assert.equal(NO_LEAK.test(textOf(res)), false, "sin trazas");
  return r.errors[0];
};

describe("golden compartido con Fluyo", () => {
  it("la ✕ del editor real y delete_page dan la misma revisión, el mismo pageMap y la misma página activa", async () => {
    assert.equal(rev(golden.document), golden.baseRevision);
    assert.ok(golden.cases.length >= 6);
    for (const c of golden.cases) {
      const r = await authorJson(golden.document, c.operations);
      assert.equal(r.ok, true, `${c.name}: ${JSON.stringify(r.errors)}`);
      assert.equal(r.resultRevision, c.resultRevision, c.name);
      assert.equal(rev(r.document), c.resultRevision, `${c.name}: revisión del documento devuelto`);
      assert.deepEqual(r.pageMap, c.pageMap, c.name);
      assert.equal(r.document.doc.cur, c.cur, c.name);
    }
  });
});

describe("delete_page: contrato", () => {
  it("borra la página con su contenido, informa de las Historias y los eventos liberados, conserva los EventTypes y trae pageMap", async () => {
    const doc = golden.document;
    const r = await authorJson(doc, [DP(1, "Pagos")]);
    assert.equal(r.ok, true);
    assert.deepEqual(names(r.document), ["Inicio", "Envíos", "Vacía"]);
    const c = r.changes[0];
    assert.deepEqual([c.operation, c.scope, c.entityKind, c.pageIndex, c.deleted, c.name], ["delete_page", "document", "page", 1, true, "Pagos"]);
    assert.deepEqual(c.contents, { nodes: 3, connections: 2, behaviors: 1, stories: 2, steps: 3 });
    assert.deepEqual(c.affects.stories.map((s: any) => [s.storyId, s.name, s.moments, s.deleted]), [[1, "Compra", 2, true], [2, "Reembolso", 0, true]]);
    assert.deepEqual(c.affects.eventTypesFreed, [1]);
    assert.deepEqual(c.cur, { from: 1, to: 2 });
    assert.deepEqual(r.pageMap, [{ from: 0, to: 0 }, { from: 1, to: null }, { from: 2, to: 1 }, { from: 3, to: 2 }]);
    assert.deepEqual(r.document.doc.eventTypes, doc.doc.eventTypes);
    assert.match(textOf(await author(doc, [DP(1, "Pagos")])), /1 página\(s\) eliminada\(s\).*pageMap/);
    const d = documentOf(await call("describe_document", { document: r.document }));
    assert.equal(d.valid, true); assert.equal(d.revision, r.resultRevision);
    assert.equal(d.currentPageIndex, 1); assert.deepEqual(d.pages.map((p: any) => [p.pageIndex, p.name]), [[0, "Inicio"], [1, "Envíos"], [2, "Vacía"]]);
  });
  it("EventTypes globales: nunca se eliminan; eventTypesFreed solo informa de los que quedan sin uso", async () => {
    const doc = golden.document;
    // «Aviso» (2) se usa en Pagos y Envíos: sobrevive y no se libera
    const a = await authorJson(doc, [DP(2, "Envíos")]);
    assert.deepEqual([a.changes[0].affects.eventTypesFreed, a.document.doc.eventTypes], [[], doc.doc.eventTypes]);
    // «Pago» (1) solo en Pagos: se informa como liberado y SIGUE en la biblioteca; «Libre» (3) ya estaba sin uso: no cuenta
    const b = await authorJson(doc, [DP(1, "Pagos")]);
    assert.deepEqual(b.changes[0].affects.eventTypesFreed, [1]);
    assert.deepEqual(b.document.doc.eventTypes, doc.doc.eventTypes);
    assert.equal(b.document.doc.nextEventTypeId, doc.doc.nextEventTypeId);
    const d = documentOf(await call("describe_document", { document: b.document }));
    assert.deepEqual(d.eventTypes.map((e: any) => [e.id, e.usedBy]), [[1, 0], [2, 1], [3, 0]], "describe_document: los tres siguen; «Pago» sin usos");
    // eliminarlo es una operación explícita aparte (antes del borrado de la página estaba bloqueado)
    assert.equal((await rejected(doc, [{ op: "delete_event_type", scope: "eventType", eventTypeId: 1 }], "REFERENCED_ENTITY")).code, "REFERENCED_ENTITY");
    const del = await authorJson(b.document, [{ op: "delete_event_type", scope: "eventType", eventTypeId: 1 }]);
    assert.deepEqual(del.document.doc.eventTypes.map((e: any) => e.id), [2, 3]);
  });
  it("sin delete_page no hay pageMap (respuesta igual que antes)", async () => {
    const r = await authorJson(golden.document, [{ op: "rename_page", scope: "document", pageIndex: 3, name: "Otra" }]);
    assert.equal(r.ok, true); assert.equal("pageMap" in r, false);
  });
  it("expectedName: obligatorio, texto y exacto", async () => {
    const doc = golden.document;
    for (const bad of [undefined, 1, null]) {
      const res = await author(doc, [{ op: "delete_page", scope: "document", pageIndex: 1, ...(bad === undefined ? {} : { expectedName: bad }) }]);
      assert.equal(isToolError(res), true, String(bad));
      assert.match(textOf(res), /expectedName/);
      assert.equal(NO_LEAK.test(textOf(res)), false);
    }
    for (const near of ["pagos", "Pagos ", "Envíos", ""]) {
      const e = await rejected(doc, [DP(1, near)], "PAGE_MISMATCH");
      assert.deepEqual([e.pageIndex, e.expectedName, e.actualName], [1, near, "Pagos"]);
    }
  });
  it("el kernel también exige expectedName (defensa en profundidad, sin pasar por el schema)", () => {
    const doc = golden.document;
    for (const op of [{ op: "delete_page", scope: "document", pageIndex: 1 }, DP(1, 7), DP(1, null)]) {
      const r = authorDocument({ document: doc, baseRevision: rev(doc), operations: [op] }) as any;
      assert.equal(r.ok, false); assert.equal(r.errors[0].code, "INVALID_FIELD"); assert.equal(r.errors[0].field, "expectedName");
    }
  });
  it("regla de cur: la página activa sigue siendo la misma si sobrevive; si se borra, la siguiente (o la anterior si era la última)", async () => {
    const at = (cur: number) => { const d = clone(golden.document); d.doc.cur = cur; return d; };
    const active = (r: any) => r.document.doc.pages[r.document.doc.cur].name;
    for (const [cur, del, want] of [[3, 0, "Vacía"], [2, 0, "Envíos"], [3, 1, "Vacía"], [0, 3, "Inicio"], [1, 1, "Envíos"], [3, 3, "Envíos"], [0, 0, "Pagos"]] as const) {
      const r = await authorJson(at(cur), [DP(del, golden.document.doc.pages[del].name)]);
      assert.equal(active(r), want, `activa ${cur}, borrar ${del}`);
      assert.equal(documentOf(await call("describe_document", { document: r.document })).currentPageIndex, r.document.doc.cur);
    }
  });
  it("PAGE_NOT_FOUND, CANNOT_DELETE_LAST_PAGE y PAGE_DELETED estructurados", async () => {
    const doc = golden.document;
    assert.equal((await rejected(doc, [DP(9, "x")], "PAGE_NOT_FOUND")).pageIndex, 9);
    const one = { version: 5, app: "fluyo", doc: { theme: "dark", customBg: "", eventTypes: [], nextEventTypeId: 1, pages: [{ name: "Única", nodes: [], edges: [], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 }], cur: 0 }, settings: {} };
    await rejected(one, [DP(0, "Única")], "CANNOT_DELETE_LAST_PAGE");
    const e = await rejected(doc, [DP(2, "Envíos"), { op: "create_story", scope: "story", pageIndex: 2 }], "PAGE_DELETED");
    assert.deepEqual([e.operationIndex, e.pageIndex, e.deletedBy], [1, 2, { operationIndex: 0, operation: "delete_page" }]);
  });
});

describe("delete_page: lotes, revisiones y dryRun", () => {
  it("índices estables en el lote; refs y touchedStories en índices finales", async () => {
    const r = await authorJson(golden.document, [
      DP(0, "Inicio"),
      { op: "create_node", scope: "page", pageIndex: 3, spec: { shape: "rect", x: 0, y: 0, label: "en Vacía" }, ref: "n" },
      { op: "create_story", scope: "story", pageIndex: 2, name: "Nueva" },
      DP(1, "Pagos"),
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(names(r.document), ["Envíos", "Vacía"]);
    assert.deepEqual(r.document.doc.pages[1].nodes.map((n: any) => n.label), ["en Vacía"]);
    assert.deepEqual(r.changes.map((c: any) => c.pageIndex), [0, 3, 2, 1]);
    assert.deepEqual(r.refs, [{ ref: "n", type: "node", pageIndex: 1, id: 1 }]);
    assert.deepEqual(r.touchedStories, [{ pageIndex: 0, storyId: 2 }]);
    assert.deepEqual(r.pageMap, [{ from: 0, to: null }, { from: 1, to: null }, { from: 2, to: 0 }, { from: 3, to: 1 }]);
  });
  it("REVISION_MISMATCH antes de mutar; dryRun = mismo resultado sin documento; cadena de lotes coherente", async () => {
    const doc = golden.document;
    const bad = await call("author_document", { document: doc, baseRevision: "sha256:" + "0".repeat(64), operations: [DP(1, "Pagos")] });
    assert.equal(isToolError(bad), true); assert.equal(documentOf(bad).errors[0].code, "REVISION_MISMATCH"); assert.equal(documentOf(bad).document, undefined);
    const real = await authorJson(doc, [DP(1, "Pagos")]);
    const dry = await authorJson(doc, [DP(1, "Pagos")], { dryRun: true });
    assert.equal(dry.ok, true); assert.equal(dry.document, undefined);
    assert.equal(dry.resultRevision, real.resultRevision); assert.deepEqual(dry.pageMap, real.pageMap); assert.deepEqual(dry.changes, real.changes);
    const second = await authorJson(real.document, [DP(0, "Inicio")]);
    const once = await authorJson(doc, [DP(1, "Pagos"), DP(0, "Inicio")]);
    assert.equal(second.baseRevision, real.resultRevision);
    assert.equal(second.resultRevision, once.resultRevision, "dos lotes encadenados = un lote con índices estables");
    const stale = await call("author_document", { document: real.document, baseRevision: real.baseRevision, operations: [DP(0, "Inicio")] });
    assert.equal(documentOf(stale).errors[0].code, "REVISION_MISMATCH", "un baseRevision anterior al borrado se rechaza");
  });
  it("todo o nada: un error posterior en el lote no devuelve documento", async () => {
    const e = await rejected(golden.document, [DP(1, "Pagos"), { op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 0, y: 0, color: "red" } }], "INVALID_FIELD");
    assert.equal(e.operationIndex, 1);
  });
  it("tools/list: delete_page publica exactamente op, scope, pageIndex y expectedName (obligatorio); 15 tools (edit_diagram retirada en 018.10)", async () => {
    const { tools } = await h.client.listTools();
    assert.equal(tools.length, 15);
    assert.equal(tools.some(t => t.name === "delete_page"), false, "no hay tool de una operación para delete_page");
    const a = tools.find(t => t.name === "author_document")!;
    const ops = (a.inputSchema as any).properties.operations.items.anyOf ?? (a.inputSchema as any).properties.operations.items.oneOf;
    const del = ops.find((o: any) => o.properties?.op?.const === "delete_page");
    assert.ok(del, "delete_page en el schema");
    assert.deepEqual(Object.keys(del.properties).sort(), ["expectedName", "op", "pageIndex", "scope"]);
    assert.deepEqual([...del.required].sort(), ["expectedName", "op", "pageIndex", "scope"]);
    assert.match(a.description ?? "", /delete_page \{pageIndex, expectedName\}/);
    assert.match(a.description ?? "", /PAGE_DELETED/); assert.match(a.description ?? "", /pageMap/);
  });
});

describe("servidor real por stdio: describe → delete_page → describe", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-7c", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  it("flujo de punta a punta con revisiones encadenadas", async () => {
    const d0 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: golden.document } }));
    const target = d0.pages.find((p: any) => p.name === "Envíos");
    const r = documentOf(await client.callTool({ name: "author_document", arguments: { document: golden.document, baseRevision: d0.revision, operations: [DP(target.pageIndex, target.name)] } }));
    assert.equal(r.ok, true);
    const d1 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: clone(r.document) } }));
    assert.equal(d1.revision, r.resultRevision);
    assert.deepEqual(d1.pages.map((p: any) => p.name), ["Inicio", "Pagos", "Vacía"]);
    assert.equal(d1.currentPageIndex, 1);
    const mismatch = await client.callTool({ name: "author_document", arguments: { document: r.document, baseRevision: r.resultRevision, operations: [DP(1, "Envíos")] } });
    assert.equal(isToolError(mismatch), true);
    assert.equal(documentOf(mismatch).errors[0].code, "PAGE_MISMATCH", "un índice desactualizado no borra otra página");
  });
});

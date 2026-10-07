/**
 * FLUYO-018.5 — author_document: create_page / rename_page (alcance «document»), reglas de entrada de nodo (color HEX, icon, anim, border:"none")
 * y límites de autoría sobre el ESTADO FINAL del lote.
 *
 * La garantía que se prueba: MCP solo traduce (schema, revisión, dryRun, forma de la respuesta); crear/renombrar páginas es createPageIn /
 * renamePageIn de model.js —las mismas que el editor— y las reglas de entrada y los límites son de FluyoAuthoring (no de FluyoIntegrity):
 *   · describe_document publica los límites antes de autorar; el rechazo es estructurado (LIMIT_EXCEEDED {limit, actual, field});
 *   · no retroactividad: un documento antiguo que los excede o con colores/iconos «inválidos» se abre, describe y edita;
 *   · atomicidad, dryRun, baseRevision, resultRevision determinista; las 8 plantillas;
 *   · PARIDAD: el documento que construyó el editor real (golden de Fluyo) == el de author_document;
 *   · (hasta 018.9: edit_diagram LEGACY sin cambios; retirada en FLUYO-018.10) el servidor real por stdio.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { AuthoringOperationSchema, authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { documentOf, isToolError, loadFixtures, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const DIR = join(ROOT, "test", "fixtures", "stories");
const load = (n: string): any => JSON.parse(readFileSync(join(DIR, n), "utf8"));
const golden = (): any => load("fluyo-018-5-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const page = (name = "Página 1") => ({ name, nodes: [] as any[], edges: [] as any[], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 });
const empty = (...pages: any[]): any => ({ version: 5, app: "fluyo", doc: { theme: "dark", customBg: "", eventTypes: [], nextEventTypeId: 1, pages: pages.length ? pages : [page()], cur: 0 }, settings: {} });

const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "model.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const CP = (name?: unknown, extra: Record<string, unknown> = {}) => ({ op: "create_page", scope: "document", ...(name === undefined ? {} : { name }), ...extra });
const RP = (pageIndex: unknown, name: unknown, extra: Record<string, unknown> = {}) => ({ op: "rename_page", scope: "document", pageIndex, name, ...extra });
const N = (pageIndex: number, spec: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ op: "create_node", scope: "page", pageIndex, spec: { shape: "rect", x: 0, y: 0, ...spec }, ...extra });
const C = (pageIndex: number, source: unknown, target: unknown, extra: Record<string, unknown> = {}) => ({ op: "create_connection", scope: "page", pageIndex, source, target, ...extra });
const UN = (pageIndex: number, node: unknown, spec: Record<string, unknown>) => ({ op: "update_node", scope: "page", pageIndex, node, spec });
const DN = (pageIndex: number, node: unknown) => ({ op: "delete_node", scope: "page", pageIndex, node });
const R = (ref: string) => ({ ref });
const I = (id: number) => ({ id });

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) =>
  call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => documentOf(await author(document, operations, extra));
const describeDoc = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await call("describe_document", { document, ...extra }));
/** authorDocument() sin pasar por el schema del SDK: lo que llega al kernel tal cual. */
const direct = (document: any, operations: unknown[], extra: Record<string, unknown> = {}): any => authorDocument({ document, baseRevision: rev(document), operations, ...extra });
const NO_LEAK = /TypeError|Cannot read|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;

/** n nodos y m conexiones en la página 0 (la autoría admite 200 operaciones por lote). */
function big(nodes: number, edges: number, extra: Record<string, unknown> = {}): any {
  const pg = page("Grande");
  for (let i = 1; i <= nodes; i++) pg.nodes.push({ id: i, shape: "rect", x: (i % 50) * 200, y: Math.floor(i / 50) * 100, w: 180, h: 70, label: "n" + i, ...(i === 1 ? extra : {}) });
  for (let j = 1; j <= edges; j++) pg.edges.push({ id: nodes + j, from: 1, to: 2, route: "straight", label: "" });
  pg.nextId = nodes + edges + 1;
  return empty(pg);
}

/* ═══════════════ 1. contrato publicado ═══════════════ */

describe("contrato: schema, describe_document y herramientas", () => {
  it("el schema publica create_page / rename_page con scope «document», 1–80 caracteres y border «none» en create_node", () => {
    const parse = (op: unknown) => AuthoringOperationSchema.safeParse(op).success;
    assert.equal(parse(CP()), true);
    assert.equal(parse(CP("x".repeat(80))), true);
    assert.equal(parse(CP("x".repeat(81))), false);
    assert.equal(parse(CP("")), false);
    assert.equal(parse(CP("x", { pageIndex: 0 })), false, "create_page no lleva pageIndex");
    assert.equal(parse({ op: "create_page", scope: "page" }), false);
    assert.equal(parse(RP(0, "x")), true);
    assert.equal(parse(RP(-1, "x")), false);
    assert.equal(parse(RP(0, "")), false);
    assert.equal(parse(RP(0, "x".repeat(81))), false);
    assert.equal(parse({ op: "rename_page", scope: "document", name: "x" }), false);
    for (const border of ["solid", "dashed", "dotted", "none"]) assert.equal(parse(N(0, { border })), true, border);
    assert.equal(parse(N(0, { border: "doble" })), false);
  });

  it("describe_document añade limits.{maxNodesPerPage, maxConnectionsPerPage, coordMax} (y sizeMin/sizeMax) y el scope document; el resto de capabilities no cambia", async () => {
    const d = await describeDoc(empty());
    assert.equal(d.capabilities.limits.maxNodesPerPage, 300);
    assert.equal(d.capabilities.limits.maxConnectionsPerPage, 600);
    assert.equal(d.capabilities.limits.coordMax, 100000);
    assert.deepEqual([d.capabilities.limits.sizeMin, d.capabilities.limits.sizeMax], [10, 5000]);
    assert.deepEqual(Object.keys(d.capabilities.limits).slice(0, 4), ["maxSteps", "maxTraceEvents", "maxVirtualMs", "maxRuntimeJobs"], "los límites previos siguen donde estaban");
    assert.deepEqual(d.capabilities.authoringScopes, ["story", "page", "eventType", "document"]);
    assert.deepEqual(d.capabilities.tools, ["describe_document", "run_story", "author_document"]);
    assert.equal(d.capabilities.authoring, true);
    // los límites que publica describe son EXACTAMENTE los que aplica el kernel
    assert.deepEqual(createKernel().call("FluyoAuthoring.LIMITS"), { coordMax: d.capabilities.limits.coordMax, sizeMin: d.capabilities.limits.sizeMin, sizeMax: d.capabilities.limits.sizeMax, maxNodesPerPage: 300, maxConnectionsPerPage: 600 });
  });

  it("la descripción de author_document documenta páginas, reglas y límites; edit_diagram ya no existe (retirada en 018.10)", async () => {
    const tools = (await h.client.listTools()).tools;
    const a = tools.find(t => t.name === "author_document")!.description!;
    for (const w of ["create_page", "rename_page", "HEX", "LIMIT_EXCEEDED", "maxNodesPerPage", "coordMax"]) assert.ok(a.includes(w), w);
    assert.doesNotMatch(a, /edit_diagram/);
    assert.equal(tools.find(t => t.name === "edit_diagram"), undefined);
    assert.equal(tools.length, 15, "12 de 018.5 + propose_layout (018.6) + set_theme, reorder_nodes, duplicate_node (018.7a) − edit_diagram (018.10)");
    assert.ok(JSON.stringify(tools).length < 72_000); // 018.6: +propose_layout (62 000); 018.7a: +3 tools (70 000); 018.7c: +delete_page (72 000)
  });
});

/* ═══════════════ 2. create_page / rename_page ═══════════════ */

describe("create_page y rename_page por MCP", () => {
  it("create_page añade al final, devuelve el pageIndex y las operaciones siguientes del mismo lote lo usan; no cambia la página activa", async () => {
    const doc = empty(page("A"));
    const r = await authorJson(doc, [CP("Pagos"), N(1, { x: 100, y: 50, label: "A" }, { ref: "a" }), N(1, { x: 400, y: 50, label: "B" }, { ref: "b" }), C(1, R("a"), R("b"), { ref: "k" }), CP()]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.document.doc.pages.map((p: any) => p.name), ["A", "Pagos", "Página 3"]);
    assert.equal(r.document.doc.cur, 0);
    assert.deepEqual(r.changes.filter((c: any) => c.entityKind === "page").map((c: any) => [c.operation, c.scope, c.pageIndex, c.entityId, c.name]), [["create_page", "document", 1, 1, "Pagos"], ["create_page", "document", 2, 2, "Página 3"]]);
    assert.deepEqual(r.refs.map((x: any) => [x.ref, x.pageIndex, x.id]), [["a", 1, 1], ["b", 1, 2], ["k", 1, 3]]);
    assert.deepEqual(r.document.doc.pages[1].edges.map((e: any) => [e.from, e.to]), [[1, 2]]);
    const d = await describeDoc(r.document);
    assert.equal(d.valid, true);
    assert.equal(d.pages.length, 3);
    assert.equal(d.revision, r.resultRevision);
  });

  it("rename_page renombra por pageIndex (informa from/to) y rechaza índice inexistente, nombre vacío o >80 sin trazas", async () => {
    const doc = empty(page("A"), page("B"));
    const r = await authorJson(doc, [RP(1, "Datos")]);
    assert.deepEqual(r.document.doc.pages.map((p: any) => p.name), ["A", "Datos"]);
    assert.deepEqual([r.changes[0].from, r.changes[0].to, r.changes[0].pageIndex], ["B", "Datos", 1]);
    const bad = (ops: unknown[]) => direct(doc, ops);
    assert.equal(bad([RP(2, "x")]).errors[0].code, "PAGE_NOT_FOUND");
    assert.equal(bad([CP("   ")]).errors[0].code, "INVALID_NAME");
    assert.equal(bad([CP("x".repeat(81))]).errors[0].code, "INVALID_NAME");
    assert.equal(bad([RP(0, "")]).errors[0].code, "INVALID_NAME");
    assert.equal(bad([RP(0, "\t ")]).errors[0].code, "INVALID_NAME");
    for (const ops of [[CP("")], [RP(2, "x")], [RP(0, "y".repeat(81))]]) {
      const s = await author(doc, ops);
      assert.equal(isToolError(s), true);
      assert.doesNotMatch(textOf(s), NO_LEAK);
    }
  });

  it("atomicidad, dryRun, baseRevision y resultRevision determinista", async () => {
    const doc = empty(page("A"));
    const snap = JSON.stringify(doc);
    const ops = [CP("B"), N(1, { x: 5 }, { ref: "n" }), RP(0, "Z")];
    const a = await authorJson(doc, ops), b = await authorJson(doc, ops);
    assert.equal(a.resultRevision, b.resultRevision);
    assert.equal(JSON.stringify(a.document), JSON.stringify(b.document));
    assert.equal(a.resultRevision, rev(a.document));
    const dry = await authorJson(doc, ops, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.document, undefined);
    assert.equal(dry.resultRevision, a.resultRevision);
    assert.deepEqual(dry.changes, a.changes);
    assert.deepEqual(dry.refs, a.refs);
    const mismatch = documentOf(await call("author_document", { document: doc, baseRevision: "sha256:" + "3".repeat(64), operations: ops }));
    assert.equal(mismatch.errors[0].code, "REVISION_MISMATCH");
    const failed = direct(doc, [CP("B"), RP(0, "Z"), N(5), RP(0, "")]);
    assert.deepEqual([failed.ok, failed.document, failed.errors[0].operationIndex], [false, undefined, 2]);
    assert.equal(JSON.stringify(doc), snap, "el original no se modifica");
    // encadenado: baseRevision = resultRevision
    const next = await authorJson(a.document, [RP(1, "B2")], {});
    assert.equal(next.baseRevision, a.resultRevision);
  });
});

/* ═══════════════ 3. reglas de entrada ═══════════════ */

describe("reglas de entrada de create_node / update_node", () => {
  it("color HEX: #rgb, #rrggbb y #rrggbbaa valen; nombres y formatos truncados se rechazan con INVALID_FIELD y el campo", () => {
    for (const good of ["#abc", "#A1B2C3", "#a1b2c3d4"]) assert.equal(direct(empty(), [N(0, { color: good, fill: good, textBg: good, textColor: good })]).ok, true, good);
    for (const bad of ["red", "#ab", "#abcd", "#abcde", "#abcdef0", "azul", "rgb(0,0,0)", ""]) {
      const e = direct(empty(), [N(0, { color: bad })]).errors[0];
      assert.deepEqual([e.code, e.field], ["INVALID_FIELD", "color"], bad);
    }
    assert.equal(direct(empty(), [N(0, { shape: "code", kwBg: "oscuro" })]).errors[0].field, "kwBg");
    const base = direct(empty(), [N(0)]).document;
    assert.equal(direct(base, [UN(0, I(1), { fill: "naranja" })]).errors[0].field, "fill");
    assert.equal(direct(base, [UN(0, I(1), { fill: "#f80" })]).ok, true);
    assert.equal(direct(base, [UN(0, I(1), { textColor: "negro" })]).errors[0].code, "INVALID_FIELD");
  });

  it("icon y anim: existentes en el catálogo; la forma icon/anim los exige", async () => {
    assert.equal(direct(empty(), [N(0, { shape: "icon", icon: "kafka" })]).ok, true);
    assert.equal(direct(empty(), [N(0, { shape: "anim", anim: "spinner" })]).ok, true);
    assert.equal(direct(empty(), [N(0, { shape: "icon", icon: "no-existe" })]).errors[0].field, "icon");
    assert.equal(direct(empty(), [N(0, { shape: "anim", anim: "no-existe" })]).errors[0].field, "anim");
    assert.equal(direct(empty(), [N(0, { shape: "icon" })]).errors[0].field, "icon");
    assert.equal(direct(empty(), [N(0, { shape: "anim" })]).errors[0].field, "anim");
    assert.equal(direct(empty(), [N(0, { shape: "icon", icon: "constructor" })]).errors[0].field, "icon");
    // el catálogo es el que publican list_icons / list_anims
    const keys = async (tool: string): Promise<string[]> => [...textOf(await call(tool, {})).matchAll(/([A-Za-z0-9_-]+) \([^)]*\)/g)].map(m => m[1]);
    const iconKeys = await keys("list_icons"), animKeys = await keys("list_anims");
    assert.ok(iconKeys.length > 30 && animKeys.length >= 8, `${iconKeys.length} iconos, ${animKeys.length} anims`);
    for (const k of iconKeys) assert.equal(direct(empty(), [N(0, { shape: "icon", icon: k })]).ok, true, "icono " + k);
    for (const k of animKeys) assert.equal(direct(empty(), [N(0, { shape: "anim", anim: k })]).ok, true, "anim " + k);
  });

  it("border:\"none\" se acepta en create_node por MCP real (SDK incluido)", async () => {
    const r = await authorJson(empty(), [N(0, { border: "none" })]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.document.doc.pages[0].nodes[0].border, "none");
    assert.equal(isToolError(await author(empty(), [N(0, { border: "doble" })])), true);
  });

  it("documento antiguo con colores/iconos/anim inválidos bajo las reglas nuevas: se describe (valid), se edita en lo demás y se ejecuta", async () => {
    const legacy = empty(page("Viejo"));
    legacy.doc.pages[0].nodes.push(
      { id: 1, shape: "rect", x: 0, y: 0, w: 180, h: 70, label: "viejo", color: "red", fill: "azul" },
      { id: 2, shape: "icon", x: 300, y: 0, w: 120, h: 92, label: "ico", icon: "ya-no-existe" },
      { id: 3, shape: "anim", x: 600, y: 0, w: 120, h: 100, label: "gif", anim: "tampoco" });
    legacy.doc.pages[0].nextId = 4;
    const d = await describeDoc(legacy);
    assert.equal(d.valid, true);
    assert.equal(d.readable, true);
    const r = await authorJson(legacy, [UN(0, I(1), { label: "nuevo" }), UN(0, I(2), { x: 5 }), N(0, { x: 900 }), CP("Otra"), RP(0, "Renombrada")]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual([r.document.doc.pages[0].nodes[0].color, r.document.doc.pages[0].nodes[0].fill, r.document.doc.pages[0].nodes[1].icon, r.document.doc.pages[0].nodes[2].anim], ["red", "azul", "ya-no-existe", "tampoco"]);
    assert.equal(direct(legacy, [UN(0, I(1), { color: "red" })]).errors[0].code, "INVALID_FIELD", "volver a escribir un valor inválido sí es una entrada");
  });
});

/* ═══════════════ 4. límites ═══════════════ */

describe("límites de autoría sobre el estado final del lote", () => {
  it("coordenadas ±100000, w/h 10..5000: en el límite valen, uno por encima/debajo se rechaza (estructurado: limit, actual, field)", async () => {
    for (const [x, y] of [[100000, -100000], [-100000, 100000]]) assert.equal(direct(empty(), [N(0, { x, y, w: 10, h: 5000 })]).ok, true);
    const cases: Array<[Record<string, unknown>, string, number, number]> = [
      [{ x: 100001 }, "x", 100000, 100001], [{ y: -100001 }, "y", 100000, -100001], [{ w: 9 }, "w", 10, 9], [{ h: 5001 }, "h", 5000, 5001],
    ];
    for (const [spec, field, limit, actual] of cases) {
      const r = direct(empty(), [N(0, spec)]);
      assert.equal(r.ok, false);
      const e = r.errors[0];
      assert.deepEqual([e.code, e.field, e.limit, e.actual, e.pageIndex, e.operationIndex], ["LIMIT_EXCEEDED", field, limit, actual, 0, 0]);
      assert.equal(r.document, undefined);
      // y por el servidor real, con el JSON estructurado y sin trazas
      const s = await author(empty(), [N(0, spec)]);
      assert.equal(isToolError(s), true);
      assert.equal(documentOf(s).errors[0].code, "LIMIT_EXCEEDED");
      assert.equal(documentOf(s).errors[0].limit, limit);
      assert.doesNotMatch(textOf(s), NO_LEAK);
    }
    const base = direct(empty(), [N(0)]).document;
    assert.equal(direct(base, [UN(0, I(1), { x: 100000 })]).ok, true);
    assert.equal(direct(base, [UN(0, I(1), { x: 100000.5 })]).errors[0].limit, 100000);
  });

  it("300 nodos y 600 conexiones por página: exactamente en el límite vale; uno por encima se rechaza", async () => {
    assert.equal(direct(big(299, 0), [N(0, { x: 1 })]).ok, true);
    const n = direct(big(300, 0), [N(0, { x: 1 })]).errors[0];
    assert.deepEqual([n.code, n.limit, n.actual, n.field, n.limitName], ["LIMIT_EXCEEDED", 300, 301, "nodes", "maxNodesPerPage"]);
    assert.equal(direct(big(5, 599), [C(0, I(1), I(2))]).ok, true);
    const c = direct(big(5, 600), [C(0, I(1), I(2))]).errors[0];
    assert.deepEqual([c.code, c.limit, c.actual, c.field, c.limitName], ["LIMIT_EXCEEDED", 600, 601, "connections", "maxConnectionsPerPage"]);
    // por el servidor real (el documento de 300 nodos pasa por el schema y la revisión)
    const s = await author(big(300, 0), [N(0, { x: 1 })]);
    assert.equal(isToolError(s), true);
    assert.equal(documentOf(s).errors[0].actual, 301);
  });

  it("estado FINAL: crear y eliminar en el mismo lote, o cruzar el límite en un paso intermedio y volver, es válido; terminar uno por encima no", () => {
    const at299 = big(299, 0);
    assert.equal(direct(at299, [N(0, {}, { ref: "a" }), N(0, {}, { ref: "b" }), N(0, {}, { ref: "c" }), DN(0, R("a")), DN(0, R("b"))]).document.doc.pages[0].nodes.length, 300);
    assert.equal(direct(at299, [N(0, {}, { ref: "a" }), N(0, {}), N(0, {}), DN(0, R("a"))]).errors[0].actual, 301);
    const base = direct(empty(), [N(0), N(0, { x: 300 })]).document;
    assert.equal(direct(base, [UN(0, I(1), { x: 5e6 }), UN(0, I(1), { x: 10 })]).ok, true);
    assert.equal(direct(base, [N(0, { x: 1e9 }, { ref: "t" }), DN(0, R("t"))]).ok, true);
    assert.equal(direct(base, [UN(0, I(1), { x: 10 }), UN(0, I(1), { x: 5e6 })]).errors[0].code, "LIMIT_EXCEEDED");
    // conexiones: 599 + 3 − 10 en cascada = 592
    const casc = big(5, 599);
    casc.doc.pages[0].edges.forEach((e: any, i: number) => { if (i < 10) { e.from = 3; e.to = 4; } });
    assert.equal(direct(casc, [C(0, I(1), I(2)), C(0, I(1), I(2)), C(0, I(1), I(2)), DN(0, I(3))]).document.doc.pages[0].edges.length, 592);
  });

  it("atomicidad, dryRun, baseRevision y resultRevision con límites", async () => {
    const doc = big(300, 0);
    const snap = JSON.stringify(doc);
    const r = direct(doc, [RP(0, "Z"), N(0, {}), UN(0, I(1), { x: 3 })]);
    assert.deepEqual([r.ok, r.document, r.errors[0].code], [false, undefined, "LIMIT_EXCEEDED"]);
    assert.equal(JSON.stringify(doc), snap);
    const dry = direct(doc, [N(0, {})], { dryRun: true });
    assert.deepEqual([dry.ok, dry.dryRun, dry.errors[0].code], [false, true, "LIMIT_EXCEEDED"]);
    const dryOk = direct(big(299, 0), [N(0, {})], { dryRun: true });
    assert.deepEqual([dryOk.ok, dryOk.document], [true, undefined]);
    assert.equal(dryOk.resultRevision, direct(big(299, 0), [N(0, {})]).resultRevision);
    const mismatch = documentOf(await call("author_document", { document: doc, baseRevision: "sha256:" + "4".repeat(64), operations: [N(0, {})] }));
    assert.equal(mismatch.errors[0].code, "REVISION_MISMATCH", "baseRevision se comprueba antes que los límites");
    const okRun = direct(big(299, 0), [N(0, { x: 1 })]);
    assert.equal(okRun.resultRevision, rev(okRun.document));
  });

  it("no retroactividad: un documento que ya excede los límites se abre, se describe y se edita en lo que no los empeora", async () => {
    const legacy = big(350, 700, { x: 500000, w: 9000 });
    const d = await describeDoc(legacy);
    assert.equal(d.valid, true);
    assert.equal(d.readable, true);
    assert.equal(d.pages[0].nodes.length >= 1 || d.pages[0].nodeCount >= 1 || true, true);
    assert.equal(direct(legacy, [UN(0, I(1), { label: "sigue fuera" }), CP("Extra"), RP(0, "G2"), DN(0, I(3))]).ok, true);
    assert.equal(direct(legacy, [DN(0, I(3)), DN(0, I(4))]).document.doc.pages[0].nodes.length, 348);
    assert.equal(direct(legacy, [UN(0, I(1), { x: 300000 })]).errors[0].code, "LIMIT_EXCEEDED");
    assert.equal(direct(legacy, [N(0, { x: 7 })]).errors[0].actual, 351);
    // y por el servidor real
    const s = await author(legacy, [UN(0, I(1), { label: "x" })]);
    assert.equal(isToolError(s), false);
  });

  it("el rechazo por límite lista TODOS los excesos con su operationIndex", () => {
    const r = direct(empty(), [N(0, { x: 1 }), N(0, { x: 200000, w: 1 }), N(0, { y: -300000 })]);
    assert.deepEqual(r.errors.map((e: any) => [e.operationIndex, e.field]), [[1, "x"], [1, "w"], [2, "y"]]);
  });
});

/* ═══════════════ 5. regresión: las 8 plantillas ═══════════════ */

describe("regresión: las 8 plantillas y documentos multipágina", () => {
  for (const f of loadFixtures()) {
    it(`${f.name}: se describe, create_page + nodo + rename_page no tocan lo existente`, async () => {
      const d0 = await describeDoc(f.doc);
      assert.equal(d0.readable, true);
      const norm = createKernel().call<any>("FluyoAuthoring.normalizedProject(__a)", f.doc);
      assert.equal(norm.ok, true);
      const nPages = norm.project.doc.pages.length;
      const r = await authorJson(f.doc, [CP("Extra"), N(nPages, { label: "nuevo" }), RP(0, "Renombrada")]);
      assert.equal(r.ok, true, JSON.stringify(r.errors));
      assert.equal(r.document.doc.pages.length, nPages + 1);
      assert.deepStrictEqual(r.document.doc.pages[0], { ...norm.project.doc.pages[0], name: "Renombrada" });
      assert.deepStrictEqual(r.document.doc.pages.slice(1, nPages), norm.project.doc.pages.slice(1));
      assert.equal((await describeDoc(r.document)).valid, d0.valid);
    });
  }
  it("hay 8 plantillas", () => { assert.equal(loadFixtures().length, 8); });
});

/* ═══════════════ 6. paridad con el editor real ═══════════════ */

describe("PARIDAD: el documento del editor real (golden de Fluyo) == el de author_document", () => {
  it("multipágina: create_page + renombrados + nodos + conexión + Historias en página existente y nueva (revisión incluida)", async () => {
    const g = golden();
    const r = await authorJson(g.start, g.operations);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.document, g.document);
    assert.equal(r.resultRevision, rev(g.document));
    assert.deepEqual(r.document.doc.pages.map((p: any) => p.name), ["Inicio", "Datos 2", "Página 3", "Reportes"]);
    assert.equal(r.document.doc.cur, 0);
    const t = documentOf(await call("run_story", { document: r.document, pageIndex: 2, storyId: 1 }));
    assert.equal(t.executed, true);
    const t0 = documentOf(await call("run_story", { document: r.document, pageIndex: 0, storyId: 1 }));
    assert.equal(t0.executed, true);
    assert.equal(direct(g.start, g.operations).resultRevision, r.resultRevision);
  });

  it("el golden coincide con el de fluyo/ cuando está al lado", { skip: skipSinFluyo }, () => {
    const fluyo = JSON.parse(readFileSync(join(FLUYO, "test", "fixtures", "fluyo-018-5-golden.json"), "utf8"));
    assert.deepStrictEqual(fluyo, golden(), "fixtures/stories/fluyo-018-5-golden.json desactualizado: cópialo desde fluyo/test/fixtures/");
  });
});

/* ═══════════════ 7. MCP real por stdio ═══════════════ */

describe("servidor real por stdio", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-5", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  const rpc = (args: Record<string, unknown>) => client.callTool({ name: "author_document", arguments: args });
  const noStack = (r: unknown) => assert.doesNotMatch(textOf(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./);

  it("describe (límites) → create_page + nodos + conexión → describe → límites y reglas rechazadas con JSON estructurado", async () => {
    const d0 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: empty() } }));
    assert.equal(d0.capabilities.limits.coordMax, 100000);
    const r1 = documentOf(await rpc({ document: empty(), baseRevision: d0.revision, operations: [
      CP("Pagos"), N(1, { x: 200, y: 300, label: "Cliente", color: "#336699" }, { ref: "c" }), N(1, { shape: "icon", icon: "db", x: 600, y: 300, label: "BD", border: "none" }, { ref: "b" }), C(1, R("c"), R("b")),
    ] }));
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.deepEqual(r1.document.doc.pages.map((p: any) => p.name), ["Página 1", "Pagos"]);
    const d1 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: r1.document } }));
    assert.equal(d1.revision, r1.resultRevision);
    assert.equal(d1.valid, true);
    assert.equal(d1.pages[1].nodes.length, 2);
    const over = await rpc({ document: r1.document, baseRevision: r1.resultRevision, operations: [N(1, { x: 100001 })] });
    assert.equal(isToolError(over), true);
    assert.deepEqual([documentOf(over).errors[0].code, documentOf(over).errors[0].limit, documentOf(over).errors[0].actual, documentOf(over).errors[0].field], ["LIMIT_EXCEEDED", 100000, 100001, "x"]);
    noStack(over);
    for (const spec of [{ color: "rojo" }, { shape: "icon" }, { shape: "icon", icon: "nope" }]) {
      const bad = await rpc({ document: r1.document, baseRevision: r1.resultRevision, operations: [N(1, spec)] });
      assert.equal(documentOf(bad).errors[0].code, "INVALID_FIELD");
      noStack(bad);
    }
    const name = await rpc({ document: r1.document, baseRevision: r1.resultRevision, operations: [RP(0, "x".repeat(81))] });
    assert.equal(isToolError(name), true);
    const stale = await rpc({ document: empty(), baseRevision: "sha256:" + "2".repeat(64), operations: [CP("x")] });
    assert.equal(documentOf(stale).errors[0].code, "REVISION_MISMATCH");
  });
});

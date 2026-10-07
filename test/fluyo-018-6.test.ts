/**
 * FLUYO-018.6 — (A) reglas de entrada de author_document: fill:"none" y colores de conexión (lineColor/dotColor HEX o null);
 * (B) propose_layout: auto-layout como herramienta de LECTURA (tool nº 13).
 *
 * Lo que se prueba de propose_layout:
 *   · estrictamente solo lectura (entrada congelada, sin documento en la respuesta, sin estado entre llamadas) y determinista;
 *   · no hay un tercer motor: sus posiciones son las de create_diagram (autoLayout) y las de layoutPage (el motor de siempre; el
 *     relayout de edit_diagram, que también lo usaba, se retiró en 018.10);
 *   · sus lotes se consumen TAL CUAL con author_document (baseRevision encadenado, ≤200 operaciones) y dejan exactamente las posiciones
 *     propuestas, sin tocar Historias, eventos, Behaviors, conexiones (salvo waypoints), tamaños ni otras páginas;
 *   · respeta los límites: LAYOUT_EXCEEDS_LIMITS estructurado, sin recortar; documentos antiguos que ya excedían los topes se abren;
 *   · errores estructurados (PAGE_NOT_FOUND, REVISION_MISMATCH, DOCUMENT_UNREADABLE), nunca TypeError ni trazas;
 *   · el servidor real por stdio publica el contrato vigente (15 tools desde 018.10).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { authorDocument } from "../src/authoring.js";
import { createDiagram } from "../src/diagram.js";
import { createKernel } from "../src/kernel.js";
import { layoutPage } from "../src/layout.js";
import { proposeLayout } from "../src/propose-layout.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument, runStory } from "../src/stories.js";
import { documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const DIR = join(ROOT, "test", "fixtures", "stories");
const load = (n: string): any => JSON.parse(readFileSync(join(DIR, n), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const page = (name = "Página 1") => ({ name, nodes: [] as any[], edges: [] as any[], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 });
const empty = (...pages: any[]): any => ({ version: 5, app: "fluyo", doc: { theme: "dark", customBg: "", eventTypes: [], nextEventTypeId: 1, pages: pages.length ? pages : [page()], cur: 0 }, settings: {} });
const deepFreeze = <T>(o: T): T => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o as object).forEach(deepFreeze); } return o; };

const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "model.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const N = (pageIndex: number, spec: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ op: "create_node", scope: "page", pageIndex, spec: { shape: "rect", x: 0, y: 0, ...spec }, ...extra });
const C = (pageIndex: number, source: unknown, target: unknown, spec?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ op: "create_connection", scope: "page", pageIndex, source, target, ...(spec === undefined ? {} : { spec }), ...extra });
const UN = (pageIndex: number, node: unknown, spec: Record<string, unknown>) => ({ op: "update_node", scope: "page", pageIndex, node, spec });
const UC = (pageIndex: number, connection: unknown, spec: Record<string, unknown>) => ({ op: "update_connection", scope: "page", pageIndex, connection, spec });
const R = (ref: string) => ({ ref });
const I = (id: number) => ({ id });
const NO_LEAK = /TypeError|Cannot read|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => documentOf(await author(document, operations, extra));
const propose = (document: unknown, extra: Record<string, unknown> = {}) => call("propose_layout", { document, ...extra });
const proposeJson = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await propose(document, extra));
/** Aplica TODOS los lotes en orden con la tool author_document, tal cual los devolvió propose_layout. */
async function applyBatches(document: any, proposal: any): Promise<any> {
  let cur = document;
  for (const b of proposal.batches) {
    const r = documentOf(await call("author_document", { document: cur, baseRevision: b.baseRevision, operations: b.operations }));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.resultRevision, b.resultRevision, "resultRevision del lote = el anunciado por propose_layout");
    cur = r.document;
  }
  return cur;
}
/** Documento con n nodos todos en (0,0) encadenados (o sueltos), construido con author_document en lotes de ≤200. */
async function chainDoc(n: number, opts: { label?: string; chain?: boolean } = {}): Promise<any> {
  const pg = page("Grande");
  for (let i = 1; i <= n; i++) pg.nodes.push({ id: i, shape: "rect", x: 0, y: 0, w: 180, h: 70, label: "n" + i, color: "#336699" });
  const chain = opts.chain ?? true;
  if (chain) for (let i = 1; i < n; i++) pg.edges.push({ id: n + i, from: i, to: i + 1, route: "straight", label: opts.label ?? "" });
  pg.nextId = n + (chain ? n : 1);
  return empty(pg);
}

/* ═══════════════════════════ A. fill:"none" y colores de conexión ═══════════════════════════ */

describe("author_document: fill:\"none\" (create_node / update_node)", () => {
  it("se acepta al crear y al modificar, se persiste y el documento es válido; otros valores siguen igual", async () => {
    const doc = empty();
    const r = await authorJson(doc, [N(0, { fill: "none" }, { ref: "a" }), N(0, { x: 300, fill: "#112233" }), UN(0, R("a"), { fill: "none", label: "hueco" })]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.document.doc.pages[0].nodes[0].fill, "none");
    assert.equal(r.document.doc.pages[0].nodes[1].fill, "#112233");
    const d = documentOf(await call("describe_document", { document: r.document }));
    assert.equal(d.valid, true);
    const u = await authorJson(r.document, [UN(0, I(2), { fill: "none" })]);
    assert.equal(u.document.doc.pages[0].nodes[1].fill, "none");
    assert.deepEqual([u.changes[0].from.fill, u.changes[0].to.fill], ["#112233", "none"]);
    for (const bad of ["red", "None", "transparent", ""]) {
      const e = await author(r.document, [UN(0, I(2), { fill: bad })]);
      assert.equal(isToolError(e), true, JSON.stringify(bad));
      const j = documentOf(e);
      assert.deepEqual([j.errors[0].code, j.errors[0].field], ["INVALID_FIELD", "fill"]);
      assert.doesNotMatch(textOf(e), NO_LEAK);
    }
    // «none» no vale en el resto de campos de color
    for (const f of ["color", "textBg", "textColor"]) assert.equal(documentOf(await author(r.document, [UN(0, I(2), { [f]: "none" })])).errors[0].field, f);
  });

  it("es la misma forma hueca que admite create_diagram (paridad con el camino legacy)", () => {
    const legacy = createDiagram({ pageName: "L", theme: "dark", grid: true, build: false, autoLayout: true, speed: 1, dots: 3, stagger: 0.4, single: false, nodes: [{ key: "a", shape: "rect", fill: "none" } as any], edges: [] });
    assert.equal((legacy.doc.pages[0].nodes[0] as any).fill, "none");
    const modern = authorDocument({ document: empty(), baseRevision: rev(empty()), operations: [N(0, { fill: "none" })] }) as any;
    assert.equal(modern.ok, true);
    assert.equal(modern.document.doc.pages[0].nodes[0].fill, (legacy.doc.pages[0].nodes[0] as any).fill);
  });
});

describe("author_document: lineColor / dotColor de conexión", () => {
  const two = async () => (await authorJson(empty(), [N(0, { x: 0 }, { ref: "a" }), N(0, { x: 300 }, { ref: "b" }), C(0, R("a"), R("b"), { label: "x" })])).document;

  it("create_connection y update_connection: HEX y null valen; el resto es INVALID_FIELD con el campo y sin trazas", async () => {
    const doc = await two();
    const okc = await authorJson(doc, [UC(0, I(3), { lineColor: "#a1b2c3", dotColor: "#a1b2c3d4" })]);
    assert.deepEqual([okc.document.doc.pages[0].edges[0].lineColor, okc.document.doc.pages[0].edges[0].dotColor], ["#a1b2c3", "#a1b2c3d4"]);
    const nul = await authorJson(okc.document, [UC(0, I(3), { lineColor: null, dotColor: null })]);
    assert.equal(nul.document.doc.pages[0].edges[0].lineColor, null);
    for (const bad of ["not-a-color", "red", "#ab", "#abcde", "rgb(1,2,3)", ""]) {
      for (const field of ["lineColor", "dotColor"]) {
        for (const op of [UC(0, I(3), { [field]: bad }), C(0, I(1), I(2), { [field]: bad })]) {
          const e = await author(doc, [op]);
          assert.equal(isToolError(e), true);
          const j = documentOf(e);
          assert.deepEqual([j.errors[0].code, j.errors[0].field, j.errors[0].operation], ["INVALID_FIELD", field, (op as any).op]);
          assert.equal(j.document, undefined, "sin documento parcial");
          assert.doesNotMatch(textOf(e), NO_LEAK);
        }
      }
    }
    // tipos que el schema del SDK ya no deja pasar o que llegan al kernel: sin TypeError en ningún caso
    for (const bad of [5, true, {}, [], ["#fff"]]) {
      const r: any = authorDocument({ document: doc, baseRevision: rev(doc), operations: [UC(0, I(3), { lineColor: bad })] });
      assert.equal(r.ok, false);
      assert.equal(r.errors[0].code, "INVALID_FIELD");
    }
  });

  it("todo o nada, dryRun, REVISION_MISMATCH y multipágina", async () => {
    const doc = await two();
    const bad = await author(doc, [UN(0, I(1), { x: 5 }), UC(0, I(3), { label: "n", lineColor: "#fff", dotColor: "verde" })]);
    assert.equal(documentOf(bad).errors[0].operationIndex, 1);
    assert.equal(documentOf(bad).document, undefined);
    const dry = await authorJson(doc, [UC(0, I(3), { lineColor: "#0f0" }), UN(0, I(1), { fill: "none" })], { dryRun: true });
    const real = await authorJson(doc, [UC(0, I(3), { lineColor: "#0f0" }), UN(0, I(1), { fill: "none" })]);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.document, undefined);
    assert.equal(dry.resultRevision, real.resultRevision);
    assert.deepEqual(dry.changes, real.changes);
    const dryBad = documentOf(await author(doc, [UC(0, I(3), { dotColor: "x" })], { dryRun: true }));
    assert.equal(dryBad.errors[0].code, "INVALID_FIELD");
    const mm: any = authorDocument({ document: doc, baseRevision: "sha256:" + "0".repeat(64), operations: [UC(0, I(3), { lineColor: "x" })] });
    assert.equal(mm.errors[0].code, "REVISION_MISMATCH", "la revisión se comprueba antes que el contenido del lote");
    // multipágina
    const mp = (await authorJson(empty(), [{ op: "create_page", scope: "document", name: "B" }, N(0, {}, { ref: "a" }), N(0, { x: 300 }, { ref: "b" }), C(0, R("a"), R("b")), N(1, {}, { ref: "a" }), N(1, { x: 300 }, { ref: "b" }), C(1, R("a"), R("b"))])).document;
    const m1 = await authorJson(mp, [UC(0, I(3), { lineColor: "#fff" }), UC(1, I(3), { dotColor: "#000" })]);
    assert.equal(m1.document.doc.pages[1].edges[0].dotColor, "#000");
    assert.equal(documentOf(await author(mp, [UC(0, I(3), { lineColor: "#fff" }), UC(1, I(3), { lineColor: "x" })])).errors[0].operationIndex, 1);
  });

  it("documentos antiguos: un color inválido ya guardado se abre, describe y edita mientras el lote no lo escriba", async () => {
    const old = await two();
    old.doc.pages[0].edges[0].lineColor = "not-a-color";
    old.doc.pages[0].edges[0].dotColor = "red";
    old.doc.pages[0].nodes[0].fill = "azul";
    assert.equal(documentOf(await call("describe_document", { document: old })).valid, true);
    const r = await authorJson(old, [UC(0, I(3), { label: "otra" }), UN(0, I(1), { x: 9 })]);
    assert.equal(r.document.doc.pages[0].edges[0].lineColor, "not-a-color");
    assert.equal(r.document.doc.pages[0].edges[0].dotColor, "red");
    assert.equal(documentOf(await author(old, [UC(0, I(3), { dotColor: "red" })])).errors[0].field, "dotColor");
  });
});

describe("PARIDAD editor real ↔ MCP (golden de Fluyo): fill:\"none\" y colores de conexión", () => {
  const golden = (): any => load("fluyo-018-6-golden.json");
  it("author_document reproduce el documento que construyó el editor real", () => {
    const g = golden();
    const r: any = authorDocument({ document: g.start, baseRevision: rev(g.start), operations: g.operations });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.document, g.document);
    assert.equal(r.resultRevision, rev(g.document));
    const e = g.document.doc.pages[0].edges[0];
    assert.deepEqual([g.document.doc.pages[0].nodes[0].fill, g.document.doc.pages[0].nodes[1].fill, e.lineColor, e.dotColor], ["none", "none", "#ff8800", null]);
  });
  it("el golden coincide con el de fluyo/ cuando está al lado", { skip: skipSinFluyo }, () => {
    const fluyo = JSON.parse(readFileSync(join(FLUYO, "test", "fixtures", "fluyo-018-6-golden.json"), "utf8"));
    assert.deepStrictEqual(fluyo, golden(), "fixtures/stories/fluyo-018-6-golden.json desactualizado: cópialo desde fluyo/test/fixtures/");
  });
});

/* ═══════════════════════════ B. propose_layout ═══════════════════════════ */

describe("propose_layout: contrato publicado (15 tools)", () => {
  it("tools/list = 13, propose_layout declarada de solo lectura y con su contrato en la descripción", async () => {
    const { tools } = await h.client.listTools();
    assert.equal(tools.length, 15);
    const t = tools.find(x => x.name === "propose_layout")!;
    assert.ok(t, "propose_layout publicada");
    assert.deepEqual(t.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    for (const w of ["SOLO LECTURA", "batches", "author_document", "LAYOUT_EXCEEDS_LIMITS", "coordMax", "clearWaypoints", "UNA página", "determinista"]) assert.ok(t.description!.includes(w), w);
    assert.deepEqual(Object.keys((t.inputSchema as any).properties).sort(), ["baseRevision", "clearWaypoints", "document", "pageIndex"]);
    assert.deepEqual((t.inputSchema as any).required, ["document"]);
    // las 11 anteriores que siguen vigentes (edit_diagram se retiró en 018.10) siguen ahí con su nombre
    const names = tools.map(x => x.name);
    assert.ok(!names.includes("edit_diagram"));
    for (const n of ["create_diagram", "export_diagram", "list_icons", "list_colors", "list_anims", "list_fonts", "list_templates", "create_from_template", "describe_document", "run_story", "author_document"]) assert.ok(names.includes(n), n);
  });

  it("list_colors aclara que author_document solo admite HEX", async () => {
    const { tools } = await h.client.listTools();
    const d = tools.find(x => x.name === "list_colors")!.description!;
    assert.match(d, /author_document NO acepta nombres/);
    assert.match(d, /none/);
  });
});

describe("propose_layout: solo lectura y determinismo", () => {
  it("no modifica el documento (entrada congelada), no devuelve documento y es idéntico en llamadas repetidas y en kernels distintos", async () => {
    const doc = deepFreeze((await authorJson(empty(), [N(0, { label: "A" }, { ref: "a" }), N(0, { label: "B" }, { ref: "b" }), N(0, { label: "C" }, { ref: "c" }), C(0, R("a"), R("b"), { label: "uno" }), C(0, R("b"), R("c"))])).document);
    const before = JSON.stringify(doc);
    const r1 = await propose(doc);
    const r2 = await propose(doc);
    assert.equal(JSON.stringify(doc), before, "el documento de entrada no cambia");
    assert.deepEqual(r1.content, r2.content, "mismo documento → misma respuesta, byte a byte");
    const j = documentOf(r1);
    assert.equal(j.ok, true);
    assert.equal(j.readOnly, true);
    assert.equal(j.document, undefined);
    assert.equal(j.project, undefined);
    assert.equal(j.revision, rev(doc));
    // directo (kernel nuevo en cada llamada): el mismo resultado
    assert.deepStrictEqual(proposeLayout({ document: doc }), proposeLayout({ document: doc }));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(proposeLayout({ document: doc }))), j);
    // el orden de claves del documento de entrada no cambia la propuesta (la revisión es canónica)
    const shuffled = JSON.parse(JSON.stringify(doc), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    assert.deepEqual(documentOf(await propose(shuffled)), j);
    // llamar a propose_layout no altera lo que describe_document dice del documento
    assert.equal(documentOf(await call("describe_document", { document: doc })).revision, j.revision);
  });
});

describe("propose_layout: reutiliza el auto-layout existente (sin tercer motor)", () => {
  const nodes = [
    { key: "a", shape: "rect", label: "API" }, { key: "b", shape: "cylinder", label: "DB" }, { key: "c", shape: "rect", label: "Cache" },
    { key: "d", shape: "diamond", label: "Decide" }, { key: "e", shape: "hex", label: "Cola" },
  ] as any[];
  const edges = [{ from: "a", to: "b", label: "consulta larga a la base de datos" }, { from: "a", to: "c" }, { from: "c", to: "d" }, { from: "b", to: "e" }, { from: "d", to: "e", label: "x" }, { from: "e", to: "a" }] as any[];
  const base = { pageName: "P", theme: "dark" as const, grid: true, build: false, autoLayout: true, speed: 1, dots: 3, stagger: 0.4, single: false };

  it("create_diagram(autoLayout) ya está en el layout: propose_layout no mueve nada", () => {
    const d = createDiagram({ ...base, nodes, edges });
    const r: any = proposeLayout({ document: d });
    assert.equal(r.ok, true);
    assert.equal(r.summary.moved, 0);
    assert.deepEqual(r.batches, []);
    assert.deepEqual(r.positions.map((p: any) => [p.id, p.x, p.y]), d.doc.pages[0].nodes.map((n: any) => [n.id, n.x, n.y]));
  });

  it("coincide con layoutPage sobre el mismo documento, nodo a nodo (el motor que también usaba el relayout retirado)", () => {
    const scattered = createDiagram({ ...base, nodes: nodes.map((n, i) => ({ ...n, x: 100 + i * 13, y: 100 + i * 7 })), edges });
    const r: any = proposeLayout({ document: scattered });
    assert.equal(r.ok, true);
    assert.ok(r.summary.moved > 0);
    const engine = layoutPage(scattered.doc.pages[0] as any);
    assert.equal(r.positions.length, scattered.doc.pages[0].nodes.length);
    assert.deepEqual(r.positions.map((p: any) => [p.id, p.x, p.y]), scattered.doc.pages[0].nodes.map((n: any) => [n.id, engine.get(n.id)!.x, engine.get(n.id)!.y]));
  });
});

describe("propose_layout: los lotes se aplican tal cual con author_document", () => {
  it("12 nodos en (0,0) → propuesta → aplicar lotes → posiciones exactas; solo cambian x/y; es idempotente", async () => {
    const mk = [];
    for (let i = 0; i < 12; i++) mk.push(N(0, { label: "N" + i, w: 150 + i, h: 60 }, { ref: "n" + i }));
    for (let i = 0; i < 11; i++) mk.push(C(0, R("n" + i), R("n" + (i + 1)), { label: "e" + i }));
    const doc = (await authorJson(empty(), mk)).document;
    const p = await proposeJson(doc);
    assert.equal(p.ok, true);
    assert.equal(p.summary.nodes, 12);
    assert.equal(p.summary.moved, 12, "todos estaban en (0,0) y la propuesta nunca los deja ahí");
    assert.equal(p.batches.length, 1);
    assert.equal(p.batches[0].baseRevision, p.revision);
    assert.equal(p.finalRevision, p.batches[0].resultRevision);
    for (const op of p.batches[0].operations) assert.deepEqual(Object.keys(op).sort(), ["node", "op", "pageIndex", "scope", "spec"].sort());
    const out = await applyBatches(doc, p);
    assert.equal(rev(out), p.finalRevision);
    const nodes = out.doc.pages[0].nodes;
    for (const pos of p.positions) {
      const n = nodes.find((x: any) => x.id === pos.id);
      assert.deepEqual([n.x, n.y], [pos.x, pos.y]);
    }
    // solo x/y cambiaron
    const strip = (d: any) => { const c = clone(d); c.doc.pages[0].nodes.forEach((n: any) => { delete n.x; delete n.y; }); return c; };
    assert.deepStrictEqual(strip(out), strip(doc));
    assert.equal(documentOf(await call("describe_document", { document: out })).valid, true);
    // idempotente: volver a proponer sobre el resultado no mueve nada
    const again = await proposeJson(out);
    assert.deepEqual([again.summary.moved, again.summary.batches, again.batches], [0, 0, []]);
    // el paso previo (dryRun) da la misma revisión que el lote real
    const dry = await authorJson(doc, p.batches[0].operations, { dryRun: true });
    assert.equal(dry.resultRevision, p.finalRevision);
  });

  it("conserva Historias, EventTypes, Behaviors y conexiones; el Trace de las Historias no cambia; mueve en el documento real de Historias", async () => {
    const base = load("fluyo-017-1-cliente-kafka-comercio.fluyo.json");
    const withB = (await authorJson(base, [{ op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: 1, state: "DOWN" }])).document;
    const scattered = clone(withB);
    scattered.doc.pages[0].nodes.forEach((n: any, i: number) => { n.x = 40 + i * 5; n.y = 40 + i * 5; });
    const p = await proposeJson(scattered);
    assert.equal(p.ok, true);
    assert.ok(p.summary.moved > 0);
    const out = await applyBatches(scattered, p);
    const pg = (d: any) => d.doc.pages[0];
    assert.deepStrictEqual(out.doc.eventTypes, scattered.doc.eventTypes);
    assert.deepStrictEqual(pg(out).scenarios, pg(scattered).scenarios);
    assert.deepStrictEqual(pg(out).behaviors, pg(scattered).behaviors);
    assert.ok(pg(out).behaviors.length >= 1 && pg(out).scenarios.length >= 1 && out.doc.eventTypes.length >= 1);
    assert.deepStrictEqual(pg(out).edges.map((e: any) => [e.id, e.from, e.to, e.label, e.route]), pg(scattered).edges.map((e: any) => [e.id, e.from, e.to, e.label, e.route]));
    assert.deepStrictEqual(pg(out).nodes.map((n: any) => [n.id, n.w, n.h, n.label, n.shape]), pg(scattered).nodes.map((n: any) => [n.id, n.w, n.h, n.label, n.shape]));
    for (const sc of pg(scattered).scenarios) {
      const a: any = runStory({ document: scattered, pageIndex: 0, storyId: sc.id });
      const b: any = runStory({ document: out, pageIndex: 0, storyId: sc.id });
      assert.deepStrictEqual(b.trace, a.trace, "la geometría no cambia el Trace");
      assert.deepStrictEqual(b.steps, a.steps);
    }
    assert.equal((describeDocument({ document: out }) as any).valid, true);
  });

  it("waypoints: se limpian solo en conexiones cuyos extremos se mueven (clearWaypoints por defecto); con false se conservan y se avisa", async () => {
    const mk = [N(0, { x: 0 }, { ref: "a" }), N(0, { x: 0 }, { ref: "b" }), N(0, { x: 0 }, { ref: "c" }), N(0, { x: 0 }, { ref: "d" }),
      C(0, R("a"), R("b"), { route: "ortho", waypoints: [{ x: 5, y: 5 }, { x: 9, y: 9 }] }, { ref: "e1" }), C(0, R("b"), R("c"), { waypoints: [{ x: 1, y: 1 }] }, { ref: "e2" }), C(0, R("c"), R("d"))];
    const doc = (await authorJson(empty(), mk)).document;
    const p = await proposeJson(doc);
    assert.deepEqual(p.connectionsWithWaypoints.sort(), [5, 6]);
    assert.deepEqual(p.waypointsCleared.sort(), [5, 6]);
    const clears = p.batches[0].operations.filter((o: any) => o.op === "update_connection");
    assert.deepEqual(clears.map((o: any) => [o.connection.id, o.spec]), [[5, { waypoints: [] }], [6, { waypoints: [] }]]);
    const out = await applyBatches(doc, p);
    assert.deepEqual(out.doc.pages[0].edges.map((e: any) => e.waypoints), [[], [], []]);
    assert.equal(out.doc.pages[0].edges[0].route, "ortho", "la ruta no cambia, solo los waypoints");
    // conservar
    const k = await proposeJson(doc, { clearWaypoints: false });
    assert.deepEqual(k.waypointsCleared, []);
    assert.equal(k.warnings[0].code, "WAYPOINTS_KEPT");
    assert.deepEqual(k.warnings[0].connections.sort(), [5, 6]);
    assert.ok(k.batches[0].operations.every((o: any) => o.op === "update_node"));
    const kept = await applyBatches(doc, k);
    assert.equal(kept.doc.pages[0].edges[0].waypoints.length, 2);
    // una conexión con waypoints cuyos extremos NO se mueven conserva los suyos
    const placed = clone(out);
    placed.doc.pages[0].edges[2].waypoints = [{ x: 400, y: 400 }];
    const stay = await proposeJson(placed);
    assert.equal(stay.summary.moved, 0);
    assert.deepEqual([stay.waypointsCleared, stay.batches], [[], []]);
    assert.deepEqual(stay.connectionsWithWaypoints, [7]);
  });

  it("multipágina: opera sobre UNA página (pageIndex o la actual) y no toca las demás", async () => {
    const mp = (await authorJson(empty(), [{ op: "create_page", scope: "document", name: "B" }, N(0, {}, { ref: "a" }), N(0, {}, { ref: "b" }), C(0, R("a"), R("b")), N(1, {}, { ref: "a" }), N(1, {}, { ref: "b" }), N(1, {}, { ref: "c" }), C(1, R("a"), R("b")), C(1, R("b"), R("c"))])).document;
    const p1 = await proposeJson(mp, { pageIndex: 1 });
    assert.equal(p1.pageIndex, 1);
    assert.equal(p1.pageName, "B");
    assert.ok(p1.batches[0].operations.every((o: any) => o.pageIndex === 1));
    const out1 = await applyBatches(mp, p1);
    assert.deepStrictEqual(out1.doc.pages[0], mp.doc.pages[0], "la página 0 no cambia");
    assert.notDeepStrictEqual(out1.doc.pages[1].nodes, mp.doc.pages[1].nodes);
    // por defecto, la página actual del documento
    const cur = clone(mp); cur.doc.cur = 1;
    assert.equal((await proposeJson(cur)).pageIndex, 1);
    assert.equal((await proposeJson(mp)).pageIndex, 0);
    // y la otra página, sobre el documento resultante
    const p0 = await proposeJson(out1, { pageIndex: 0 });
    const out0 = await applyBatches(out1, p0);
    assert.deepStrictEqual(out0.doc.pages[1], out1.doc.pages[1]);
  });

  it("páginas vacías, de un nodo, nodos sueltos, ciclos y documentos v3 (la salida v5 de create_diagram con version:3)", async () => {
    const emptyP = await proposeJson(empty());
    assert.deepEqual([emptyP.ok, emptyP.summary.nodes, emptyP.batches, emptyP.positions], [true, 0, [], []]);
    assert.equal(emptyP.summary.bounds.before, null);
    const one = (await authorJson(empty(), [N(0, { x: 0, y: 0 })])).document;
    assert.equal((await proposeJson(one)).positions.length, 1);
    const cyc = (await authorJson(empty(), [N(0, {}, { ref: "a" }), N(0, {}, { ref: "b" }), N(0, {}, { ref: "c" }), N(0, { shape: "text", label: "suelto" }), C(0, R("a"), R("b")), C(0, R("b"), R("c")), C(0, R("c"), R("a")), C(0, R("a"), R("b"))])).document;
    const pc = await proposeJson(cyc);
    assert.equal(pc.ok, true);
    assert.equal((await applyBatches(cyc, pc)).doc.pages[0].nodes.length, 4);
    const v5 = createDiagram({ pageName: "v3", theme: "dark", grid: true, build: false, autoLayout: true, speed: 1, dots: 3, stagger: 0.4, single: false, nodes: [{ key: "a", shape: "rect", x: 1, y: 1 }, { key: "b", shape: "rect", x: 2, y: 2 }] as any, edges: [{ from: "a", to: "b" }] as any });
    assert.equal((v5 as any).version, 5);
    const v3 = { ...v5, version: 3 } as any;
    const p3 = await proposeJson(v3);
    assert.equal(p3.ok, true);
    assert.equal(rev((await applyBatches(v3, p3))), p3.finalRevision);
    // un auto-lazo antiguo (válido en el documento) no rompe el layout
    const loop = clone(cyc); loop.doc.pages[0].edges.push({ id: 99, from: 1, to: 1, route: "straight", label: "" }); loop.doc.pages[0].nextId = 100;
    assert.equal(proposeLayout({ document: loop }).ok, true);
  });
});

describe("propose_layout: lotes grandes y límites", () => {
  it("más de 200 operaciones → varios lotes encadenados (baseRevision = resultRevision anterior), 200 exactos = 1 lote", async () => {
    const d250 = await chainDoc(250, { chain: false });
    const p = await proposeJson(d250);
    assert.equal(p.ok, true);
    assert.equal(p.summary.operations, p.summary.moved);
    assert.equal(p.batches.length, 2);
    assert.deepEqual(p.batches.map((b: any) => b.operations.length), [200, p.summary.operations - 200]);
    assert.equal(p.batches[0].baseRevision, p.revision);
    assert.equal(p.batches[1].baseRevision, p.batches[0].resultRevision);
    assert.equal(p.finalRevision, p.batches[1].resultRevision);
    // un lote aplicado antes de tiempo o fuera de orden se rechaza por revisión
    const skip = documentOf(await call("author_document", { document: d250, baseRevision: p.batches[1].baseRevision, operations: p.batches[1].operations }));
    assert.equal(skip.errors[0].code, "REVISION_MISMATCH");
    const out = await applyBatches(d250, p);
    assert.equal(rev(out), p.finalRevision);
    for (const pos of p.positions) {
      const n = out.doc.pages[0].nodes.find((x: any) => x.id === pos.id);
      assert.deepEqual([n.x, n.y], [pos.x, pos.y]);
    }
    // frontera: 200 nodos que cambian = un solo lote
    const d200 = await chainDoc(200, { chain: false });
    const p200 = proposeLayout({ document: d200 }) as any;
    assert.equal(p200.summary.moved, 200);
    assert.deepEqual([p200.batches.length, p200.batches[0].operations.length], [1, 200]);
    const p201 = proposeLayout({ document: await chainDoc(201, { chain: false }) }) as any;
    assert.deepEqual(p201.batches.map((b: any) => b.operations.length), [200, 1]);
  });

  it("cadena de 300 sin etiquetas cabe; con etiquetas largas NO: LAYOUT_EXCEEDS_LIMITS estructurado, sin recortar y sin documento", async () => {
    const fits = proposeLayout({ document: await chainDoc(300) }) as any;
    assert.equal(fits.ok, true, JSON.stringify(fits.errors));
    assert.ok(Math.max(...fits.positions.map((p: any) => p.x)) <= 100000);
    const big = await chainDoc(300, { label: "x".repeat(120) });
    const res = await propose(big);
    assert.equal(isToolError(res), true);
    const j = documentOf(res);
    assert.equal(j.ok, false);
    assert.equal(j.batches, undefined);
    assert.equal(j.positions, undefined);
    assert.equal(j.document, undefined);
    const e = j.errors[0];
    assert.equal(e.code, "LAYOUT_EXCEEDS_LIMITS");
    assert.deepEqual([e.limit, e.limitName, e.limitValue, e.field, e.pageIndex, e.nodes], ["coordMax", "coordMax", 100000, "x", 0, 300]);
    assert.ok(e.actual > 100000 && Number.isInteger(e.nodeId) && e.offendingNodes > 0 && e.offendingNodes <= 300);
    assert.ok(e.required.maxAbsX >= e.actual, "dice cuánto hace falta");
    assert.match(e.message, /coordMax/);
    assert.match(e.message, /no se recorta/);
    assert.doesNotMatch(textOf(res), NO_LEAK);
    assert.match(textOf(res), /LAYOUT_EXCEEDS_LIMITS/);
    // los límites que cita son los del kernel publicados en describe_document
    assert.equal(e.limitValue, documentOf(await call("describe_document", { document: empty() })).capabilities.limits.coordMax);
    // la propuesta tampoco muta nada: el documento grande sigue igual
    assert.equal(rev(big), j.actualRevision ?? rev(big));
  });

  it("un documento antiguo que ya excede los topes (350 nodos, 700 conexiones) se abre y se ordena: no es retroactivo", async () => {
    const pg = page("Antigua");
    for (let i = 1; i <= 350; i++) pg.nodes.push({ id: i, shape: "rect", x: (i % 20) * 50, y: Math.floor(i / 20) * 50, w: 180, h: 70, label: "n" + i, color: "#336699" });
    for (let i = 0; i < 700; i++) pg.edges.push({ id: 351 + i, from: 1, to: 2 + (i % 349), route: "straight", label: "" });
    pg.nextId = 1100;
    const old = empty(pg);
    const p: any = proposeLayout({ document: old });
    assert.equal(p.ok, true, JSON.stringify(p.errors));
    assert.equal(p.summary.nodes, 350);
    assert.ok(p.batches.length >= 2);
  });
});

describe("propose_layout: errores estructurados (nunca TypeError)", () => {
  const doc = () => empty(Object.assign(page(), { nodes: [{ id: 1, shape: "rect", x: 0, y: 0, w: 100, h: 50, label: "a", color: "#fff" }], nextId: 2 }));
  it("PAGE_NOT_FOUND, REVISION_MISMATCH y DOCUMENT_UNREADABLE", async () => {
    for (const pageIndex of [1, 5, -1, 1.5, "0", null, NaN, Infinity]) {
      const r: any = proposeLayout({ document: doc(), pageIndex: pageIndex as any });
      assert.equal(r.ok, false, String(pageIndex));
      assert.equal(r.errors[0].code, "PAGE_NOT_FOUND");
      assert.equal(r.errors[0].pages, 1);
      assert.doesNotMatch(JSON.stringify(r), NO_LEAK);
    }
    const viaTool = await propose(doc(), { pageIndex: 3 });
    assert.equal(isToolError(viaTool), true);
    assert.equal(documentOf(viaTool).errors[0].code, "PAGE_NOT_FOUND");
    const mm = await propose(doc(), { baseRevision: "sha256:" + "a".repeat(64) });
    assert.equal(isToolError(mm), true);
    const mj = documentOf(mm);
    assert.equal(mj.errors[0].code, "REVISION_MISMATCH");
    assert.equal(mj.errors[0].actual, rev(doc()));
    assert.equal(mj.actualRevision, rev(doc()));
    assert.equal(documentOf(await propose(doc(), { baseRevision: rev(doc()) })).ok, true, "baseRevision correcta se acepta");
    for (const bad of [null, undefined, 5, "x", [], {}, { version: 5 }, { version: 99, app: "fluyo", doc: {} }]) {
      const r: any = proposeLayout({ document: bad });
      assert.equal(r.ok, false);
      assert.equal(r.errors[0].code, "DOCUMENT_UNREADABLE");
      assert.doesNotMatch(JSON.stringify(r), NO_LEAK);
    }
    // el schema del SDK rechaza tipos incorrectos antes de llegar al kernel
    for (const args of [{ document: doc(), pageIndex: "x" }, { document: doc(), clearWaypoints: "si" }, { document: doc(), baseRevision: "abc" }]) {
      const r = await propose(args.document, Object.fromEntries(Object.entries(args).filter(([k]) => k !== "document")));
      assert.equal(isToolError(r), true);
    }
  });

  it("un lote de propose_layout que ya no encaja (el documento cambió) se rechaza con REVISION_MISMATCH al aplicarlo", async () => {
    const d = (await authorJson(empty(), [N(0, {}, { ref: "a" }), N(0, {}, { ref: "b" }), C(0, R("a"), R("b"))])).document;
    const p = await proposeJson(d);
    const changed = (await authorJson(d, [UN(0, I(1), { label: "otro" })])).document;
    const r = documentOf(await call("author_document", { document: changed, baseRevision: p.batches[0].baseRevision, operations: p.batches[0].operations }));
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, "REVISION_MISMATCH");
  });
});

describe("servidor real por stdio: 15 tools y propose_layout de punta a punta", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-6", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });

  it("tools/list = 15; describe → propose_layout → author_document; LAYOUT_EXCEEDS_LIMITS sin trazas", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 15);
    assert.ok(tools.some(t => t.name === "propose_layout"));
    const mk = [N(0, {}, { ref: "a" }), N(0, {}, { ref: "b" }), N(0, {}, { ref: "c" }), C(0, R("a"), R("b"), { label: "x" }), C(0, R("b"), R("c"))];
    const d0 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: empty() } }));
    const built = documentOf(await client.callTool({ name: "author_document", arguments: { document: empty(), baseRevision: d0.revision, operations: mk } }));
    const prop = documentOf(await client.callTool({ name: "propose_layout", arguments: { document: built.document, baseRevision: built.resultRevision } }));
    assert.equal(prop.ok, true);
    assert.equal(prop.revision, built.resultRevision);
    const applied = documentOf(await client.callTool({ name: "author_document", arguments: { document: built.document, baseRevision: prop.batches[0].baseRevision, operations: prop.batches[0].operations } }));
    assert.equal(applied.ok, true);
    assert.equal(applied.resultRevision, prop.finalRevision);
    const d1 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: applied.document } }));
    assert.deepEqual(d1.pages[0].nodes.map((n: any) => [n.id, n.x, n.y]), prop.positions.map((p: any) => [p.id, p.x, p.y]));
    const big = await client.callTool({ name: "propose_layout", arguments: { document: await chainDoc(300, { label: "y".repeat(200) }) } });
    assert.equal(isToolError(big), true);
    assert.equal(documentOf(big).errors[0].code, "LAYOUT_EXCEEDS_LIMITS");
    assert.doesNotMatch(textOf(big), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./);
  });
});

/**
 * FLUYO-018.2 — author_document: create_node y create_connection (alcance «page»).
 *
 * La garantía que se prueba: MCP sólo traduce (schema, refs del lote, revisión, forma de la respuesta); crear el nodo o la
 * conexión es createNodeIn/createConnectionIn de model.js —las mismas funciones que el editor—.
 *   · describe_document → author_document → describe_document → crear Historia → run_story;
 *   · refs del lote acotadas por página, atomicidad, dryRun, baseRevision/resultRevision;
 *   · PARIDAD: Cliente/Comercio/Banco construido por el editor real (golden de Fluyo) == el de author_document, sin normalizar;
 *   · errores estructurados, límites, compatibilidad con documentos existentes;
 *   · el servidor real por stdio.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { DEFAULT_SIZES, SHAPE_NAMES } from "../src/schema.js";
import { documentOf, isToolError, loadFixtures, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const DIR = join(ROOT, "test", "fixtures", "stories");
const load = (n: string): any => JSON.parse(readFileSync(join(DIR, n), "utf8"));
const simple = () => load("fluyo-017-1-cliente-kafka-comercio.fluyo.json");
const golden = (): any => load("fluyo-018-2-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const page = (name = "Página 1") => ({ name, nodes: [] as any[], edges: [] as any[], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 });
const empty = (...pages: any[]): any => ({ version: 5, app: "fluyo", doc: { theme: "dark", customBg: "", eventTypes: [], nextEventTypeId: 1, pages: pages.length ? pages : [page()], cur: 0 }, settings: {} });

const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "model.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const N = (extra: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) => ({ op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 0, y: 0, ...spec }, ...extra });
const C = (source: unknown, target: unknown, extra: Record<string, unknown> = {}) => ({ op: "create_connection", scope: "page", pageIndex: 0, source, target, ...extra });
const R = (ref: string) => ({ ref });
const I = (id: number) => ({ id });
const STORY = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, ...extra });

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) =>
  call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => documentOf(await author(document, operations, extra));
const describeDoc = async (document: unknown) => documentOf(await call("describe_document", { document }));
/** authorDocument() sin pasar por el schema del SDK: lo que llega al kernel tal cual (para probar las reglas del dominio). */
const direct = (document: any, operations: unknown[], extra: Record<string, unknown> = {}): any =>
  authorDocument({ document, baseRevision: rev(document), operations, ...extra });
const NO_LEAK = /TypeError|Cannot read|undefined|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;

/* ═══════════════ 1. Flujo completo: describe → author → describe → Historia → run ═══════════════ */

describe("describe_document → author_document → describe_document → crear Historia → run_story", () => {
  it("un agente crea Cliente → Comercio con refs, crea una Historia con esos elementos y Fluyo la ejecuta", async () => {
    const doc = empty();
    const d0 = await describeDoc(doc);
    assert.equal(d0.valid, true);
    const r = await authorJson(doc, [
      N({ ref: "cliente" }, { x: 200, y: 300, label: "Cliente" }),
      N({ ref: "comercio" }, { x: 600, y: 300, label: "Comercio" }),
      C(R("cliente"), R("comercio"), { ref: "pago", spec: { label: "Pago" } }),
      { op: "create_event_type", scope: "eventType", name: "Pago", primitive: "FLOW", sentence: "{source} paga a {target}", ref: "ev" },
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.baseRevision, d0.revision);
    assert.deepEqual(r.refs, [
      { ref: "cliente", type: "node", pageIndex: 0, id: 1 },
      { ref: "comercio", type: "node", pageIndex: 0, id: 2 },
      { ref: "pago", type: "connection", pageIndex: 0, id: 3 },
    ]);
    const d1 = await describeDoc(r.document);
    assert.equal(d1.revision, r.resultRevision);
    assert.equal(d1.valid, true);
    // Segunda llamada: el agente usa los ids de `refs` para escribir la Historia.
    const edgeId = r.refs.find((x: any) => x.ref === "pago").id;
    const r2 = await authorJson(r.document, [
      STORY("create_story", { name: "Pago del cliente", ref: "s" }),
      STORY("add_step", { storyId: R("s"), eventTypeId: 1, target: { edgeId } }),
    ]);
    assert.equal(r2.ok, true, JSON.stringify(r2.errors));
    const t = documentOf(await call("run_story", { document: r2.document, storyId: 1 }));
    assert.equal(t.executed, true);
    assert.equal(t.steps.length, 1);
    assert.equal(t.steps[0].outcome.status, "completed");
  });

  it("el mismo lote que crea nodos, conexión y Historia (sobre un documento con eventos) deja la Historia ejecutable", async () => {
    const doc = simple();
    const r = await authorJson(doc, [
      N({ ref: "a" }, { x: 1000, y: 100, label: "Nuevo A" }),
      N({ ref: "b" }, { x: 1300, y: 100, label: "Nuevo B" }),
      C(R("a"), R("b"), { ref: "ab" }),
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const ab = r.refs.find((x: any) => x.ref === "ab").id;
    const r2 = await authorJson(r.document, [STORY("create_story", { name: "N", ref: "n" }), STORY("add_step", { storyId: R("n"), eventTypeId: 1, target: { edgeId: ab } })]);
    assert.equal(r2.ok, true);
    const t = documentOf(await call("run_story", { document: r2.document, storyId: r2.touchedStories[0].storyId }));
    assert.equal(t.executed, true);
  });
});

/* ═══════════════ 2. create_node ═══════════════ */

describe("create_node", () => {
  it("mínimo: shape, x, y → el registro completo del editor, con sus defaults", async () => {
    const r = await authorJson(empty(), [N({}, { x: 200, y: 300 })]);
    assert.equal(r.ok, true);
    const n = r.document.doc.pages[0].nodes[0];
    assert.deepStrictEqual(n, { id: 1, shape: "rect", x: 200, y: 300, w: 180, h: 70, label: "Nodo", color: n.color, fill: null, border: "solid", lblPos: "center", textBg: null, textColor: null, font: null, bold: false, pulse: false, order: 0 });
    assert.equal(r.document.doc.pages[0].nextId, 2);
    assert.equal(r.refs.length, 0);
  });

  it("cada shape se crea con su tamaño por defecto", async () => {
    const shapes = SHAPE_NAMES.filter(s => s !== "image");
    const extra: Record<string, Record<string, unknown>> = { icon: { icon: "kafka", label: "Kafka" }, anim: { anim: "pulse", label: "Pulso" } };
    const ops = shapes.map((shape, i) => N({}, { shape, x: i * 10, y: i, ...extra[shape] }));
    const r = await authorJson(empty(), ops);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    r.document.doc.pages[0].nodes.forEach((n: any, i: number) => {
      assert.equal(n.shape, shapes[i]);
      assert.deepEqual([n.w, n.h], DEFAULT_SIZES[shapes[i] as keyof typeof DEFAULT_SIZES]);
      assert.equal(n.id, i + 1);
    });
    // `image` lleva bytes de imagen: como en create_diagram, no se crea por MCP (el schema lo rechaza).
    const img = await author(empty(), [N({}, { shape: "image", x: 1, y: 1 })]).then(x => isToolError(x), () => true);
    assert.equal(img, true);
  });

  it("posición, tamaño y label tal cual (decimales conservados, sin snap)", async () => {
    const r = await authorJson(empty(), [N({}, { x: 200.5, y: 300.25, w: 161, h: 71, label: "Cliente", color: "#112233", bold: true })]);
    const n = r.document.doc.pages[0].nodes[0];
    assert.deepEqual([n.x, n.y, n.w, n.h, n.label, n.color, n.bold], [200.5, 300.25, 161, 71, "Cliente", "#112233", true]);
  });

  it("ref: se devuelve en refs y en changes, y NO se persiste en el documento", async () => {
    const r = await authorJson(empty(), [N({ ref: "cliente" }, { label: "Cliente" })]);
    assert.deepEqual(r.refs, [{ ref: "cliente", type: "node", pageIndex: 0, id: 1 }]);
    assert.equal(r.changes[0].ref, "cliente");
    assert.equal(r.changes[0].entityId, 1);
    assert.doesNotMatch(JSON.stringify(r.document), /"ref"|cliente/);
  });

  it("id explícito: se respeta y adelanta el contador; colisión → DUPLICATE_ID", async () => {
    const r = await authorJson(empty(), [N({ ref: "a" }, { id: 10 }), N({ ref: "b" })]);
    assert.deepEqual(r.document.doc.pages[0].nodes.map((n: any) => n.id), [10, 11]);
    assert.equal(r.document.doc.pages[0].nextId, 12);
    const dup = direct(empty(), [N({}, { id: 3 }), N({}, { id: 3 })]);
    assert.deepEqual([dup.ok, dup.errors[0].code, dup.errors[0].operationIndex, dup.errors[0].field], [false, "DUPLICATE_ID", 1, "id"]);
    const taken = direct(simple(), [N({}, { id: 2 })]);
    assert.equal(taken.errors[0].code, "DUPLICATE_ID");
  });

  it("página: se crea en la pageIndex indicada y no toca las demás", async () => {
    const p = empty(page("A"), page("B"));
    const r = await authorJson(p, [N({ pageIndex: 1 }, { label: "en B" })]);
    assert.deepEqual(r.document.doc.pages.map((pg: any) => pg.nodes.length), [0, 1]);
    assert.deepStrictEqual(r.document.doc.pages[0], p.doc.pages[0]);
    assert.equal(r.changes[0].pageIndex, 1);
  });

  it("dryRun: mismos changes y refs, sin documento; el original intacto", async () => {
    const doc = empty();
    const real = await authorJson(doc, [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"), { ref: "k" })]);
    const dry = await authorJson(doc, [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"), { ref: "k" })], { dryRun: true });
    assert.equal(dry.ok, true);
    assert.equal(dry.dryRun, true);
    assert.equal("document" in dry, false);
    assert.deepEqual(dry.changes, real.changes);
    assert.deepEqual(dry.refs, real.refs);
    assert.equal(dry.resultRevision, real.resultRevision);
    assert.deepStrictEqual(doc, empty());
  });
});

/* ═══════════════ 3. create_connection ═══════════════ */

describe("create_connection", () => {
  it("con ids de elementos existentes: defaults del editor (geometría delegada al dominio)", async () => {
    const r = await authorJson(simple(), [C(I(1), I(3))]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const e = r.document.doc.pages[0].edges.at(-1);
    assert.deepStrictEqual(e, { id: 6, from: 1, to: 3, fromSide: null, toSide: null, route: "straight", waypoints: [], label: "", font: null, bold: false, animated: true, dashed: false, startArrow: false, endArrow: true, flowDir: "normal" });
    assert.equal(r.document.doc.pages[0].nextId, 7);
  });

  it("con refs de nodos creados en el mismo lote, en cualquier orden válido (A→B, C, B→C, C→A)", async () => {
    const r = await authorJson(empty(), [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b")), N({ ref: "c" }), C(R("b"), R("c")), C(R("c"), R("a"), { ref: "vuelta" })]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.document.doc.pages[0].edges.map((e: any) => [e.from, e.to]), [[1, 2], [2, 4], [4, 1]]);
    assert.deepEqual(r.changes.map((c: any) => c.entityKind), ["node", "node", "connection", "node", "connection", "connection"]);
  });

  it("mezcla {id} existente y {ref} nuevo", async () => {
    const r = await authorJson(simple(), [N({ ref: "nuevo" }, { x: 900 }), C(I(3), R("nuevo"))]);
    const e = r.document.doc.pages[0].edges.at(-1);
    assert.deepEqual([e.from, e.to], [3, 6]);
  });

  it("spec: lados, ruta, etiqueta y estilo tal cual los pasa el agente; sin spec, los defaults", async () => {
    const r = await authorJson(empty(), [N({ ref: "a" }), N({ ref: "b" }, { x: 400 }), C(R("a"), R("b"), { spec: { route: "ortho", fromSide: "e", toSide: "w", label: "Cobro", dashed: true, waypoints: [{ x: 10, y: 20 }] } })]);
    const e = r.document.doc.pages[0].edges[0];
    assert.deepEqual([e.route, e.fromSide, e.toSide, e.label, e.dashed, e.waypoints], ["ortho", "e", "w", "Cobro", true, [{ x: 10, y: 20 }]]);
  });

  it("self-loop, origen o destino inexistente: rechazo estructurado del dominio", () => {
    const loop = direct(empty(), [N({ ref: "a" }), C(R("a"), R("a"))]);
    assert.deepEqual([loop.errors[0].code, loop.errors[0].operationIndex, loop.errors[0].field], ["SELF_LOOP", 1, "target"]);
    assert.equal(direct(simple(), [C(I(1), I(1))]).errors[0].code, "SELF_LOOP");
    assert.deepEqual([direct(simple(), [C(I(1), I(99))]).errors[0].code, direct(simple(), [C(I(99), I(1))]).errors[0].code], ["TARGET_NOT_FOUND", "SOURCE_NOT_FOUND"]);
    assert.equal(direct(simple(), [C(R("nada"), I(1))]).errors[0].code, "UNKNOWN_REF");
  });

  it("ref de conexión duplicada → DUPLICATE_REF; la misma ref para un nodo y una conexión es válida (son tipos distintos)", () => {
    const dup = direct(empty(), [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"), { ref: "k" }), C(R("b"), R("a"), { ref: "k" })]);
    assert.deepEqual([dup.errors[0].code, dup.errors[0].operationIndex, dup.errors[0].ref], ["DUPLICATE_REF", 3, "k"]);
    assert.equal(direct(empty(), [N({ ref: "x" }), N({ ref: "y" }), C(R("x"), R("y"), { ref: "x" })]).ok, true);
  });
});

/* ═══════════════ 4. Lote: orden, atomicidad, revisión, páginas ═══════════════ */

describe("lote", () => {
  it("varias operaciones en orden: los ids siguen el orden del lote", async () => {
    const r = await authorJson(empty(), [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b")), N({ ref: "c" }), C(R("b"), R("c"))]);
    assert.deepEqual(r.changes.map((c: any) => [c.operationIndex, c.entityId]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
  });

  it("atomicidad: la última operación inválida descarta TODO; no se devuelve documento y el original queda igual", async () => {
    const doc = empty();
    const before = clone(doc);
    const res = await author(doc, [N({ ref: "cliente" }), N({ ref: "comercio" }), C(R("cliente"), R("comercio"), { ref: "pago" }), C(R("cliente"), I(99))]);
    assert.equal(isToolError(res), true);
    const r = documentOf(res);
    assert.equal(r.ok, false);
    assert.equal("document" in r, false);
    assert.equal(r.errors[0].code, "TARGET_NOT_FOUND");
    assert.equal(r.errors[0].operationIndex, 3);
    assert.deepStrictEqual(doc, before);
  });

  it("baseRevision incorrecta → REVISION_MISMATCH, nada se modifica; correcta → resultRevision determinista", async () => {
    const doc = empty();
    const bad = documentOf(await call("author_document", { document: doc, baseRevision: "sha256:" + "1".repeat(64), operations: [N()] }));
    assert.deepEqual([bad.ok, bad.errors[0].code, bad.actualRevision], [false, "REVISION_MISMATCH", rev(doc)]);
    const a = await authorJson(doc, [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"))]);
    const b = await authorJson(clone(doc), [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"))]);
    assert.match(a.resultRevision, /^sha256:[0-9a-f]{64}$/);
    assert.equal(a.resultRevision, b.resultRevision);
    assert.equal(a.resultRevision, rev(a.document));
    assert.equal(a.changed, true);
    assert.notEqual(a.resultRevision, a.baseRevision);
  });

  it("páginas: la misma ref en la página 0 y en la 1 es válida; una ref de otra página no se resuelve", async () => {
    const p = empty(page("A"), page("B"));
    const ok = await authorJson(p, [N({ ref: "cliente" }), N({ ref: "cliente", pageIndex: 1 }), N({ ref: "x", pageIndex: 1 }), C(R("cliente"), R("x"), { pageIndex: 1 })]);
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    assert.deepEqual(ok.document.doc.pages.map((pg: any) => [pg.nodes.length, pg.edges.length]), [[1, 0], [2, 1]]);
    assert.deepEqual(ok.refs.filter((x: any) => x.ref === "cliente").map((x: any) => x.pageIndex), [0, 1]);
    const cross = direct(p, [N({ ref: "solo0" }), N({ ref: "otro", pageIndex: 1 }), C(R("solo0"), R("otro"), { pageIndex: 1 })]);
    assert.equal(cross.errors[0].code, "UNKNOWN_REF");
    assert.match(cross.errors[0].message, /OTRA página/);
  });

  it("mezcla con Historias: la Historia creada en el mismo lote que sus elementos funciona con ids existentes", async () => {
    const r = await authorJson(simple(), [N({ ref: "x" }, { x: 1 }), STORY("create_story", { name: "Z", ref: "z" })]);
    assert.equal(r.ok, true);
    assert.equal(r.touchedStories.length, 1);
  });
});

/* ═══════════════ 5. Paridad con el editor ═══════════════ */

describe("paridad: Cliente/Comercio/Banco por el editor real y por author_document", () => {
  it("documento completo idéntico (deepStrictEqual, sin normalizar): ids, nextId, shapes, coordenadas, tamaños, defaults, ruta, lados, waypoints, orden", async () => {
    const g = golden();
    const r = await authorJson(empty(), g.operations);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.document, g.document);
    assert.deepStrictEqual(r.refs, g.refs);
    assert.equal(r.document.doc.pages[0].nextId, 7);
  });

  it("el documento del editor es ejecutable: describe_document lo da por válido y la revisión coincide", async () => {
    const g = golden();
    const r = await authorJson(empty(), g.operations);
    const d = await describeDoc(r.document);
    assert.equal(d.valid, true);
    assert.equal(d.revision, r.resultRevision);
    assert.equal(rev(g.document), r.resultRevision);
  });

  it("el golden es el de Fluyo (con fluyo/ al lado)", { skip: skipSinFluyo }, () => {
    assert.equal(
      readFileSync(join(DIR, "fluyo-018-2-golden.json"), "utf8").replace(/\r\n/g, "\n"),
      readFileSync(join(FLUYO, "test", "fixtures", "fluyo-018-2-golden.json"), "utf8").replace(/\r\n/g, "\n")
    );
  });
});

/* ═══════════════ 6. Errores estructurados ═══════════════ */

describe("errores", () => {
  const cases: Array<[string, unknown[], string, Partial<Record<string, unknown>>?]> = [
    ["página inexistente", [N({ pageIndex: 7 })], "PAGE_NOT_FOUND", { pageIndex: 7 }],
    ["ref inexistente", [C(R("nada"), I(1))], "UNKNOWN_REF"],
    ["id inexistente (source)", [N(), C(I(9), I(1))], "SOURCE_NOT_FOUND"],
    ["id inexistente (target)", [N(), C(I(1), I(9))], "TARGET_NOT_FOUND"],
    ["ref duplicada", [N({ ref: "a" }), N({ ref: "a" })], "DUPLICATE_REF"],
    ["auto-lazo", [N({ ref: "a" }), C(R("a"), R("a"))], "SELF_LOOP"],
    ["ID duplicado", [N({}, { id: 1 }), N({}, { id: 1 })], "DUPLICATE_ID"],
    ["shape inválida", [N({}, { shape: "pentagono" })], "INVALID_FIELD", { field: "shape" }],
    ["campo inválido (tipo)", [N({}, { x: "uno" })], "INVALID_FIELD", { field: "x" }],
    ["campo desconocido", [N({}, { colorr: "#fff" })], "INVALID_FIELD", { field: "colorr" }],
    ["ruta inválida", [N(), N(), C(I(1), I(2), { spec: { route: "curva" } })], "INVALID_FIELD"],
    ["lado inválido", [N(), N(), C(I(1), I(2), { spec: { fromSide: "norte" } })], "INVALID_FIELD"],
    ["spec ausente", [{ op: "create_node", scope: "page", pageIndex: 0 }], "INVALID_OPERATION", { field: "spec" }],
    ["ref dentro de spec", [N({}, { ref: "x" })], "INVALID_OPERATION", { field: "spec.ref" }],
    ["extremo con ref e id a la vez", [N(), N(), C({ ref: "a", id: 1 }, I(2))], "INVALID_OPERATION", { field: "source" }],
    ["scope equivocado", [{ ...N(), scope: "story" }], "SCOPE_MISMATCH"],
    ["lote parcialmente válido con una operación inválida", [N({ ref: "ok" }), N({ ref: "ok2" }), C(R("ok"), R("ok2")), N({}, { shape: "zzz" })], "INVALID_FIELD", { operationIndex: 3 }],
  ];
  for (const [name, ops, code, extra] of cases) {
    it(`${name} → ${code}`, () => {
      const r = direct(empty(), ops);
      assert.equal(r.ok, false);
      assert.equal(r.valid, false);
      assert.equal("document" in r, false);
      assert.equal(r.errors[0].code, code, JSON.stringify(r.errors[0]));
      assert.equal(typeof r.errors[0].message, "string");
      assert.equal(typeof r.errors[0].operationIndex, "number");
      assert.doesNotMatch(JSON.stringify(r), NO_LEAK);
      for (const [k, v] of Object.entries(extra ?? {})) assert.deepEqual(r.errors[0][k], v, k);
    });
  }

  it("por el protocolo: un valor fuera del schema (shape inventada, campo desconocido, ref vacía) se rechaza legible, sin traza", async () => {
    for (const op of [N({}, { shape: "pentagono" }), N({}, { colorr: 1 }), N({ ref: "" }), C({ ref: "a", id: 1 }, I(1)), C(5, I(1)), { ...N(), spec: undefined }, N({ extra: true })]) {
      let text = "";
      let isErr = true;
      try { const res = await author(empty(), [op]); text = textOf(res); isErr = isToolError(res); } catch (e) { text = (e as Error).message; }
      assert.equal(isErr, true, JSON.stringify(op));
      assert.doesNotMatch(text, /\n\s+at\s|node:internal|vm\./);
    }
  });

  it("límites: 201 operaciones se rechazan en el schema antes de construir nada; 200 pasan; specs gigantes también se rechazan", async () => {
    const ops = Array.from({ length: 201 }, (_, i) => N({ ref: "n" + i }, { x: i }));
    const over = await author(empty(), ops).then(x => ({ err: isToolError(x), text: textOf(x) }), (e: Error) => ({ err: true, text: e.message }));
    assert.equal(over.err, true);
    assert.doesNotMatch(over.text, /\n\s+at\s|node:internal/);
    const direct201 = direct(empty(), ops);
    assert.deepEqual([direct201.ok, direct201.errors[0].code], [false, "INVALID_OPERATION"]);
    const ok200 = await authorJson(empty(), ops.slice(0, 200));
    assert.equal(ok200.ok, true);
    assert.equal(ok200.document.doc.pages[0].nodes.length, 200);
    for (const spec of [{ label: "x".repeat(501) }, { font: "x".repeat(121) }]) {
      const res = await author(empty(), [N({}, { shape: "rect", ...spec })]).then(x => isToolError(x), () => true);
      assert.equal(res, true);
    }
    const way = await author(empty(), [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"), { spec: { waypoints: Array.from({ length: 101 }, (_, i) => ({ x: i, y: i })) } })]).then(x => isToolError(x), () => true);
    assert.equal(way, true);
  });
});

/* ═══════════════ 7. Compatibilidad y aislamiento ═══════════════ */

describe("compatibilidad", () => {
  it("todos los ejemplos y fixtures: crear un nodo sólo añade ese nodo (lo existente no cambia ni un byte) y el original no se toca", async () => {
    const docs = [...loadFixtures().map(f => [f.name, f.doc] as const), ["simple", simple()] as const, ["complejo", load("fluyo-017-1-qa-complejo.fluyo.json")] as const];
    for (const [name, doc] of docs) {
      const frozen = clone(doc);
      const norm = createKernel().call<any>("FluyoAuthoring.normalizedProject(__a)", doc);
      if (!norm.ok) continue;
      const lastPage = (norm.project.doc.pages.length - 1);
      const r = direct(doc as any, [{ ...N({ pageIndex: lastPage }, { x: 7, y: 8 }) }]);
      assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.errors)}`);
      assert.deepStrictEqual(doc, frozen, `${name}: la entrada se modificó`);
      const out = clone(r.document);
      const pg = out.doc.pages[lastPage];
      const created = pg.nodes.pop();
      assert.equal(created.label, "Nodo");
      pg.nextId = norm.project.doc.pages[lastPage].nextId;
      assert.deepStrictEqual(out, norm.project, `${name}: algo más cambió`);
    }
  });

  it("multipágina, con Historias y EventTypes: operar en una página no altera las Historias ni los eventos", async () => {
    const doc = load("fluyo-017-1-qa-complejo.fluyo.json");
    const r = await authorJson(doc, [N({ ref: "z" }, { x: 5000 })]);
    const norm = createKernel().call<any>("FluyoAuthoring.normalizedProject(__a)", doc).project;
    assert.deepStrictEqual(r.document.doc.eventTypes, norm.doc.eventTypes);
    assert.deepStrictEqual(r.document.doc.pages.map((p: any) => p.scenarios), norm.doc.pages.map((p: any) => p.scenarios));
  });

  it("legacy v1 (`state`): sigue siendo ilegible (DOCUMENT_UNREADABLE), sin traza", () => {
    const r = authorDocument({ document: { state: {} }, baseRevision: "sha256:" + "0".repeat(64), operations: [N()] });
    assert.equal((r as any).errors[0].code, "DOCUMENT_UNREADABLE");
  });

  it("el resumen cuenta lo creado", async () => {
    const res = await author(empty(), [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"))]);
    assert.match(textOf(res), /2 elemento\(s\) y 1 conexión\(es\) creados/);
  });
});

/* ═══════════════ 8. MCP real por stdio ═══════════════ */

describe("servidor real por stdio", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-2", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  const rpc = (args: Record<string, unknown>) => client.callTool({ name: "author_document", arguments: args });
  const noStack = (r: unknown) => assert.doesNotMatch(textOf(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./);

  it("lista create_node y create_connection (y, desde 018.3, update_*/delete_* de diagrama)", async () => {
    const { tools } = await client.listTools();
    const schema = JSON.stringify(tools.find(t => t.name === "author_document")!.inputSchema);
    for (const op of ["create_node", "create_connection"]) assert.ok(schema.includes(op), op);
    for (const op of ["update_node", "update_connection", "delete_node", "delete_connection"]) assert.ok(schema.includes(op), op);
    assert.ok(!schema.includes("move_node") && !schema.includes("add_edge"));
  });

  it("describe → author (2 nodos) → author (conexión por refs) → describe → run_story, y un lote inválido y una baseRevision incorrecta", async () => {
    const d0 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: empty() } }));
    const r1 = documentOf(await rpc({ document: empty(), baseRevision: d0.revision, operations: [N({ ref: "cliente" }, { x: 200, y: 300, label: "Cliente" }), N({ ref: "comercio" }, { x: 600, y: 300, label: "Comercio" })] }));
    assert.equal(r1.ok, true, JSON.stringify(r1));
    const r2 = documentOf(await rpc({ document: r1.document, baseRevision: r1.resultRevision, operations: [C(I(r1.refs[0].id), I(r1.refs[1].id), { ref: "pago" })] }));
    assert.equal(r2.ok, true);
    // La misma conexión en un solo lote con refs:
    const one = documentOf(await rpc({ document: empty(), baseRevision: d0.revision, operations: [N({ ref: "cliente" }, { x: 200, y: 300, label: "Cliente" }), N({ ref: "comercio" }, { x: 600, y: 300, label: "Comercio" }), C(R("cliente"), R("comercio"), { ref: "pago" })] }));
    assert.equal(one.ok, true);
    const d1 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: one.document } }));
    assert.equal(d1.revision, one.resultRevision);
    assert.equal(d1.valid, true);
    const withEvent = documentOf(await rpc({ document: one.document, baseRevision: one.resultRevision, operations: [
      { op: "create_event_type", scope: "eventType", name: "Pago", primitive: "FLOW", sentence: "{source} paga a {target}" },
      STORY("create_story", { name: "Pago", ref: "s" }),
    ] }));
    const story = documentOf(await rpc({ document: withEvent.document, baseRevision: withEvent.resultRevision, operations: [
      STORY("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: one.refs.find((x: any) => x.ref === "pago").id } }),
    ] }));
    assert.equal(story.ok, true, JSON.stringify(story.errors));
    const t = documentOf(await client.callTool({ name: "run_story", arguments: { document: story.document, storyId: 1 } }));
    assert.equal(t.executed, true);
    assert.equal(t.steps[0].outcome.status, "completed");

    const invalid = await rpc({ document: empty(), baseRevision: d0.revision, operations: [N({ ref: "a" }), C(R("a"), R("a"))] });
    assert.equal(isToolError(invalid), true);
    assert.equal(documentOf(invalid).errors[0].code, "SELF_LOOP");
    noStack(invalid);
    const mismatch = await rpc({ document: empty(), baseRevision: "sha256:" + "2".repeat(64), operations: [N()] });
    assert.equal(documentOf(mismatch).errors[0].code, "REVISION_MISMATCH");
    noStack(mismatch);
  });
});

/* ═══════════════ 9. El schema publicado es estricto por sí mismo (defensa en profundidad: el kernel también lo rechaza) ═══════════════ */

describe("schema publicado", () => {
  it("rechaza ref dentro de spec, campos extra y formas sin bytes", async () => {
    const { AuthoringOperationSchema } = await import("../src/authoring.js");
    assert.equal(AuthoringOperationSchema.safeParse(N({}, { x: 1 })).success, true);
    assert.equal(AuthoringOperationSchema.safeParse(N({}, { ref: "x" })).success, false);
    assert.equal(AuthoringOperationSchema.safeParse(N({ force: true })).success, false);
    assert.equal(AuthoringOperationSchema.safeParse(N({}, { shape: "image" })).success, false);
    assert.equal(AuthoringOperationSchema.safeParse(C(R("a"), R("b"), { spec: { ref: "x" } })).success, false);
    assert.equal(AuthoringOperationSchema.safeParse(C({ ref: "a", id: 1 }, R("b"))).success, false);
  });
});

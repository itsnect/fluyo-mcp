/**
 * FLUYO-018.3 — author_document: update_node, update_connection, delete_node, delete_connection (alcance «page»), refs ampliadas y B2.
 *
 * La garantía que se prueba: MCP solo traduce (schema, revisión, dryRun, forma de la respuesta); modificar y eliminar es
 * updateNodeIn / updateConnectionIn / deleteNodeIn / deleteConnectionIn de model.js —las mismas funciones que el editor—.
 *   · describe_document (con geometría) → author_document → describe_document → run_story;
 *   · B2: un borrado que deja una Historia inválida se rechaza explicando entidad, Historia, Step y operación;
 *   · retarget + eliminar en el mismo lote; refs en update_*, delete_* y destinos de Steps;
 *   · atomicidad, baseRevision/resultRevision, dryRun, errores estructurados sin trazas;
 *   · PARIDAD: el documento que construyó el editor real (golden de Fluyo) == el de author_document, sin normalizar;
 *   · el servidor real por stdio.
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
const simple = () => load("fluyo-017-1-cliente-kafka-comercio.fluyo.json");
const golden = (): any => load("fluyo-018-3-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const page = (name = "Página 1") => ({ name, nodes: [] as any[], edges: [] as any[], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 });
const empty = (...pages: any[]): any => ({ version: 5, app: "fluyo", doc: { theme: "dark", customBg: "", eventTypes: [], nextEventTypeId: 1, pages: pages.length ? pages : [page()], cur: 0 }, settings: {} });

const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "model.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const N = (extra: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) => ({ op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 0, y: 0, ...spec }, ...extra });
const C = (source: unknown, target: unknown, extra: Record<string, unknown> = {}) => ({ op: "create_connection", scope: "page", pageIndex: 0, source, target, ...extra });
const UN = (node: unknown, spec: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ op: "update_node", scope: "page", pageIndex: 0, node, spec, ...extra });
const UC = (connection: unknown, spec?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ op: "update_connection", scope: "page", pageIndex: 0, connection, ...(spec ? { spec } : {}), ...extra });
const DN = (node: unknown, extra: Record<string, unknown> = {}) => ({ op: "delete_node", scope: "page", pageIndex: 0, node, ...extra });
const DC = (connection: unknown, extra: Record<string, unknown> = {}) => ({ op: "delete_connection", scope: "page", pageIndex: 0, connection, ...extra });
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
const describeDoc = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await call("describe_document", { document, ...extra }));
/** authorDocument() sin pasar por el schema del SDK: lo que llega al kernel tal cual (reglas del dominio). */
const direct = (document: any, operations: unknown[], extra: Record<string, unknown> = {}): any =>
  authorDocument({ document, baseRevision: rev(document), operations, ...extra });
const NO_LEAK = /TypeError|Cannot read|undefined|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;
const pg0 = (d: any) => d.doc.pages[0];

/* ═══════════════ 1. describe_document con geometría y flujo completo ═══════════════ */

describe("describe_document → author_document (modificar y eliminar) → describe_document → run_story", () => {
  it("describe da lo que un agente necesita para modificar: x/y/w/h, ruta, lados, waypoints y bounds; sin estilos", async () => {
    const doc = empty();
    const made = await authorJson(doc, [
      N({ ref: "a" }, { x: 100, y: 200, w: 200, h: 80, label: "A" }), N({ ref: "b" }, { x: 500, y: 200, label: "B" }),
      C(R("a"), R("b"), { ref: "k", spec: { route: "ortho", fromSide: "e", toSide: "w", waypoints: [{ x: 300, y: 150 }] } }), C(R("b"), R("a")),
    ]);
    const d = await describeDoc(made.document);
    const p = d.pages[0];
    assert.deepEqual(p.nodes.map((n: any) => [n.id, n.x, n.y, n.w, n.h]), [[1, 100, 200, 200, 80], [2, 500, 200, 180, 70]]);
    assert.deepEqual(p.connections[0], { id: 3, from: 1, to: 2, fromLabel: "A", toLabel: "B", route: "ortho", fromSide: "e", toSide: "w", waypoints: [{ x: 300, y: 150 }] });
    assert.deepEqual(p.connections[1], { id: 4, from: 2, to: 1, fromLabel: "B", toLabel: "A", route: "straight" }, "sin lados ni waypoints no se listan");
    assert.deepEqual(p.bounds, { minX: 0, minY: 160, maxX: 590, maxY: 240 });
    const text = JSON.stringify(d);
    assert.doesNotMatch(text, /"color"|"border"|"lblPos"|"fill"|"bold"|presentation/);
    assert.equal((await describeDoc(empty())).pages[0].bounds, null);
  });

  it("un agente mueve, redimensiona, edita, retargetea y elimina; la Historia sigue ejecutándose y el Trace no cambia", async () => {
    const doc = simple();
    const d0 = await describeDoc(doc);
    assert.equal(d0.valid, true);
    const trace0 = documentOf(await call("run_story", { document: doc, storyId: 2 }));
    const r = await authorJson(doc, [
      UN(I(1), { x: 90, y: 310, w: 220, h: 90, label: "Cliente final" }),
      UN(I(3), { shape: "hex", color: "#d08b5b", bold: true }),
      UC(I(4), { label: "Pago", route: "ortho", fromSide: "e", toSide: "w" }),
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.baseRevision, d0.revision);
    assert.notEqual(r.resultRevision, r.baseRevision);
    assert.deepEqual(r.changes.map((c: any) => [c.operation, c.scope, c.pageIndex, c.entityKind, c.entityId, c.updated]), [
      ["update_node", "page", 0, "node", 1, true], ["update_node", "page", 0, "node", 3, true], ["update_connection", "page", 0, "connection", 4, true]]);
    const d1 = await describeDoc(r.document);
    assert.equal(d1.revision, r.resultRevision);
    assert.equal(d1.valid, true);
    assert.equal(d1.pages[0].nodes[0].label, "Cliente final");
    const trace1 = documentOf(await call("run_story", { document: r.document, storyId: 2 }));
    assert.deepEqual(trace1.trace, trace0.trace, "mover/editar no cambia el Trace");
    assert.equal(trace1.executed, true);
  });
});

describe("geometría: solo se escribe lo que se pide; los waypoints no se inventan ni se pierden", () => {
  it("mover, redimensionar, editar y retargetear conservan los waypoints; waypoints:[] vuelve a la ruta automática; el aviso lista las conexiones con ruta manual", async () => {
    const made = await authorJson(empty(), [N({ ref: "a" }, { x: 0, y: 0 }), N({ ref: "b" }, { x: 400, y: 0 }), N({ ref: "c" }, { x: 400, y: 300 }),
      C(R("a"), R("b"), { ref: "k", spec: { route: "ortho", fromSide: "e", toSide: "w", waypoints: [{ x: 200, y: -50 }, { x: 250, y: -50 }] } })]);
    const wp = [{ x: 200, y: -50 }, { x: 250, y: -50 }];
    const r = await authorJson(made.document, [UN(I(2), { x: 450, w: 240 }), UC(I(4), { label: "k" }), UC(I(4), undefined, { target: I(3) })]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(pg0(r.document).edges[0].waypoints, wp);
    assert.deepEqual(r.changes[0].affects.connectionsWithWaypoints, [4]);
    assert.equal(r.changes[2].affects.note.includes("waypoints:[]"), true);
    const auto = await authorJson(r.document, [UC(I(4), { waypoints: [] })]);
    assert.deepEqual(pg0(auto.document).edges[0].waypoints, []);
    const d = await describeDoc(r.document);
    assert.deepEqual(d.pages[0].connections[0].waypoints, wp);
  });
});

/* ═══════════════ 2. B2: eliminar con Historias que lo usan ═══════════════ */

describe("B2: el estado final decide; nada se limpia en silencio", () => {
  it("delete_connection de una conexión usada por dos Historias: rechazo con entidad, Historias, Steps y operación; sin documento", async () => {
    const doc = simple();
    const res = await author(doc, [DC(I(5))]);
    assert.equal(isToolError(res), true);
    const r = documentOf(res);
    assert.equal(r.ok, false);
    assert.equal(r.document, undefined);
    assert.equal(r.errors.length, 1);
    const e = r.errors[0];
    assert.equal(e.code, "REFERENCED_ENTITY");
    assert.deepEqual(e.entity, { kind: "connection", id: 5 });
    assert.deepEqual(e.affectedStories.map((s: any) => [s.storyId, s.storyName, s.stepIds]), [[1, "Historia A", [3]], [2, "Historia B", [4]]]);
    assert.equal(e.operationIndex, 0);
    assert.equal(e.operation, "delete_connection");
    assert.match(e.message, /Historia A/);
    assert.match(r.note, /original no se modificó/);
    assert.doesNotMatch(textOf(res), NO_LEAK);
  });

  it("delete_node usado: la cascada de sus conexiones también se atribuye (cascadedFrom) y nombra a cada Historia", async () => {
    const r = documentOf(await author(simple(), [DN(I(2))]));
    assert.equal(r.ok, false);
    const byEntity = r.errors.map((e: any) => [e.entity.kind, e.entity.id, e.cascadedFrom?.id ?? null]);
    assert.deepEqual(byEntity.sort(), [["connection", 4, 2], ["connection", 5, 2], ["node", 2, null]]);
    for (const e of r.errors) {
      assert.equal(e.code, "REFERENCED_ENTITY");
      assert.ok(e.affectedStories.length >= 1 && e.affectedSteps.length >= 1);
      assert.equal(e.operationIndex, 0);
    }
  });

  it("retarget + eliminar el nodo anterior en el mismo lote es válido, en cualquier orden de lo que lo permita", async () => {
    // Kafka (2) desaparece: sus pasos se retargetean a conexiones de Cliente→Comercio y Comercio→Cliente, y Kafka se elimina al final.
    const doc = simple();
    const before = await describeDoc(doc);
    const steps = before.pages[0].stories.flatMap((s: any) => (s.moments ?? []).flatMap((m: any) => m.steps.map((st: any) => [s.storyId, st])));
    const touching = steps.filter(([, st]: any) => st.target.id === 2 || st.target.id === 4 || st.target.id === 5);
    assert.ok(touching.length > 0);
    const ops: unknown[] = [C(I(1), I(3), { ref: "directo" })];
    for (const [storyId, st] of touching as any[]) {
      const target = st.target.kind === "element" ? { nodeId: 1 } : { edgeId: { ref: "directo" } };
      ops.push(STORY("retarget_step", { storyId, stepId: st.stepId, target }));
    }
    ops.push(DN(I(2)));
    const r = documentOf(await author(doc, ops));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(pg0(r.document).nodes.map((n: any) => n.id), [1, 3]);
    const after = await describeDoc(r.document);
    assert.equal(after.valid, true);
    assert.deepEqual(r.changes.at(-1).cascade.connections, [4, 5]);
  });

  it("antes de eliminar, quitar los pasos: válido; eliminar sin quitarlos: rechazado", async () => {
    const doc = clone(simple());
    // Historia C (3) solo usa la conexión 4: se vacía y se elimina la conexión; las otras dos Historias siguen en pie.
    const one = documentOf(await author(doc, [DC(I(4))]));
    assert.equal(one.ok, false);
    const steps4 = one.errors[0].affectedSteps;
    const removals = steps4.map((s: any) => STORY("remove_step", { storyId: s.storyId, stepId: s.stepId }));
    const fixed = documentOf(await author(doc, [...removals, DC(I(4))]));
    assert.equal(fixed.ok, true, JSON.stringify(fixed.errors));
    assert.deepEqual(pg0(fixed.document).edges.map((e: any) => e.id), [5]);
  });

  it("el Behavior (disponibilidad inicial) del nodo eliminado se elimina con él y se informa", async () => {
    const doc = await authorJson(empty(), [N({ ref: "a" }), N({ ref: "b" }), { op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: R("b"), state: "DOWN" }]);
    const r = await authorJson(doc.document, [DN(I(2))]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(pg0(r.document).behaviors, []);
    assert.deepEqual(r.changes[0].cascade, { connections: [], behaviors: [2] });
    assert.equal((await describeDoc(r.document)).valid, true);
  });
});

/* ═══════════════ 3. Refs ═══════════════ */

describe("refs en update/delete y en destinos de Steps", () => {
  it("create → update → connection → step → delete en un único lote", async () => {
    const r = await authorJson(empty(), [
      N({ ref: "cliente" }, { x: 100, y: 100, label: "Cliente" }), N({ ref: "comercio" }, { x: 500, y: 100, label: "Comercio" }),
      C(R("cliente"), R("comercio"), { ref: "pago" }),
      UN(R("cliente"), { x: 120 }), UC(R("pago"), { label: "Pago" }),
      { op: "create_event_type", scope: "eventType", name: "Pago", primitive: "FLOW", sentence: "{source} paga a {target}", ref: "ev" },
      STORY("create_story", { name: "Compra", ref: "s" }),
      STORY("add_step", { storyId: R("s"), eventTypeId: R("ev"), target: R("pago") }),
      N({ ref: "tmp" }), C(R("tmp"), R("cliente"), { ref: "t" }), DC(R("t")), DN(R("tmp")),
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.refs.map((x: any) => x.ref), ["cliente", "comercio", "pago"]);
    assert.equal(JSON.stringify(r.document).includes("tmp"), false, "las refs no se persisten");
    const t = documentOf(await call("run_story", { document: r.document, storyId: 1 }));
    assert.equal(t.steps[0].outcome.status, "completed");
  });

  it("destinos de Step: {ref}, {edgeId:{ref}}, {nodeId:{ref}} y {from:{ref},to:{ref}}", async () => {
    const base = [N({ ref: "a" }), N({ ref: "b" }, { x: 300 }), C(R("a"), R("b"), { ref: "k" }),
      { op: "create_event_type", scope: "eventType", name: "Pago", primitive: "FLOW", sentence: "{source} paga a {target}", ref: "ev" },
      { op: "create_event_type", scope: "eventType", name: "Aviso", primitive: "OCCURRENCE", sentence: "{target} avisa", ref: "av" },
      STORY("create_story", { ref: "s" })];
    const step = (eventTypeId: unknown, target: unknown) => STORY("add_step", { storyId: R("s"), eventTypeId, target });
    const r = await authorJson(empty(), [...base, step(R("ev"), { edgeId: R("k") }), step(R("ev"), { from: R("a"), to: R("b") }), step(R("ev"), R("k")), step(R("av"), { nodeId: R("a") }),
      { op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: R("b"), state: "DOWN" }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(pg0(r.document).scenarios[0].steps.map((s: any) => s.edgeId ?? s.nodeId), [3, 3, 3, 1]);
    assert.deepEqual(pg0(r.document).behaviors, [{ nodeId: 2, initialState: "DOWN" }]);
  });

  it("UNKNOWN_REF (también de otra página), DUPLICATE_REF y uso de una entidad ya eliminada en el lote", async () => {
    const two = empty(page("A"), page("B"));
    const code = async (doc: any, ops: unknown[]) => documentOf(await author(doc, ops)).errors[0];
    assert.equal((await code(empty(), [UN(R("nada"), { x: 1 })])).code, "UNKNOWN_REF");
    assert.equal((await code(empty(), [DC(R("nada"))])).code, "UNKNOWN_REF");
    const cross = await code(two, [N({ ref: "x" }), UN(R("x"), { x: 1 }, { pageIndex: 1 })]);
    assert.equal(cross.code, "UNKNOWN_REF");
    assert.match(cross.message, /OTRA página/);
    assert.equal((await code(empty(), [N({ ref: "x" }), N({ ref: "x" })])).code, "DUPLICATE_REF");
    const gone = await code(empty(), [N({ ref: "x" }), DN(R("x")), UN(R("x"), { x: 1 })]);
    assert.equal(gone.code, "NODE_NOT_FOUND");
    assert.match(gone.message, /operación 1: delete_node/);
    assert.equal(gone.operationIndex, 2);
  });
});

/* ═══════════════ 4. Revisión, dryRun, atomicidad ═══════════════ */

describe("baseRevision, resultRevision, dryRun y atomicidad", () => {
  it("baseRevision incorrecta: REVISION_MISMATCH sin tocar nada; resultRevision determinista", async () => {
    const doc = simple();
    const bad = documentOf(await call("author_document", { document: doc, baseRevision: "sha256:" + "3".repeat(64), operations: [UN(I(1), { x: 1 })] }));
    assert.equal(bad.errors[0].code, "REVISION_MISMATCH");
    assert.equal(bad.document, undefined);
    assert.equal(bad.actualRevision, rev(doc));
    const ops = [UN(I(1), { x: 5, label: "z" }), UC(I(4), { label: "q" }), N({ ref: "n" }), C(R("n"), I(1), { ref: "k" }), UC(R("k"), { dashed: true }), DC(R("k"))];
    const a = await authorJson(doc, ops), b = await authorJson(doc, ops);
    assert.equal(a.resultRevision, b.resultRevision);
    assert.equal(rev(a.document), a.resultRevision);
    assert.deepEqual(a.document, b.document);
  });

  it("dryRun: los mismos changes, refs y resultRevision que el lote real, sin document, sin tocar la entrada", async () => {
    const doc = simple();
    const snapshot = JSON.stringify(doc);
    const ops = [UN(I(1), { x: 5, label: "z" }), UC(I(4), undefined, { target: I(3) }), N({ ref: "n" }), C(R("n"), I(1))];
    const real = await authorJson(doc, ops);
    const dry = await authorJson(doc, ops, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.document, undefined);
    assert.deepEqual(dry.changes, real.changes);
    assert.deepEqual(dry.refs, real.refs);
    assert.equal(dry.resultRevision, real.resultRevision);
    assert.equal(JSON.stringify(doc), snapshot);
    const rejected = await authorJson(doc, [DC(I(5))], { dryRun: true });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.dryRun, true);
    assert.equal(rejected.errors[0].code, "REFERENCED_ENTITY");
  });

  it("atomicidad: fallo en la 1.ª operación, en una intermedia y en la validación final (B2): ningún documento, el original intacto", async () => {
    const doc = simple();
    const snapshot = JSON.stringify(doc);
    for (const ops of [[UN(I(99), { x: 1 }), UN(I(1), { x: 5 })], [UN(I(1), { x: 5 }), UC(I(99), { label: "x" }), UN(I(2), { x: 6 })], [UN(I(1), { x: 5 }), DC(I(5))], [UN(I(1), { x: 5 }), DN(I(2))]]) {
      const res = await author(doc, ops);
      const r = documentOf(res);
      assert.equal(isToolError(res), true, JSON.stringify(ops));
      assert.equal(r.ok, false);
      assert.equal(r.document, undefined);
      assert.equal(JSON.stringify(doc), snapshot);
      assert.doesNotMatch(textOf(res), NO_LEAK);
    }
  });
});

/* ═══════════════ 5. Errores estructurados y schema ═══════════════ */

describe("errores estructurados (kernel) y schema publicado", () => {
  const code = (doc: any, ops: unknown[]) => { const r = direct(doc, ops); assert.equal(r.ok, false); assert.doesNotMatch(JSON.stringify(r), NO_LEAK); return r.errors[0]; };

  it("update_node: id inexistente, campo desconocido, id/ref/icon no modificables, valores y formas inválidos", () => {
    const doc = simple();
    assert.equal(code(doc, [UN(I(99), { x: 1 })]).code, "NODE_NOT_FOUND");
    assert.equal(code(doc, [UN(I(4), { x: 1 })]).code, "NODE_NOT_FOUND", "un id de conexión no es un nodo");
    for (const field of ["zzz", "id", "ref", "icon", "img"]) assert.deepEqual([code(doc, [UN(I(1), { [field]: 1 })]).code, code(doc, [UN(I(1), { [field]: 1 })]).field], ["INVALID_FIELD", field]);
    for (const bad of [{ w: -1 }, { x: "1" }, { shape: "image" }, { shape: "hexagono" }, { tint: true }, { lang: "sql" }, { border: "doble" }, { bold: "si" }, { label: 3 }])
      assert.equal(code(doc, [UN(I(1), bad)]).code, "INVALID_FIELD", JSON.stringify(bad));
    assert.equal(code(doc, [UN(I(1), {})]).code, "INVALID_OPERATION");
  });

  it("update_connection: source/target inexistente, auto-lazo, campo desconocido, eventTypeId (no es de la conexión)", () => {
    const doc = simple();
    assert.equal(code(doc, [UC(I(4), undefined, { source: I(99) })]).code, "SOURCE_NOT_FOUND");
    assert.equal(code(doc, [UC(I(4), undefined, { target: I(99) })]).code, "TARGET_NOT_FOUND");
    assert.equal(code(doc, [UC(I(4), undefined, { target: I(1) })]).code, "SELF_LOOP");
    assert.equal(code(doc, [UC(I(99), { label: "x" })]).code, "CONNECTION_NOT_FOUND");
    assert.equal(code(doc, [UC(I(1), { label: "x" })]).code, "CONNECTION_NOT_FOUND");
    for (const field of ["zzz", "eventTypeId", "from", "to", "id"]) assert.equal(code(doc, [UC(I(4), { [field]: 1 })]).field, field);
    assert.equal(code(doc, [UC(I(4), { route: "curva" })]).code, "INVALID_FIELD");
  });

  it("el schema publicado es estricto: ids, forma desde/hacia image, claves extra y tipos", () => {
    const ok = (op: unknown) => AuthoringOperationSchema.safeParse(op).success;
    assert.equal(ok(UN(I(1), { x: 1 })), true);
    assert.equal(ok(UN(R("a"), { shape: "diamond", label: "x", fs: null })), true);
    assert.equal(ok(UN(I(1), { shape: "image" })), false);
    assert.equal(ok(UN(I(1), { shape: "icon" })), false);
    assert.equal(ok(UN(I(1), { id: 5 })), false);
    assert.equal(ok(UN(I(1), { icon: "x" })), false);
    assert.equal(ok(UN(I(1), { x: 1 }, { force: true })), false);
    assert.equal(ok(UN(1, { x: 1 })), false);
    assert.equal(ok(UN({ ref: "a", id: 1 }, { x: 1 })), false);
    assert.equal(ok(UN(I(1), { border: "none" })), true, "«none» es un borde válido del documento");
    assert.equal(ok(UC(I(4), { label: "x" }, { source: R("a"), target: I(2) })), true);
    assert.equal(ok(UC(I(4), { source: 1 })), false);
    assert.equal(ok(UC(I(4), { id: 7 })), false);
    assert.equal(ok(UC(I(4), { waypoints: [{ x: 1 }] })), false);
    assert.equal(ok(DN(I(1))), true);
    assert.equal(ok(DN(1)), false);
    assert.equal(ok(DC(R("a"))), true);
    assert.equal(ok(Object.assign(DC(I(4)), { scope: "story" })), false);
    assert.equal(ok({ op: "delete_node", scope: "page", pageIndex: 0, nodeId: 1 }), false);
    assert.equal(ok(STORY("add_step", { storyId: 1, eventTypeId: 1, target: { ref: "k" } })), true);
    assert.equal(ok(STORY("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: R("k") } })), true);
    assert.equal(ok(STORY("add_step", { storyId: 1, eventTypeId: 1, target: { from: R("a"), to: 2 } })), true);
    assert.equal(ok(STORY("add_step", { storyId: 1, eventTypeId: 1, target: { ref: "k", edgeId: 1 } })), false);
    assert.equal(ok({ op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: R("a"), state: "DOWN" }), true);
  });

  it("el resumen cuenta lo modificado y lo eliminado", async () => {
    const res = await author(empty(), [N({ ref: "a" }), N({ ref: "b" }), C(R("a"), R("b"), { ref: "k" }), UN(R("a"), { x: 5 }), UC(R("k"), { label: "k" }), DC(R("k")), DN(R("b"))]);
    assert.match(textOf(res), /2 elemento\(s\) y 1 conexión\(es\) creados/);
    assert.match(textOf(res), /1 elemento\(s\) y 1 conexión\(es\) modificados/);
    assert.match(textOf(res), /1 elemento\(s\) y 1 conexión\(es\) eliminados/);
  });
});

/* ═══════════════ 6. Compatibilidad ═══════════════ */

describe("compatibilidad con documentos existentes", () => {
  it("todos los ejemplos publicados (v3) y fixtures de Historias admiten mover/etiquetar y siguen siendo válidos; la entrada no se toca", async () => {
    for (const { name, doc } of loadFixtures()) {
      const d: any = doc;
      const before = JSON.stringify(d);
      const pg = d.doc?.pages?.[0] ?? d.state;
      const first = (pg?.nodes ?? [])[0];
      if (!first) continue;
      const r = await authorJson(d, [UN(I(first.id), { x: 11, y: 22, label: "editado" })]);
      if (r.ok === false && r.errors?.[0]?.code === "DOCUMENT_UNREADABLE") continue;
      assert.equal(r.ok, true, `${name} ${JSON.stringify(r.errors)}`);
      assert.equal(pg0(r.document).nodes.find((n: any) => n.id === first.id).label, "editado", name);
      assert.equal((await describeDoc(r.document)).valid, true, name);
      assert.equal(JSON.stringify(d), before, `${name}: la entrada se modificó`);
    }
  });
});

/* ═══════════════ 7. Paridad con el editor real ═══════════════ */

describe("PARIDAD: el documento del editor real (golden de Fluyo) == el de author_document, sin normalizar", () => {
  it("mover, redimensionar, editar, retarget, crear y borrar (con Historias, EventTypes, Behaviors, nextId y revisión)", async () => {
    const g = golden();
    const r = await authorJson(g.start, g.operations);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.document, g.document);
    // (el orden de claves de `doc` en la respuesta MCP lo fija el schema de entrada de zod —preexistente—: la igualdad y la revisión son estructurales)
    assert.equal(r.resultRevision, rev(g.document));
    const t0 = documentOf(await call("run_story", { document: g.start, storyId: 1 }));
    const t1 = documentOf(await call("run_story", { document: r.document, storyId: 1 }));
    assert.equal(t1.executed, true);
    assert.ok(t0.executed);
  });

  it("el golden coincide con el de fluyo/ cuando está al lado", { skip: skipSinFluyo }, () => {
    const fluyo = JSON.parse(readFileSync(join(FLUYO, "test", "fixtures", "fluyo-018-3-golden.json"), "utf8"));
    assert.deepStrictEqual(fluyo, golden(), "fixtures/stories/fluyo-018-3-golden.json desactualizado: cópialo desde fluyo/test/fixtures/");
  });
});

/* ═══════════════ 8. MCP real por stdio ═══════════════ */

describe("servidor real por stdio", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-3", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  const rpc = (args: Record<string, unknown>) => client.callTool({ name: "author_document", arguments: args });
  const noStack = (r: unknown) => assert.doesNotMatch(textOf(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./);

  it("describe → author (crear + modificar + borrar) → describe → Historia → run_story; B2 y baseRevision incorrecta", async () => {
    const d0 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: empty() } }));
    const r1 = documentOf(await rpc({ document: empty(), baseRevision: d0.revision, operations: [
      N({ ref: "cliente" }, { x: 200, y: 300, label: "Cliente" }), N({ ref: "comercio" }, { x: 600, y: 300, label: "Comercio" }), N({ ref: "x" }),
      C(R("cliente"), R("comercio"), { ref: "pago" }), C(R("x"), R("comercio"), { ref: "viejo" }),
      UC(R("viejo"), undefined, { source: R("cliente") }), UN(R("cliente"), { x: 220 }), DN(R("x")),
    ] }));
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.deepEqual(pg0(r1.document).nodes.map((n: any) => n.id), [1, 2]);
    assert.deepEqual(pg0(r1.document).edges.map((e: any) => [e.id, e.from, e.to]), [[4, 1, 2], [5, 1, 2]]);
    const d1 = documentOf(await client.callTool({ name: "describe_document", arguments: { document: r1.document } }));
    assert.equal(d1.revision, r1.resultRevision);
    assert.equal(d1.valid, true);
    const withStory = documentOf(await rpc({ document: r1.document, baseRevision: r1.resultRevision, operations: [
      { op: "create_event_type", scope: "eventType", name: "Pago", primitive: "FLOW", sentence: "{source} paga a {target}", ref: "ev" },
      STORY("create_story", { name: "Pago", ref: "s" }), STORY("add_step", { storyId: R("s"), eventTypeId: R("ev"), target: { edgeId: 4 } }),
    ] }));
    assert.equal(withStory.ok, true, JSON.stringify(withStory.errors));
    const t = documentOf(await client.callTool({ name: "run_story", arguments: { document: withStory.document, storyId: 1 } }));
    assert.equal(t.steps[0].outcome.status, "completed");
    const b2 = await rpc({ document: withStory.document, baseRevision: withStory.resultRevision, operations: [DC(I(4))] });
    assert.equal(isToolError(b2), true);
    assert.equal(documentOf(b2).errors[0].code, "REFERENCED_ENTITY");
    assert.deepEqual(documentOf(b2).errors[0].affectedSteps, [{ pageIndex: 0, storyId: 1, stepId: 1 }]);
    noStack(b2);
    const mismatch = await rpc({ document: empty(), baseRevision: "sha256:" + "2".repeat(64), operations: [UN(I(1), { x: 1 })] });
    assert.equal(documentOf(mismatch).errors[0].code, "REVISION_MISMATCH");
    noStack(mismatch);
    const unknown = await rpc({ document: withStory.document, baseRevision: withStory.resultRevision, operations: [UN(I(9), { x: 1 })] });
    assert.equal(documentOf(unknown).errors[0].code, "NODE_NOT_FOUND");
    noStack(unknown);
  });
});

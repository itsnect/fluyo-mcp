/**
 * FLUYO-018.22 — Dependencias de llegada en el MCP: crearlas y modificarlas de forma explícita y segura.
 *
 * Semántica (018.21, no se rediseña): scenario.arrivalDependencies = [{stepId, waitsForArrivalOf:[ids de SEND]}] —«este momento
 * no empieza hasta que llegue el token de ese envío»—. Dato de la HISTORIA, nunca del Step; el momento es atómico; lo
 * independiente no se retrasa; nada se infiere de las conexiones. La regla de validez vive en el kernel (model.js) y es la
 * misma que usa el editor (FluyoStoryClock la reexporta).
 *
 * Se fija:
 *   · add_step {waitsForArrivalOf} y set_arrival_dependencies (reemplazar, limpiar); rechazo INVALID_ARRIVAL_DEPENDENCY con razón;
 *   · integridad: remove_step (objetivo y dependiente), duplicate_step (dependiente y objetivo), duplicate_story, move/set_wait (aviso);
 *   · describe_document: lo almacenado, lo que aplica y lo ignorado; Historias antiguas sin cambios;
 *   · PARIDAD con el editor (mismas funciones de model.js, story-clock.js real de fluyo/) y reproducción 0→1100→1600→2700, 0→500→1100;
 *   · Share (#d=) conserva el dato; el MCP no ejecuta el reloj (story-clock.js fuera del kernel).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";

import { AuthoringOperationSchema, authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { KERNEL_FILES } from "../src/generated/kernel-sources.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument, runStory } from "../src/stories.js";
import { documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "story-clock.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
const author = (document: unknown, operations: unknown[]): any => authorDocument({ document, baseRevision: rev(document), operations });
const ok = (document: unknown, operations: unknown[]): any => {
  const r = author(document, operations);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};
const play0 = (doc: any) => (describeDocument({ document: doc }) as any).pages[0].stories[0].moments.map((m: any) => m.at);
const story = (doc: any, id = 1, pi = 0) => doc.doc.pages[pi].scenarios.find((s: any) => s.id === id);
const W = (stepId: number, ...ids: number[]) => ({ stepId, waitsForArrivalOf: ids });

/* ───────── El documento de la prueba integrada, creado ENTERO por el MCP ─────────
   A → B → C (conexiones 1→2, 2→3) y X aparte. Eventos: Petición (FLOW normal = 1100 ms), Recibe (OCCURRENCE), Cae (SET_AVAILABILITY DOWN). */
const BLANK = { version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 1, eventTypes: [],
  pages: [{ name: "Llegadas", nodes: [], edges: [], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 }] } };
const DIAGRAM_OPS = [
  { op: "create_node", scope: "page", pageIndex: 0, ref: "A", spec: { shape: "rect", x: 200, y: 300, label: "A" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "B", spec: { shape: "rect", x: 500, y: 300, label: "B" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "C", spec: { shape: "rect", x: 800, y: 300, label: "C" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "X", spec: { shape: "rect", x: 500, y: 520, label: "X" } },
  { op: "create_connection", scope: "page", pageIndex: 0, ref: "AB", source: { ref: "A" }, target: { ref: "B" } },
  { op: "create_connection", scope: "page", pageIndex: 0, ref: "BC", source: { ref: "B" }, target: { ref: "C" } },
  { op: "create_event_type", scope: "eventType", ref: "send", name: "Petición", primitive: "FLOW", sentence: "{source} envía a {target}", motion: "normal" },
  { op: "create_event_type", scope: "eventType", ref: "recv", name: "Recibe", primitive: "OCCURRENCE", sentence: "{target} recibe" },
  { op: "create_event_type", scope: "eventType", ref: "down", name: "Cae", primitive: "SET_AVAILABILITY", availability: "DOWN", sentence: "{target} cae" },
];
/* ids que asigna el dominio en BLANK: nodos 1..4, conexiones 5 (A→B) y 6 (B→C); eventos 1 send, 2 recv, 3 down. */
const DIAGRAM = (() => ok(BLANK, DIAGRAM_OPS).document)();
const SEND = (ref: string, edgeId: number, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId: 1, target: { edgeId }, waitMs: 500, ...extra });
const RECV = (ref: string, nodeId: number, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId: 2, target: { nodeId }, waitMs: 500, ...extra });
const DOWN = (ref: string, nodeId: number, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId: 3, target: { nodeId }, waitMs: 500, ...extra });
/* Cadena: M1 A SEND B · M2 B recibe (espera M1) · M3 B SEND C · M4 C recibe (espera M3). Pasos 1..4. */
const CHAIN_OPS = [
  { op: "create_story", scope: "story", pageIndex: 0, name: "Cadena" },
  SEND("m1", 5), RECV("m2", 2, { waitsForArrivalOf: [{ ref: "m1" }] }), SEND("m3", 6), RECV("m4", 3, { waitsForArrivalOf: [{ ref: "m3" }] }),
];
const chain = (): any => ok(DIAGRAM, CHAIN_OPS).document;
/* Independiente: A SEND B (0) · X cae (500) · B recibe esperando a A (1000). */
const indep = (): any => ok(DIAGRAM, [{ op: "create_story", scope: "story", pageIndex: 0, name: "Independiente" },
  SEND("a", 5), DOWN("x", 4), RECV("b", 2, { waitsForArrivalOf: [{ ref: "a" }] })]).document;
/* Sin dependencias: pasos 1 SEND(0) 2 RECV(500) 3 SEND(1000) 4 RECV(1500). */
const plain = (): any => ok(DIAGRAM, [{ op: "create_story", scope: "story", pageIndex: 0, name: "Plana" }, SEND("m1", 5), RECV("m2", 2), SEND("m3", 6), RECV("m4", 3)]).document;
const rejected = (doc: unknown, ops: unknown[], code = "INVALID_ARRIVAL_DEPENDENCY") => {
  const r = author(doc, ops);
  assert.equal(r.ok, false, "debía rechazarse");
  assert.equal(r.errors[0].code, code, JSON.stringify(r.errors));
  assert.equal("document" in r, false, "un rechazo no devuelve documento");
  return r.errors[0];
};

/* ───────── Reproducción con el editor real (fluyo/js, story-clock.js incluido) ───────── */
const EDITOR_FILES = ["config.js", "safe-svg.js", "model.js", "scenario-engine.js", "scenario-playback.js", "story-playback.js", "story-clock.js"];
function editorKernel() {
  const ctx = vm.createContext({ TextEncoder, TextDecoder, atob, btoa });
  for (const f of EDITOR_FILES) vm.runInContext(readFileSync(join(FLUYO, "js", f), "utf8"), ctx, { filename: f });
  return (code: string, arg?: unknown): any => {
    (ctx as any).__in = JSON.stringify(arg ?? null);
    return JSON.parse(vm.runInContext(`JSON.stringify((function(){ const __a = JSON.parse(__in); ${code} })())`, ctx));
  };
}
/* Instante en que se VE cada momento con el Playback real a 1 ms (como 018.21), más el horario. */
function play(document: unknown, storyId = 1) {
  return editorKernel()(`doc = projectFromProjectData(__a.d).doc; const pg = doc.pages[0], sc = pg.scenarios.find(s => s.id === __a.id);
    const st = FluyoStoryClock.start(pg, sc, 0); if (!st.ok) return {errors: st.errors};
    const shown = {};
    for (let t = 0; t <= 20000; t++) { const rs = FluyoScenarioPlayback.tick(st.playback, t); for (const e of rs.logEvents) if (shown[e.stepId] === undefined) shown[e.stepId] = t; if (rs.finished) break; }
    return {moments: storyboardGroups(sc.steps).map(g => shown[g.steps[0].id]), times: st.playback.schedule.times};`, { d: document, id: storyId });
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });

/* ═══════════════ 1. Crear ═══════════════ */
describe("018.22 · add_step", () => {
  it("1 · sin waitsForArrivalOf: no crea arrivalDependencies (ni vacía) y el Step no cambia de forma", () => {
    const doc = plain(), sc = story(doc);
    assert.equal("arrivalDependencies" in sc, false);
    for (const s of sc.steps) assert.deepEqual(Object.keys(s).sort(), (s.action === "SEND" ? ["action", "at", "edgeId", "eventTypeId", "id"] : ["action", "at", "eventTypeId", "id", "nodeId"]));
    const r = ok(doc, [RECV("z", 3, { waitsForArrivalOf: [] })]);
    assert.equal("arrivalDependencies" in story(r.document), false, "[] tampoco crea una entrada vacía");
    assert.equal("waitsForArrivalOf" in r.changes[0], false);
  });

  it("2 · con dependencia válida (id o {ref}): se registra en la Historia, nunca en el Step", () => {
    const doc = chain(), sc = story(doc);
    assert.deepEqual(sc.arrivalDependencies, [W(2, 1), W(4, 3)]);
    for (const s of sc.steps) assert.equal("waitsForArrivalOf" in s, false, "el Step no lleva la dependencia");
    const r = ok(plain(), [RECV("z", 3, { waitsForArrivalOf: [3, 1, 3] })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(5, 1, 3)], "ordenado y sin duplicados");
    assert.deepEqual(r.changes[0].waitsForArrivalOf, [1, 3]);
  });
});

/* ═══════════════ 2. Modificar ═══════════════ */
describe("018.22 · set_arrival_dependencies", () => {
  it("3 · crea la dependencia de un Step existente (from/to/changed en changes)", () => {
    const r = ok(plain(), [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [1] })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(2, 1)]);
    assert.deepEqual([r.changes[0].from, r.changes[0].to, r.changes[0].changed, r.changes[0].entityId], [[], [1], true, 2]);
    assert.deepEqual(r.touchedStories, [{ pageIndex: 0, storyId: 1 }]);
  });

  it("4 · reemplaza (no añade): solo queda la lista nueva; las de otros Steps no se tocan", () => {
    const base = ok(plain(), [S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [1] }), S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [1] })]).document;
    const r = ok(base, [S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [3] })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(2, 1), W(4, 3)]);
    assert.deepEqual([r.changes[0].from, r.changes[0].to], [[1], [3]]);
  });

  it("5 · [] limpia de verdad: la entrada desaparece y, si era la única, el campo también", () => {
    const r = ok(chain(), [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [] })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(4, 3)]);
    const r2 = ok(r.document, [S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [] })]);
    assert.equal("arrivalDependencies" in story(r2.document), false, "sin dependencias, sin campo (como una Historia antigua)");
    const d = describeDocument({ document: r2.document }) as any;
    assert.equal("arrivalDependencies" in d.pages[0].stories[0], false);
    assert.ok(d.pages[0].stories[0].moments.every((m: any) => !("waitsFor" in m)));
  });

  it("idempotente: volver a fijar lo mismo es changed:false y no cambia la revisión", () => {
    const doc = chain();
    const r = ok(doc, [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [1] })]);
    assert.equal(r.changes[0].changed, false);
    assert.equal(r.changed, false);
  });
});

/* ═══════════════ 3. Validación: se RECHAZA con razón (nunca se ignora en la entrada) ═══════════════ */
describe("018.22 · validación de entrada", () => {
  it("6 · SEND inexistente → send_missing", () => {
    const e = rejected(plain(), [S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [99] })]);
    assert.deepEqual([e.reason, e.stepId, e.sendId, e.storyId, e.field], ["send_missing", 4, 99, 1, "waitsForArrivalOf[0]"]);
    assert.deepEqual(e.candidates, [1, 3]);
  });

  it("7 · Step dependiente inexistente → STEP_NOT_FOUND", () => {
    const e = rejected(plain(), [S("set_arrival_dependencies", { stepId: 77, waitsForArrivalOf: [1] })], "STEP_NOT_FOUND");
    assert.equal(e.stepId, 77);
  });

  it("8 · objetivo que no es SEND → not_send", () => {
    assert.equal(rejected(plain(), [S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [2] })]).reason, "not_send");
  });

  it("9 · objetivo futuro o del mismo momento → not_earlier", () => {
    assert.equal(rejected(plain(), [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [3] })]).reason, "not_earlier");
    const same = ok(plain(), [S("add_step", { ref: "s", eventTypeId: 1, target: { edgeId: 6 }, placement: { sameMomentAs: 2 } })]).document;
    assert.equal(rejected(same, [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [5] })]).reason, "not_earlier", "mismo momento: atómico");
  });

  it("10 · sobre sí mismo → self", () => {
    assert.equal(rejected(plain(), [S("set_arrival_dependencies", { stepId: 3, waitsForArrivalOf: [3] })]).reason, "self");
  });

  it("11 · ciclo → cycle (y nunca se acepta)", () => {
    const base = ok(plain(), [S("set_arrival_dependencies", { stepId: 3, waitsForArrivalOf: [1] })]).document;
    const e = rejected(base, [S("set_arrival_dependencies", { stepId: 1, waitsForArrivalOf: [3] })]);
    assert.equal(e.reason, "cycle");
  });

  it("otra Historia: un {ref} de un paso de otra Historia → other_story; en add_step también", () => {
    const doc = plain();
    const e = rejected(doc, [{ op: "create_story", scope: "story", pageIndex: 0, ref: "h2" }, S("add_step", { storyId: { ref: "h2" }, ref: "o", eventTypeId: 1, target: { edgeId: 5 } }),
      S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [{ ref: "o" }] })]);
    assert.equal(e.reason, "other_story");
    assert.equal(rejected(doc, [RECV("z", 3, { waitsForArrivalOf: [2] })]).reason, "not_send");
    assert.equal(rejected(doc, [RECV("z", 3, { waitsForArrivalOf: [{ ref: "nadie" }] })], "UNKNOWN_REF").field, "waitsForArrivalOf[0]");
  });

  it("forma: sin waitsForArrivalOf, no lista, campo desconocido → rechazo; el schema MCP publica la forma", () => {
    rejected(plain(), [S("set_arrival_dependencies", { stepId: 2 })], "INVALID_OPERATION");
    rejected(plain(), [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: 1 })], "INVALID_OPERATION");
    rejected(plain(), [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [1], at: 5 })], "INVALID_OPERATION");
    const parse = (op: unknown) => AuthoringOperationSchema.safeParse(op).success;
    assert.equal(parse(S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [1, { ref: "x" }] })), true);
    assert.equal(parse(S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [] })), true);
    assert.equal(parse(S("set_arrival_dependencies", { stepId: 2 })), false);
    assert.equal(parse(S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [0] })), false);
    assert.equal(parse(S("add_step", { eventTypeId: 2, target: { nodeId: 2 }, waitsForArrivalOf: [1] })), true);
  });

  it("un documento ANTIGUO con una dependencia inválida se lee y se edita igual (tolerancia 018.21): no se revalida lo que no se escribe", () => {
    const doc = plain();
    story(doc).arrivalDependencies = [W(2, 3), W(4, 99), { stepId: "x" }];
    const d = describeDocument({ document: doc }) as any;
    assert.equal(d.valid, true);
    const r = ok(doc, [S("rename_story", { name: "Otra" }), S("set_wait", { stepId: 2, waitMs: 700 })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(2, 3), W(4, 99), { stepId: "x" }], "lo almacenado no se toca");
    assert.equal("warnings" in r, false, "no se avisa de lo que ya no aplicaba");
  });
});

/* ═══════════════ 4. Integridad en las operaciones existentes ═══════════════ */
describe("018.22 · remove / duplicate / reorder", () => {
  it("12 · remove_step del SEND objetivo: se van las dependencias que lo esperaban; sin huérfanas; cascade lo dice", () => {
    const r = ok(chain(), [S("remove_step", { stepId: 1 })]);
    const sc = story(r.document);
    assert.deepEqual(sc.arrivalDependencies, [W(4, 3)]);
    assert.deepEqual(r.changes[0].cascade, { arrivalDependencies: [{ stepId: 2, sendId: 1 }] });
    const ids = new Set(sc.steps.map((s: any) => s.id));
    for (const d of sc.arrivalDependencies) { assert.ok(ids.has(d.stepId)); for (const x of d.waitsForArrivalOf) assert.ok(ids.has(x), "sin referencias huérfanas"); }
  });

  it("13 · remove_step del dependiente: se va su entrada; si no queda ninguna, el campo desaparece", () => {
    const r = ok(chain(), [S("remove_step", { stepId: 4 })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(2, 1)]);
    assert.deepEqual(r.changes[0].cascade, { arrivalDependencies: [{ stepId: 4, sendId: 3 }] });
    const r2 = ok(r.document, [S("remove_step", { stepId: 2 })]);
    assert.equal("arrivalDependencies" in story(r2.document), false);
    const plainRemove = ok(plain(), [S("remove_step", { stepId: 2 })]);
    assert.equal("cascade" in plainRemove.changes[0], false, "sin dependencias, la respuesta de siempre");
  });

  it("14 · duplicate_step del dependiente: la copia (mismo momento) espera lo mismo; solo lo válido", () => {
    const r = ok(chain(), [S("duplicate_step", { stepId: 4 })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(2, 1), W(4, 3), W(5, 3)]);
    assert.deepEqual(r.changes[0].waitsForArrivalOf, [3]);
    // Lo almacenado que no aplica (aquí: 2 «espera» a 3, que es posterior) NO se copia.
    const doc = chain();
    story(doc).arrivalDependencies = [W(2, 1, 3)];
    const r2 = ok(doc, [S("duplicate_step", { stepId: 2 })]);
    assert.deepEqual(story(r2.document).arrivalDependencies, [W(2, 1, 3), W(5, 1)]);
  });

  it("15 · duplicate_step del SEND objetivo: las dependencias existentes NO se redirigen a la copia", () => {
    const r = ok(chain(), [S("duplicate_step", { stepId: 1 })]);
    assert.deepEqual(story(r.document).arrivalDependencies, [W(2, 1), W(4, 3)], "siguen apuntando al SEND original");
    assert.equal("waitsForArrivalOf" in r.changes[0], false);
  });

  it("16 · duplicate_story: la copia conserva sus dependencias con los MISMOS ids de paso (los ids son por Historia) y el original no cambia", () => {
    const doc = chain();
    const r = ok(doc, [S("duplicate_story", { ref: "c" }), S("set_arrival_dependencies", { storyId: { ref: "c" }, stepId: 4, waitsForArrivalOf: [] })]);
    const orig = story(r.document, 1), copy = story(r.document, 2);
    assert.deepEqual(copy.steps.map((s: any) => s.id), orig.steps.map((s: any) => s.id));
    assert.deepEqual(orig.arrivalDependencies, [W(2, 1), W(4, 3)], "el original no se toca al editar la copia");
    assert.deepEqual(copy.arrivalDependencies, [W(2, 1)]);
    const r2 = ok(doc, [S("duplicate_story")]);
    assert.deepEqual(story(r2.document, 2).arrivalDependencies, story(r2.document, 1).arrivalDependencies);
    const ids = new Set(story(r2.document, 2).steps.map((s: any) => s.id));
    for (const d of story(r2.document, 2).arrivalDependencies) for (const x of [d.stepId, ...d.waitsForArrivalOf]) assert.ok(ids.has(x));
  });

  it("move_step / set_wait: el dato se conserva; si deja de aplicar se AVISA (warnings) y la reproducción no se rompe", () => {
    const r = ok(chain(), [S("move_step", { stepId: 1, direction: "later" })]);   // el envío 1 pasa detrás del 2: deja de ser anterior
    assert.deepEqual(story(r.document).arrivalDependencies, [W(2, 1), W(4, 3)], "dato almacenado intacto");
    assert.deepEqual(r.warnings.map((w: any) => [w.code, w.stepId, w.sendId, w.reason]), [["ARRIVAL_DEPENDENCY_INACTIVE", 2, 1, "not_earlier"]]);
    const d = describeDocument({ document: r.document }) as any;
    assert.deepEqual(d.pages[0].stories[0].inactiveArrivalDependencies, [{ stepId: 2, sendId: 1, reason: "not_earlier" }]);
    assert.ok(!d.pages[0].stories[0].moments.flatMap((m: any) => m.steps).some((s: any) => s.stepId === 2 && s.waitsForArrivalOf), "no aplica: no se expone como espera");
    const back = ok(r.document, [S("move_step", { stepId: 1, direction: "earlier" })]);
    assert.equal("warnings" in back, false, "vuelve a aplicar al restablecer el orden");
    assert.deepEqual(play0(back.document), [0, 500, 1000, 1500], "narrativo intacto");
  });

  it("run_story: el Trace del motor es idéntico con y sin dependencias (el MCP no ejecuta el reloj)", () => {
    const a = runStory({ document: chain(), storyId: 1 }) as any, b = runStory({ document: plain(), storyId: 1 }) as any;
    assert.equal(a.executed, true);
    assert.deepEqual(a.trace, b.trace);
    assert.equal(a.traceDigest, b.traceDigest);
  });
});

/* ═══════════════ 5. author_document conserva, describe_document expone ═══════════════ */
describe("018.22 · conservar y describir", () => {
  it("17 · author_document conserva las dependencias en TODAS las operaciones que no las tocan (Historia, página, eventos, documento)", () => {
    const doc = chain(), deps = clone(story(doc).arrivalDependencies);
    const r = ok(doc, [S("rename_story", { name: "Renombrada" }), S("set_wait", { stepId: 3, waitMs: 800 }), S("retarget_step", { stepId: 2, target: { nodeId: 4 } }),
      { op: "update_node", scope: "page", pageIndex: 0, node: { id: 1 }, spec: { x: 210 } }, { op: "update_event_type", scope: "eventType", eventTypeId: 1, name: "Pedido" },
      { op: "set_theme", scope: "document", theme: "crema" }, { op: "create_page", scope: "document" }, { op: "create_story", scope: "story", pageIndex: 0, name: "Otra" }]);
    assert.deepEqual(story(r.document).arrivalDependencies, deps);
    assert.equal(createKernel().call<any>("FluyoAuthoring.normalizedProject(__a)", r.document).project.doc.pages[0].scenarios[0].arrivalDependencies.length, 2);
  });

  it("18 · describe_document: lo almacenado (story), lo que aplica (paso y momento) y nada más", () => {
    const d = describeDocument({ document: chain() }) as any, st = d.pages[0].stories[0];
    assert.deepEqual(st.arrivalDependencies, [W(2, 1), W(4, 3)]);
    assert.equal("inactiveArrivalDependencies" in st, false);
    assert.deepEqual(st.moments.map((m: any) => [m.at, m.waitsFor ?? null, m.steps.map((s: any) => s.waitsForArrivalOf ?? null)]),
      [[0, null, [null]], [500, [1], [[1]]], [1000, null, [null]], [1500, [3], [[3]]]]);
    const atomic = describeDocument({ document: ok(chain(), [S("add_step", { eventTypeId: 3, target: { nodeId: 4 }, placement: { sameMomentAs: 2 } })]).document }) as any;
    assert.deepEqual(atomic.pages[0].stories[0].moments[1].waitsFor, [1], "el momento espera la unión aunque el otro paso no espere nada");
    const lean = describeDocument({ document: chain(), includeSteps: false }) as any;
    assert.deepEqual(lean.pages[0].stories[0].arrivalDependencies, [W(2, 1), W(4, 3)]);
    assert.ok(d.unmodeled.some((u: string) => /dependencias de llegada/.test(u) && /Trace/.test(u)));
  });

  it("describe_document por el MCP real (zod + transporte): mismas claves", async () => {
    const r = await call("describe_document", { document: chain() });
    assert.ok(!isToolError(r), textOf(r));
    assert.deepEqual(documentOf(r).pages[0].stories[0].arrivalDependencies, [W(2, 1), W(4, 3)]);
  });

  it("19 · Historia antigua sin dependencias: describe_document y author_document dan exactamente lo de antes (sin claves nuevas)", () => {
    const doc = plain(), d = describeDocument({ document: doc }) as any;
    const json = JSON.stringify(d);
    for (const k of ["arrivalDependencies", "inactiveArrivalDependencies", "waitsFor", "waitsForArrivalOf"]) assert.equal(json.includes(`"${k}"`), false, k);
    const r = ok(doc, [S("set_wait", { stepId: 2, waitMs: 900 }), S("duplicate_step", { stepId: 2 }), S("remove_step", { stepId: 1 })]);
    assert.doesNotMatch(JSON.stringify([r.document, r.changes, r.warnings ?? null]), /arrivalDependencies|waitsForArrivalOf|"cascade"|ARRIVAL_/, "ni en el documento ni en changes ni en warnings");
  });
});

/* ═══════════════ 6. Compatibilidad: editor, Viewer, Share ═══════════════ */
describe("018.22 · paridad con el editor y reproducción", { skip: skipSinFluyo }, () => {
  it("20 · cadena creada por el MCP se reproduce en Fluyo 0 → 1100 → 1600 → 2700; independiente 0 → 500 → 1100", () => {
    const c = play(chain());
    assert.deepEqual(c.moments, [0, 1100, 1600, 2700]);
    assert.deepEqual(c.times, [0, 1100, 1600, 2700]);
    assert.deepEqual(play(indep()).moments, [0, 500, 1100], "X cae a su hora: lo independiente no se retrasa");
    assert.deepEqual(play(plain()).moments, [0, 500, 1000, 1500], "sin dependencias, como siempre");
  });

  it("paridad: el editor (FluyoStoryClock = model.js) y el MCP escriben la misma forma para declarar, quitar, eliminar y duplicar", () => {
    const k = editorKernel(), base = plain();
    const editor = k(`const sc = projectFromProjectData(__a).doc.pages[0].scenarios[0];
      const set = l => { if (l) sc.arrivalDependencies = l; else delete sc.arrivalDependencies; };
      set(FluyoStoryClock.withArrivalWait(sc, 2, 1, true)); set(FluyoStoryClock.withArrivalWait(sc, 4, 3, true)); set(FluyoStoryClock.withArrivalWait(sc, 4, 1, true));
      const declared = JSON.parse(JSON.stringify(sc.arrivalDependencies || null));
      set(FluyoStoryClock.withoutArrivalWaits(sc, 4)); const cleared = JSON.parse(JSON.stringify(sc.arrivalDependencies || null));
      set(FluyoStoryClock.withArrivalWait(sc, 4, 3, true));
      const copy = duplicateStep(sc, 4); set(FluyoStoryClock.copyArrivalWaits(sc, 4, copy.id)); const duplicated = JSON.parse(JSON.stringify(sc));
      sc.steps = storyboardRemoveStep(sc.steps, 3).steps; set(FluyoStoryClock.pruneArrivalDependencies(sc));
      return {declared, cleared, duplicated, removed: sc};`, base);
    const m1 = ok(base, [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [1] }), S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [1, 3] })]).document;
    assert.deepEqual(story(m1).arrivalDependencies, editor.declared);
    const m2 = ok(m1, [S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [] })]).document;
    assert.deepEqual(story(m2).arrivalDependencies ?? null, editor.cleared);
    const m3 = ok(m2, [S("set_arrival_dependencies", { stepId: 4, waitsForArrivalOf: [3] }), S("duplicate_step", { stepId: 4 })]).document;
    assert.deepEqual(story(m3), editor.duplicated);
    const m4 = ok(m3, [S("remove_step", { stepId: 3 })]).document;
    assert.deepEqual(story(m4), editor.removed);
  });

  it("paridad de la regla: la del kernel del MCP es la del editor (story-clock.js reexporta model.js); lo ignorado coincide", () => {
    const doc = chain();
    story(doc).arrivalDependencies = [W(2, 1, 3, 99), W(4, 2), W(77, 1), { stepId: 4 }];
    const k = editorKernel();
    const editor = k(`const sc = projectFromProjectData(__a).doc.pages[0].scenarios[0]; const a = FluyoStoryClock.arrivalDependencies(sc);
      return {waits: [...a.waits], ignored: a.ignored, same: FluyoStoryClock.arrivalDependencies === arrivalDependencies && FluyoStoryClock.arrivalCandidates === arrivalCandidates};`, doc);
    assert.equal(editor.same, true);
    const st = (describeDocument({ document: doc }) as any).pages[0].stories[0];
    assert.deepEqual(st.inactiveArrivalDependencies, editor.ignored);
    assert.deepEqual(st.moments.flatMap((m: any) => m.steps).filter((s: any) => s.waitsForArrivalOf).map((s: any) => [s.stepId, s.waitsForArrivalOf]), editor.waits);
  });

  it("Share/Viewer: el enlace #d= del resultado lleva arrivalDependencies tal cual y el Viewer reproduce lo mismo", () => {
    const r = ok(DIAGRAM, CHAIN_OPS);
    const payload = /#d=([A-Za-z0-9\-_]+)$/.exec(r.editorUrl)![1];
    const bytes = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const shared = JSON.parse((bytes[0] === 1 ? inflateRawSync(bytes.subarray(1)) : bytes.subarray(1)).toString("utf8"));
    assert.deepEqual(story(shared).arrivalDependencies, [W(2, 1), W(4, 3)]);
    assert.deepEqual(play(shared).moments, [0, 1100, 1600, 2700]);
    // El Viewer (s/index.html) y el editor cargan model.js antes de story-clock.js: la regla está disponible para los dos.
    for (const page of ["index.html", join("s", "index.html")]) {
      const html = readFileSync(join(FLUYO, page), "utf8");
      assert.ok(html.indexOf("js/model.js") < html.indexOf("js/story-clock.js"), page);
    }
  });
});

/* ═══════════════ 7. Kernel y contrato ═══════════════ */
describe("018.22 · kernel y contrato", () => {
  it("story-clock.js NO entra en el kernel; la regla sí (model.js) y FluyoAuthoring la usa", () => {
    assert.deepEqual(KERNEL_FILES.map(f => f.name), ["config.js", "safe-svg.js", "model.js", "scenario-engine.js", "scenario-playback.js", "story-playback.js", "document-integrity.js", "story-authoring.js"]);
    const k = createKernel();
    assert.equal(k.call<string>("typeof FluyoStoryClock"), "undefined");
    assert.equal(k.call<string>("[typeof arrivalDependencies, typeof arrivalCandidates, typeof withArrivalWaits, typeof pruneArrivalDependencies, typeof copyArrivalWaits].join()"), "function,function,function,function,function");
    assert.equal(k.call<string>("FluyoAuthoring.OPERATION_SCOPE.set_arrival_dependencies"), "story");
  });

  it("MCP no reimplementa la regla: authoring.ts y stories.ts no comparan tiempos ni acciones", () => {
    for (const f of ["authoring.ts", "stories.ts"]) {
      const src = readFileSync(join(ROOT, "src", f), "utf8");
      assert.doesNotMatch(src, /"SEND"|\.at\s*[<>]|not_earlier/, f);
    }
  });

  it("author_document por el MCP real: el lote de la cadena, y un rechazo legible sin documento", async () => {
    const good = await call("author_document", { document: DIAGRAM, baseRevision: rev(DIAGRAM), operations: CHAIN_OPS });
    assert.ok(!isToolError(good), textOf(good));
    assert.deepEqual(story(documentOf(good).document).arrivalDependencies, [W(2, 1), W(4, 3)]);
    const bad = await call("author_document", { document: DIAGRAM, baseRevision: rev(DIAGRAM), operations: [...CHAIN_OPS.slice(0, 2), RECV("m2", 2, { waitsForArrivalOf: [{ ref: "m2x" }] })] });
    assert.match(textOf(bad), /UNKNOWN_REF/);
    const bad2 = await call("author_document", { document: plain(), baseRevision: rev(plain()), operations: [S("set_arrival_dependencies", { stepId: 2, waitsForArrivalOf: [3] })] });
    assert.match(textOf(bad2), /INVALID_ARRIVAL_DEPENDENCY/);
    assert.doesNotMatch(textOf(bad2), /\n\s+at\s|node:internal/);
    const { tools } = await h.client.listTools();
    const t = tools.find(x => x.name === "author_document")!;
    assert.ok(JSON.stringify(t.inputSchema).includes("set_arrival_dependencies"));
    assert.ok(JSON.stringify(t.inputSchema).includes("waitsForArrivalOf"));
    assert.match(t.description ?? "", /DEPENDENCIAS DE LLEGADA/);
  });
});

/**
 * FLUYO-017.2 — author_document: autoría de Historias sobre una copia, en un lote atómico.
 *
 * La garantía que se prueba: si MCP puede crear una Historia, Fluyo puede ejecutarla sin saber que la creó MCP.
 *   · describe_document → author_document → run_story, con revisión optimista (baseRevision / resultRevision);
 *   · atomicidad y original intacto; B2 (rechazar y explicar) evaluado sobre el estado final del lote;
 *   · PARIDAD: las mismas operaciones que el editor real (golden de Fluyo) dan los mismos Steps, Trace,
 *     outcomes y disponibilidad final;
 *   · el servidor real por stdio.
 * El criterio (tiempos, acciones, destinos, integridad) vive en el kernel de Fluyo: aquí no hay reglas de dominio.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { canonicalJson, revisionOf } from "../src/revision.js";
import { documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const DIR = join(ROOT, "test", "fixtures", "stories");
const load = (n: string): any => JSON.parse(readFileSync(join(DIR, n), "utf8"));
const simple = () => load("fluyo-017-1-cliente-kafka-comercio.fluyo.json");
const complex = () => load("fluyo-017-1-qa-complejo.fluyo.json");
const golden = (): any => load("fluyo-017-2-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "model.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, ...extra });
const P = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "page", pageIndex: 0, ...extra });

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) =>
  call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => documentOf(await author(document, operations, extra));
const describeDoc = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await call("describe_document", { document, ...extra }));
const run = async (document: unknown, storyId: number, extra: Record<string, unknown> = {}) => documentOf(await call("run_story", { document, storyId, ...extra }));
const stepsOf = (doc: any, storyId: number, pi = 0) => doc.doc.pages[pi].scenarios.find((s: any) => s.id === storyId).steps;
const ats = (doc: any, storyId: number) => stepsOf(doc, storyId).map((s: any) => [s.id, s.at]);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}

/* ═══════════════ 1. Flujo completo: describe → author → run ═══════════════ */

describe("describe_document → author_document → run_story", () => {
  it("un agente crea una Historia y Fluyo la ejecuta: el flujo conceptual completo", async () => {
    const doc = simple();
    const d = await describeDoc(doc);
    assert.match(d.revision, /^sha256:[0-9a-f]{64}$/);
    const r = await authorJson(doc, [
      S("create_story", { name: "Pago con Kafka caído", ref: "n" }),
      P("set_initial_availability", { nodeId: 2, state: "DOWN" }),
      S("add_step", { storyId: { ref: "n" }, eventTypeId: 1, target: { from: 1, to: 2 } }),
      S("add_step", { storyId: { ref: "n" }, eventTypeId: 2, target: { nodeId: 2 }, waitMs: 2000 }),
      S("add_step", { storyId: { ref: "n" }, eventTypeId: 3, target: { from: 2, to: 3 }, waitMs: 5000 }),
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.baseRevision, d.revision);
    // El agente relee el resultado con describe_document y lo ejecuta con run_story.
    const d2 = await describeDoc(r.document);
    assert.equal(d2.revision, r.resultRevision);
    assert.equal(d2.valid, true);
    const story = d2.pages[0].stories.find((s: any) => s.name === "Pago con Kafka caído");
    assert.deepEqual(story.moments.map((m: any) => m.at), [0, 2000, 7000]);
    assert.equal(d2.pages[0].nodes[1].availability, "DOWN");
    const t = await run(r.document, story.storyId);
    assert.equal(t.executed, true);
    assert.deepEqual(t.steps.map((s: any) => [s.sentence, s.outcome.status, s.outcome.reason ?? null]), [
      ["Cliente paga a Kafka", "not_completed", "target_down"],
      ["Kafka procesa el evento", "narrated", null],
      ["Comercio recibe confirmación de Kafka", "not_completed", "source_down"],
    ]);
  });

  it("el documento nuevo es el formato de guardado de Fluyo (v5, sin estado de MCP) y se vuelve a normalizar sin cambios", async () => {
    const r = await authorJson(complex(), [S("create_story", { name: "X" })]);
    assert.deepEqual(Object.keys(r.document).sort(), ["app", "doc", "settings", "version"]);
    assert.equal(r.document.version, 5);
    assert.equal(rev(r.document), r.resultRevision, "idempotente: la revisión del resultado es la que se anunció");
    assert.ok(!JSON.stringify(r).includes("generator"));
  });

  it("encadenar lotes: el resultado y su resultRevision son la base del siguiente", async () => {
    const a = await authorJson(simple(), [S("create_story", { name: "Primera", ref: "p" }), S("add_step", { storyId: { ref: "p" }, eventTypeId: 1, target: { edgeId: 4 } })]);
    const b = await authorJson(a.document, [S("add_step", { storyId: 4, eventTypeId: 2, target: { nodeId: 2 }, waitMs: 3000 })], { });
    assert.equal(b.ok, true);
    assert.equal(b.baseRevision, a.resultRevision);
    assert.deepEqual(ats(b.document, 4), [[1, 0], [2, 3000]]);
  });

  it("documento legacy (v3): se crea una Historia y la salida es v5 válido", async () => {
    const legacy = clone(JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "kafka-event-pipeline.fluyo.json"), "utf8")));
    const r = await authorJson(legacy, [S("create_story", { name: "Primera historia" })]);
    assert.equal(r.ok, true);
    assert.equal(r.document.version, 5);
    assert.equal((await describeDoc(r.document)).valid, true);
    // Sin biblioteca de eventos no se puede añadir un paso (los eventos sólo se referencian).
    const bad = await author(legacy, [S("create_story", { ref: "x" }), S("add_step", { storyId: { ref: "x" }, eventTypeId: 1, target: { nodeId: 1 } })]);
    assert.equal(isToolError(bad), true);
    assert.equal(documentOf(bad).errors[0].code, "EVENT_TYPE_NOT_FOUND");
  });
});

/* ═══════════════ 2. Revisión (control optimista, sin estado) ═══════════════ */

describe("revisiones", () => {
  it("baseRevision correcta → ok; incorrecta → REVISION_MISMATCH con la revisión real, sin documento", async () => {
    const doc = simple();
    const wrong = await call("author_document", { document: doc, baseRevision: "sha256:" + "0".repeat(64), operations: [S("create_story")] });
    assert.equal(isToolError(wrong), true);
    const w = documentOf(wrong);
    assert.equal(w.ok, false);
    assert.equal(w.document, undefined);
    assert.equal(w.errors[0].code, "REVISION_MISMATCH");
    assert.equal(w.actualRevision, rev(doc));
    assert.equal(w.errors[0].actual, rev(doc));
    assert.equal((await authorJson(doc, [S("create_story")])).ok, true);
  });

  it("baseRevision con formato inválido: la rechaza el schema (no llega al servidor de dominio)", async () => {
    for (const bad of ["abc", "sha256:xyz", "", "SHA256:" + "0".repeat(64)]) {
      let text = "";
      try { text = textOf(await call("author_document", { document: simple(), baseRevision: bad, operations: [S("create_story")] })); } catch (e) { text = (e as Error).message; }
      assert.match(text, /baseRevision|invalid|Invalid|pattern/i, bad);
    }
  });

  it("misma entrada + mismas operaciones → mismo resultRevision y mismo documento (determinista)", async () => {
    const ops = [S("create_story", { name: "Det", ref: "d" }), S("add_step", { storyId: { ref: "d" }, eventTypeId: 2, target: { nodeId: 2 } })];
    const a = await authorJson(simple(), ops), b = await authorJson(simple(), ops);
    assert.equal(a.resultRevision, b.resultRevision);
    assert.deepStrictEqual(a.document, b.document);
    // Y no depende del estado del proceso: otra operación en medio no cambia nada.
    await authorJson(complex(), [S("create_story")]);
    assert.equal((await authorJson(simple(), ops)).resultRevision, a.resultRevision);
  });

  it("la revisión no depende del formato ni del orden de claves del documento recibido", async () => {
    const doc = simple();
    const reordered = (o: any): any => Array.isArray(o) ? o.map(reordered) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reordered(v)])) : o;
    assert.equal(rev(reordered(doc)), rev(doc));
    assert.equal(rev(JSON.parse(JSON.stringify(doc, null, 4))), rev(doc));
    assert.equal((await describeDoc(reordered(doc))).revision, (await describeDoc(doc)).revision);
  });

  it("cualquier cambio del documento cambia la revisión", () => {
    const base = simple(), r = rev(base);
    const variants = [
      (d: any) => { d.doc.pages[0].scenarios[0].name = "otra"; },
      (d: any) => { d.doc.pages[0].scenarios[0].steps[0].at = 1; },
      (d: any) => { d.doc.pages[0].nodes[0].label = "otro"; },
      (d: any) => { d.doc.eventTypes[0].name = "otro"; },
      (d: any) => { d.doc.pages[0].behaviors.push({ nodeId: 1, initialState: "DOWN" }); },
    ];
    for (const v of variants) { const d = clone(base); v(d); assert.notEqual(rev(d), r); }
  });

  it("un lote que no cambia nada deja la misma revisión (changed:false)", async () => {
    const r = await authorJson(simple(), [S("rename_story", { storyId: 1, name: "Historia A" })]);
    assert.equal(r.changed, false);
    assert.equal(r.resultRevision, r.baseRevision);
  });

  it("describe_document y run_story anuncian la revisión; un documento ilegible no tiene", async () => {
    assert.equal((await describeDoc(simple())).revision, rev(simple()));
    assert.equal((await run(simple(), 1)).revision, rev(simple()));
    assert.equal((await describeDoc({ version: 5, app: "fluyo", doc: { pages: [null] } })).revision, null);
  });

  it("canonicalJson: claves ordenadas, sin undefined, estable", () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  });
});

/* ═══════════════ 3. Atomicidad y dryRun ═══════════════ */

describe("atomicidad", () => {
  it("op1 válida, op2 válida, op3 inválida → isError, sin documento y el original intacto", async () => {
    const doc = simple(), before = JSON.stringify(doc);
    const res = await author(doc, [S("create_story", { name: "Nueva" }), S("add_step", { storyId: 1, eventTypeId: 4, target: { nodeId: 3 } }), S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 99 } })]);
    assert.equal(isToolError(res), true);
    const r = documentOf(res);
    assert.deepEqual([r.ok, r.valid, r.document, r.errors[0].code, r.errors[0].operationIndex], [false, false, undefined, "TARGET_NOT_FOUND", 2]);
    assert.match(r.note, /original no se modificó/);
    assert.equal(JSON.stringify(doc), before);
    assert.match(textOf(res), /RECHAZADO/);
  });

  it("un lote que falla en la validación FINAL (tocar una Historia rota sin repararla) tampoco deja nada parcial", async () => {
    const broken = simple();
    broken.doc.pages[0].scenarios[0].steps[0].eventTypeId = 99;               // la Historia A ya estaba rota
    const r = documentOf(await author(broken, [S("create_story", { name: "Se descarta" }), S("add_step", { storyId: 1, eventTypeId: 2, target: { nodeId: 2 } })]));
    assert.equal(r.ok, false);
    assert.equal(r.document, undefined);
    assert.equal(r.errors[0].code, "STORY_NOT_EXECUTABLE");
  });

  it("dryRun: aplica y valida sobre una copia y devuelve los cambios, sin documento", async () => {
    const ops = [S("create_story", { name: "Simulada", ref: "s" }), S("add_step", { storyId: { ref: "s" }, eventTypeId: 1, target: { edgeId: 4 } })];
    const dry = await authorJson(simple(), ops, { dryRun: true });
    const real = await authorJson(simple(), ops);
    assert.equal(dry.ok, true);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.document, undefined);
    assert.deepEqual(dry.changes, real.changes);
    assert.equal(dry.resultRevision, real.resultRevision);
    const rejected = documentOf(await author(simple(), [S("add_step", { storyId: 1, eventTypeId: 2, target: { edgeId: 4 } })], { dryRun: true }));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.dryRun, true);
  });
});

/* ═══════════════ 4. Sin edición estructural del diagrama (corrección de scope, FLUYO-017.3) ═══════════════ */

describe("B2 del diagrama: delete_node/delete_connection existen desde 018.3 (forma {node}|{connection}); la política vive en FluyoIntegrity", () => {
  it("delete_connection y delete_node (018.3) NO admiten la forma antigua de 017.2 ({edgeId}/{nodeId} sueltos)", async () => {
    for (const op of [P("delete_connection", { edgeId: 5 }), P("delete_node", { nodeId: 2 })]) {
      let rejected = false;
      try { rejected = isToolError(await author(simple(), [op])); } catch { rejected = true; }
      assert.equal(rejected, true, String(op.op));
    }
    const r = createKernel().call<any>("FluyoAuthoring.apply(__a.p, __a.o)", { p: simple(), o: [P("delete_connection", { edgeId: 5 })] });
    assert.deepEqual([r.ok, r.errors[0].code], [false, "INVALID_OPERATION"]);
  });

  it("removalImpact (kernel): conexión usada → Historias y Steps exactos; retarget + eliminación sería válida sobre el estado final", async () => {
    const k = createKernel();
    const impact = (project: unknown, removal: unknown) => k.call<any>("FluyoIntegrity.removalImpact(__a.p, __a.r)", { p: project, r: removal });
    const used = impact(simple(), { pageIndex: 0, edgeIds: [5] });
    assert.equal(used.wouldInvalidate, true);
    assert.deepEqual(used.affectedStories.map((s: any) => [s.storyId, s.storyName, s.stepIds]), [[1, "Historia A", [3]], [2, "Historia B", [4]]]);
    const doc = simple();
    doc.doc.pages[0].edges.push({ ...doc.doc.pages[0].edges[1], id: 6 }); doc.doc.pages[0].nextId = 7;
    const half = await authorJson(doc, [S("retarget_step", { storyId: 1, stepId: 3, target: { edgeId: 6 } })]);
    assert.deepEqual(impact(half.document, { pageIndex: 0, edgeIds: [5] }).affectedStories.map((s: any) => [s.storyId, s.stepIds]), [[2, [4]]]);
    const both = await authorJson(doc, [S("retarget_step", { storyId: 1, stepId: 3, target: { edgeId: 6 } }), S("retarget_step", { storyId: 2, stepId: 4, target: { edgeId: 6 } })]);
    assert.equal(impact(both.document, { pageIndex: 0, edgeIds: [5] }).wouldInvalidate, false);
  });
});

/* ═══════════════ 5. Temporal (esperas narrativas) y simultaneidad ═══════════════ */

describe("semántica temporal", () => {
  const abc = () => {
    const d = simple();
    d.doc.pages[0].scenarios[0].steps = [{ id: 1, at: 0, action: "SEND", edgeId: 4, eventTypeId: 1 }, { id: 2, at: 3000, action: "OCCURRENCE", nodeId: 2, eventTypeId: 2 }, { id: 3, at: 7000, action: "SEND", edgeId: 5, eventTypeId: 3 }];
    return d;
  };
  it("A·3s·B·4s·C: set_wait desplaza el momento y los posteriores; remove colapsa la espera (no «7 s»)", async () => {
    const w = await authorJson(abc(), [S("set_wait", { storyId: 1, stepId: 2, waitMs: 1000 })]);
    assert.deepEqual(ats(w.document, 1), [[1, 0], [2, 1000], [3, 5000]]);
    assert.deepEqual(w.changes[0].affects.stories[0].stepIds, [2, 3]);
    const r = await authorJson(abc(), [S("remove_step", { storyId: 1, stepId: 2 })]);
    assert.deepEqual(ats(r.document, 1), [[1, 0], [3, 4000]]);
  });
  it("duplicar: la copia entra al mismo tiempo y no desplaza a los posteriores", async () => {
    const r = await authorJson(abc(), [S("duplicate_step", { storyId: 1, stepId: 2, ref: "d" })]);
    assert.deepEqual(ats(r.document, 1), [[1, 0], [2, 3000], [4, 3000], [3, 7000]]);
    assert.deepEqual({ ...stepsOf(r.document, 1)[2], id: 2 }, stepsOf(abc(), 1)[1]);
  });
  it("simultaneidad: A, B (mismo momento), C sin inventar ninguna espera", async () => {
    const r = await authorJson(abc(), [S("set_wait", { storyId: 1, stepId: 3, waitMs: 3000 }), S("set_wait", { storyId: 1, stepId: 2, waitMs: 0 })]);
    // B se une al momento de A (espera 0) y C conserva su espera de 3 s respecto del momento anterior.
    assert.deepEqual(ats(r.document, 1), [[1, 0], [2, 0], [3, 3000]]);
    const t = await run(r.document, 1);
    assert.deepEqual(t.steps.map((s: any) => s.moment), [0, 0, 1]);
  });
  it("mover: los instantes son ranuras; no se inventa ninguno", async () => {
    const r = await authorJson(abc(), [S("move_step", { storyId: 1, stepId: 3, direction: "earlier" })]);
    assert.deepEqual(ats(r.document, 1).map((x: any) => x[1]).sort((a: number, b: number) => a - b), [0, 3000, 7000]);
    assert.deepEqual(r.changes[0].affects.stories[0].stepIds.sort(), [2, 3]);
  });
  it("el tiempo absoluto no es una entrada: el schema rechaza `at`", async () => {
    let text = "";
    try { text = textOf(await call("author_document", { document: simple(), baseRevision: rev(simple()), operations: [S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 4 }, at: 5000 })] })); } catch (e) { text = (e as Error).message; }
    assert.match(text, /at|unrecognized|invalid/i);
  });
});

/* ═══════════════ 6. Resultado: changes y affects ═══════════════ */

describe("resultado de author_document", () => {
  it("changes: operación, alcance, entidad, ids creados y a quién afecta", async () => {
    const r = await authorJson(simple(), [S("create_story", { name: "N", ref: "n" }), S("add_step", { storyId: { ref: "n" }, eventTypeId: 1, target: { edgeId: 4 } }), P("set_initial_availability", { nodeId: 3, state: "DOWN" })]);
    assert.deepEqual(r.changes.map((c: any) => [c.operation, c.scope, c.entityKind, c.entityId, c.created ?? false]), [
      ["create_story", "story", "story", 4, true], ["add_step", "story", "step", 1, true], ["set_initial_availability", "page", "element", 3, false]]);
    assert.deepEqual(r.changes[1].affects.stories, [{ pageIndex: 0, storyId: 4, name: "N", stepIds: [1], removedStepIds: [] }]);
    assert.deepEqual(r.changes[2].affects.stories.map((s: any) => s.storyId), [1, 2, 3, 4]);        // la disponibilidad inicial rige en TODAS las Historias de la página
    assert.deepEqual(r.touchedStories, [{ pageIndex: 0, storyId: 4 }]);
    assert.equal(r.schemaVersion, 5);
    assert.equal(r.engineVersion, 2);
    assert.match(r.kernelId, /^[0-9a-f]{64}$/);
    assert.ok(JSON.stringify(r.changes).length < 2_000, "sin diffs gigantes");
  });
  it("las Historias del lote son ejecutables; una Historia ya rota que no se toca no bloquea", async () => {
    const doc = simple();
    doc.doc.pages[0].scenarios[0].steps[0].eventTypeId = 99;
    const r = await authorJson(doc, [S("rename_story", { storyId: 2, name: "Sigue" })]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.validation, { valid: false, preexistingErrors: 1 });
    const bad = documentOf(await author(doc, [S("add_step", { storyId: 1, eventTypeId: 2, target: { nodeId: 2 } })]));
    assert.equal(bad.errors[0].code, "STORY_NOT_EXECUTABLE");
  });
});

/* ═══════════════ 7. PARIDAD con el editor ═══════════════ */

describe("paridad: la misma Historia por el editor real y por author_document", () => {
  it("las operaciones del golden producen exactamente los Steps, la disponibilidad y el contador del editor", async () => {
    const g = golden();
    const r = await authorJson(complex(), g.operations);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(stepsOf(r.document, g.storyId), g.steps, "Steps (ids, tiempos, orden, EventType, objetivo)");
    assert.deepStrictEqual(r.document.doc.pages[0].behaviors, g.behaviors);
  });

  it("run_story sobre el resultado == Trace, outcomes y disponibilidad final del editor (deepStrictEqual)", async () => {
    const g = golden();
    const r = await authorJson(complex(), g.operations);
    const t = await run(r.document, g.storyId);
    assert.equal(t.executed, true);
    assert.deepStrictEqual(t.trace, g.trace.events);
    assert.deepStrictEqual(t.steps.map((s: any) => [s.stepId, s.at, s.outcome.status, s.outcome.reason, s.outcome.nodeAvailability, s.outcome.eventIndexes]),
      g.outcomes.map((o: any) => [o.stepId, o.at, o.status, o.reason, o.nodeAvailability, o.eventIndexes]));
    assert.deepStrictEqual(Object.fromEntries(t.finalAvailability.map((n: any) => [String(n.id), n.availability])), g.finalAvailability);
    // Metadata de presentación intacta: la misma que calcula el kernel para el editor.
    const meta = createKernel().call<any>(`(function(){ const d = projectFromProjectData(__a.p).doc; const sc = d.pages[0].scenarios.find(s => s.id === __a.id); doc = d; return FluyoStory.stepMeta(sc.steps); })()`, { p: r.document, id: g.storyId });
    assert.deepStrictEqual(meta, g.stepMeta);
  });

  it("el golden y su fixture son los de Fluyo (con fluyo/ al lado)", { skip: skipSinFluyo }, () => {
    assert.equal(
      readFileSync(join(DIR, "fluyo-017-2-golden.json"), "utf8").replace(/\r\n/g, "\n"),
      readFileSync(join(FLUYO, "test", "fixtures", "fluyo-017-2-golden.json"), "utf8").replace(/\r\n/g, "\n")
    );
  });
});

/* ═══════════════ 8. Aislamiento y límites de la herramienta ═══════════════ */

describe("aislamiento", () => {
  it("entrada congelada: author_document no intenta mutarla; nada persiste entre llamadas", () => {
    const doc = deepFreeze(simple());
    const ops = deepFreeze([S("create_story", { name: "x" })]);
    const input = { document: doc, baseRevision: rev(doc), operations: ops as unknown[] };
    const a = authorDocument(input), b = authorDocument(input);
    assert.deepStrictEqual(a, b);
    assert.equal(a.ok, true);
  });

  it("peticiones concurrentes con documentos distintos no se mezclan", async () => {
    const [a, b] = await Promise.all([authorJson(simple(), [S("create_story", { name: "A" })]), authorJson(complex(), [S("create_story", { name: "B" })])]);
    assert.equal(a.document.doc.pages.length, 1);
    assert.equal(b.document.doc.pages.length, 2);
    assert.notEqual(a.resultRevision, b.resultRevision);
  });

  it("las operaciones de Historia no tocan la biblioteca de eventos ni nada fuera de lo declarado; no hay operaciones estructurales del diagrama", async () => {
    const doc = complex(), before = clone(doc);
    const r = await authorJson(doc, [S("create_story", { name: "Sin tocar vocabulario", ref: "x" }), S("add_step", { storyId: { ref: "x" }, eventTypeId: 1, target: { edgeId: 5 } })]);
    assert.deepStrictEqual(r.document.doc.eventTypes, before.doc.eventTypes);
    assert.deepStrictEqual(r.document.doc.pages[1], before.doc.pages[1]);
    assert.deepStrictEqual(r.document.doc.pages[0].nodes, before.doc.pages[0].nodes);
    assert.deepStrictEqual(r.document.doc.pages[0].scenarios.slice(0, 3), before.doc.pages[0].scenarios);
    // No existe ninguna operación para crear/borrar conexiones ni crear/editar/borrar elementos (slice posterior).
    for (const op of ["add_edge", "add_node", "update_node", "delete_connection", "delete_node"]) {
      let text = "";
      try { text = textOf(await call("author_document", { document: doc, baseRevision: rev(doc), operations: [{ op, scope: "page", pageIndex: 0 }] })); } catch (e) { text = (e as Error).message; }
      assert.doesNotMatch(text, /"ok": true/, op);
    }
  });

  it("MCP no contiene reglas de dominio de autoría: nada de tiempos, acciones ni integridad fuera del kernel", () => {
    const src = readFileSync(join(ROOT, "src", "authoring.ts"), "utf8");
    for (const prohibido of [/"SEND"|"SET_STATE"|eventTypeActionSpec|EVENT_ACTION/, /storyboard/i, /stepDefinitionForEvent/, /\.at\b/, /Math\.max/, /edges\.filter|nodes\.filter/])
      assert.doesNotMatch(src, prohibido, `authoring.ts contiene lógica de dominio: ${prohibido}`);
  });
});

/* ═══════════════ 9. MCP real por stdio ═══════════════ */

describe("servidor real por stdio", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-017-2", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  const rpc = (args: Record<string, unknown>) => client.callTool({ name: "author_document", arguments: args });
  const noStack = (r: unknown) => assert.doesNotMatch(textOf(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./);

  it("lista author_document con sus operaciones", async () => {
    const { tools } = await client.listTools();
    const t = tools.find(x => x.name === "author_document")!;
    assert.ok(t);
    const ops = JSON.stringify(t.inputSchema);
    for (const op of ["create_story", "rename_story", "duplicate_story", "delete_story", "add_step", "remove_step", "move_step", "duplicate_step", "retarget_step", "set_wait", "set_initial_availability"]) assert.ok(ops.includes(op), op);
    for (const op of ["create_node", "create_connection", "update_node", "update_connection", "delete_node", "delete_connection"]) assert.ok(ops.includes(op), op);
    assert.ok(!ops.includes("add_edge") && !ops.includes("move_node"));
  });

  it("flujo completo describe → author → run por stdio", async () => {
    const doc = simple();
    const d = documentOf(await client.callTool({ name: "describe_document", arguments: { document: doc } }));
    const r = documentOf(await rpc({ document: doc, baseRevision: d.revision, operations: [S("duplicate_story", { storyId: 1, name: "Variante", ref: "v" }), S("add_step", { storyId: { ref: "v" }, eventTypeId: 4, target: { nodeId: 2 }, placement: { sameMomentAs: 1, position: "before" } })] }));
    assert.equal(r.ok, true);
    const t = documentOf(await client.callTool({ name: "run_story", arguments: { document: r.document, storyId: 4 } }));
    assert.deepEqual(t.steps.map((s: any) => s.outcome.status), ["state_changed", "not_completed", "narrated", "not_completed"]);
    // La Historia A del original sigue intacta en el resultado.
    assert.deepStrictEqual(stepsOf(r.document, 1), stepsOf(doc, 1));
  });

  it("rechazos estructurados (revisión, destino, operación inválida) sin trazas internas", async () => {
    const doc = simple();
    const mismatch = await rpc({ document: doc, baseRevision: "sha256:" + "1".repeat(64), operations: [S("create_story")] });
    assert.equal(isToolError(mismatch), true);
    assert.equal(documentOf(mismatch).errors[0].code, "REVISION_MISMATCH");
    noStack(mismatch);
    const missing = await rpc({ document: doc, baseRevision: rev(doc), operations: [S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 99 } })] });
    assert.equal(documentOf(missing).errors[0].code, "TARGET_NOT_FOUND");
    noStack(missing);
    const inv = await rpc({ document: doc, baseRevision: rev(doc), operations: [S("add_step", { storyId: 1, eventTypeId: 2, target: { edgeId: 4 } })] });
    assert.equal(documentOf(inv).errors[0].code, "TARGET_INCOMPATIBLE");
    noStack(inv);
  });

  it("entradas absurdas y documento ilegible: errores legibles, nunca una traza", async () => {
    for (const args of [{ document: "x", baseRevision: "y", operations: [] }, { document: {}, baseRevision: "sha256:" + "0".repeat(64), operations: [{}] }, { document: simple(), baseRevision: rev(simple()), operations: [] }]) {
      let text = "";
      try { text = textOf(await rpc(args as any)); } catch (e) { text = (e as Error).message; }
      assert.doesNotMatch(text, /\n\s+at\s|node:internal/);
    }
    const unreadable = documentOf(await rpc({ document: { version: 5, app: "fluyo", doc: { pages: [null] } }, baseRevision: "sha256:" + "0".repeat(64), operations: [S("create_story")] }));
    assert.equal(unreadable.errors[0].code, "DOCUMENT_UNREADABLE");
  });
});

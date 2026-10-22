/**
 * FLUYO-MCP-STEP-REVERSE-001 — el contrato `reverse` de fluyo STEP-REVERSE-002 (decisiones 234–239) en el MCP.
 *
 * Un Step SEND con `reverse:true` recorre su conexión de `to` a `from`: la respuesta va por la MISMA conexión que la petición.
 * Toda la semántica es del kernel (model.js traversalEnds/validatePersistedStep, story-authoring.js targetOf, scenario-engine.js,
 * story-playback.js); el MCP solo publica la forma de `target`, proyecta el sentido en describe_document/run_story y lo documenta.
 *
 * Se fija:
 *   · kernel = fluyo 702f269 (lleva traversalEnds y la resolución directa → inversa); engineVersion 2 y versión 5 (sin v3);
 *   · schema publicado de target: reverse solo en {edgeId} y {ref}; {from,to,reverse} y {nodeId,reverse} no pasan la forma;
 *   · add_step: ida, vuelta, {from,to} directa → inversa (la directa gana; ambigüedad por nivel; inexistente), forma explícita;
 *   · reverse:false = normal y no se guarda;
 *   · retarget_step: dar la vuelta en el sitio, volver al normal, {from,to}, y normal → normal sin claves nuevas; duplicate_step;
 *   · describe_document y run_story: target.reverse, label y frase del recorrido, motivo del recorrido, Trace con reverse:true;
 *   · equivalencia con la conexión inversa DIBUJADA (el gemelo);
 *   · documentos antiguos: ni una clave nueva en describe_document/run_story; el documento con reverse lo lee el kernel nuevo.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { AuthoringOperationSchema, authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { KERNEL_FILES } from "../src/generated/kernel-sources.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument, runStory } from "../src/stories.js";
import { FIXTURES_DIR, derefSchema, documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
const C = (extra: Record<string, unknown> = {}) => ({ op: "create_story", scope: "story", pageIndex: 0, ...extra });
const author = (document: unknown, operations: unknown[]): any => authorDocument({ document, baseRevision: rev(document), operations });
const ok = (document: unknown, operations: unknown[]): any => {
  const r = author(document, operations);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};
const rejected = (document: unknown, operations: unknown[]): any => {
  const r = author(document, operations);
  assert.equal(r.ok, false, "el lote debía rechazarse");
  assert.equal(r.document, undefined);
  return r.errors[0];
};
const steps = (doc: any, storyId = 1) => doc.doc.pages[0].scenarios.find((s: any) => s.id === storyId).steps;
const step = (doc: any, id: number, storyId = 1) => steps(doc, storyId).find((s: any) => s.id === id);

/* ───────── Diagrama creado ENTERO por el MCP ─────────
   Cliente(1) → API(2) → DB(3): conexiones 4 (1→2) y 5 (2→3). Eventos: 1 Petición, 2 Respuesta (FLOW), 3 Cae (SET_AVAILABILITY DOWN). */
const BLANK = { version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 1, eventTypes: [],
  pages: [{ name: "Ida y vuelta", nodes: [], edges: [], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 }] } };
const P = (op: string, extra: Record<string, unknown>) => ({ op, scope: "page", pageIndex: 0, ...extra });
const NODE = (ref: string, x: number, label: string) => P("create_node", { ref, spec: { shape: "rect", x, y: 300, label } });
const EDGE = (ref: string, a: string, b: string) => P("create_connection", { ref, source: { ref: a }, target: { ref: b } });
const EVENTS = [
  { op: "create_event_type", scope: "eventType", name: "Petición", primitive: "FLOW", sentence: "{source} pide a {target}" },
  { op: "create_event_type", scope: "eventType", name: "Respuesta", primitive: "FLOW", sentence: "{source} responde a {target}" },
  { op: "create_event_type", scope: "eventType", name: "Cae", primitive: "SET_AVAILABILITY", availability: "DOWN", sentence: "{target} cae" },
];
/* Conexión nueva Cliente → DB (id 6) sobre DIAGRAM, con ref del lote. */
const CD = P("create_connection", { ref: "cd", source: { id: 1 }, target: { id: 3 } });
const DIAGRAM = ok(BLANK, [NODE("c", 200, "Cliente"), NODE("a", 500, "API"), NODE("d", 800, "DB"), EDGE("ca", "c", "a"), EDGE("ad", "a", "d"), ...EVENTS]).document;
const REQ = (target: unknown, extra: Record<string, unknown> = {}) => S("add_step", { eventTypeId: 1, target, waitMs: 500, ...extra });
const RES = (target: unknown, extra: Record<string, unknown> = {}) => S("add_step", { eventTypeId: 2, target, waitMs: 500, ...extra });
/* Petición y respuesta resueltas por {from,to}: pasos 1 (C→A, 4), 2 (A→D, 5), 3 (D→A = 5 al revés), 4 (A→C = 4 al revés). */
const ROUND_TRIP = [C({ name: "Petición y respuesta" }), REQ({ from: 1, to: 2 }), REQ({ from: 2, to: 3 }), RES({ from: 3, to: 2 }), RES({ from: 2, to: 1 })];
const roundTrip = (): any => ok(DIAGRAM, ROUND_TRIP);
const withDown = (doc: any, nodeId: number) => ok(doc, [P("set_initial_availability", { nodeId, state: "DOWN" })]).document;

/* ═══════════════ Kernel y versiones ═══════════════ */

describe("MCP-STEP-REVERSE-001 · kernel y versiones", () => {
  it("el kernel es fluyo 702f269: trae traversalEnds, setStepReverse y la resolución directa → inversa", () => {
    const k = createKernel();
    assert.equal(k.call("typeof traversalEnds"), "function");
    assert.equal(k.call("typeof setStepReverse"), "function");
    assert.deepEqual(k.call("traversalEnds({from:1,to:2}, true)"), { source: 2, target: 1 });
    assert.deepEqual(k.call("traversalEnds({from:1,to:2}, undefined)"), { source: 1, target: 2 });
    const authoring = KERNEL_FILES.find(f => f.name === "story-authoring.js")!.source;
    assert.ok(authoring.includes("const back = pg.edges.filter(e=>e.from===to && e.to===from);"));
    const header = readFileSync(join(ROOT, "src", "generated", "kernel-sources.ts"), "utf8").split("\n", 6).join("\n");
    /* SCENARIOS-SEMANTICS-001 FASE 5 resincroniza el kernel (set_observed_flow, avisos W2/W3): la cabecera nombra una revisión posterior
       a 702f269; lo que vigila este test es el contenido de STEP-REVERSE (arriba y abajo), no la revisión. */
    assert.match(header, /Sincronizado desde la revisión [0-9a-f]{7,} de fluyo\//);
  });

  it("engineVersion sigue en 2 y el documento en v5 (no hay v3): la autoría, describe y run_story lo dicen", () => {
    const r = roundTrip();
    assert.equal(r.engineVersion, 2);
    assert.equal(r.schemaVersion, 5);
    assert.equal(r.document.version, 5);
    assert.equal(steps(r.document) && r.document.doc.pages[0].scenarios[0].engineVersion, 2);
    const d: any = describeDocument({ document: r.document });
    assert.deepEqual([d.engineVersion, d.capabilities.engineVersion, d.schemaVersion, d.pages[0].stories[0].engineVersion], [2, 2, 5, 2]);
    const run: any = runStory({ document: r.document, storyId: 1 });
    assert.deepEqual([run.engineVersion, run.traceEngineVersion, run.story.engineVersion], [2, 2, 2]);
  });
});

/* ═══════════════ Schema publicado de target ═══════════════ */

describe("MCP-STEP-REVERSE-001 · schema de target", () => {
  const parse = (target: unknown) => AuthoringOperationSchema.safeParse(S("add_step", { eventTypeId: 1, target })).success;
  const parseRetarget = (target: unknown) => AuthoringOperationSchema.safeParse(S("retarget_step", { stepId: 1, target })).success;

  it("acepta reverse booleano en {edgeId} y en {ref}; las formas de siempre siguen igual", () => {
    for (const t of [{ edgeId: 4, reverse: true }, { edgeId: 4, reverse: false }, { edgeId: { ref: "x" }, reverse: true }, { ref: "x", reverse: true }, { ref: "x", reverse: false },
      { edgeId: 4 }, { nodeId: 2 }, { from: 1, to: 2 }, { from: { ref: "a" }, to: { ref: "b" } }, { ref: "x" }]) {
      assert.equal(parse(t), true, JSON.stringify(t));
      assert.equal(parseRetarget(t), true, JSON.stringify(t));
    }
  });

  it("rechaza reverse en {from,to} y en {nodeId}, y cualquier reverse no booleano", () => {
    for (const t of [{ from: 1, to: 2, reverse: true }, { from: 1, to: 2, reverse: false }, { nodeId: 2, reverse: true }, { nodeId: 2, reverse: false },
      { edgeId: 4, reverse: "true" }, { edgeId: 4, reverse: 1 }, { edgeId: 4, reverse: null }, { ref: "x", reverse: "true" }, { edgeId: 4, direction: "reverse" }]) {
      assert.equal(parse(t), false, JSON.stringify(t));
      assert.equal(parseRetarget(t), false, JSON.stringify(t));
    }
  });

  let h: Harness;
  before(async () => { h = await startHarness(); });
  after(async () => { await h.close(); });

  it("tools/list: add_step y retarget_step publican reverse:boolean SOLO en las formas {edgeId} y {ref}", async () => {
    const { tools } = await h.client.listTools();
    const items: any = derefSchema(tools.find(t => t.name === "author_document")!.inputSchema).properties.operations.items; // CATALOG-COMPACTION-001: Target es un $ref
    const find = (op: string): any => (items.oneOf ?? items.anyOf).find((o: any) => o.properties.op.const === op);
    for (const op of ["add_step", "retarget_step"]) {
      const forms: any[] = find(op).properties.target.anyOf;
      const shape = forms.map(f => Object.keys(f.properties).sort().join(","));
      assert.deepEqual(shape, ["edgeId,reverse", "nodeId", "from,to", "ref,reverse"], op);
      for (const f of forms.filter(f => f.properties.reverse)) {
        assert.deepEqual(f.properties.reverse, { type: "boolean" }, op);
        assert.ok(!f.required.includes("reverse"), `${op}: reverse es opcional`);
        assert.equal(f.additionalProperties, false);
      }
      assert.match(find(op).properties.target.description, /reverse:true \(solo conexión\) la recorre de to a from/);
    }
    const desc = tools.find(t => t.name === "author_document")!.description!;
    assert.match(desc, /SENTIDO: target \{edgeId\|ref, reverse:true\} recorre la conexión de to a from: la respuesta va por la MISMA conexión, no dibujes la inversa/); // MCP-DESCRIPTIONS-001
    assert.match(tools.find(t => t.name === "describe_document")!.description!, /target\.reverse:true/);
    assert.match(tools.find(t => t.name === "run_story")!.description!, /target\.reverse:true/);
  });

  it("por la tool real: {from,to,reverse} lo rechaza la validación de entrada (isError) y el documento no cambia", async () => {
    const doc = DIAGRAM, snap = JSON.stringify(doc);
    const r = await h.client.callTool({ name: "author_document", arguments: { document: doc, baseRevision: rev(doc), operations: [C({}), REQ({ from: 2, to: 1, reverse: true })] } });
    assert.equal(isToolError(r), true);
    assert.equal(JSON.stringify(doc), snap);
  });

  it("por la tool real: {from,to} vuelta → la misma conexión con reverse:true, y run_story lo ejecuta", async () => {
    const r = documentOf(await h.client.callTool({ name: "author_document", arguments: { document: DIAGRAM, baseRevision: rev(DIAGRAM), operations: ROUND_TRIP } }));
    assert.equal(r.ok, true);
    assert.deepEqual(steps(r.document).map((s: any) => [s.edgeId, s.reverse ?? null]), [[4, null], [5, null], [5, true], [4, true]]);
    const run = documentOf(await h.client.callTool({ name: "run_story", arguments: { document: r.document, storyId: 1 } }));
    assert.equal(run.executed, true);
    assert.deepEqual(run.steps.map((s: any) => s.sentence), ["Cliente pide a API", "API pide a DB", "DB responde a API", "API responde a Cliente"]);
    const text = textOf(await h.client.callTool({ name: "describe_document", arguments: { document: r.document } }));
    assert.match(text, /"reverse":true,"label":"API → Cliente"/);
  });
});

/* ═══════════════ add_step ═══════════════ */

describe("MCP-STEP-REVERSE-001 · add_step", () => {
  it("ida y vuelta por {from,to}: la ida normal, la vuelta usa la MISMA conexión con reverse:true; changes lo dice", () => {
    const r = roundTrip();
    assert.deepEqual(steps(r.document).map((s: any) => Object.keys(s).sort().join(",")), [
      "action,at,edgeId,eventTypeId,id", "action,at,edgeId,eventTypeId,id", "action,at,edgeId,eventTypeId,id,reverse", "action,at,edgeId,eventTypeId,id,reverse",
    ]);
    assert.deepEqual(steps(r.document).map((s: any) => [s.id, s.edgeId, s.reverse ?? null]), [[1, 4, null], [2, 5, null], [3, 5, true], [4, 4, true]]);
    const added = r.changes.filter((c: any) => c.operation === "add_step");
    assert.deepEqual(added.map((c: any) => c.reverse ?? null), [null, null, true, true]);
    assert.equal(r.document.doc.pages[0].edges.length, 2, "no se crea ninguna conexión inversa");
    assert.deepEqual(r.document.doc.pages[0].edges.map((e: any) => [e.id, e.from, e.to]), [[4, 1, 2], [5, 2, 3]], "las conexiones no cambian");
  });

  it("{from,to}: si existe la directa, gana la directa (sin reverse) aunque haya inversa", () => {
    const twin = ok(DIAGRAM, [P("create_connection", { source: { id: 2 }, target: { id: 1 } })]).document; // 6: API → Cliente
    const r = ok(twin, [C({}), RES({ from: 2, to: 1 }), REQ({ from: 1, to: 2 })]);
    assert.deepEqual(steps(r.document).map((s: any) => [s.edgeId, s.reverse ?? null]), [[6, null], [4, null]]);
  });

  it("{from,to}: ambigüedad por nivel — dos directas → AMBIGUOUS_TARGET; dos inversas → AMBIGUOUS_TARGET con reverse:true; una directa decide aunque haya dos inversas", () => {
    const twoBack = ok(DIAGRAM, [P("create_connection", { source: { id: 1 }, target: { id: 2 }, spec: { label: "otra" } })]).document; // 4 y 6: 1 → 2
    const e1 = rejected(twoBack, [C({}), RES({ from: 2, to: 1 })]);
    assert.equal(e1.code, "AMBIGUOUS_TARGET");
    assert.deepEqual([e1.edgeIds, e1.reverse], [[4, 6], true]);
    const e2 = rejected(twoBack, [C({}), REQ({ from: 1, to: 2 })]);
    assert.equal(e2.code, "AMBIGUOUS_TARGET");
    assert.deepEqual([e2.edgeIds, e2.reverse], [[4, 6], undefined]);
    const plusDirect = ok(twoBack, [P("create_connection", { source: { id: 2 }, target: { id: 1 } })]).document; // 7: 2 → 1
    const r = ok(plusDirect, [C({}), RES({ from: 2, to: 1 })]);
    assert.deepEqual(steps(r.document).map((s: any) => [s.edgeId, s.reverse ?? null]), [[7, null]]);
  });

  it("{from,to} sin conexión en ningún sentido → TARGET_NOT_FOUND, y el mensaje dice que también buscó la inversa", () => {
    const e = rejected(DIAGRAM, [C({}), REQ({ from: 1, to: 3 })]);
    assert.equal(e.code, "TARGET_NOT_FOUND");
    assert.match(e.message, /ni de 3 a 1 para recorrerla al revés/);
  });

  it("forma explícita: {edgeId, reverse:true}, {edgeId:{ref}, reverse:true} y {ref, reverse:true} con la conexión creada en el lote", () => {
    const a = ok(DIAGRAM, [C({}), RES({ edgeId: 4, reverse: true })]);
    assert.deepEqual(step(a.document, 1), { id: 1, at: 0, action: "SEND", edgeId: 4, eventTypeId: 2, reverse: true });
    const b = ok(DIAGRAM, [CD, C({}), RES({ edgeId: { ref: "cd" }, reverse: true }), RES({ ref: "cd", reverse: true })]);
    assert.deepEqual(steps(b.document).map((s: any) => [s.edgeId, s.reverse]), [[6, true], [6, true]]);
  });

  it("reverse:false es el sentido normal y NO se guarda (ni en el Step ni en changes)", () => {
    const r = ok(DIAGRAM, [CD, C({}), REQ({ edgeId: 4, reverse: false }), REQ({ ref: "cd", reverse: false })]);
    assert.deepEqual(steps(r.document).map((s: any) => Object.keys(s).sort().join(",")), ["action,at,edgeId,eventTypeId,id", "action,at,edgeId,eventTypeId,id"]);
    assert.ok(!JSON.stringify(r.document).includes('"reverse"'));
    assert.ok(r.changes.every((c: any) => !("reverse" in c)));
    // El mismo documento que sin la clave.
    const plain = ok(DIAGRAM, [CD, C({}), REQ({ edgeId: 4 }), REQ({ ref: "cd" })]);
    assert.equal(r.resultRevision, plain.resultRevision);
  });

  it("reverse sobre un elemento → TARGET_INCOMPATIBLE (por {ref}); y el kernel también cierra {nodeId,reverse} y {from,to,reverse} si llegaran sin la forma", () => {
    const e1 = rejected(DIAGRAM, [NODE("x", 500, "X"), C({}), S("add_step", { eventTypeId: 3, target: { ref: "x", reverse: true } })]);
    assert.equal(e1.code, "TARGET_INCOMPATIBLE");
    const e2 = rejected(DIAGRAM, [C({}), S("add_step", { eventTypeId: 3, target: { nodeId: 2, reverse: true } })]);
    assert.equal(e2.code, "TARGET_INCOMPATIBLE");
    const e3 = rejected(DIAGRAM, [C({}), REQ({ from: 2, to: 1, reverse: true })]);
    assert.equal(e3.code, "INVALID_OPERATION");
    assert.equal(e3.field, "target.reverse");
  });

  it("documento con reverse:false escrito a mano: se lee, se canonicaliza (sin la clave) y la autoría parte del canónico", () => {
    const hand = clone(roundTrip().document);
    steps(hand)[0].reverse = false;
    const d: any = describeDocument({ document: hand });
    assert.equal(d.valid, true);
    assert.equal(d.pages[0].stories[0].moments[0].steps[0].target.reverse, undefined);
    const r = ok(hand, [S("rename_story", { name: "Canónica" })]);
    assert.equal(step(r.document, 1).reverse, undefined);
    assert.equal(rev(hand), rev(roundTrip().document), "la revisión es la del documento canónico");
  });

  it("documento con reverse inválido (\"true\", en un SET_STATE) → no se lee; author_document lo rechaza sin documento", () => {
    for (const mutate of [(d: any) => { steps(d)[0].reverse = "true"; }, (d: any) => { steps(d)[0].reverse = 1; }]) {
      const bad = clone(roundTrip().document);
      mutate(bad);
      const d: any = describeDocument({ document: bad });
      assert.equal(d.readable, false);
      assert.equal(author(bad, [S("rename_story", { name: "x" })]).errors[0].code, "DOCUMENT_UNREADABLE");
    }
    const st = ok(roundTrip().document, [S("add_step", { eventTypeId: 3, target: { nodeId: 3 } })]).document;
    steps(st).at(-1).reverse = true;
    assert.equal((describeDocument({ document: st }) as any).readable, false);
  });
});

/* ═══════════════ retarget_step y duplicate_step ═══════════════ */

describe("MCP-STEP-REVERSE-001 · retarget_step y duplicate_step", () => {
  const retarget = (doc: any, stepId: number, target: unknown) => ok(doc, [S("retarget_step", { stepId, target })]);

  it("da la vuelta en el sitio: {edgeId: la misma, reverse:true}; el resultado trae reverse y previousReverse", () => {
    const r = retarget(roundTrip().document, 1, { edgeId: 4, reverse: true });
    assert.deepEqual(step(r.document, 1), { id: 1, at: 0, action: "SEND", edgeId: 4, eventTypeId: 1, reverse: true });
    const c = r.changes[0];
    assert.deepEqual([c.from, c.to, c.reverse, c.previousReverse], [4, 4, true, false]);
  });

  it("vuelve al sentido normal: {edgeId} sin reverse quita la clave; reverse:false igual", () => {
    for (const target of [{ edgeId: 4 }, { edgeId: 4, reverse: false }]) {
      const r = retarget(roundTrip().document, 4, target);
      assert.equal("reverse" in step(r.document, 4), false, JSON.stringify(target));
      assert.deepEqual([r.changes[0].reverse, r.changes[0].previousReverse], [false, true]);
    }
  });

  it("{from,to} en retarget_step resuelve directa → inversa; {ref, reverse} también", () => {
    const r = retarget(roundTrip().document, 1, { from: 3, to: 2 });
    assert.deepEqual([step(r.document, 1).edgeId, step(r.document, 1).reverse], [5, true]);
    const r2 = ok(roundTrip().document, [CD, S("retarget_step", { stepId: 2, target: { ref: "cd", reverse: true } })]);
    assert.deepEqual([step(r2.document, 2).edgeId, step(r2.document, 2).reverse], [6, true]);
  });

  it("normal → normal: el resultado de siempre, sin reverse ni previousReverse", () => {
    const r = retarget(roundTrip().document, 1, { edgeId: 5 });
    assert.deepEqual([r.changes[0].from, r.changes[0].to], [4, 5]);
    assert.equal("reverse" in r.changes[0], false);
    assert.equal("previousReverse" in r.changes[0], false);
  });

  it("duplicate_step conserva el sentido y lo anuncia", () => {
    const r = ok(roundTrip().document, [S("duplicate_step", { stepId: 4 })]);
    const copy = steps(r.document).find((s: any) => s.id === r.changes[0].entityId);
    assert.deepEqual([copy.edgeId, copy.reverse, r.changes[0].reverse], [4, true, true]);
  });
});

/* ═══════════════ describe_document y run_story ═══════════════ */

describe("MCP-STEP-REVERSE-001 · describe_document y run_story", () => {
  it("describe_document: target con reverse:true y label/frase en el sentido del recorrido; from/to son los de la conexión", () => {
    const d: any = describeDocument({ document: roundTrip().document });
    const targets = d.pages[0].stories[0].moments.map((m: any) => m.steps[0]);
    assert.deepEqual(targets.map((s: any) => s.target), [
      { kind: "connection", id: 4, from: 1, to: 2, label: "Cliente → API" },
      { kind: "connection", id: 5, from: 2, to: 3, label: "API → DB" },
      { kind: "connection", id: 5, from: 2, to: 3, reverse: true, label: "DB → API" },
      { kind: "connection", id: 4, from: 1, to: 2, reverse: true, label: "API → Cliente" },
    ]);
    assert.deepEqual(targets.map((s: any) => s.sentence), ["Cliente pide a API", "API pide a DB", "DB responde a API", "API responde a Cliente"]);
    assert.equal(d.valid, true);
    assert.equal(d.pages[0].stories[0].executable, true);
  });

  it("run_story con todo arriba: completed; target, frase y Trace con reverse:true solo en los inversos", () => {
    const run: any = runStory({ document: roundTrip().document, storyId: 1 });
    assert.equal(run.executed, true);
    assert.deepEqual(run.steps.map((s: any) => [s.target.label, s.target.reverse ?? null, s.outcome.status]), [
      ["Cliente → API", null, "completed"], ["API → DB", null, "completed"], ["DB → API", true, "completed"], ["API → Cliente", true, "completed"],
    ]);
    const sends = run.trace.filter((e: any) => e.type.startsWith("send_"));
    assert.deepEqual(sends.map((e: any) => [e.stepId, e.type, e.reverse ?? null]), [
      [1, "send_started", null], [1, "send_succeeded", null], [2, "send_started", null], [2, "send_succeeded", null],
      [3, "send_started", true], [3, "send_succeeded", true], [4, "send_started", true], [4, "send_succeeded", true],
    ]);
    // reverse va detrás de edgeId (D4), como lo escribe el motor.
    assert.equal(JSON.stringify(sends[4]), '{"at":1000,"type":"send_started","stepId":3,"edgeId":5,"reverse":true}');
  });

  it("run_story con Cliente caído: la petición falla source_down y la respuesta target_down, las dos nombrando a Cliente", () => {
    const run: any = runStory({ document: withDown(roundTrip().document, 1), storyId: 1 });
    const o = run.steps.map((s: any) => [s.stepId, s.outcome.status, s.outcome.reason ?? null, s.outcome.reasonNode?.label ?? null]);
    assert.deepEqual(o, [[1, "not_completed", "source_down", "Cliente"], [2, "completed", null, null], [3, "completed", null, null], [4, "not_completed", "target_down", "Cliente"]]);
  });

  it("run_story con DB caída: la petición a DB falla target_down y la respuesta de DB source_down, las dos nombrando a DB", () => {
    const run: any = runStory({ document: withDown(roundTrip().document, 3), storyId: 1 });
    const o = run.steps.map((s: any) => [s.stepId, s.outcome.status, s.outcome.reason ?? null, s.outcome.reasonNode ?? null]);
    assert.deepEqual(o, [[1, "completed", null, null], [2, "not_completed", "target_down", { id: 3, label: "DB" }], [3, "not_completed", "source_down", { id: 3, label: "DB" }], [4, "completed", null, null]]);
    assert.equal(JSON.stringify(run.trace.find((e: any) => e.stepId === 3 && e.type === "send_failed")), '{"at":1000,"type":"send_failed","stepId":3,"edgeId":5,"reverse":true,"reason":"source_down"}');
  });

  it("equivale a la conexión inversa DIBUJADA: mismos resultados, frases, motivos y Trace salvo edgeId y la marca reverse", () => {
    // Gemelo: las respuestas van por conexiones dibujadas D→A (6) y A→C (7).
    const twin = ok(DIAGRAM, [P("create_connection", { source: { id: 3 }, target: { id: 2 } }), P("create_connection", { source: { id: 2 }, target: { id: 1 } }),
      C({ name: "Petición y respuesta" }), REQ({ edgeId: 4 }), REQ({ edgeId: 5 }), RES({ edgeId: 6 }), RES({ edgeId: 7 })]).document;
    const rt = clone(roundTrip().document);
    for (const down of [null, 1, 2, 3]) {
      const a: any = runStory({ document: down ? withDown(rt, down) : rt, storyId: 1 });
      const b: any = runStory({ document: down ? withDown(twin, down) : twin, storyId: 1 });
      const view = (r: any) => r.steps.map((s: any) => ({ sentence: s.sentence, label: s.target.label, outcome: s.outcome }));
      assert.deepEqual(view(a), view(b), `caído: ${down}`);
      const strip = (r: any) => r.trace.map((e: any) => { const { reverse, edgeId, ...rest } = e; return rest; });
      assert.deepEqual(strip(a), strip(b), `Trace, caído: ${down}`);
      assert.deepEqual(a.finalAvailability, b.finalAvailability);
    }
  });
});

/* ═══════════════ README: el patrón petición/respuesta es el que da el MCP ═══════════════ */

describe("MCP-STEP-REVERSE-001 · README", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const section = readme.slice(readme.indexOf("**Patrón petición/respuesta.**"));
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].slice(0, 3).map(m => m[1]);

  it("el lote del README da exactamente los pasos guardados que muestra", () => {
    assert.equal(blocks.length, 3);
    const r = ok(DIAGRAM, JSON.parse(blocks[0]));
    const shown = blocks[1].trim().split("\n").map(l => JSON.parse(l));
    assert.deepEqual(steps(r.document), shown);
  });

  it("la respuesta de run_story y el Trace del README son los del MCP (paso 3, DB caída)", () => {
    const doc = withDown(ok(DIAGRAM, JSON.parse(blocks[0])).document, 3);
    const run: any = runStory({ document: doc, storyId: 1 });
    const s3 = run.steps.find((s: any) => s.stepId === 3);
    const { eventIndexes, ...outcome } = s3.outcome;
    assert.deepEqual(JSON.parse(blocks[2]), { stepId: 3, target: s3.target, sentence: s3.sentence, outcome });
    const failed = JSON.stringify(run.trace.find((e: any) => e.stepId === 3 && e.type === "send_failed"));
    assert.ok(section.includes(`En el Trace: \`${failed}\``), failed);
    assert.equal(run.steps.find((s: any) => s.stepId === 2).outcome.reason, "target_down");
  });

  it("el README documenta las formas, reverse:false sin guardar, retarget y la salida de describe/run_story", () => {
    for (const text of ["`{edgeId, reverse}` y `{ref, reverse}`", "`reverse:false` es el sentido normal y **no se guarda**", "`{edgeId: la misma, reverse:true}` da la vuelta en el sitio",
      "`engineVersion` sigue en 2", "`target.from`/`target.to` son siempre los de la **conexión**"]) assert.ok(readme.includes(text), text);
  });
});

/* ═══════════════ Documentos antiguos ═══════════════ */

describe("MCP-STEP-REVERSE-001 · documentos antiguos", () => {
  const corpus = (): Array<{ name: string; doc: unknown }> => {
    const dirs = [FIXTURES_DIR, join(FIXTURES_DIR, "stories"), join(FLUYO, "ejemplos", "data")].filter(existsSync);
    return dirs.flatMap(dir => readdirSync(dir).filter(f => f.endsWith(".fluyo.json")).map(f => ({ name: f, doc: JSON.parse(readFileSync(join(dir, f), "utf8")) })));
  };

  it("ningún documento del corpus lleva reverse; describe_document y run_story no añaden ni una clave y la etiqueta sigue siendo from → to", () => {
    const docs = corpus();
    let stories = 0;
    for (const { name, doc } of docs) {
      assert.ok(!JSON.stringify(doc).includes('"reverse"'), name);
      const d: any = describeDocument({ document: doc });
      if (!d.readable) continue;
      assert.ok(!JSON.stringify(d).includes('"reverse"'), `${name}: describe_document`);
      d.pages.forEach((pg: any, pageIndex: number) => {
        const label = new Map(pg.nodes.map((n: any) => [n.id, n.label]));
        for (const sc of pg.stories) {
          stories++;
          for (const s of sc.moments.flatMap((m: any) => m.steps)) {
            if (s.target.kind !== "connection" || s.target.from === undefined) continue;
            assert.deepEqual(Object.keys(s.target), ["kind", "id", "from", "to", "label"], name);
            assert.equal(s.target.label, `${label.get(s.target.from)} → ${label.get(s.target.to)}`, name);
          }
          const run: any = runStory({ document: doc, pageIndex, storyId: sc.storyId });
          assert.ok(!JSON.stringify(run).includes('"reverse"'), `${name}: run_story ${sc.storyId}`);
        }
      });
    }
    assert.ok(stories >= 5, `el corpus tiene Historias (${stories})`);
  });

  it("los mismos lotes sin reverse dan el mismo documento que antes: revisiones fijadas en la base (kernel 544fd4b)", () => {
    // Medidas con fluyo-mcp 0bf0732 (kernel fluyo 544fd4b) antes de sincronizar el kernel.
    const plain = ok(DIAGRAM, [C({ name: "Petición y respuesta" }), REQ({ from: 1, to: 2 }), REQ({ edgeId: 5 }), S("retarget_step", { stepId: 1, target: { edgeId: 5 } }), S("duplicate_step", { stepId: 2 })]);
    assert.equal(rev(DIAGRAM), BASE_DIAGRAM_REVISION);
    assert.equal(plain.resultRevision, BASE_PLAIN_REVISION);
  });
});

const BASE_DIAGRAM_REVISION = "sha256:b917ce2b898438743d2d62264b9e5ad999deec2bdc1a220db1554b9f367da868";
const BASE_PLAIN_REVISION = "sha256:d09f9fd7eff99913105b2f7ab19ed62f84252bbcec7f1041bf819fa684d30fcb";

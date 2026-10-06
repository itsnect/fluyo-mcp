/**
 * FLUYO-017.3 — author_document con EventTypes: crear, modificar y eliminar eventos de la biblioteca.
 *
 * La garantía que se prueba: un EventType creado o modificado por MCP es indistinguible, a nivel de modelo y de ejecución,
 * de uno creado o modificado desde el editor de Fluyo.
 *   · describe_document → create/update_event_type → add_step → run_story, con revisión optimista;
 *   · las mismas reglas que el editor (primitiva y disponibilidad bloqueadas si el evento está en uso, no se elimina en uso);
 *   · rechazos estructurados (entidad, Historias y pasos afectados) vía FluyoIntegrity; atomicidad y original intacto;
 *   · PARIDAD: las operaciones del golden de Fluyo (generado con el modal REAL del editor) dan los mismos EventTypes,
 *     Steps, Trace, outcomes y presentación;
 *   · el servidor real por stdio.
 * El criterio (reglas del evento, integridad, acción derivada) vive en el kernel de Fluyo: aquí no hay reglas de dominio.
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
import { documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const DIR = join(ROOT, "test", "fixtures", "stories");
const load = (n: string): any => JSON.parse(readFileSync(join(DIR, n), "utf8"));
const simple = () => load("fluyo-017-1-cliente-kafka-comercio.fluyo.json");
const complex = () => load("fluyo-017-1-qa-complejo.fluyo.json");
const golden = (): any => load("fluyo-017-3-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "model.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const E = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "eventType", ...extra });
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, ...extra });
const PAGO = E("create_event_type", { name: "Pago", primitive: "FLOW", sentence: "{source} paga a {target}", symbol: "💵" });

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) =>
  call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const authorJson = async (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) => documentOf(await author(document, operations, extra));
const describeDoc = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await call("describe_document", { document, ...extra }));
const run = async (document: unknown, storyId: number) => documentOf(await call("run_story", { document, storyId }));
const types = (d: any) => d.doc.eventTypes as any[];
const stepsOf = (d: any, storyId: number) => d.doc.pages[0].scenarios.find((s: any) => s.id === storyId).steps;

/* ═══════════════ 1. Flujo completo ═══════════════ */

describe("describe_document → create_event_type → add_step → run_story", () => {
  it("un agente entiende los eventos existentes, crea uno nuevo, lo usa en una Historia y Fluyo la ejecuta", async () => {
    const doc = simple();
    const d = await describeDoc(doc);
    assert.deepEqual(d.eventTypes.map((e: any) => [e.id, e.name, e.primitive, e.target]), [[1, "Pago", "FLOW", "connection"], [2, "Procesamiento", "OCCURRENCE", "element"], [3, "Confirmación", "FLOW", "connection"], [4, "Caída", "SET_AVAILABILITY", "element"]]);
    const r = await authorJson(doc, [
      E("create_event_type", { name: "Pago rechazado", primitive: "FLOW", sentence: "{source} no logra pagar a {target}", symbol: "✗", motion: "fast", presentation: { connectionEffects: { style: "impulse" } }, ref: "rech" }),
      S("create_story", { name: "Pago rechazado", ref: "h" }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "rech" }, target: { from: 1, to: 2 } }),
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.baseRevision, d.revision);
    assert.deepEqual(r.changes.map((c: any) => [c.operation, c.scope, c.entityKind, c.entityId]), [["create_event_type", "eventType", "eventType", 5], ["create_story", "story", "story", 4], ["add_step", "story", "step", 1]]);
    assert.equal("pageIndex" in r.changes[0], false);
    // El agente relee el resultado y lo ejecuta.
    const d2 = await describeDoc(r.document);
    assert.equal(d2.revision, r.resultRevision);
    assert.equal(d2.valid, true);
    const nuevo = d2.eventTypes.find((e: any) => e.id === 5);
    assert.deepEqual([nuevo.name, nuevo.action, nuevo.target, nuevo.motion, nuevo.usedBy, nuevo.presentation, nuevo.usedIn], ["Pago rechazado", "SEND", "connection", "fast", 1, { style: "impulse" }, [{ pageIndex: 0, storyId: 4, stepIds: [1] }]]);
    const t = await run(r.document, 4);
    assert.equal(t.executed, true);
    assert.deepEqual(t.steps.map((s: any) => [s.event.name, s.sentence, s.outcome.status]), [["Pago rechazado", "Cliente no logra pagar a Kafka", "completed"]]);
    assert.deepEqual(stepsOf(r.document, 4), [{ id: 1, at: 0, action: "SEND", edgeId: 4, eventTypeId: 5 }], "el Step referencia el EventType por id");
  });

  it("encadenar: el resultado y su resultRevision son la base del siguiente lote (crear → actualizar → eliminar)", async () => {
    const a = await authorJson(simple(), [PAGO]);
    const b = await authorJson(a.document, [E("update_event_type", { eventTypeId: 5, name: "Cobro", presentation: { connectionEffects: { trail: "marked" } } })]);
    assert.equal(b.baseRevision, a.resultRevision);
    assert.deepEqual(b.changes[0].fields, ["name", "presentation"]);
    const c = await authorJson(b.document, [E("delete_event_type", { eventTypeId: 5 })]);
    assert.equal(c.ok, true);
    assert.deepStrictEqual(types(c.document), types(simple()));
    assert.equal(c.document.doc.nextEventTypeId, 6, "los ids no se reutilizan");
  });

  it("update de un evento usado: la Historia, sus pasos y su Trace no cambian (sólo el relato)", async () => {
    const doc = simple();
    const r = await authorJson(doc, [E("update_event_type", { eventTypeId: 1, name: "Pago aprobado", sentence: "{source} liquida a {target}", symbol: "✔", presentation: { connectionEffects: { style: "smooth" } } })]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(r.document.doc.pages[0].scenarios, doc.doc.pages[0].scenarios);
    const before = await run(doc, 1), now = await run(r.document, 1);
    assert.deepStrictEqual(now.trace, before.trace);
    assert.deepStrictEqual(now.steps.map((s: any) => s.outcome), before.steps.map((s: any) => s.outcome));
    assert.equal(now.steps[0].sentence, "Cliente liquida a Kafka");
    assert.equal(r.changes[0].affects.eventTypeUsedBy, 2);
    assert.deepEqual(r.changes[0].affects.stories.map((s: any) => [s.storyId, s.stepIds]), [[1, [1]], [2, [2]]]);
  });
});

/* ═══════════════ 2. Reglas del editor, rechazos estructurados ═══════════════ */

describe("rechazos estructurados (vía FluyoIntegrity)", () => {
  it("delete de un evento usado: isError, REFERENCED_ENTITY con entity, affectedStories y affectedSteps; sin documento", async () => {
    const res = await author(simple(), [E("delete_event_type", { eventTypeId: 1 })]);
    assert.equal(isToolError(res), true);
    const r = documentOf(res);
    assert.equal(r.document, undefined);
    assert.equal(r.errors.length, 1);
    const e = r.errors[0];
    assert.deepEqual([e.code, e.entity, e.operationIndex], ["REFERENCED_ENTITY", { kind: "eventType", id: 1, name: "Pago" }, 0]);
    assert.deepEqual(e.affectedStories.map((s: any) => [s.storyId, s.storyName, s.stepIds]), [[1, "Historia A", [1]], [2, "Historia B", [2]]]);
    assert.deepEqual(e.affectedSteps, [{ pageIndex: 0, storyId: 1, stepId: 1 }, { pageIndex: 0, storyId: 2, stepId: 2 }]);
    assert.match(textOf(res), /RECHAZADO/);
    assert.match(r.note, /original no se modificó/);
  });

  it("update de primitiva o disponibilidad de un evento usado: EVENT_TYPE_LOCKED con el campo y los usos", async () => {
    const prim = documentOf(await author(simple(), [E("update_event_type", { eventTypeId: 1, primitive: "OCCURRENCE" })]));
    assert.deepEqual([prim.errors[0].code, prim.errors[0].field, prim.errors[0].integrityCodes], ["EVENT_TYPE_LOCKED", "primitive", ["event_type_action_mismatch"]]);
    assert.deepEqual(prim.errors[0].affectedStories.map((s: any) => s.storyId), [1, 2]);
    const av = documentOf(await author(simple(), [E("update_event_type", { eventTypeId: 4, availability: "UP" })]));
    assert.deepEqual([av.errors[0].code, av.errors[0].field], ["EVENT_TYPE_LOCKED", "availability"]);
    // Lo mismo reenviado no es un cambio (como el modal del editor).
    assert.equal((await authorJson(simple(), [E("update_event_type", { eventTypeId: 4, availability: "DOWN", name: "Caída editada" })])).ok, true);
  });

  it("quitar los pasos que lo usan y borrar después en el mismo lote es válido; borrar antes se rechaza", async () => {
    const uses = [[1, 1], [2, 2]];
    const removes = uses.map(([storyId, stepId]) => S("remove_step", { storyId, stepId }));
    assert.equal((await authorJson(simple(), [...removes, E("delete_event_type", { eventTypeId: 1 })])).ok, true);
    const before = documentOf(await author(simple(), [E("delete_event_type", { eventTypeId: 1 }), ...removes]));
    assert.deepEqual([before.ok, before.errors[0].code, before.errors[0].operationIndex], [false, "REFERENCED_ENTITY", 0]);
  });

  it("campos inválidos: INVALID_EVENT_TYPE con el campo exacto (nombre, frase, símbolo, motion, disponibilidad, presentación)", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: "x".repeat(60), sentence: "{source", symbol: "★" }, "sentence"],
      [{ symbol: "123456789" }, "symbol"], [{ primitive: "OCCURRENCE", motion: "slow" }, "motion"], [{ primitive: "SET_AVAILABILITY" }, "availability"],
      [{ presentation: { nodeEffects: { dim: true } } }, "presentation.nodeEffects"],
      [{ presentation: { connectionEffects: { size: "large" }, nodeEffects: {} } }, "presentation.nodeEffects"],
    ];
    for (const [patch, field] of cases) {
      const res = await author(simple(), [E("create_event_type", { name: "N", primitive: "FLOW", sentence: "{source} a {target}", ...patch })]);
      const r = documentOf(res);
      assert.deepEqual([isToolError(res), r.ok, r.errors[0].code, r.errors[0].field], [true, false, "INVALID_EVENT_TYPE", field], JSON.stringify(patch));
    }
  });

  it("nombre duplicado: se acepta como en el editor y se avisa (warnings), con ids distintos", async () => {
    const r = await authorJson(simple(), [E("create_event_type", { name: "pago", primitive: "FLOW", sentence: "{source} paga" })]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.changes[0].warnings.map((w: any) => [w.code, w.eventTypeIds]), [["DUPLICATE_EVENT_TYPE_NAME", [1]]]);
    const d = await describeDoc(r.document);
    assert.deepEqual(d.eventTypes.map((e: any) => e.id), [1, 2, 3, 4, 5]);
  });

  it("scope y campos: un EventType es global (scope eventType, sin pageIndex); lo demás lo rechaza el schema o el kernel", async () => {
    const bad: Array<Record<string, unknown>> = [
      { ...PAGO, scope: "story" }, { ...PAGO, scope: "page", pageIndex: 0 }, { ...PAGO, pageIndex: 0 }, { ...PAGO, action: "SEND" }, { ...PAGO, id: 9 },
      E("update_event_type", { eventTypeId: 1, name: "x", state: "UP" }), E("delete_event_type", { eventTypeId: 1, force: true }),
    ];
    for (const op of bad) {
      let rejected = false;
      try { rejected = isToolError(await author(simple(), [op])); } catch { rejected = true; }
      assert.equal(rejected, true, JSON.stringify(op));
    }
    // El kernel también (un cliente que no use el schema de MCP).
    const k = createKernel();
    for (const op of bad) assert.equal(k.call<any>("FluyoAuthoring.apply(__a.p, __a.o)", { p: simple(), o: [op] }).ok, false, JSON.stringify(op));
  });
});

/* ═══════════════ 3. Atomicidad, revisión, dryRun ═══════════════ */

describe("atomicidad y revisión", () => {
  it("crear · actualizar · inválida ⇒ isError, sin documento y el original intacto", async () => {
    const doc = simple(), before = JSON.stringify(doc);
    const res = await author(doc, [E("create_event_type", { name: "A", primitive: "FLOW", sentence: "{source}", ref: "a" }), E("update_event_type", { eventTypeId: { ref: "a" }, name: "B" }), E("update_event_type", { eventTypeId: 1, primitive: "OCCURRENCE" })]);
    assert.equal(isToolError(res), true);
    const r = documentOf(res);
    assert.deepEqual([r.ok, r.document, r.errors[0].code, r.errors[0].operationIndex], [false, undefined, "EVENT_TYPE_LOCKED", 2]);
    assert.equal(JSON.stringify(doc), before);
  });

  it("baseRevision incorrecta → REVISION_MISMATCH con la revisión real; correcta → resultRevision determinista e independiente del proceso", async () => {
    const doc = simple();
    const wrong = documentOf(await call("author_document", { document: doc, baseRevision: "sha256:" + "0".repeat(64), operations: [PAGO] }));
    assert.deepEqual([wrong.ok, wrong.errors[0].code, wrong.actualRevision], [false, "REVISION_MISMATCH", rev(doc)]);
    const ops = [PAGO, E("update_event_type", { eventTypeId: 2, name: "Procesado" })];
    const a = await authorJson(doc, ops);
    await authorJson(complex(), [E("create_event_type", { name: "Otro", primitive: "FLOW", sentence: "{source}" })]);
    const b = await authorJson(doc, ops);
    assert.equal(a.resultRevision, b.resultRevision);
    assert.deepStrictEqual(a.document, b.document);
    assert.equal(rev(a.document), a.resultRevision, "la revisión del documento devuelto es la anunciada");
    assert.notEqual(a.resultRevision, a.baseRevision);
  });

  it("dryRun: valida y devuelve los cambios y la revisión sin documento; también para rechazos", async () => {
    const ops = [PAGO, E("update_event_type", { eventTypeId: 3, symbol: "★" })];
    const dry = await authorJson(simple(), ops, { dryRun: true });
    const real = await authorJson(simple(), ops);
    assert.deepEqual([dry.ok, dry.dryRun, dry.document], [true, true, undefined]);
    assert.deepEqual(dry.changes, real.changes);
    assert.equal(dry.resultRevision, real.resultRevision);
    const rejected = documentOf(await author(simple(), [E("delete_event_type", { eventTypeId: 1 })], { dryRun: true }));
    assert.deepEqual([rejected.ok, rejected.dryRun], [false, true]);
  });

  it("un lote que no cambia nada (el mismo valor) deja la misma revisión", async () => {
    const r = await authorJson(simple(), [E("update_event_type", { eventTypeId: 1, name: "Pago" })]);
    assert.deepEqual([r.changed, r.resultRevision === r.baseRevision], [false, true]);
  });

  it("entrada congelada: no se muta y nada persiste entre llamadas", () => {
    const freeze = (o: any): any => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
    const doc = freeze(simple()), ops = freeze([PAGO]);
    const input = { document: doc, baseRevision: rev(doc), operations: ops as unknown[] };
    assert.deepStrictEqual(authorDocument(input), authorDocument(input));
  });
});

/* ═══════════════ 4. describe_document: ¿qué eventos puedo usar? ═══════════════ */

describe("describe_document de EventTypes", () => {
  it("cada evento trae id, nombre, frase, símbolo, primitiva, acción, a qué se aplica, presentación relevante y dónde se usa", async () => {
    const d = await describeDoc(simple());
    const pago = d.eventTypes[0];
    assert.deepEqual(Object.keys(pago), ["id", "name", "sentence", "symbol", "primitive", "action", "target", "motion", "usedBy", "usedIn"]);
    assert.deepEqual(pago.usedIn, [{ pageIndex: 0, storyId: 1, stepIds: [1] }, { pageIndex: 0, storyId: 2, stepIds: [2] }]);
    assert.equal(d.eventTypes[3].availability, "DOWN");
    assert.deepEqual(d.capabilities.authoringScopes, ["story", "page", "eventType", "document"]);
  });

  it("la presentación se resume como lo que se aparta del defecto; vacía no aparece", async () => {
    const r = await authorJson(simple(), [
      E("create_event_type", { name: "Aviso", primitive: "OCCURRENCE", sentence: "{target} avisa", presentation: { nodeEffects: { showSymbol: true, message: "Ojo", visualDuration: "custom", visualDurationMs: 2500 } } }),
      E("create_event_type", { name: "Sobrio", primitive: "OCCURRENCE", sentence: "{target} ok" }),
    ]);
    const d = await describeDoc(r.document);
    assert.deepEqual(d.eventTypes[4].presentation, { showSymbol: true, message: "Ojo", visualDuration: "custom", visualDurationMs: 2500 });
    assert.equal("presentation" in d.eventTypes[5], false);
    assert.ok(!JSON.stringify(d).includes("nodeEffects"));
  });

  it("con pageIndex sólo se listan los usos de esa página; sin uso no hay usedIn; un evento muy usado se acota", async () => {
    const d = await describeDoc(complex(), { pageIndex: 1 });
    for (const et of d.eventTypes) for (const u of et.usedIn ?? []) assert.equal(u.pageIndex, 1);
    const big = simple();
    const sc = big.doc.pages[0].scenarios[0];
    for (let i = 0; i < 30; i++) big.doc.pages[0].scenarios.push({ ...clone(sc), id: 100 + i, name: "S" + i });
    big.doc.pages[0].nextScenarioId = 200;
    const dd = await describeDoc(big, { includeSteps: false });
    const pago = dd.eventTypes[0];
    assert.equal(pago.usedIn.length, 25);
    assert.equal(pago.usedInTruncated, 7);
    assert.equal(pago.usedBy, 32);
    const sinUso = (await describeDoc((await authorJson(simple(), [PAGO])).document)).eventTypes.at(-1);
    assert.equal("usedIn" in sinUso, false);
    assert.equal(sinUso.usedBy, 0);
  });

  it("responde «¿qué eventos puedo usar para esta Historia?» sin inspeccionar el documento: cada evento dice a qué se aplica", async () => {
    const d = await describeDoc(simple(), { includeSteps: false });
    const forConnection = d.eventTypes.filter((e: any) => e.target === "connection").map((e: any) => e.name);
    const forElement = d.eventTypes.filter((e: any) => e.target === "element").map((e: any) => e.name);
    assert.deepEqual([forConnection, forElement], [["Pago", "Confirmación"], ["Procesamiento", "Caída"]]);
    assert.ok(JSON.stringify(d).length < 8_000, "compacto");
  });
});

/* ═══════════════ 5. Compatibilidad ═══════════════ */

describe("compatibilidad", () => {
  it("documento legacy (v3, sin eventos ni Historias): se crea un evento, una Historia que lo usa y la salida es v5 válido y ejecutable", async () => {
    const legacy = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "kafka-event-pipeline.fluyo.json"), "utf8"));
    const first = legacy.doc ? legacy.doc.pages[0] : legacy.pages[0];
    const nodeId = (first.nodes ?? legacy.nodes)[0].id;
    const r = await authorJson(legacy, [
      E("create_event_type", { name: "Llega", primitive: "OCCURRENCE", sentence: "{target} recibe", ref: "l" }),
      S("create_story", { name: "Primera", ref: "s" }),
      S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "l" }, target: { nodeId } }),
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.document.version, 5);
    assert.equal((await describeDoc(r.document)).valid, true);
    assert.equal((await run(r.document, 1)).executed, true);
  });

  it("EventType antiguo sin presentation/motion: renombrar no inventa campos; un parche de presentación sí los crea", async () => {
    const old = simple();
    delete old.doc.eventTypes[0].presentation; delete old.doc.eventTypes[0].motion;
    const a = await authorJson(old, [E("update_event_type", { eventTypeId: 1, name: "Pago antiguo" })]);
    assert.equal(a.ok, true);
    assert.equal("presentation" in types(a.document)[0], false);
    const b = await authorJson(old, [E("update_event_type", { eventTypeId: 1, presentation: { connectionEffects: { style: "smooth" } } })]);
    assert.equal(types(b.document)[0].presentation.connectionEffects.style, "smooth");
  });
});

/* ═══════════════ 6. PARIDAD con el modal real del editor ═══════════════ */

describe("paridad: el mismo EventType y la misma Historia por el modal del editor y por author_document", () => {
  it("las operaciones del golden producen EXACTAMENTE los EventTypes y Steps del editor (deepStrictEqual, sin normalizar)", async () => {
    const g = golden();
    const r = await authorJson(simple(), g.operations);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(types(r.document), g.types);
    assert.deepStrictEqual(stepsOf(r.document, g.ids.sid), g.steps);
  });

  it("run_story sobre el resultado == Trace, outcomes y disponibilidad final del editor; y la metadata de presentación (Playback/Present/Viewer/Share)", async () => {
    const g = golden();
    const r = await authorJson(simple(), g.operations);
    const t = await run(r.document, g.ids.sid);
    assert.equal(t.executed, true);
    assert.deepStrictEqual(t.trace, g.trace.events);
    assert.deepStrictEqual(t.steps.map((s: any) => [s.stepId, s.at, s.outcome.status, s.outcome.reason, s.outcome.nodeAvailability, s.outcome.eventIndexes]),
      g.outcomes.map((o: any) => [o.stepId, o.at, o.status, o.reason, o.nodeAvailability, o.eventIndexes]));
    assert.deepStrictEqual(Object.fromEntries(t.finalAvailability.map((n: any) => [String(n.id), n.availability])), g.finalAvailability);
    const k = createKernel().call<any>(`(function(){ const d = projectFromProjectData(__a.p).doc; doc = d; const sc = d.pages[0].scenarios.find(s => s.id === __a.id);
      return {stepMeta: FluyoStory.stepMeta(sc.steps), playback: sc.steps.map(s => FluyoStory.playbackEffects ? FluyoStory.playbackEffects(eventTypeById(s.eventTypeId)) : null)}; })()`, { p: r.document, id: g.ids.sid });
    assert.deepStrictEqual(k.stepMeta, g.stepMeta);
    assert.deepStrictEqual(k.playback, g.playback);
  });

  it("el golden es el de Fluyo (con fluyo/ al lado)", { skip: skipSinFluyo }, () => {
    assert.equal(
      readFileSync(join(DIR, "fluyo-017-3-golden.json"), "utf8").replace(/\r\n/g, "\n"),
      readFileSync(join(FLUYO, "test", "fixtures", "fluyo-017-3-golden.json"), "utf8").replace(/\r\n/g, "\n")
    );
  });
});

/* ═══════════════ 7. Contrato publicado ═══════════════ */

describe("contrato de tools/list", () => {
  const findOp = (schema: any, op: string): any => {
    const items = schema.properties.operations.items;
    return (items.oneOf ?? items.anyOf).find((o: any) => o.properties.op.const === op || o.properties.op.enum?.[0] === op);
  };

  it("author_document publica las 3 operaciones de eventos (scope eventType) y ninguna operación de diagrama antigua (add_edge, add_node…)", async () => {
    const { tools } = await h.client.listTools();
    const t = tools.find(x => x.name === "author_document")!;
    const schema: any = t.inputSchema;
    for (const op of ["create_event_type", "update_event_type", "delete_event_type"]) {
      const o = findOp(schema, op);
      assert.ok(o, op);
      assert.equal(o.properties.scope.const ?? o.properties.scope.enum?.[0], "eventType");
      assert.ok(!("pageIndex" in o.properties), `${op} no tiene pageIndex`);
      assert.equal(o.additionalProperties, false);
    }
    assert.doesNotMatch(JSON.stringify(t), /add_edge|add_node|remove_node|remove_edge/);
    assert.match(t.description ?? "", /eventType/);
    // Los valores fuera de las listas cerradas ni siquiera llegan al kernel: los rechaza el schema.
    for (const [op, campo] of [[E("create_event_type", { name: "N", primitive: "FLOW", sentence: "{source}", presentation: { connectionEffects: { arrival: "boom" } } }), "arrival"], [E("create_event_type", { name: "", primitive: "FLOW", sentence: "{source}" }), "name"]] as const) {
      const res = await author(simple(), [op]);
      assert.equal(isToolError(res), true, campo);
      assert.match(textOf(res), /validation|Invalid/i);
    }
  });

  it("las listas cerradas del schema son las de la UI de Fluyo (kernel): sin deriva", async () => {
    const { tools } = await h.client.listTools();
    const schema: any = tools.find(x => x.name === "author_document")!.inputSchema;
    const create = findOp(schema, "create_event_type");
    const kernel = createKernel().call<any>(`({
      primitives:[...EVENT_TYPE_PRIMITIVES], motions:[...EVENT_TYPE_MOTIONS], sizes:SYMBOL_SIZES, styles:FLOW_STYLES, trails:FLOW_TRAILS, arrivals:FLOW_ARRIVALS, durings:FLOW_DURINGS,
      msgSizes:NODE_MESSAGE_SIZES, weights:NODE_MESSAGE_WEIGHTS, fonts:NODE_MESSAGE_FONTS, positions:NODE_MESSAGE_POSITIONS, durations:NODE_VISUAL_DURATIONS,
      name:EVENT_TYPE_NAME_MAX, sentence:EVENT_TYPE_SENTENCE_MAX, msgMax:NODE_EFFECT_MAX_MESSAGE_LEN, msMin:NODE_VISUAL_DURATION_MIN_MS, msMax:NODE_VISUAL_DURATION_MAX_MS})`);
    const conn = create.properties.presentation.properties.connectionEffects.properties, node = create.properties.presentation.properties.nodeEffects.properties;
    assert.deepEqual(create.properties.primitive.enum, kernel.primitives);
    assert.deepEqual(create.properties.motion.enum, kernel.motions);
    assert.deepEqual([conn.size.enum, conn.style.enum, conn.trail.enum, conn.arrival.enum, conn.during.enum], [kernel.sizes, kernel.styles, kernel.trails, kernel.arrivals, kernel.durings]);
    assert.deepEqual([node.symbolSize.enum, node.messageSize.enum, node.messageWeight.enum, node.messageFont.enum, node.messagePosition.enum, node.visualDuration.enum], [kernel.sizes, kernel.msgSizes, kernel.weights, kernel.fonts, kernel.positions, kernel.durations]);
    assert.deepEqual([create.properties.name.maxLength, create.properties.sentence.maxLength, node.message.maxLength, node.visualDurationMs.minimum, node.visualDurationMs.maximum], [kernel.name, kernel.sentence, kernel.msgMax, kernel.msMin, kernel.msMax]);
    assert.deepEqual(Object.keys(node).sort(), Object.keys(createKernel().call<any>("defaultNodeEffects()")).sort(), "todos los efectos de elemento");
    assert.deepEqual(Object.keys(conn).sort(), Object.keys(createKernel().call<any>("defaultConnectionEffects()")).sort(), "todos los efectos de conexión");
  });

  it("MCP no contiene reglas de dominio de EventTypes: sólo la forma de las operaciones", () => {
    const src = readFileSync(join(ROOT, "src", "authoring.ts"), "utf8");
    for (const prohibido of [/eventTypeActionSpec|EVENT_ACTION|stepDefinitionForEvent/, /immutable_when_used|event_type_in_use/, /usedBy|eventTypeUse/, /\.filter\(\s*\w*\s*=>\s*\w*\.eventTypeId/])
      assert.doesNotMatch(src, prohibido, `authoring.ts contiene lógica de dominio: ${prohibido}`);
  });
});

/* ═══════════════ 8. MCP real por stdio ═══════════════ */

describe("servidor real por stdio", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-017-3", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  const rpc = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const noStack = (r: unknown) => assert.doesNotMatch(textOf(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./);

  it("describe → create_event_type → add_step → run_story por stdio", async () => {
    const doc = simple();
    const d = documentOf(await rpc("describe_document", { document: doc }));
    const r = documentOf(await rpc("author_document", { document: doc, baseRevision: d.revision, operations: [
      E("create_event_type", { name: "Reintento", primitive: "FLOW", sentence: "{source} reintenta con {target}", symbol: "↻", ref: "re" }),
      S("create_story", { name: "Con reintento", ref: "s" }),
      S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "re" }, target: { edgeId: 4 } }),
    ] }));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const t = documentOf(await rpc("run_story", { document: r.document, storyId: 4 }));
    assert.deepEqual(t.steps.map((s: any) => [s.event.name, s.sentence, s.outcome.status]), [["Reintento", "Cliente reintenta con Kafka", "completed"]]);
  });

  it("rechazos de EventTypes sin trazas internas (borrar usado, bloqueo, campo inválido) y lista de herramientas", async () => {
    const doc = simple();
    for (const [op, code] of [[E("delete_event_type", { eventTypeId: 1 }), "REFERENCED_ENTITY"], [E("update_event_type", { eventTypeId: 1, primitive: "OCCURRENCE" }), "EVENT_TYPE_LOCKED"], [E("create_event_type", { name: "N", primitive: "FLOW", sentence: "{x}" }), "INVALID_EVENT_TYPE"]] as const) {
      const res = await rpc("author_document", { document: doc, baseRevision: rev(doc), operations: [op] });
      assert.equal(isToolError(res), true);
      assert.equal(documentOf(res).errors[0].code, code);
      noStack(res);
    }
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12);
  });
});

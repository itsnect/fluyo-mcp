/**
 * FLUYO-017.3 — QA final del lado MCP (EventTypes + authoring + describe + run + paridad).
 *
 * Complementa test/fluyo-017-3.test.ts con lo que hace falta para CERRAR el slice y para que una batería de mutaciones
 * (scripts/mutate-017-3.ts) pueda detectar cada defecto plausible:
 *   · crear: las tres primitivas, acción derivada, disponibilidad inicial, `{ref}` y creación + uso en el mismo lote;
 *   · update: identidad, relato, Steps/Trace intactos, primitiva y disponibilidad bloqueadas si se usa, atomicidad;
 *   · delete: no usado sí; usado REFERENCED_ENTITY con entidad, Historias y Steps; nunca documento parcial;
 *   · describe: usedIn por página/Historia/Step, etiquetas largas, documentos antiguos, EventTypes duplicados;
 *   · paridad editor ↔ MCP (documento, revisión incluida, sin normalizar) y ciclo describe → author → describe → run;
 *   · aislamiento: run(A) run(B) run(A); describe no muta; la entrada no se toca.
 * Ninguna regla de dominio vive aquí: se comprueba el comportamiento observable del servidor MCP real (en memoria).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { documentOf, isToolError, packageRoot, startHarness, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const load = (n: string): any => JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "stories", n), "utf8"));
const simple = () => load("fluyo-017-1-cliente-kafka-comercio.fluyo.json");
const complex = () => load("fluyo-017-1-qa-complejo.fluyo.json");
const golden = (): any => load("fluyo-017-3-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const E = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "eventType", ...extra });
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, ...extra });
const P = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "page", pageIndex: 0, ...extra });

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const author = (document: unknown, operations: unknown[], extra: Record<string, unknown> = {}) =>
  call("author_document", { document, baseRevision: rev(document), operations, ...extra });
const ok = async (document: unknown, operations: unknown[]) => { const r = documentOf(await author(document, operations)); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r; };
const rejected = async (document: unknown, operations: unknown[]) => {
  const res = await author(document, operations);
  assert.equal(isToolError(res), true, "un rechazo es isError");
  const r = documentOf(res);
  assert.equal(r.ok, false);
  assert.equal(r.document, undefined, "un rechazo nunca devuelve documento (ni parcial)");
  return r;
};
const describeDoc = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await call("describe_document", { document, ...extra }));
const run = async (document: unknown, storyId: number, extra: Record<string, unknown> = {}) => documentOf(await call("run_story", { document, storyId, ...extra }));
const types = (d: any) => d.doc.eventTypes as any[];
const storiesOf = (d: any, page = 0) => d.doc.pages[page].scenarios as any[];

/* ═══════════════ Crear ═══════════════ */

describe("crear EventTypes", () => {
  it("las tres primitivas: la acción del Step la deriva el EventType (SEND / OCCURRENCE / SET_STATE) y nunca la escribe el agente", async () => {
    const r = await ok(simple(), [
      E("create_event_type", { name: "Cobro", primitive: "FLOW", sentence: "{source} cobra a {target}", ref: "c" }),
      E("create_event_type", { name: "Alerta", primitive: "OCCURRENCE", sentence: "{target} alerta", ref: "n" }),
      E("create_event_type", { name: "Recupera", primitive: "SET_AVAILABILITY", availability: "UP", sentence: "{target} vuelve", ref: "u" }),
      S("create_story", { name: "Nueva", ref: "h" }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "c" }, target: { edgeId: 4 } }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "n" }, target: { nodeId: 2 } }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "u" }, target: { nodeId: 3 } }),
    ]);
    assert.deepEqual(types(r.document).slice(4).map(e => [e.id, e.name, e.primitive, e.availability ?? null]), [[5, "Cobro", "FLOW", null], [6, "Alerta", "OCCURRENCE", null], [7, "Recupera", "SET_AVAILABILITY", "UP"]]);
    assert.deepEqual(storiesOf(r.document)[3].steps.map((s: any) => [s.eventTypeId, s.action, s.state ?? null, s.edgeId ?? null, s.nodeId ?? null]),
      [[5, "SEND", null, 4, null], [6, "OCCURRENCE", null, null, 2], [7, "SET_STATE", "UP", null, 3]]);
    const t = await run(r.document, 4);
    assert.equal(t.executed, true);
    assert.deepEqual(t.steps.map((s: any) => s.outcome.status), ["completed", "narrated", "no_change"]);   // SEND completa; OCCURRENCE se narra; Kafka ya estaba disponible (UP→UP)
  });

  it("disponibilidad inicial + SET_AVAILABILITY: finalAvailability refleja ambos, y cambia sólo lo que la Historia provoca", async () => {
    const r = await ok(simple(), [
      P("set_initial_availability", { nodeId: 2, state: "DOWN" }),
      E("create_event_type", { name: "Reanuda", primitive: "SET_AVAILABILITY", availability: "UP", sentence: "{target} reanuda", ref: "u" }),
      S("create_story", { ref: "h" }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "u" }, target: { nodeId: 2 } }),
    ]);
    const base = await run(simple(), 3);
    const t = await run(r.document, 4);
    const avail = (x: any, id: number) => x.finalAvailability.find((n: any) => n.id === id).availability;
    assert.equal(avail(t, 2), "UP");
    assert.equal(avail(t, 1), avail(base, 1));
    const sinReanudar = await run((await ok(simple(), [P("set_initial_availability", { nodeId: 2, state: "DOWN" }), S("create_story", {})])).document, 4);
    assert.equal(avail(sinReanudar, 2), "DOWN");
  });

  it("sin símbolo se usa el del modal del editor («●»); con símbolo, el dado", async () => {
    const r = await ok(simple(), [E("create_event_type", { name: "S", primitive: "OCCURRENCE", sentence: "{target}" }), E("create_event_type", { name: "T", primitive: "OCCURRENCE", sentence: "{target}", symbol: "★" })]);
    assert.deepEqual(types(r.document).slice(4).map(e => e.visual), [{ kind: "token", value: "●" }, { kind: "token", value: "★" }]);
  });

  it("sin disponibilidad en SET_AVAILABILITY, o disponibilidad en otra primitiva, es INVALID_EVENT_TYPE con el campo", async () => {
    const a = await rejected(simple(), [E("create_event_type", { name: "x", primitive: "SET_AVAILABILITY", sentence: "{target}" })]);
    assert.deepEqual([a.errors[0].code, a.errors[0].field], ["INVALID_EVENT_TYPE", "availability"]);
    const b = await rejected(simple(), [E("create_event_type", { name: "x", primitive: "FLOW", sentence: "{source}", availability: "UP" })]);
    assert.deepEqual([b.errors[0].code, b.errors[0].field], ["INVALID_EVENT_TYPE", "availability"]);
  });

  it("un `{ref}` inexistente es UNKNOWN_REF (no se acepta una referencia que nadie creó) y el lote no deja nada", async () => {
    const doc = simple();
    const r = await rejected(doc, [E("create_event_type", { name: "A", primitive: "FLOW", sentence: "{source}" }), S("create_story", { ref: "h" }), S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "fantasma" }, target: { edgeId: 4 } })]);
    assert.deepEqual([r.errors[0].code, r.errors[0].operationIndex, r.errors[0].ref], ["UNKNOWN_REF", 2, "fantasma"]);
    const r2 = await rejected(doc, [S("create_story", { ref: "h" }), S("add_step", { storyId: { ref: "h" }, eventTypeId: 99, target: { edgeId: 4 } })]);
    assert.equal(r2.errors[0].code, "EVENT_TYPE_NOT_FOUND");
    // La ref sólo vive durante el lote.
    const a = await ok(doc, [E("create_event_type", { name: "A", primitive: "FLOW", sentence: "{source}", ref: "efimera" })]);
    const r3 = await rejected(a.document, [S("create_story", { ref: "h" }), S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "efimera" }, target: { edgeId: 4 } })]);
    assert.equal(r3.errors[0].code, "UNKNOWN_REF");
  });

  it("add_step no admite action, state ni at (ni siquiera con un EventType válido): los decide el EventType y las esperas", async () => {
    for (const extra of [{ action: "SEND" }, { state: "UP" }, { at: 5000 }]) {
      let rejectedByAnyone = false;
      try { rejectedByAnyone = isToolError(await author(simple(), [S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 4 }, ...extra })])); } catch { rejectedByAnyone = true; }
      assert.equal(rejectedByAnyone, true, JSON.stringify(extra));
      const k = createKernel().call<any>("FluyoAuthoring.apply(__a.p, __a.o)", { p: simple(), o: [S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 4 }, ...extra })] });
      assert.deepEqual([k.ok, k.errors[0].code], [false, "INVALID_OPERATION"], JSON.stringify(extra));
    }
  });
});

/* ═══════════════ Update ═══════════════ */

describe("actualizar EventTypes", () => {
  it("nombre/frase: conserva el id, cambia el relato en todos los usos, no cambia acción, primitiva, Steps ni Trace", async () => {
    const doc = simple();
    const antes = await run(doc, 1), antesB = await run(doc, 2);
    const r = await ok(doc, [E("update_event_type", { eventTypeId: 1, name: "Cobro", sentence: "{source} abona a {target}" })]);
    const et = types(r.document)[0], old = types(doc)[0];
    assert.deepEqual([et.id, et.name, et.sentenceTemplate, et.primitive], [1, "Cobro", "{source} abona a {target}", "FLOW"]);
    assert.deepStrictEqual(r.document.doc.pages, doc.doc.pages, "las Historias y Steps no cambian");
    assert.deepEqual(Object.keys(et), Object.keys(old));
    const ahora = await run(r.document, 1), ahoraB = await run(r.document, 2);
    assert.equal(ahora.steps[0].sentence, "Cliente abona a Kafka");
    assert.equal(ahoraB.steps[1].sentence, "Cliente abona a Kafka");
    assert.deepStrictEqual(ahora.trace, antes.trace);
    assert.deepStrictEqual(ahoraB.trace, antesB.trace);
    assert.deepEqual(ahora.steps.map((s: any) => [s.outcome, s.action]), antes.steps.map((s: any) => [s.outcome, s.action]));
  });

  it("un EventType usado: primitiva y disponibilidad bloqueadas (EVENT_TYPE_LOCKED), también al cambiar varios campos a la vez, y el lote es atómico", async () => {
    const doc = simple(), snapshot = JSON.stringify(doc);
    const p = await rejected(doc, [E("update_event_type", { eventTypeId: 1, name: "Nuevo nombre", primitive: "OCCURRENCE" })]);
    assert.deepEqual([p.errors[0].code, p.errors[0].field], ["EVENT_TYPE_LOCKED", "primitive"]);
    const a = await rejected(doc, [E("update_event_type", { eventTypeId: 4, name: "Otro", availability: "UP" })]);
    assert.deepEqual([a.errors[0].code, a.errors[0].field], ["EVENT_TYPE_LOCKED", "availability"]);
    assert.equal(JSON.stringify(doc), snapshot);
    // Un EventType NO usado sí puede cambiar de primitiva (y reconstruye su definición).
    const libre = await ok(doc, [E("create_event_type", { name: "L", primitive: "FLOW", sentence: "{source}", motion: "slow", ref: "l" }), E("update_event_type", { eventTypeId: { ref: "l" }, primitive: "OCCURRENCE", sentence: "{target}" })]);
    const l = types(libre.document)[4];
    assert.deepEqual([l.primitive, l.motion, "connectionEffects" in (l.presentation ?? {})], ["OCCURRENCE", "normal", false]);
  });

  it("update parcialmente inválido: ninguna parte se aplica (nombre válido + presentación inválida) y el original queda intacto", async () => {
    const doc = simple(), snapshot = JSON.stringify(doc);
    const r = await rejected(doc, [E("update_event_type", { eventTypeId: 2, name: "Cambiado", symbol: "✔", motion: "slow" })]);
    assert.ok(r.errors[0].code === "INVALID_EVENT_TYPE" && r.errors[0].field === "motion", JSON.stringify(r.errors[0]));
    assert.equal(JSON.stringify(doc), snapshot);
    // Con el validador de datos del dominio: el mismo lote, con el último campo ilegal en el kernel directo.
    const k = createKernel().call<any>("FluyoAuthoring.apply(__a.p, __a.o)", { p: doc, o: [E("update_event_type", { eventTypeId: 1, name: "Cambiado", motion: "turbo" })] });
    assert.equal(k.ok, false);
    assert.equal(k.project, undefined);
  });

  it("el cambio de símbolo/movimiento/presentación no altera la acción, el Trace ni los Steps (sólo presentación)", async () => {
    const doc = simple();
    const r = await ok(doc, [E("update_event_type", { eventTypeId: 1, symbol: "★", motion: "slow", presentation: { connectionEffects: { style: "impulse", trail: "marked" } } })]);
    assert.deepStrictEqual(r.document.doc.pages, doc.doc.pages);
    const antes = await run(doc, 1), ahora = await run(r.document, 1);
    assert.deepStrictEqual(ahora.trace, antes.trace);
    assert.equal(types(r.document)[0].visual.value, "★");
  });
});

/* ═══════════════ Delete ═══════════════ */

describe("eliminar EventTypes", () => {
  it("no usado: se elimina y el id no se reutiliza; usado: REFERENCED_ENTITY con entidad, Historias y Steps afectados", async () => {
    const a = await ok(simple(), [E("create_event_type", { name: "Temporal", primitive: "OCCURRENCE", sentence: "{target}" })]);
    const b = await ok(a.document, [E("delete_event_type", { eventTypeId: 5 })]);
    assert.deepEqual(types(b.document).map(e => e.id), [1, 2, 3, 4]);
    const c = await ok(b.document, [E("create_event_type", { name: "Otro", primitive: "OCCURRENCE", sentence: "{target}" })]);
    assert.equal(types(c.document).at(-1).id, 6);
    const doc = simple(), snapshot = JSON.stringify(doc);
    for (const id of [1, 2, 3, 4]) {
      // Los usos esperados salen del documento crudo, no del kernel.
      const stories: Array<[number, number[]]> = [];
      for (const sc of doc.doc.pages[0].scenarios) { const ids = sc.steps.filter((x: any) => x.eventTypeId === id).map((x: any) => x.id); if (ids.length) stories.push([sc.id, ids]); }
      assert.ok(stories.length > 0);
      const r = await rejected(doc, [E("delete_event_type", { eventTypeId: id })]);
      assert.equal(r.errors.length, 1);
      assert.equal(r.errors[0].code, "REFERENCED_ENTITY");
      assert.equal(r.errors[0].entity.id, id);
      assert.deepEqual(r.errors[0].affectedStories.map((s: any) => [s.storyId, s.stepIds]), stories);
      assert.equal(r.errors[0].affectedSteps.length, stories.reduce((n, [, ids]) => n + ids.length, 0));
      assert.equal(JSON.stringify(doc), snapshot);
    }
  });

  it("un lote que borra un evento usado tras uno que sí era válido no devuelve el documento a medias (REFERENCED_ENTITY en el índice correcto)", async () => {
    const doc = simple();
    const r = await rejected(doc, [E("create_event_type", { name: "Bien", primitive: "FLOW", sentence: "{source}" }), E("delete_event_type", { eventTypeId: 2 })]);
    assert.deepEqual([r.errors[0].code, r.errors[0].operationIndex], ["REFERENCED_ENTITY", 1]);
  });
});

/* ═══════════════ Describe ═══════════════ */

describe("describe_document de EventTypes", () => {
  it("usedIn: página, Historia y Step correctos en un documento de varias páginas; los ids de Historia son por página", async () => {
    const d = await describeDoc(complex());
    const raw = complex();
    const expected = new Map<number, Array<[number, number, number[]]>>();
    raw.doc.pages.forEach((pg: any, pi: number) => pg.scenarios.forEach((sc: any) => {
      const per = new Map<number, number[]>();
      for (const st of sc.steps) per.set(st.eventTypeId, [...(per.get(st.eventTypeId) ?? []), st.id]);
      for (const [et, ids] of per) expected.set(et, [...(expected.get(et) ?? []), [pi, sc.id, ids]]);
    }));
    for (const et of d.eventTypes) {
      assert.deepEqual((et.usedIn ?? []).map((u: any) => [u.pageIndex, u.storyId, u.stepIds]), expected.get(et.id) ?? [], `evento ${et.id}`);
      assert.equal(et.usedBy, (expected.get(et.id) ?? []).reduce((n, [, , ids]) => n + ids.length, 0));
    }
    assert.ok(d.eventTypes.some((e: any) => (e.usedIn ?? []).some((u: any) => u.pageIndex === 1)), "algún uso en la 2.ª página");
  });

  it("presentación/primitiva/acción/target de cada evento corresponden al documento; etiquetas largas se truncan a una línea", async () => {
    const doc = simple();
    doc.doc.pages[0].nodes[1].label = "Línea 1 muy larga ".repeat(20) + "\nsegunda línea";
    const d = await describeDoc(doc);
    for (const et of d.eventTypes) {
      const raw = types(doc).find(e => e.id === et.id);
      assert.deepEqual([et.name, et.primitive, et.sentence], [raw.name, raw.primitive, raw.sentenceTemplate]);
      assert.equal(et.action, { FLOW: "SEND", OCCURRENCE: "OCCURRENCE", SET_AVAILABILITY: "SET_STATE" }[et.primitive as string]);
      assert.equal(et.target, et.primitive === "FLOW" ? "connection" : "element");
    }
    const kafka = d.pages[0].nodes.find((n: any) => n.id === 2);
    assert.ok([...kafka.label].length <= 80 && kafka.label.endsWith("…"), kafka.label);
    assert.ok(!kafka.label.includes("\n"));
  });

  it("EventTypes con el mismo nombre: dos entradas con ids distintos y usos separados", async () => {
    const r = await ok(simple(), [E("create_event_type", { name: "Pago", primitive: "FLOW", sentence: "{source} duplica a {target}", ref: "d" }), S("create_story", { ref: "h" }), S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "d" }, target: { edgeId: 4 } })]);
    const d = await describeDoc(r.document);
    const pagos = d.eventTypes.filter((e: any) => e.name === "Pago");
    assert.deepEqual(pagos.map((e: any) => [e.id, e.usedBy]), [[1, 2], [5, 1]]);
    assert.deepEqual(pagos[1].usedIn, [{ pageIndex: 0, storyId: 4, stepIds: [1] }]);
  });

  it("documento antiguo (v3 sin Historias ni eventos): se describe, no inventa usos, y sigue válido", async () => {
    const legacy = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "kafka-event-pipeline.fluyo.json"), "utf8"));
    const d = await describeDoc(legacy);
    assert.equal(d.valid, true);
    assert.deepEqual(d.eventTypes.filter((e: any) => e.usedBy > 0), []);
  });

  it("describe no modifica nada: describe(A) · author(A) · describe(A original) idénticos; el documento original no cambia", async () => {
    const A = simple(), snapshot = JSON.stringify(A);
    const d1 = await describeDoc(A);
    await ok(A, [E("create_event_type", { name: "Z", primitive: "FLOW", sentence: "{source}" }), S("create_story", {})]);
    const d2 = await describeDoc(A);
    assert.deepStrictEqual(d2, d1);
    assert.equal(JSON.stringify(A), snapshot);
  });
});

/* ═══════════════ Paridad editor ↔ MCP y ciclo completo ═══════════════ */

describe("paridad editor ↔ MCP (sin normalizar)", () => {
  it("el documento COMPLETO que produce author_document es el del editor: EventTypes, Steps, `at`, esperas, simultaneidad, acciones, contadores y revisión", async () => {
    const g = golden();
    const viaMcp = await ok(simple(), g.operations);
    // Camino A (modal real del editor) = el golden de Fluyo, generado con las funciones del editor sobre el mismo punto de partida.
    const viaMcpStory = storiesOf(viaMcp.document).find((s: any) => s.id === g.ids.sid);
    assert.deepStrictEqual(viaMcpStory.steps, g.steps);
    assert.deepStrictEqual(types(viaMcp.document), g.types);
    assert.deepStrictEqual(viaMcpStory.steps.map((s: any) => s.at), g.steps.map((s: any) => s.at));
    assert.deepStrictEqual(viaMcpStory.steps.map((s: any) => s.action), g.steps.map((s: any) => s.action));
    assert.equal(viaMcp.document.doc.nextEventTypeId, Math.max(...g.types.map((t: any) => t.id)) + 1);
    // La revisión es función del documento: el devuelto y el anunciado coinciden y no dependen del proceso.
    assert.equal(rev(viaMcp.document), viaMcp.resultRevision);
    assert.equal(viaMcp.resultRevision, g.revision, "revisión del documento del EDITOR (golden de Fluyo) == resultRevision de MCP");
    const again = await ok(simple(), g.operations);
    assert.equal(again.resultRevision, viaMcp.resultRevision);
    assert.deepStrictEqual(again.document, viaMcp.document);
  });

  it("Trace, outcomes y finalAvailability de run_story == los del editor (golden); idénticos en dos ejecuciones", async () => {
    const g = golden();
    const doc = (await ok(simple(), g.operations)).document;
    const t1 = await run(doc, g.ids.sid), t2 = await run(doc, g.ids.sid);
    assert.deepStrictEqual(t1.trace, g.trace.events);
    assert.deepStrictEqual(t1.steps.map((s: any) => [s.stepId, s.at, s.outcome.status, s.outcome.reason, s.outcome.nodeAvailability]), g.outcomes.map((o: any) => [o.stepId, o.at, o.status, o.reason, o.nodeAvailability]));
    assert.deepStrictEqual(Object.fromEntries(t1.finalAvailability.map((n: any) => [String(n.id), n.availability])), g.finalAvailability);
    assert.deepStrictEqual(t1, t2);
  });
});

describe("ciclo describe → author → describe → run, sin pérdida de información", () => {
  it("lo que describe dice que existe es lo que author crea y lo que run ejecuta (ids, acciones, frases, tiempos, simultaneidad)", async () => {
    const A = simple();
    const d0 = await describeDoc(A);
    const r = await ok(A, [
      E("create_event_type", { name: "Reintento", primitive: "FLOW", sentence: "{source} reintenta a {target}", symbol: "↻", ref: "re" }),
      S("create_story", { name: "Con reintento", ref: "h" }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "re" }, target: { from: 1, to: 2 }, ref: "a" }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: 2, target: { nodeId: 2 }, waitMs: 750 }),
      S("add_step", { storyId: { ref: "h" }, eventTypeId: 3, target: { edgeId: 5 }, placement: { sameMomentAs: { ref: "a" } } }),
    ]);
    assert.equal(r.baseRevision, d0.revision);
    const d1 = await describeDoc(r.document);
    assert.equal(d1.revision, r.resultRevision);
    const story = d1.pages[0].stories.find((s: any) => s.storyId === 4);
    assert.deepEqual(story.moments.map((m: any) => [m.at, m.steps.map((s: any) => [s.stepId, s.eventTypeId, s.action])]), [[0, [[1, 5, "SEND"], [3, 3, "SEND"]]], [750, [[2, 2, "OCCURRENCE"]]]]);
    const t = await run(r.document, 4);
    assert.equal(t.executed, true);
    assert.deepEqual(t.steps.map((s: any) => s.stepId).sort(), [1, 2, 3]);
    assert.ok(t.steps.some((s: any) => s.stepId === 1 && s.sentence === "Cliente reintenta a Kafka"));
    // Re-autoría desde la descripción: reutilizar los ids descritos produce el mismo documento sin cambios.
    const again = documentOf(await call("author_document", { document: r.document, baseRevision: d1.revision, operations: [E("update_event_type", { eventTypeId: 5, name: "Reintento" })] }));
    assert.deepEqual([again.ok, again.changed, again.resultRevision], [true, false, d1.revision]);
  });
});

/* ═══════════════ Contrato de campos ═══════════════ */

describe("contrato de campos de las operaciones de EventType", () => {
  it("tools/list publica EXACTAMENTE los campos de cada operación (ni uno más: sin id, action, state, at, force, pageIndex)", async () => {
    const { tools } = await h.client.listTools();
    const items: any = (tools.find(t => t.name === "author_document")!.inputSchema as any).properties.operations.items;
    const find = (op: string): any => (items.oneOf ?? items.anyOf).find((o: any) => o.properties.op.const === op || o.properties.op.enum?.[0] === op);
    assert.deepEqual(Object.keys(find("create_event_type").properties).sort(), ["availability", "motion", "name", "op", "presentation", "primitive", "ref", "scope", "sentence", "symbol"]);
    assert.deepEqual(Object.keys(find("update_event_type").properties).sort(), ["availability", "eventTypeId", "motion", "name", "op", "presentation", "primitive", "scope", "sentence", "symbol"]);
    assert.deepEqual(Object.keys(find("delete_event_type").properties).sort(), ["eventTypeId", "op", "scope"]);
    assert.deepEqual(Object.keys(find("add_step").properties).sort(), ["eventTypeId", "op", "pageIndex", "placement", "ref", "scope", "storyId", "target", "waitMs"]);
  });
});

/* ═══════════════ Atomicidad, revisión, dryRun, aislamiento ═══════════════ */

describe("atomicidad y aislamiento", () => {
  it("[válida + inválida] ⇒ documento idéntico (snapshot antes/después) y sin documento devuelto", async () => {
    const doc = complex(), snapshot = JSON.stringify(doc), sRev = rev(doc);
    const r = await rejected(doc, [E("create_event_type", { name: "OK", primitive: "FLOW", sentence: "{source}" }), S("create_story", { name: "OK" }), S("add_step", { storyId: 1, eventTypeId: 999, target: { edgeId: 1 } })]);
    assert.equal(r.errors[0].operationIndex, 2);
    assert.equal(JSON.stringify(doc), snapshot);
    assert.equal(rev(doc), sRev);
  });

  it("baseRevision: correcta ⇒ OK; incorrecta ⇒ REVISION_MISMATCH con la real; el original intacto", async () => {
    const doc = simple(), snapshot = JSON.stringify(doc);
    assert.equal(documentOf(await call("author_document", { document: doc, baseRevision: rev(doc), operations: [S("create_story", {})] })).ok, true);
    const bad = documentOf(await call("author_document", { document: doc, baseRevision: "sha256:" + "f".repeat(64), operations: [S("create_story", {})] }));
    assert.deepEqual([bad.ok, bad.errors[0].code, bad.actualRevision, bad.document], [false, "REVISION_MISMATCH", rev(doc), undefined]);
    assert.equal(JSON.stringify(doc), snapshot);
  });

  it("dryRun: no modifica, devuelve los mismos changes que la ejecución real y la ejecución real produce exactamente esos cambios", async () => {
    const doc = simple(), snapshot = JSON.stringify(doc);
    const ops = [E("create_event_type", { name: "Q", primitive: "OCCURRENCE", sentence: "{target} q", ref: "q" }), S("create_story", { ref: "h" }), S("add_step", { storyId: { ref: "h" }, eventTypeId: { ref: "q" }, target: { nodeId: 1 } }), E("update_event_type", { eventTypeId: 1, name: "Pago!" })];
    const dry = documentOf(await author(doc, ops, { dryRun: true }));
    assert.equal(JSON.stringify(doc), snapshot);
    const real = await ok(doc, ops);
    assert.deepEqual(dry.changes, real.changes);
    assert.equal(dry.resultRevision, real.resultRevision);
    // Cada cambio anunciado está realmente en el documento resultante.
    assert.equal(types(real.document).at(-1).name, "Q");
    assert.equal(types(real.document)[0].name, "Pago!");
    assert.equal(storiesOf(real.document).length, 4);
  });

  it("aislamiento: run(A) run(B) run(A) ⇒ A1 === A2; ninguna llamada deja estado para la siguiente", async () => {
    const A = simple(), B = complex();
    const a1 = await run(A, 1);
    await run(B, 1);
    await authorDocument({ document: B, baseRevision: rev(B), operations: [S("create_story", {})] });
    const a2 = await run(A, 1);
    assert.deepStrictEqual(a1, a2);
  });

  it("dryRun sobre una entrada congelada: no escribe en ella (ni lanza) y no devuelve documento", () => {
    const freeze = (o: any): any => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
    const doc = freeze(simple()), snapshot = JSON.stringify(doc);
    const r = authorDocument({ document: doc, baseRevision: rev(doc), operations: freeze([E("update_event_type", { eventTypeId: 1, name: "Seco" })]), dryRun: true }) as any;
    assert.deepEqual([r.ok, r.dryRun, r.document], [true, true, undefined]);
    assert.equal(JSON.stringify(doc), snapshot);
  });

  it("author sobre una copia: la entrada de author_document nunca se muta (ni siquiera congelada), y dos lotes iguales dan el mismo documento", () => {
    const freeze = (o: any): any => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
    const doc = freeze(simple());
    const ops = freeze([E("update_event_type", { eventTypeId: 1, name: "Congelado" }), E("create_event_type", { name: "C", primitive: "FLOW", sentence: "{source}" })]);
    const input = { document: doc, baseRevision: rev(doc), operations: ops as unknown[] };
    const x = authorDocument(input) as any, y = authorDocument(input) as any;
    assert.equal(x.ok, true);
    assert.deepStrictEqual(x, y);
    assert.equal(doc.doc.eventTypes[0].name, "Pago");
  });

  it("errores sin traza interna: página inexistente, Historia inexistente, documento incompatible", async () => {
    const noStack = (r: unknown) => assert.doesNotMatch(JSON.stringify(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./);
    const pg = documentOf(await call("author_document", { document: simple(), baseRevision: rev(simple()), operations: [{ ...S("create_story"), pageIndex: 9 }] }));
    assert.equal(pg.errors[0].code, "PAGE_NOT_FOUND"); noStack(pg);
    const st = documentOf(await call("author_document", { document: simple(), baseRevision: rev(simple()), operations: [S("rename_story", { storyId: 99, name: "x" })] }));
    assert.equal(st.errors[0].code, "STORY_NOT_FOUND"); noStack(st);
    const inc = await call("author_document", { document: { version: 99, doc: {} }, baseRevision: "sha256:" + "0".repeat(64), operations: [S("create_story", {})] });
    assert.equal(isToolError(inc), true); noStack(inc);
    const rs = await call("run_story", { document: simple(), storyId: 99 });
    noStack(rs);
    const rp = await call("run_story", { document: simple(), pageIndex: 9, storyId: 1 });
    noStack(rp);
  });
});

/* ═══════════════ Servidor real por stdio: los 8 casos de cierre ═══════════════ */

describe("servidor real por stdio (proceso hijo): casos de cierre", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-017-3-qa", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  const rpc = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const text = (r: unknown) => JSON.stringify(r);
  const noStack = (r: unknown) => assert.doesNotMatch(text(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\.|TypeError|ReferenceError/);

  it("describe_document · author_document válido · run_story", async () => {
    const doc = simple();
    const d = documentOf(await rpc("describe_document", { document: doc }));
    assert.equal(d.valid, true);
    const r = documentOf(await rpc("author_document", { document: doc, baseRevision: d.revision, operations: [E("update_event_type", { eventTypeId: 1, name: "Cobro" })] }));
    assert.deepEqual([r.ok, r.changed], [true, true]);
    const t = documentOf(await rpc("run_story", { document: r.document, storyId: 1 }));
    assert.deepEqual([t.executed, t.steps[0].event.name], [true, "Cobro"]);
  });

  it("author_document inválido · revisión incorrecta · Historia inexistente · página inexistente · documento incompatible: errores estructurados, sin trazas", async () => {
    const doc = simple();
    const inv = await rpc("author_document", { document: doc, baseRevision: rev(doc), operations: [E("update_event_type", { eventTypeId: 1, primitive: "OCCURRENCE" })] });
    assert.deepEqual([isToolError(inv), documentOf(inv).errors[0].code], [true, "EVENT_TYPE_LOCKED"]); noStack(inv);
    const rv = await rpc("author_document", { document: doc, baseRevision: "sha256:" + "1".repeat(64), operations: [S("create_story", {})] });
    assert.deepEqual([isToolError(rv), documentOf(rv).errors[0].code], [true, "REVISION_MISMATCH"]); noStack(rv);
    const st = await rpc("author_document", { document: doc, baseRevision: rev(doc), operations: [S("rename_story", { storyId: 77, name: "x" })] });
    assert.equal(documentOf(st).errors[0].code, "STORY_NOT_FOUND"); noStack(st);
    const pg = await rpc("author_document", { document: doc, baseRevision: rev(doc), operations: [{ ...S("create_story"), pageIndex: 5 }] });
    assert.equal(documentOf(pg).errors[0].code, "PAGE_NOT_FOUND"); noStack(pg);
    const rs = await rpc("run_story", { document: doc, storyId: 77 }); noStack(rs);
    assert.equal(isToolError(rs), true);
    const rp = await rpc("run_story", { document: doc, pageIndex: 5, storyId: 1 }); noStack(rp);
    assert.equal(isToolError(rp), true);
    for (const bad of [{ version: 99, doc: {} }, { version: 5, doc: { pages: "x" } }, null, 7]) {
      const x = await rpc("describe_document", { document: bad }); noStack(x);
      const y = await rpc("author_document", { document: bad, baseRevision: "sha256:" + "0".repeat(64), operations: [S("create_story", {})] }); noStack(y);
      assert.equal(isToolError(y), true, text(bad));
    }
  });
});

/**
 * FLUYO-017.1 — QA independiente y adversarial de describe_document / run_story.
 *
 * Complementa test/fluyo-017-1.test.ts con: paridad estructural contra el camino real del editor sobre un fixture
 * complejo (waits, simultaneidad, disponibilidad inicial, efectos visuales, motion, fallos, narrado), auditoría del
 * contrato de lectura (qué ve un agente y qué NO debe ver), aislamiento (entradas congeladas, ejecuciones repetidas),
 * compatibilidad con documentos existentes y el servidor REAL por stdio. Sólo lectura: ninguna prueba de autoría.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { describeDocument, runStory } from "../src/stories.js";
import { createKernel, sha256Hex } from "../src/kernel.js";
import { documentOf, isToolError, loadFixture, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const DIR = join(ROOT, "test", "fixtures", "stories");
const load = (n: string): any => JSON.parse(readFileSync(join(DIR, n), "utf8"));
const simple = () => load("fluyo-017-1-cliente-kafka-comercio.fluyo.json");
const complex = () => load("fluyo-017-1-qa-complejo.fluyo.json");
const golden2 = (): any => load("fluyo-017-1-qa-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const describeDoc = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await call("describe_document", { document, ...extra }));
const run = async (document: unknown, storyId: number, extra: Record<string, unknown> = {}) => documentOf(await call("run_story", { document, storyId, ...extra }));

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}

/* ═══════════════ 1. Paridad estructural con el editor (fixture complejo) ═══════════════ */

const STORIES: Array<[number, number]> = [[0, 1], [0, 2], [0, 3], [1, 1]];
const RAW = `(function(){
  const d = projectFromProjectData(__a.p).doc; doc = d;
  const page = d.pages[__a.pi], story = page.scenarios.find(s => s.id === __a.id);
  const r = FluyoStory.run(page, story);
  const pb = FluyoStory.start(page, story, 0).playback;
  return {trace: r.trace, stepMeta: pb.stepMeta, outcomes: FluyoStory.outcomes(r.trace, story, page),
          finalAvailability: FluyoStory.finalAvailability(r.trace, page),
          finalNodeStates: FluyoScenarioPlayback.tick(pb, 1e9).nodeStates};
})()`;

describe("paridad compleja: lo que calcula MCP == lo que produjo el editor real (golden)", () => {
  for (const [pi, id] of STORIES) {
    it(`página ${pi} · Historia ${id}: Trace, metadata, resultados y estado final (deepStrictEqual)`, () => {
      const exp = golden2()[`${pi}:${id}`];
      const got = createKernel().call<any>(RAW, { p: complex(), pi, id });
      assert.deepStrictEqual(got.trace, exp.trace, "Trace");
      assert.deepStrictEqual(got.stepMeta, exp.stepMeta, "metadata de Step (motion, efectos, símbolo, nombre)");
      assert.deepStrictEqual(got.outcomes, exp.outcomes, "resultado por Step");
      assert.deepStrictEqual(got.finalAvailability, exp.finalAvailability, "disponibilidad final");
      assert.deepStrictEqual(got.finalNodeStates, exp.finalNodeStates, "estado final del Playback del editor");
    });

    it(`página ${pi} · Historia ${id}: la tool run_story entrega ese mismo Trace, orden, tiempos, códigos y resultados`, async () => {
      const exp = golden2()[`${pi}:${id}`];
      const r = await run(complex(), id, { pageIndex: pi });
      assert.equal(r.executed, true);
      assert.deepStrictEqual(r.trace, exp.trace.events);
      assert.equal(r.traceDigest, `sha256:${sha256Hex(JSON.stringify(exp.trace.events))}`);
      assert.deepStrictEqual(r.steps.map((s: any) => s.stepId), exp.outcomes.map((o: any) => o.stepId), "orden de los Steps");
      assert.deepStrictEqual(r.steps.map((s: any) => s.at), exp.outcomes.map((o: any) => o.at), "tiempos virtuales");
      for (const [i, o] of exp.outcomes.entries()) {
        const s = r.steps[i];
        assert.equal(s.outcome.status, o.status);
        assert.equal(s.outcome.reason, o.reason);
        assert.equal(s.outcome.reasonNode?.id, o.reasonNodeId);
        assert.equal(s.outcome.nodeAvailability, o.nodeAvailability);
        assert.equal(s.outcome.from, o.from);
        assert.equal(s.outcome.to, o.to);
        assert.deepStrictEqual(s.outcome.eventIndexes, o.eventIndexes);
        assert.equal(s.event?.id ?? undefined, o.eventTypeId);
        if (o.eventTypeId !== undefined) assert.equal(s.event.symbol, exp.stepMeta[o.stepId].token);
      }
      assert.deepStrictEqual(Object.fromEntries(r.finalAvailability.map((n: any) => [String(n.id), n.availability])), exp.finalAvailability);
    });
  }

  it("el fixture complejo y su golden son los de Fluyo (con fluyo/ al lado)", { skip: !hayFluyo() && "fluyo/ no está al lado" }, () => {
    for (const n of ["fluyo-017-1-qa-complejo.fluyo.json", "fluyo-017-1-qa-golden.json"]) {
      assert.equal(readFileSync(join(DIR, n), "utf8").replace(/\r\n/g, "\n"), readFileSync(join(fluyoDir(), "test", "fixtures", n), "utf8").replace(/\r\n/g, "\n"), n);
    }
  });

  it("sentido semántico: el relato queda como relato y lo del motor como consecuencia", async () => {
    const r = await run(complex(), 2);
    const byId = Object.fromEntries(r.steps.map((s: any) => [s.stepId, s.outcome]));
    assert.equal(byId[5].status, "narrated");                    // «procesa» con Kafka caído
    assert.equal(byId[5].nodeAvailability, "DOWN");
    assert.equal(byId[3].reason, "source_down");                 // misma hora que la caída; manda el orden del array
    assert.equal(byId[4].reason, "target_down");
    assert.deepEqual(r.finalAvailability.map((n: any) => [n.id, n.availability]), [[1, "UP"], [2, "UP"], [3, "UP"], [4, "UP"]]);
  });
});

function fluyoDir(): string { return join(ROOT, "..", "fluyo"); }
function hayFluyo(): boolean { try { readFileSync(join(fluyoDir(), "js", "model.js")); return true; } catch { return false; } }

/* ═══════════════ 2. Contrato de lectura: ¿qué ve y qué no ve un agente? ═══════════════ */

/** Todo lo que puede aparecer en describe_document. Lo que no esté aquí es una fuga accidental. */
const ALLOWED_KEYS = new Set([
  "readable", "schemaVersion", "sourceSchemaVersion", "engineVersion", "kernelId", "valid", "errorCount", "errors", "currentPageIndex",
  "revision", "code", "message", "scope", "pageIndex", "storyId", "stepId", "entityId", "entityKind", "path", "limit", "reason", "endpoint",
  "capabilities", "readsDocumentVersions", "eventPrimitives", "stepActions", "limits", "maxSteps", "maxTraceEvents", "maxVirtualMs", "maxRuntimeJobs", "maxNodesPerPage", "maxConnectionsPerPage", "coordMax", "sizeMin", "sizeMax", "tools", "authoring",
  "eventTypes", "id", "name", "sentence", "symbol", "primitive", "action", "target", "availability", "motion", "usedBy",
  /* 017.3: dónde se usa un evento y su presentación distinta del defecto (sólo lo que se aparta, sin las ramas crudas) */
  "authoringScopes", "presentation", "usedIn", "usedInTruncated",
  "showSymbol", "symbolSize", "message", "messageColor", "messageSize", "messageWeight", "messageFont", "messagePosition", "highlight", "blink", "dim", "fillColor", "visualDuration", "visualDurationMs",
  "size", "style", "trail", "arrival", "during", "stepIds",
  "pages", "nodes", "label", "shape", "icon", "x", "y", "w", "h", "route", "fromSide", "toSide", "waypoints", "bounds", "minX", "minY", "maxX", "maxY", "connections", "from", "to", "fromLabel", "toLabel", "initialUnavailable",
  "stories", "durationMs", "executable", "stepCount", "moments", "at", "steps", "eventTypeId", "event", "state", "kind", "unmodeled",
]);
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach(x => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
};

describe("describe_document: auditoría de contrato", () => {
  it("un agente responde las 8 preguntas sin recibir el documento crudo", async () => {
    const doc = complex();
    const d = await describeDoc(doc);
    // ¿Qué páginas existen?
    assert.deepEqual(d.pages.map((p: any) => [p.pageIndex, p.name]), [[0, "Pago complejo"], [1, "Segunda página"]]);
    // ¿Qué nodos? ¿Qué conexiones?
    assert.deepEqual(d.pages[0].nodes.map((n: any) => [n.id, n.label, n.availability]), [[1, "Cliente", "UP"], [2, "Kafka", "UP"], [3, "Comercio", "UP"], [4, "Banco", "DOWN"]]);
    assert.deepEqual(d.pages[0].connections.map((c: any) => [c.id, c.fromLabel, c.toLabel]), [[5, "Cliente", "Kafka"], [6, "Kafka", "Comercio"], [7, "Kafka", "Banco"], [8, "Comercio", "Cliente"]]);
    assert.deepEqual(d.pages[0].initialUnavailable, [4]);
    // ¿Qué EventTypes? ¿Qué acción hace cada uno?
    assert.deepEqual(d.eventTypes.map((e: any) => [e.id, e.name, e.action, e.target, e.motion]), [
      [1, "Pago", "SEND", "connection", "slow"], [2, "Procesamiento", "OCCURRENCE", "element", "normal"], [3, "Confirmación", "SEND", "connection", "fast"],
      [4, "Caída", "SET_STATE", "element", "normal"], [5, "Recuperación", "SET_STATE", "element", "normal"], [6, "Notificación", "SEND", "connection", "fast"]]);
    // ¿Qué Historias? ¿Qué hace cada una? ¿Qué usa cada Step? ¿Cuándo ocurre cada acontecimiento?
    assert.deepEqual(d.pages[0].stories.map((s: any) => [s.storyId, s.name, s.stepCount, s.durationMs, s.engineVersion]), [
      [1, "Banco caído desde el inicio", 7, 7000, 2], [2, "Kafka cae y vuelve", 8, 6000, 2], [3, "Historia v1 (sin OCCURRENCE)", 2, 1000, 1]]);
    const s1 = d.pages[0].stories[0];
    assert.deepEqual(s1.moments.map((m: any) => [m.at, m.steps.length]), [[0, 1], [500, 1], [2500, 3], [7000, 2]]);   // simultaneidad visible
    assert.deepEqual(s1.moments[2].steps.map((s: any) => s.stepId), [3, 4, 5]);                                    // orden de resolución
    assert.equal(s1.moments[2].steps[0].sentence, "Kafka notifica a Banco");
    assert.equal(s1.moments[3].steps[1].eventTypeId, null);                                                          // Step legacy sin EventType
    assert.equal(s1.moments[3].steps[1].event, null);
    // La Historia de la 2.ª página repite el id 1 y se distingue por página.
    assert.deepEqual(d.pages[1].stories.map((s: any) => [s.storyId, s.name]), [[1, "Misma id que en la página 1"]]);
  });

  it("no filtra estilo, geometría, las ramas crudas de presentación, estado del editor ni runtime de Playback (la presentación de un evento sólo aparece como diferencias con el defecto)", async () => {
    const d = await describeDoc(complex());
    const extra = [...keysOf(d)].filter(k => !ALLOWED_KEYS.has(k));
    assert.deepEqual(extra, [], `claves fuera del contrato: ${extra.join(", ")}`);
    const text = JSON.stringify(d);
    for (const prohibido of ["nodeEffects", "connectionEffects", "customBg", "theme", "settings", "scPlayback", "activeSends", "cursorVirtual", "undo", "autosave", "localStorage"])
      assert.ok(!text.includes(prohibido), `describe filtra «${prohibido}»`);
  });

  it("es pequeña en documentos grandes (60 páginas × 20 elementos) y crece con el relato, no con el estilo", async () => {
    const doc = simple();
    const page = doc.doc.pages[0];
    for (let i = 0; i < 59; i++) { const p = clone(page); p.name = "Página " + i; doc.doc.pages.push(p); }
    const completo = JSON.stringify(doc).length;
    const compacto = JSON.stringify(await describeDoc(doc, { includeSteps: false })).length;
    assert.ok(compacto < completo * 0.6, `describe(includeSteps:false) ${compacto} vs documento ${completo}`);
    const acotado = JSON.stringify(await describeDoc(doc, { pageIndex: 3 })).length;
    assert.ok(acotado < 6_500, `describe de una página: ${acotado}`);
  });

  it("resume las etiquetas largas (bloques de código) para no desbordar el contexto del agente", async () => {
    const doc = simple();
    doc.doc.pages[0].nodes[0].label = Array.from({ length: 40 }, (_, i) => `const linea${i} = ${i};`).join("\n");
    const d = await describeDoc(doc);
    const label: string = d.pages[0].nodes[0].label;
    assert.ok([...label].length <= 80 && label.endsWith("…") && !label.includes("\n"), label);
    // La frase de los Steps usa la primera línea (misma regla del panel de Historias), no el bloque entero.
    const first = d.pages[0].stories[0].moments[0].steps[0].sentence as string;
    assert.ok(first.length < 120, first);
    const r = await run(doc, 1);
    assert.ok(r.steps[0].target.label.length <= 90);
  });

  it("multipágina, legacy v1 (`state`), sin Historias y con Historias, con EventTypes antiguos", async () => {
    const legacy = { version: 1, app: "fluyo", state: { theme: "dark", nodes: [{ id: 1, label: "A", x: 0, y: 0 }, { id: 2, label: "B", x: 200, y: 0 }], edges: [{ id: 3, from: 1, to: 2 }], nextId: 4 }, settings: {} };
    const d = await describeDoc(legacy);
    assert.equal(d.readable, true);
    assert.equal(d.sourceSchemaVersion, 1);
    assert.equal(d.schemaVersion, 5);
    assert.deepEqual(d.pages[0].connections.map((c: any) => [c.id, c.fromLabel, c.toLabel]), [[3, "A", "B"]]);
    // Un Step sin eventTypeId (histórico) se describe y se ejecuta.
    const old = simple();
    for (const s of old.doc.pages[0].scenarios[0].steps) delete s.eventTypeId;
    const od = await describeDoc(old);
    assert.equal(od.valid, true);
    assert.ok(od.pages[0].stories[0].moments.every((m: any) => m.steps.every((s: any) => s.event === null && s.eventTypeId === null)));
    const r = await run(old, 1);
    assert.deepEqual(r.steps.map((s: any) => s.outcome.status), ["completed", "narrated", "completed"]);
  });

  it("los 8 ejemplos publicados y la salida de create_diagram (v3) se leen sin errores", async () => {
    for (const f of readdirSync(join(ROOT, "test", "fixtures")).filter(n => n.endsWith(".fluyo.json"))) {
      const d = await describeDoc(loadFixture(f));
      assert.equal(d.valid, true, f);
    }
    const created = documentOf(await call("create_diagram", { pageName: "P", nodes: [{ key: "a", shape: "rect", label: "A" }, { key: "b", shape: "rect", label: "B" }], edges: [{ from: "a", to: "b" }] }));
    const d = await describeDoc(created);
    assert.equal(d.sourceSchemaVersion, 3);
    assert.deepEqual(d.pages[0].connections.map((c: any) => [c.fromLabel, c.toLabel]), [["A", "B"]]);
  });
});

/* ═══════════════ 3. run_story: semántica exacta ═══════════════ */

describe("run_story: semántica exacta, sin aceptar «falló» a secas", () => {
  it("Kafka DOWN (B): códigos, orden del Trace y resultado de cada Step", async () => {
    const r = await run(simple(), 2);
    assert.deepStrictEqual(r.trace, [
      { at: 0, type: "state_changed", stepId: 1, nodeId: 2, from: "UP", to: "DOWN" },
      { at: 1000, type: "send_started", stepId: 2, edgeId: 4 },
      { at: 1000, type: "send_failed", stepId: 2, edgeId: 4, reason: "target_down" },
      { at: 2000, type: "event_occurred", stepId: 3, nodeId: 2 },
      { at: 3000, type: "send_started", stepId: 4, edgeId: 5 },
      { at: 3000, type: "send_failed", stepId: 4, edgeId: 5, reason: "source_down" },
    ]);
    assert.deepStrictEqual(r.steps.map((s: any) => [s.stepId, s.outcome.status, s.outcome.reason ?? null, s.outcome.eventIndexes]), [
      [1, "state_changed", null, [0]], [2, "not_completed", "target_down", [1, 2]], [3, "narrated", null, [3]], [4, "not_completed", "source_down", [4, 5]]]);
    assert.deepEqual(r.finalAvailability.map((n: any) => [n.label, n.availability]), [["Cliente", "UP"], ["Kafka", "DOWN"], ["Comercio", "UP"]]);
  });

  it("OCCURRENCE con Kafka DOWN: NO se convierte en «Kafka procesó»; relato y consecuencia quedan separados", async () => {
    const r = await run(simple(), 3);
    const occ = r.steps[1];
    assert.equal(occ.action, "OCCURRENCE");
    assert.equal(occ.sentence, "Kafka procesa el evento");           // lo que dice el relato (frase del autor)
    assert.equal(occ.outcome.status, "narrated");                    // lo que sabe el motor: sólo que se narró
    assert.notEqual(occ.outcome.status, "completed");
    assert.equal(occ.outcome.nodeAvailability, "DOWN");
    assert.equal(occ.outcome.reason, undefined);                     // ni éxito ni fallo inventados
    assert.ok(!JSON.stringify(r).match(/procesó|processed|succeeded.*stepId":2/), "ninguna afirmación de que Kafka procesó");
    assert.ok(r.unmodeled.some((u: string) => /OCCURRENCE.*narrado/.test(u)));
    // Ningún evento de éxito/fallo asociado a ese Step en el Trace.
    assert.deepEqual(r.trace.filter((e: any) => e.stepId === 2).map((e: any) => e.type), ["event_occurred"]);
  });

  it("OCCURRENCE con el elemento UP también es sólo «narrated» (no existe un «éxito» de OCCURRENCE)", async () => {
    const r = await run(simple(), 1);
    assert.equal(r.steps[1].outcome.status, "narrated");
    assert.equal(r.steps[1].outcome.nodeAvailability, "UP");
  });
});

/* ═══════════════ 4. Aislamiento ═══════════════ */

describe("run_story / describe_document: sólo lectura, sin estado residual", () => {
  it("entrada profundamente congelada: ni describe ni run intentan mutarla", () => {
    const doc = deepFreeze(complex());
    assert.doesNotThrow(() => describeDocument({ document: doc }));
    for (const [pi, id] of STORIES) assert.doesNotThrow(() => runStory({ document: doc, pageIndex: pi, storyId: id }));
  });

  it("snapshot antes/después: documento, Historias, Steps, EventTypes, nodos, conexiones y Behaviors intactos", async () => {
    const doc = complex(), before = JSON.stringify(doc);
    const parts = (d: any) => JSON.stringify([d.doc.eventTypes, d.doc.pages.map((p: any) => [p.nodes, p.edges, p.behaviors, p.scenarios, p.nextId, p.nextScenarioId])]);
    const partsBefore = parts(doc);
    await describeDoc(doc); for (const [pi, id] of STORIES) await run(doc, id, { pageIndex: pi });
    assert.equal(JSON.stringify(doc), before);
    assert.equal(parts(doc), partsBefore);
  });

  it("run(A), run(B), run(A): la tercera es idéntica a la primera (y distinta de B)", async () => {
    const doc = complex();
    const a1 = await run(doc, 1), b = await run(doc, 2), a2 = await run(doc, 1);
    assert.deepStrictEqual(a2, a1);
    assert.notDeepEqual(b.trace, a1.trace);
    // También intercalando documentos distintos.
    const s1 = await run(simple(), 2), c = await run(complex(), 2), s2 = await run(simple(), 2);
    assert.deepStrictEqual(s2, s1);
    assert.notDeepEqual(c.trace, s1.trace);
  });

  it("peticiones concurrentes no comparten contexto", async () => {
    const [a, b, c] = await Promise.all([run(complex(), 1), run(complex(), 2), run(complex(), 1)]);
    assert.deepStrictEqual(a, c);
    assert.notDeepEqual(a.trace, b.trace);
  });

  it("MCP no tiene estado entre llamadas: un documento ya ejecutado no deja rastro en el kernel de la siguiente", () => {
    const k1 = createKernel(); k1.call("(function(){ doc = {pages: []}; return 0; })()");
    const k2 = createKernel();
    assert.equal(k2.call("doc.pages.length"), 1);       // el `doc` por defecto de model.js, no el que dejó k1
  });
});

/* ═══════════════ 5. MCP real por stdio ═══════════════ */

describe("servidor real por stdio (node dist/index.js)", () => {
  let client: Client;
  before(async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" });
    client = new Client({ name: "fluyo-017-1-qa", version: "0.0.0" });
    await client.connect(transport);
  });
  after(async () => { await client?.close(); });
  const rpc = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const noStack = (r: unknown) => assert.doesNotMatch(textOf(r), /\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./, "la respuesta no debe exponer una traza interna");

  it("tools/list incluye las dos tools con annotations de sólo lectura", async () => {
    const { tools } = await client.listTools();
    for (const n of ["describe_document", "run_story"]) {
      const t = tools.find(x => x.name === n)!;
      assert.ok(t, n);
      assert.equal(t.annotations?.readOnlyHint, true);
    }
  });

  it("describe_document y run_story responden con JSON válido sobre el documento real", async () => {
    const d = documentOf(await rpc("describe_document", { document: simple() }));
    assert.equal(d.valid, true);
    assert.equal(d.pages[0].stories.length, 3);
    const r = documentOf(await rpc("run_story", { document: simple(), pageIndex: 0, storyId: 2 }));
    assert.equal(r.executed, true);
    assert.equal(r.steps[3].outcome.reason, "source_down");
  });

  it("documento inválido (conexión eliminada): resultado estructurado, no excepción", async () => {
    const doc = simple(); doc.doc.pages[0].edges = doc.doc.pages[0].edges.filter((e: any) => e.id !== 5);
    const rr = await rpc("run_story", { document: doc, storyId: 1 });
    assert.equal(isToolError(rr), false);
    const r = documentOf(rr);
    assert.equal(r.executed, false);
    assert.equal(r.reason, "story_not_executable");
    assert.deepEqual(r.validation.errors.map((e: any) => [e.code, e.storyId, e.stepId, e.entityId]), [["missing_edge", 1, 3, 5], ["missing_edge", 2, 4, 5]]);
    noStack(rr);
  });

  it("engine incompatible: la Historia no se ejecuta y lo dice con su código", async () => {
    const doc = simple(); doc.doc.pages[0].scenarios[0].engineVersion = 3;
    const r = documentOf(await rpc("run_story", { document: doc, storyId: 1 }));
    assert.equal(r.executed, false);
    assert.deepEqual(r.validation.errors.map((e: any) => [e.code, e.scope, e.storyId]), [["unsupported_engine_version", "story", 1]]);
    const d = documentOf(await rpc("describe_document", { document: doc }));
    assert.deepEqual(d.pages[0].stories.map((s: any) => s.executable), [false, true, true]);
  });

  it("schema demasiado nuevo: ilegible, con código estructurado", async () => {
    const doc = simple(); doc.version = 6;
    const d = documentOf(await rpc("describe_document", { document: doc }));
    assert.deepEqual([d.readable, d.errors[0].code], [false, "unsupported_version"]);
    assert.equal(documentOf(await rpc("run_story", { document: doc, storyId: 1 })).reason, "document_unreadable");
  });

  it("Historia inexistente y página inexistente: error de tool legible, sin traza", async () => {
    const a = await rpc("run_story", { document: simple(), storyId: 42 });
    assert.equal(isToolError(a), true);
    assert.match(textOf(a), /storyId=42/);
    noStack(a);
    const b = await rpc("run_story", { document: simple(), storyId: 1, pageIndex: 9 });
    assert.equal(isToolError(b), true);
    assert.match(textOf(b), /pageIndex 9 fuera de rango/);
    noStack(b);
    const c = await rpc("describe_document", { document: simple(), pageIndex: 9 });
    assert.equal(isToolError(c), true);
    noStack(c);
  });

  it("entradas absurdas: el SDK o el servidor explican, nunca devuelven una traza", async () => {
    for (const args of [{ document: "no soy un objeto" }, { document: {}, storyId: "x" }, { document: simple(), storyId: -1 }, { document: simple() }]) {
      let text = "";
      try { const r = await rpc("run_story", args as any); text = textOf(r); } catch (e) { text = String((e as Error).message); }
      assert.doesNotMatch(text, /\n\s+at\s|node:internal/);
    }
    const r = documentOf(await rpc("describe_document", { document: {} }));
    assert.equal(r.readable, false);
  });
});

/* ═══════════════ 6. Compatibilidad ═══════════════ */

describe("compatibilidad con documentos existentes", () => {
  it("v5 con presentation/motion, sin Historias y con varias, y el kernel no pierde ni altera la metadata visual", async () => {
    const doc = complex();
    const meta = createKernel().call<any>(RAW, { p: doc, pi: 0, id: 1 }).stepMeta;
    assert.equal(meta[1].motion, "slow");
    assert.equal(meta[1].connection.arrival, "bounce");
    assert.equal(meta[2].nodeEffects.visualDurationMs, 3000);
    // Sin Historias:
    const sin = clone(doc); for (const p of sin.doc.pages) p.scenarios = [];
    const d = await describeDoc(sin);
    assert.equal(d.valid, true);
    assert.deepEqual(d.pages.flatMap((p: any) => p.stories), []);
    assert.deepEqual(d.eventTypes.map((e: any) => e.usedBy), [0, 0, 0, 0, 0, 0]);
  });

  it("el kernel normaliza igual que el editor: contadores bajos y Behaviors repetidos se canonizan sin error", async () => {
    const doc = simple();
    doc.doc.pages[0].nextId = 1; doc.doc.pages[0].scenarios[0].nextStepId = 1;
    doc.doc.pages[0].behaviors.push({ nodeId: 3, initialState: "DOWN" }, { nodeId: 3, initialState: "UP" });
    const d = await describeDoc(doc);
    assert.equal(d.valid, true);
    assert.equal(d.pages[0].nodes[2].availability, "UP");      // gana el último, como al abrir en el editor
  });
});

/**
 * FLUYO-017.1 — describe_document, run_story, kernel compartido y PARIDAD con el editor.
 *
 * La pregunta de fondo: ¿MCP lee, valida y ejecuta el modelo real de Fluyo sin reimplementarlo?
 * La respuesta se comprueba con tres cosas:
 *
 *   1. El kernel que ejecuta MCP es, byte a byte, el de fluyo/js (hash + comparación con el repo
 *      hermano cuando está al lado).
 *   2. Lo que devuelve MCP para las Historias A/B/C de Cliente → Kafka → Comercio es IDÉNTICO al
 *      golden que Fluyo genera con su camino real de editor (scRun → FluyoStory.start): mismo Trace,
 *      mismo orden, mismos tiempos virtuales, mismos códigos, misma metadata de Step y mismo
 *      resultado por Step. (test/fluyo-017-1.test.cjs en fluyo prueba el otro extremo.)
 *   3. En MCP no hay reglas del motor fuera del kernel copiado.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";

import { KERNEL_FILES, KERNEL_ID } from "../src/generated/kernel-sources.js";
import { createKernel, sha256Hex } from "../src/kernel.js";
import { documentOf, isToolError, loadFixture, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const STORIES_DIR = join(ROOT, "test", "fixtures", "stories");
const FIXTURE_NAME = "fluyo-017-1-cliente-kafka-comercio.fluyo.json";
const fixture = (): any => JSON.parse(readFileSync(join(STORIES_DIR, FIXTURE_NAME), "utf8"));
const golden = (): any => JSON.parse(readFileSync(join(STORIES_DIR, "fluyo-017-1-golden.json"), "utf8"));

const FLUYO_PATH = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO_PATH, "js", "model.js"));
const EXIGE_FLUYO = process.env.REQUIRE_FLUYO === "1";
const skipSinFluyo = !hayFluyo && !EXIGE_FLUYO ? "fluyo/ no está al lado" : false;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const describeDoc = async (document: unknown, extra: Record<string, unknown> = {}) => documentOf(await call("describe_document", { document, ...extra }));
const run = async (document: unknown, storyId: number, extra: Record<string, unknown> = {}) => documentOf(await call("run_story", { document, storyId, ...extra }));

/** Quita una conexión como lo hacen hoy el editor (deleteSel) y MCP (remove_edge): sólo estructura. */
function sinConexion(doc: any, edgeId: number): any {
  doc.doc.pages[0].edges = doc.doc.pages[0].edges.filter((e: any) => e.id !== edgeId);
  return doc;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Kernel compartido
   ═══════════════════════════════════════════════════════════════════════════ */

describe("kernel: copia verbatim de fluyo/js", () => {
  it("cada archivo coincide con su sha256 y el conjunto con KERNEL_ID", () => {
    for (const f of KERNEL_FILES) assert.equal(sha256Hex(f.source), f.sha256, `${f.name}: la fuente no coincide con su hash`);
    assert.equal(sha256Hex(KERNEL_FILES.map(f => `${f.name}:${f.sha256}`).join("\n")), KERNEL_ID);
  });

  it("incluye el dominio y la autoridad de integridad, en orden de carga", () => {
    assert.deepEqual(KERNEL_FILES.map(f => f.name), [
      "config.js", "safe-svg.js", "model.js", "scenario-engine.js", "scenario-playback.js", "story-playback.js", "document-integrity.js", "story-authoring.js",
    ]);
  });

  it("son scripts clásicos: sin import/export de nivel superior (restricción dura de Fluyo)", () => {
    for (const f of KERNEL_FILES) assert.doesNotMatch(f.source, /^\s*(import|export)\s/m, `${f.name} parece un módulo ES`);
  });

  it("cada archivo es idéntico al de fluyo/js (sin tocar una coma)", { skip: skipSinFluyo }, () => {
    for (const f of KERNEL_FILES) {
      const fuente = readFileSync(join(FLUYO_PATH, "js", f.name), "utf8").replace(/\r\n/g, "\n");
      assert.equal(f.source, fuente, `${f.name} se desvió de fluyo/js: ejecuta 'npm run sync:kernel'`);
    }
  });

  it("el fixture y el golden de MCP son los mismos que genera Fluyo", { skip: skipSinFluyo }, () => {
    for (const name of [FIXTURE_NAME, "fluyo-017-1-golden.json"]) {
      assert.equal(
        readFileSync(join(STORIES_DIR, name), "utf8").replace(/\r\n/g, "\n"),
        readFileSync(join(FLUYO_PATH, "test", "fixtures", name), "utf8").replace(/\r\n/g, "\n"),
        `${name} difiere de fluyo/test/fixtures`
      );
    }
  });

  it("cada llamada recibe un contexto nuevo: nada se comparte entre documentos", () => {
    const a = createKernel(), b = createKernel();
    a.call("(function(){ doc = {pages: ['a']}; return 1; })()");
    assert.equal(b.call("typeof doc.pages[0].name"), "string");   // `doc` del kernel b es el de blankPage, no el de a
    assert.equal(a.call("typeof window + typeof document + typeof process + typeof require"), "undefinedundefinedundefinedundefined");
  });

  it("MCP no contiene reglas del motor: nada del engine fuera del kernel copiado", () => {
    const src = join(ROOT, "src");
    const prohibido = /send_failed|send_succeeded|target_down|source_down|runScenario|validateExecution|MAX_TRACE_EVENTS\s*=/;
    const archivos = readdirSync(src).filter(f => f.endsWith(".ts"));
    for (const f of archivos) {
      assert.doesNotMatch(readFileSync(join(src, f), "utf8"), prohibido, `src/${f} contiene lógica del engine`);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. describe_document
   ═══════════════════════════════════════════════════════════════════════════ */

describe("describe_document", () => {
  it("el documento Cliente → Kafka → Comercio: qué hay y qué Historias existen", async () => {
    const result = await call("describe_document", { document: fixture() });
    assert.equal(isToolError(result), false);
    const d = documentOf(result);
    assert.equal(d.readable, true);
    assert.equal(d.schemaVersion, 5);
    assert.equal(d.sourceSchemaVersion, 5);
    assert.equal(d.engineVersion, 2);
    assert.equal(d.kernelId, KERNEL_ID);
    assert.equal(d.valid, true);
    assert.equal(d.capabilities.authoring, true, "desde 017.2 existe author_document (Historias) y desde 017.3 también para eventos");
    assert.deepEqual(d.capabilities.authoringScopes, ["story", "page", "eventType"]);
    assert.deepEqual(d.capabilities.tools, ["describe_document", "run_story", "author_document"]);
    assert.deepEqual(d.capabilities.eventPrimitives, ["FLOW", "OCCURRENCE", "SET_AVAILABILITY"]);

    const p = d.pages[0];
    assert.equal(p.pageIndex, 0);
    assert.deepEqual(p.nodes.map((n: any) => [n.id, n.label, n.shape, n.availability]), [[1, "Cliente", "rect", "UP"], [2, "Kafka", "rect", "UP"], [3, "Comercio", "rect", "UP"]]);
    assert.deepEqual(p.connections.map((c: any) => [c.id, c.from, c.to, c.fromLabel, c.toLabel]), [[4, 1, 2, "Cliente", "Kafka"], [5, 2, 3, "Kafka", "Comercio"]]);
    assert.deepEqual(p.initialUnavailable, []);
    assert.deepEqual(p.stories.map((s: any) => [s.storyId, s.name, s.stepCount, s.durationMs, s.executable]), [
      [1, "Historia A", 3, 2000, true], [2, "Historia B", 4, 3000, true], [3, "Historia C", 2, 1000, true],
    ]);
    // Información suficiente para entender el relato de B: momentos, evento, objetivo y frase.
    const b = p.stories[1];
    assert.deepEqual(b.moments.map((m: any) => m.at), [0, 1000, 2000, 3000]);
    assert.deepEqual(b.moments.map((m: any) => m.steps[0].sentence), [
      "Kafka deja de responder", "Cliente paga a Kafka", "Kafka procesa el evento", "Comercio recibe confirmación de Kafka",
    ]);
    assert.deepEqual(b.moments[0].steps[0], {
      stepId: 1, eventTypeId: 4, event: "Caída", action: "SET_STATE", state: "DOWN",
      target: { kind: "element", id: 2, label: "Kafka" }, sentence: "Kafka deja de responder",
    });
    assert.deepEqual(b.moments[1].steps[0].target, { kind: "connection", id: 4, from: 1, to: 2, label: "Cliente → Kafka" });
  });

  it("EventTypes compartidos: se listan una vez, con su acción, símbolo y cuántos pasos los usan", async () => {
    const d = await describeDoc(fixture());
    assert.deepEqual(d.eventTypes.map((e: any) => [e.id, e.name, e.primitive, e.action, e.target, e.symbol, e.usedBy]), [
      [1, "Pago", "FLOW", "SEND", "connection", "💵", 2],
      [2, "Procesamiento", "OCCURRENCE", "OCCURRENCE", "element", "⚙️", 3],
      [3, "Confirmación", "FLOW", "SEND", "connection", "✅", 2],
      [4, "Caída", "SET_AVAILABILITY", "SET_STATE", "element", "⛔", 2],
    ]);
    assert.equal(d.eventTypes[0].sentence, "{source} paga a {target}");
    assert.equal(d.eventTypes[3].availability, "DOWN");
  });

  it("es compacta: no devuelve el documento (coordenadas, estilos, presentación)", async () => {
    const text = JSON.stringify(await describeDoc(fixture()));
    assert.ok(text.length < 5_000, `describe ocupa ${text.length} caracteres para 3 elementos y 3 Historias`);
    assert.doesNotMatch(text, /"x":|"y":|"color":|presentation|"waypoints"/);
    // El peso de un documento real está en estilos y geometría, no en el relato: con 60 elementos describe es una fracción.
    const grande = fixture();
    const pg = grande.doc.pages[0];
    for (let i = 0; i < 60; i++) pg.nodes.push({ ...pg.nodes[0], id: 100 + i, label: `Servicio ${i}`, x: i * 10, y: i * 5 });
    pg.nextId = 200;
    const completo = JSON.stringify(grande).length, compacto = JSON.stringify(await describeDoc(grande)).length;
    assert.ok(compacto < completo * 0.6, `describe (${compacto}) no es bastante menor que el documento (${completo})`);
  });

  it("includeSteps:false y pageIndex acotan la respuesta", async () => {
    const d = await describeDoc(fixture(), { includeSteps: false, pageIndex: 0 });
    assert.equal(d.pages[0].stories[1].moments, undefined);
    assert.equal(d.pages[0].stories[1].stepCount, 4);
    assert.equal(isToolError(await call("describe_document", { document: fixture(), pageIndex: 3 })), true);
  });

  it("documento vacío: una página sin elementos ni Historias", async () => {
    const vacio = { version: 5, app: "fluyo", doc: { theme: "dark", cur: 0, eventTypes: [], nextEventTypeId: 1, pages: [{ name: "Página 1", nodes: [], edges: [], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 }] }, settings: {} };
    const d = await describeDoc(vacio);
    assert.equal(d.readable, true);
    assert.equal(d.valid, true);
    assert.deepEqual(d.eventTypes, []);
    assert.deepEqual(d.pages, [{ pageIndex: 0, name: "Página 1", nodes: [], connections: [], initialUnavailable: [], stories: [] }]);
  });

  it("documento con una sola Historia", async () => {
    const doc = fixture();
    doc.doc.pages[0].scenarios = [doc.doc.pages[0].scenarios[0]];
    const d = await describeDoc(doc);
    assert.deepEqual(d.pages[0].stories.map((s: any) => s.storyId), [1]);
    assert.deepEqual(d.eventTypes.map((e: any) => e.usedBy), [1, 1, 1, 0]);
  });

  it("documento legacy (v3, generado por la propia MCP / ejemplos publicados): legible, sin Historias", async () => {
    const legacy = loadFixture("kafka-event-pipeline.fluyo.json") as any;
    const d = await describeDoc(legacy);
    assert.equal(d.readable, true);
    assert.equal(d.valid, true);
    assert.equal(d.sourceSchemaVersion, legacy.version);
    assert.equal(d.schemaVersion, 5);
    assert.ok(d.sourceSchemaVersion < 5);
    assert.deepEqual(d.eventTypes, []);
    assert.deepEqual(d.pages.flatMap((p: any) => p.stories), []);
    assert.ok(d.pages[0].nodes.length > 0 && d.pages[0].connections.length > 0);
    assert.ok(d.pages[0].nodes.every((n: any) => n.availability === "UP"));
  });

  it("todos los documentos publicados por Fluyo son legibles y válidos", async () => {
    for (const f of readdirSync(join(ROOT, "test", "fixtures")).filter(n => n.endsWith(".fluyo.json"))) {
      const d = await describeDoc(loadFixture(f));
      assert.equal(d.readable, true, f);
      assert.equal(d.valid, true, `${f}: ${JSON.stringify(d.errors)}`);
    }
  });

  it("la disponibilidad inicial (Behavior) aparece en el nodo y en la página", async () => {
    const doc = fixture();
    doc.doc.pages[0].behaviors.push({ nodeId: 3, initialState: "DOWN" });
    const d = await describeDoc(doc);
    assert.deepEqual(d.pages[0].initialUnavailable, [3]);
    assert.equal(d.pages[0].nodes[2].availability, "DOWN");
  });

  it("un documento con integridad rota se describe igualmente y lo dice con el Step exacto", async () => {
    const d = await describeDoc(sinConexion(fixture(), 5));
    assert.equal(d.readable, true);
    assert.equal(d.valid, false);
    assert.deepEqual(d.errors.map((e: any) => [e.code, e.scope, e.pageIndex, e.storyId, e.stepId, e.entityKind, e.entityId]), [
      ["missing_edge", "step", 0, 1, 3, "edge", 5],
      ["missing_edge", "step", 0, 2, 4, "edge", 5],
    ]);
    assert.deepEqual(d.pages[0].stories.map((s: any) => s.executable), [false, false, true]);
  });

  it("documento ilegible: se informa, no se lanza", async () => {
    const r = await call("describe_document", { document: { version: 5, app: "fluyo", doc: { pages: [{ nodes: [], edges: [] }] , eventTypes: "x" }, settings: {} } });
    assert.equal(isToolError(r), false);
    const d = documentOf(r);
    assert.equal(d.readable, false);
    assert.equal(d.valid, false);
    assert.ok(d.errors.length >= 1);
    assert.equal(d.pages, undefined);
  });

  it("no modifica el documento recibido (original intacto)", async () => {
    const doc = fixture(), antes = JSON.stringify(doc);
    await describeDoc(doc);
    await run(doc, 2);
    assert.equal(JSON.stringify(doc), antes);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. run_story
   ═══════════════════════════════════════════════════════════════════════════ */

describe("run_story", () => {
  it("Historia normal (A): los dos envíos se completan; el Trace es el del motor", async () => {
    const r = await run(fixture(), 1);
    assert.equal(r.executed, true);
    assert.equal(r.engineVersion, 2);
    assert.equal(r.traceEngineVersion, 2);
    assert.equal(r.sourceSchemaVersion, 5);
    assert.equal(r.kernelId, KERNEL_ID);
    assert.equal(r.validation.valid, true);
    assert.deepEqual(r.steps.map((s: any) => [s.stepId, s.at, s.moment, s.outcome.status]), [[1, 0, 0, "completed"], [2, 1000, 1, "narrated"], [3, 2000, 2, "completed"]]);
    assert.deepEqual(r.trace.map((e: any) => [e.at, e.type, e.stepId]), [
      [0, "send_started", 1], [0, "send_succeeded", 1], [1000, "event_occurred", 2], [2000, "send_started", 3], [2000, "send_succeeded", 3],
    ]);
    assert.match(r.traceDigest, /^sha256:[0-9a-f]{64}$/);
  });

  it("Historia con Kafka DOWN (B): el pago no llega, «procesa» queda narrado, la confirmación no sale", async () => {
    const r = await run(fixture(), 2);
    assert.deepEqual(r.steps.map((s: any) => [s.stepId, s.sentence, s.outcome.status, s.outcome.reason, s.outcome.reasonNode?.label]), [
      [1, "Kafka deja de responder", "state_changed", undefined, undefined],
      [2, "Cliente paga a Kafka", "not_completed", "target_down", "Kafka"],
      [3, "Kafka procesa el evento", "narrated", undefined, undefined],
      [4, "Comercio recibe confirmación de Kafka", "not_completed", "source_down", "Kafka"],
    ]);
    assert.deepEqual(r.steps[0].outcome, { status: "state_changed", from: "UP", to: "DOWN", eventIndexes: [0] });
    assert.deepEqual(r.trace.filter((e: any) => e.type === "send_failed").map((e: any) => [e.at, e.reason]), [[1000, "target_down"], [3000, "source_down"]]);
  });

  it("OCCURRENCE sobre Kafka DOWN: narrado, no prueba que Kafka procesara nada", async () => {
    const r = await run(fixture(), 3);
    const occ = r.steps[1];
    assert.equal(occ.sentence, "Kafka procesa el evento");
    assert.equal(occ.outcome.status, "narrated");
    assert.equal(occ.outcome.nodeAvailability, "DOWN");
    assert.match(occ.outcome.note, /no comprueba disponibilidad/);
    // El motor SÍ emitió event_occurred con Kafka caído: esto es lo que el agente no debe leer como «procesó».
    assert.ok(r.trace.some((e: any) => e.type === "event_occurred" && e.nodeId === 2));
    assert.ok(!r.trace.some((e: any) => String(e.type).endsWith("failed")), "MCP no inventó ningún fallo");
    assert.ok(r.unmodeled.some((u: string) => /OCCURRENCE.*narrado/.test(u)));
  });

  it("devuelve la validación del documento junto al resultado", async () => {
    const r = await run(fixture(), 1);
    assert.deepEqual(r.validation, { valid: true, storyExecutable: true, errors: [] });
    assert.equal(r.page.name, "Pago con Kafka");
    assert.deepEqual(r.story, { id: 1, name: "Historia A", engineVersion: 2 });
  });

  it("Historia inválida (conexión eliminada): no hay Trace, sí los errores con Historia y Step", async () => {
    const r = await run(sinConexion(fixture(), 5), 1);
    assert.equal(r.executed, false);
    assert.equal(r.reason, "story_not_executable");
    assert.equal(r.trace, undefined);
    assert.equal(r.steps, undefined);
    assert.equal(r.validation.storyExecutable, false);
    assert.deepEqual(r.validation.errors.filter((e: any) => e.storyId === 1).map((e: any) => [e.code, e.stepId, e.entityId]), [["missing_edge", 3, 5]]);
    assert.match(textOf(await call("run_story", { document: sinConexion(fixture(), 5), storyId: 1 })), /no es válida \(missing_edge\)/);
  });

  it("una Historia sana se ejecuta aunque otra del documento esté rota, y el documento lo dice", async () => {
    const r = await run(sinConexion(fixture(), 5), 3);
    assert.equal(r.executed, true);
    assert.equal(r.validation.valid, false);
    assert.equal(r.validation.storyExecutable, true);
  });

  it("EventType inexistente: la Historia no se entrega ejecutada", async () => {
    const doc = fixture();
    doc.doc.pages[0].scenarios[0].steps[0].eventTypeId = 99;
    const r = await run(doc, 1);
    assert.equal(r.executed, false);
    assert.deepEqual(r.validation.errors.map((e: any) => [e.code, e.storyId, e.stepId, e.entityKind, e.entityId]), [["missing_event_type", 1, 1, "eventType", 99]]);
  });

  it("documento ilegible, Historia inexistente y página inexistente", async () => {
    const roto = await call("run_story", { document: { version: 5, app: "fluyo", doc: { pages: [{ nodes: [], edges: [] }], eventTypes: "x" }, settings: {} }, storyId: 1 });
    assert.equal(isToolError(roto), false);
    assert.equal(documentOf(roto).reason, "document_unreadable");
    const sin = await call("run_story", { document: fixture(), storyId: 42 });
    assert.equal(isToolError(sin), true);
    assert.match(textOf(sin), /storyId=42.*1, 2, 3.*por página/);
    assert.equal(isToolError(await call("run_story", { document: fixture(), storyId: 1, pageIndex: 9 })), true);
  });

  it("los storyId son por página: sin pageIndex usa la página actual del documento", async () => {
    const doc = fixture();
    const otra = JSON.parse(JSON.stringify(doc.doc.pages[0]));
    otra.name = "Otra";
    otra.scenarios = [otra.scenarios[2]];
    doc.doc.pages.push(otra);
    doc.doc.cur = 1;
    const r = await run(doc, 3);
    assert.equal(r.page.pageIndex, 1);
    assert.equal(r.steps.length, 2);
    assert.equal((await run(doc, 3, { pageIndex: 0 })).steps.length, 2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. PARIDAD con el editor de Fluyo
   ═══════════════════════════════════════════════════════════════════════════ */

describe("paridad: el Trace de MCP es idéntico al del editor", () => {
  /** Lo que el kernel de MCP calcula, sin pasar por el formato del contrato. */
  const RAW = `(function(){
    const d = projectFromProjectData(__a.p).doc; doc = d;
    const pg = d.pages[0], sc = pg.scenarios.find(s => s.id === __a.id);
    const r = FluyoStory.run(pg, sc);
    return {trace: r.trace, stepMeta: FluyoStory.stepMeta(sc.steps), outcomes: FluyoStory.outcomes(r.trace, sc, pg)};
  })()`;

  for (const id of [1, 2, 3]) {
    it(`Historia ${["A", "B", "C"][id - 1]}: Trace, metadata de Step y resultado == golden del editor`, () => {
      const got = createKernel().call<any>(RAW, { p: fixture(), id });
      const exp = golden()[id];
      assert.deepEqual(got.trace, exp.trace, "Trace (orden, tiempos virtuales, códigos)");
      assert.deepEqual(got.stepMeta, exp.stepMeta, "metadata de Step");
      assert.deepEqual(got.outcomes, exp.outcomes, "resultado por Step");
    });

    it(`Historia ${["A", "B", "C"][id - 1]}: lo que entrega la tool run_story == golden del editor`, async () => {
      const r = await run(fixture(), id);
      const exp = golden()[id];
      assert.deepEqual(r.trace, exp.trace.events, "Trace");
      assert.equal(r.traceEngineVersion, exp.trace.engineVersion);
      assert.equal(r.traceDigest, `sha256:${sha256Hex(JSON.stringify(exp.trace.events))}`);
      assert.deepEqual(r.steps.map((s: any) => s.stepId), exp.outcomes.map((o: any) => o.stepId));
      for (const [i, o] of exp.outcomes.entries()) {
        const s = r.steps[i];
        assert.equal(s.at, o.at);
        assert.equal(s.action, o.action);
        assert.equal(s.outcome.status, o.status);
        assert.equal(s.outcome.reason, o.reason);
        assert.equal(s.outcome.reasonNode?.id, o.reasonNodeId);
        assert.equal(s.outcome.nodeAvailability, o.nodeAvailability);
        assert.deepEqual(s.outcome.eventIndexes, o.eventIndexes);
        assert.equal(s.event?.id, o.eventTypeId);
        assert.equal(s.event?.symbol, exp.stepMeta[o.stepId].token);
        assert.equal(s.event?.name, exp.stepMeta[o.stepId].name);
      }
    });
  }

  it("el engine que corre MCP es el que corre FLUYO: las fuentes de fluyo/js ejecutadas aparte dan el mismo Trace", { skip: skipSinFluyo }, () => {
    // Camino 1: el repositorio de Fluyo, cargado como lo carga el editor (scripts clásicos en un contexto), con FluyoStory.start.
    const ctx = vm.createContext({});
    for (const n of ["config.js", "safe-svg.js", "model.js", "scenario-engine.js", "scenario-playback.js", "story-playback.js"]) {
      vm.runInContext(readFileSync(join(FLUYO_PATH, "js", n), "utf8"), ctx, { filename: n });
    }
    (ctx as any).__p = JSON.stringify(fixture());
    for (const id of [1, 2, 3]) {
      (ctx as any).__id = id;
      const editor = JSON.parse(vm.runInContext(
        `(function(){ doc = projectFromProjectData(JSON.parse(__p)).doc; const pg = doc.pages[0];
           const sc = pg.scenarios.find(s => s.id === __id); const s = FluyoStory.start(pg, sc, 0);
           return JSON.stringify({trace: s.playback.trace, stepMeta: s.playback.stepMeta}); })()`, ctx));
      // Camino 2: el kernel copiado en MCP.
      const mcp = createKernel().call<any>(RAW_START, { p: fixture(), id });
      assert.deepEqual(mcp.trace, editor.trace, `Trace de la Historia ${id}`);
      assert.deepEqual(mcp.stepMeta, editor.stepMeta, `stepMeta de la Historia ${id}`);
    }
  });
});

/** Igual que el editor: FluyoStory.start (valida, ejecuta y construye Playback). */
const RAW_START = `(function(){ doc = projectFromProjectData(__a.p).doc; const pg = doc.pages[0];
  const sc = pg.scenarios.find(s => s.id === __a.id); const s = FluyoStory.start(pg, sc, 0);
  return {trace: s.playback.trace, stepMeta: s.playback.stepMeta}; })()`;

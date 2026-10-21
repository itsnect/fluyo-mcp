/**
 * FLUYO-018.28 — Autoría de Historias temporalmente coherentes desde el MCP.
 *
 * No añade semántica: fija lo que YA hace el kernel (018.21/018.22) y lo que el contrato tiene que decirle a un agente que
 * solo descubre las tools:
 *   · waitMs = espera narrativa desde el INICIO del momento anterior; NO incluye ni espera el viaje visual del token;
 *   · waitsForArrivalOf = «este momento no empieza hasta que llegue visualmente ese SEND»;
 *   · el patrón correcto (recepción/consecuencia → waitsForArrivalOf) y el error original (waitMs como si fuera la llegada).
 * Reproduce los números con el reloj y el Playback reales de fluyo/ (si está al lado) y comprueba que la API no crece.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument, runStory, UNMODELED } from "../src/stories.js";
import { derefSchema, packageRoot, startHarness, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayFluyo = existsSync(join(FLUYO, "js", "story-clock.js"));
const skipSinFluyo = !hayFluyo && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const author = (document: unknown, operations: unknown[]): any => authorDocument({ document, baseRevision: rev(document), operations });
const ok = (document: unknown, operations: unknown[]): any => { const r = author(document, operations); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r; };
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
const NEW = (name: string) => ({ op: "create_story", scope: "story", pageIndex: 0, name });

/* ───────── Reproducción con el editor real: instante visible de cada paso y qué envíos siguen en vuelo al verse ───────── */
const EDITOR_FILES = ["config.js", "safe-svg.js", "model.js", "scenario-engine.js", "scenario-playback.js", "story-playback.js", "story-clock.js"];
function editorKernel() {
  const ctx = vm.createContext({ TextEncoder, TextDecoder, atob, btoa });
  for (const f of EDITOR_FILES) vm.runInContext(readFileSync(join(FLUYO, "js", f), "utf8"), ctx, { filename: f });
  return (code: string, arg?: unknown): any => {
    (ctx as any).__in = JSON.stringify(arg ?? null);
    return JSON.parse(vm.runInContext(`JSON.stringify((function(){ const __a = JSON.parse(__in); ${code} })())`, ctx));
  };
}
interface Played { steps: Array<{ id: number; action: string; at: number; visible: number; shownAt: number; arrivesAt: number | null; inFlight: Array<{ send: number; arrivesAt: number }> }>; moments: number[] }
function play(document: unknown, storyId = 1): Played {
  return editorKernel()(`const doc = projectFromProjectData(__a.d).doc; const pg = doc.pages[0], sc = pg.scenarios.find(s => s.id === __a.id);
    const st = FluyoStoryClock.start(pg, sc, 0); if (!st.ok) return {errors: st.errors};
    const pb = st.playback, sch = pb.schedule, shown = {}, inFlight = {};
    for (let t = 0; t <= 60000; t++) { const rs = FluyoScenarioPlayback.tick(pb, t);
      for (const e of rs.logEvents) if (shown[e.stepId] === undefined) { shown[e.stepId] = t;
        inFlight[e.stepId] = pb.activeSends.filter(s => s.stepId !== e.stepId).map(s => ({send: s.stepId, arrivesAt: s.startedReal + s.duration})); }
      if (rs.finished) break; }
    return { steps: sc.steps.map(s => ({ id: s.id, action: s.action, at: s.at, visible: sch.byStep[s.id], shownAt: shown[s.id],
        arrivesAt: s.action === "SEND" ? sch.arrivals[s.id] : null, inFlight: inFlight[s.id] || [] })), moments: sch.times };`, { d: document, id: storyId });
}
/* Cuántos ms ANTES de la llegada del envío `send` se ve el paso `id` (0 = no se adelanta). */
const earlyBy = (p: Played, id: number, send: number): number => {
  const s = p.steps.find(x => x.id === id)!, f = s.inFlight.find(x => x.send === send);
  return f ? Math.max(0, f.arrivesAt - s.shownAt) : 0;
};

/* ───────── Documento creado ENTERO por el MCP: A → B → C (+ A → C) y X aparte ───────── */
const BLANK = { version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 1, eventTypes: [],
  pages: [{ name: "P", nodes: [], edges: [], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 }] } };
const DIAGRAM_OPS = [
  { op: "create_node", scope: "page", pageIndex: 0, ref: "A", spec: { shape: "rect", x: 200, y: 300, label: "A" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "B", spec: { shape: "rect", x: 500, y: 300, label: "B" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "C", spec: { shape: "rect", x: 800, y: 300, label: "C" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "X", spec: { shape: "rect", x: 500, y: 520, label: "X" } },
  { op: "create_connection", scope: "page", pageIndex: 0, ref: "AB", source: { ref: "A" }, target: { ref: "B" } },
  { op: "create_connection", scope: "page", pageIndex: 0, ref: "BC", source: { ref: "B" }, target: { ref: "C" } },
  { op: "create_connection", scope: "page", pageIndex: 0, ref: "AC", source: { ref: "A" }, target: { ref: "C" } },
  { op: "create_event_type", scope: "eventType", ref: "send", name: "Petición", primitive: "FLOW", sentence: "{source} envía a {target}", motion: "normal" },
  { op: "create_event_type", scope: "eventType", ref: "recv", name: "Procesa", primitive: "OCCURRENCE", sentence: "{target} procesa" },
  { op: "create_event_type", scope: "eventType", ref: "down", name: "Cae", primitive: "SET_AVAILABILITY", availability: "DOWN", sentence: "{target} cae" },
];
/* ids: nodos 1 A, 2 B, 3 C, 4 X; conexiones 5 A→B, 6 B→C, 7 A→C; eventos 1 Petición (normal = 1100 ms), 2 Procesa, 3 Cae. */
const DIAGRAM = (() => ok(BLANK, DIAGRAM_OPS).document)();
const SEND = (ref: string, edgeId: number, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId: 1, target: { edgeId }, ...extra });
const RECV = (ref: string, nodeId: number, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId: 2, target: { nodeId }, ...extra });
const DOWN = (ref: string, nodeId: number, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId: 3, target: { nodeId }, ...extra });

/* El error original: un agente que solo conoce waitMs y cree que 500 ms «dan tiempo» a que llegue el mensaje. */
const INCORRECT_OPS = [NEW("Incorrecta"), SEND("m1", 5, { waitMs: 0 }), RECV("m2", 2, { waitMs: 500 }), SEND("m3", 6, { waitMs: 500 }), RECV("m4", 3, { waitMs: 500 })];
/* El patrón correcto: los MISMOS waitMs; cada recepción declara el envío que espera. */
const CORRECT_OPS = [NEW("Correcta"), SEND("m1", 5, { waitMs: 0 }), RECV("m2", 2, { waitMs: 500, waitsForArrivalOf: [{ ref: "m1" }] }),
  SEND("m3", 6, { waitMs: 500 }), RECV("m4", 3, { waitMs: 500, waitsForArrivalOf: [{ ref: "m3" }] })];

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

/* ═══════════════ 1. Reproducir el problema y la solución (números reales) ═══════════════ */
describe("018.28 · reproducción con el reloj y el Playback reales", { skip: skipSinFluyo }, () => {
  it("solo waitMs=500: B procesa se ve 600 ms ANTES de que llegue A→B; C procesa 600 ms antes de B→C", () => {
    const p = play(ok(DIAGRAM, INCORRECT_OPS).document);
    assert.deepEqual(p.moments, [0, 500, 1000, 1500]);
    assert.deepEqual(p.steps.map(s => s.arrivesAt), [1100, null, 2100, null], "viaje normal = 1100 ms desde que se ve el envío");
    assert.equal(earlyBy(p, 2, 1), 600);
    assert.equal(earlyBy(p, 4, 3), 600);
    assert.equal(earlyBy(p, 3, 1), 100, "incluso B envía a C se ve con el token de A→B aún en vuelo");
  });

  it("solo waitMs por defecto (1000): sigue adelantado 100 ms (1000 < 1100)", () => {
    const p = play(ok(DIAGRAM, [NEW("Defecto"), SEND("m1", 5), RECV("m2", 2), SEND("m3", 6), RECV("m4", 3)]).document);
    assert.deepEqual(p.moments, [0, 1000, 2000, 3000]);
    assert.equal(earlyBy(p, 2, 1), 100);
    assert.equal(earlyBy(p, 4, 3), 100);
  });

  it("mismos waitMs + waitsForArrivalOf: 0 → 1100 → 1600 → 2700, nada se adelanta y el Trace es idéntico", () => {
    const bad = ok(DIAGRAM, INCORRECT_OPS).document, good = ok(DIAGRAM, CORRECT_OPS).document;
    const p = play(good);
    assert.deepEqual(p.moments, [0, 1100, 1600, 2700]);
    assert.deepEqual(p.steps.map(s => [s.at, s.visible, s.shownAt]), [[0, 0, 0], [500, 1100, 1100], [1000, 1600, 1600], [1500, 2700, 2700]]);
    for (const s of p.steps) assert.deepEqual(s.inFlight.filter(f => f.arrivesAt > s.shownAt), [], `paso ${s.id} con un envío en vuelo`);
    assert.deepEqual((runStory({ document: good, storyId: 1 }) as any).trace, (runStory({ document: bad, storyId: 1 }) as any).trace, "el motor no cambia: solo cambia cuándo se VE");
    const d = (describeDocument({ document: good }) as any).pages[0].stories[0];
    assert.deepEqual(d.moments.map((m: any) => m.waitsFor ?? null), [null, [1], null, [3]]);
  });
});

/* ═══════════════ 4. Casos que el MCP debe poder expresar ═══════════════ */
describe("018.28 · casos A–E", { skip: skipSinFluyo }, () => {
  it("A · cadena: B espera A→B y C espera B→C (es la Historia correcta de arriba)", () => {
    assert.deepEqual(play(ok(DIAGRAM, CORRECT_OPS).document).moments, [0, 1100, 1600, 2700]);
  });

  it("B · evento independiente: X cae a los 500 ms mientras A→B viaja; no se retrasa; B procesa sí espera", () => {
    const p = play(ok(DIAGRAM, [NEW("B"), SEND("a", 5, { waitMs: 0 }), DOWN("x", 4, { waitMs: 500 }), RECV("b", 2, { waitMs: 100, waitsForArrivalOf: [{ ref: "a" }] })]).document);
    assert.deepEqual(p.moments, [0, 500, 1100]);
    assert.equal(p.steps[1].shownAt, 500, "X cae a su hora aunque el token esté en vuelo: no hay dependencia declarada");
  });

  it("C · dos llegadas: A→B (0) y A→C (300); C procesa empieza con la ÚLTIMA (1400)", () => {
    const p = play(ok(DIAGRAM, [NEW("C"), SEND("ab", 5, { waitMs: 0 }), SEND("ac", 7, { waitMs: 300 }), RECV("c", 3, { waitMs: 100, waitsForArrivalOf: [{ ref: "ab" }, { ref: "ac" }] })]).document);
    assert.deepEqual(p.steps.map(s => s.arrivesAt), [1100, 1400, null]);
    assert.deepEqual(p.moments, [0, 300, 1400]);
  });

  it("D · un evento sobre B tras A→B SIN dependencia NO es una recepción: se ve a los 200 ms con el token en vuelo (900 ms antes)", () => {
    const p = play(ok(DIAGRAM, [NEW("D"), SEND("ab", 5, { waitMs: 0 }), RECV("b", 2, { waitMs: 200 })]).document);
    assert.deepEqual(p.moments, [0, 200]);
    assert.equal(earlyBy(p, 2, 1), 900);
  });

  it("E · envío que falla: B cae, A envía a B (send_failed: target_down); el momento que lo espera empieza cuando se ve el fallo (300 + 1100)", () => {
    const doc = ok(DIAGRAM, [NEW("E"), DOWN("down", 2, { waitMs: 0 }), SEND("ab", 5, { waitMs: 300 }), RECV("b", 2, { waitMs: 100, waitsForArrivalOf: [{ ref: "ab" }] })]).document;
    const r = runStory({ document: doc, storyId: 1 }) as any;
    assert.deepEqual(r.steps.map((s: any) => [s.stepId, s.outcome.status, s.outcome.reason ?? null]), [[1, "state_changed", null], [2, "not_completed", "target_down"], [3, "narrated", null]]);
    assert.deepEqual(r.trace.map((e: any) => [e.at, e.type]), [[0, "state_changed"], [300, "send_started"], [300, "send_failed"], [400, "event_occurred"]], "no hay reintento, cola ni entrega posterior");
    assert.deepEqual(play(doc).moments, [0, 300, 1400]);
  });
});

/* ═══════════════ 5. Petición humana real: Kafka cae y vuelve ═══════════════ */
const KAFKA_DIAGRAM_OPS = [
  { op: "create_node", scope: "page", pageIndex: 0, ref: "prod", spec: { shape: "rect", x: 200, y: 300, label: "Productor" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "kafka", spec: { shape: "cylinder", x: 520, y: 300, label: "Kafka" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "cons", spec: { shape: "rect", x: 840, y: 300, label: "Consumidor" } },
  { op: "create_connection", scope: "page", pageIndex: 0, ref: "pk", source: { ref: "prod" }, target: { ref: "kafka" }, spec: { label: "produce" } },
  { op: "create_connection", scope: "page", pageIndex: 0, ref: "kc", source: { ref: "kafka" }, target: { ref: "cons" }, spec: { label: "consume" } },
  { op: "create_event_type", scope: "eventType", ref: "pub", name: "Publica", primitive: "FLOW", sentence: "{source} publica en {target}", motion: "normal" },
  { op: "create_event_type", scope: "eventType", ref: "deliver", name: "Entrega", primitive: "FLOW", sentence: "{source} entrega a {target}", motion: "normal" },
  { op: "create_event_type", scope: "eventType", ref: "proc", name: "Procesa", primitive: "OCCURRENCE", sentence: "{target} procesa el mensaje" },
  { op: "create_event_type", scope: "eventType", ref: "down", name: "Cae", primitive: "SET_AVAILABILITY", availability: "DOWN", sentence: "{target} deja de estar disponible" },
  { op: "create_event_type", scope: "eventType", ref: "up", name: "Vuelve", primitive: "SET_AVAILABILITY", availability: "UP", sentence: "{target} vuelve a estar disponible" },
];
/* ids: nodos 1 Productor, 2 Kafka, 3 Consumidor; conexiones 4 produce, 5 consume; eventos 1 Publica, 2 Entrega, 3 Procesa, 4 Cae, 5 Vuelve. */
const A = (ref: string, eventTypeId: number, target: unknown, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId, target, ...extra });
/* «Un productor envía a Kafka, Kafka cae, deja de recibir, vuelve y el flujo continúa». Lo que un agente escribiría con el contrato actual. */
const KAFKA_STORY_OPS = [NEW("Kafka cae y vuelve"),
  A("pub1", 1, { edgeId: 4 }, { waitMs: 0 }),                                                   // M1 Productor publica (msg 1)
  A("proc1", 3, { nodeId: 2 }, { waitMs: 500, waitsForArrivalOf: [{ ref: "pub1" }] }),        // M2 Kafka procesa: cuando LLEGA msg 1
  A("del1", 2, { edgeId: 5 }, { placement: { sameMomentAs: { ref: "proc1" } } }),              // M2 …y entrega al consumidor (mismo momento)
  A("cons1", 3, { nodeId: 3 }, { waitMs: 500, waitsForArrivalOf: [{ ref: "del1" }] }),        // M3 Consumidor procesa: cuando LLEGA la entrega
  A("down", 4, { nodeId: 2 }, { waitMs: 800 }),                                                // M4 Kafka cae (no depende de ninguna llegada)
  A("pub2", 1, { edgeId: 4 }, { waitMs: 500 }),                                                // M5 Productor publica (msg 2): el motor lo marca fallido
  A("up", 5, { nodeId: 2 }, { waitMs: 1500 }),                                                 // M6 Kafka vuelve (decisión del autor, no del motor)
  A("pub3", 1, { edgeId: 4 }, { waitMs: 500 }),                                                // M7 Productor publica (msg 3)
  A("proc3", 3, { nodeId: 2 }, { waitMs: 500, waitsForArrivalOf: [{ ref: "pub3" }] }),        // M8 Kafka procesa: cuando LLEGA msg 3
  A("del3", 2, { edgeId: 5 }, { placement: { sameMomentAs: { ref: "proc3" } } }),              // M8 …y entrega
  A("cons3", 3, { nodeId: 3 }, { waitMs: 500, waitsForArrivalOf: [{ ref: "del3" }] }),        // M9 Consumidor procesa: cuando LLEGA la entrega
];

describe("018.28 · fixture de agente: Kafka cae y vuelve", () => {
  const KD = (() => ok(BLANK, KAFKA_DIAGRAM_OPS).document)();

  it("el lote se acepta sin avisos; el motor marca fallido el envío con Kafka caída y no inventa reintentos ni entregas posteriores", () => {
    const r = ok(KD, KAFKA_STORY_OPS);
    assert.equal(r.warnings, undefined, JSON.stringify(r.warnings));
    const run = runStory({ document: r.document, storyId: 1 }) as any;
    assert.deepEqual(run.steps.map((s: any) => [s.stepId, s.outcome.status, s.outcome.reason ?? null]), [
      [1, "completed", null], [2, "narrated", null], [3, "completed", null], [4, "narrated", null], [5, "state_changed", null],
      [6, "not_completed", "target_down"], [7, "state_changed", null], [8, "completed", null], [9, "narrated", null], [10, "completed", null], [11, "narrated", null]]);
    assert.equal(run.trace.filter((e: any) => e.stepId === 6).length, 2, "send_started + send_failed; nada más para el msg 2");
    const story = (describeDocument({ document: r.document }) as any).pages[0].stories[0];
    assert.deepEqual(story.arrivalDependencies, [{ stepId: 2, waitsForArrivalOf: [1] }, { stepId: 4, waitsForArrivalOf: [3] }, { stepId: 9, waitsForArrivalOf: [8] }, { stepId: 11, waitsForArrivalOf: [10] }]);
    assert.deepEqual(story.moments.map((m: any) => [m.at, m.waitsFor ?? null]), [[0, null], [500, [1]], [1000, [3]], [1800, null], [2300, null], [3800, null], [4300, null], [4800, [8]], [5300, [10]]]);
    assert.match(r.editorUrl, /#d=/);
  });

  it("se reproduce en Fluyo sin que ninguna recepción se adelante a su envío; lo independiente conserva su ritmo", { skip: skipSinFluyo }, () => {
    const p = play(ok(KD, KAFKA_STORY_OPS).document);
    assert.deepEqual(p.moments, [0, 1100, 2200, 3000, 3500, 5000, 5500, 6600, 7700]);
    for (const [step, send] of [[2, 1], [4, 3], [9, 8], [11, 10]]) assert.equal(earlyBy(p, step, send), 0, `paso ${step} antes de ${send}`);
    // El msg 2 falla: el token viaja y el fallo se ve en Kafka 1100 ms después (3500 + 1100); nadie lo espera y nada lo reintenta.
    assert.equal(p.steps[5].arrivesAt, 4600);
  });
});

/* ═══════════════ 2. Lo que un agente lee al descubrir las tools ═══════════════ */
describe("018.28 · contrato: lo que ve un agente en tools/list, describe_document y README", () => {
  /* CATALOG-COMPACTION-001: Wait (waitMs) es un $ref a las definitions; lo que lee el agente es la definición, una vez. */
  const schemaOf = async (name: string) => { const t = (await h.client.listTools()).tools.find(t => t.name === name)!; return { ...t, inputSchema: derefSchema(t.inputSchema) }; };
  const variants = (tool: any): any[] => { const items = tool.inputSchema.properties.operations.items; return items.anyOf ?? items.oneOf ?? []; };
  const opSchema = (tool: any, op: string): any => variants(tool).find(v => v.properties?.op?.const === op || v.properties?.op?.enum?.[0] === op);

  it("waitMs (add_step y set_wait) dice que se cuenta desde el INICIO del momento anterior y que NO espera al token", async () => {
    const tool = await schemaOf("author_document");
    for (const op of ["add_step", "set_wait"]) {
      const d: string = opSchema(tool, op).properties.waitMs.description ?? "";
      assert.match(d, /inicio del momento anterior/i, `${op}.waitMs`);
      assert.match(d, /no (incluye|espera)[^.]*(token|viaje)/i, `${op}.waitMs: debe negar que incluya el viaje`);
      assert.match(d, /waitsForArrivalOf|set_arrival_dependencies/, `${op}.waitMs: debe remitir a la dependencia`);
    }
  });

  it("waitsForArrivalOf dice cuándo usarlo (recepción/consecuencia de un envío) y que un paso sobre el nodo destino no es una recepción", async () => {
    const tool = await schemaOf("author_document");
    const d: string = opSchema(tool, "add_step").properties.waitsForArrivalOf.description ?? "";
    assert.match(d, /no empieza[^.]*hasta que llegue/i);
    assert.match(d, /recepci|consecuencia/i);
    assert.match(d, /waitMs[^.]*no[^.]*(espera|incluye)/i);
    assert.match(d, /nodo destino[^.]*(no|aunque)/i);
    assert.match(d, /nunca se infiere/i);
  });

  it("author_document explica el patrón A→B→C, el error original y que la duración del viaje es presentación (sin calcular esperas)", async () => {
    const d = (await schemaOf("author_document")).description ?? "";
    assert.match(d, /waitMs[^.]*inicio del momento anterior/i);
    assert.match(d, /no incluye[^.]*viaje/i);
    assert.match(d, /PATR[ÓO]N/);
    assert.match(d, /nodo destino[^.]*no es una recepci/i);
    assert.match(d, /no lo uses para calcular/i);
    // Las duraciones citadas son las del kernel (presentación): si cambian, esta frase miente y el test lo dice.
    const ms = createKernel().call<Record<string, number>>("FluyoScenarioPlayback.MOTION_MS");
    assert.ok(d.includes(`${ms.fast}/${ms.normal}/${ms.slow}`), `la descripción debe citar ${ms.fast}/${ms.normal}/${ms.slow} ms`);
    assert.match(d, /env[íi]o fallido[^.]*(fallo|llega)/i, "un SEND fallido también «llega» (se ve el fallo en el destino)");
  });

  it("describe_document.unmodeled: sin dependencia, waitMs no espera al token y un paso sobre el nodo destino no es una recepción", () => {
    assert.ok(UNMODELED.some(u => /dependencias de llegada/.test(u) && /Trace/.test(u) && /waitMs/.test(u) && /nodo destino/.test(u)), JSON.stringify(UNMODELED));
    const d = describeDocument({ document: BLANK }) as any;
    assert.deepEqual(d.unmodeled, UNMODELED);
  });

  it("README: el patrón, el error original y el ejemplo A→B→C (incorrecto vs correcto)", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /`waitMs`[^\n]*inicio del momento anterior/i);
    assert.match(readme, /no incluye[^\n]*viaje/i);
    assert.match(readme, /Incorrecto[\s\S]*Correcto/);
    assert.match(readme, /"waitsForArrivalOf":\s*\[\{"ref":"m1"\}\]/);
    assert.match(readme, /nodo destino[^\n]*no es una recepci/i);
  });

  it("los dos lotes del README se ejecutan tal cual sobre el diagrama A→B→C y dan los instantes que el README anuncia", { skip: skipSinFluyo }, () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("Incorrecto —el error habitual"), readme.indexOf("- **B2**"));
    const batches = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
    assert.equal(batches.length, 2);
    assert.deepEqual(play(ok(DIAGRAM, batches[0]).document).moments, [0, 500, 1000, 1500]);
    assert.deepEqual(play(ok(DIAGRAM, batches[1]).document).moments, [0, 1100, 1600, 2700]);
  });
});

/* ═══════════════ 3. La API no crece y la semántica no cambia ═══════════════ */
describe("018.28 · sin API nueva, misma semántica", () => {
  it("add_step y set_wait publican exactamente las claves de siempre; no existe arrivalMs/latency/dependsOn/after/causedBy", async () => {
    const tool = (await h.client.listTools()).tools.find(t => t.name === "author_document")!;
    const keys = (op: string) => Object.keys((variants(tool).find((v: any) => v.properties?.op?.const === op || v.properties?.op?.enum?.[0] === op)).properties).sort();
    assert.deepEqual(keys("add_step"), ["eventTypeId", "op", "pageIndex", "placement", "ref", "scope", "storyId", "target", "waitMs", "waitsForArrivalOf"]);
    assert.deepEqual(keys("set_wait"), ["op", "pageIndex", "scope", "stepId", "storyId", "waitMs"]);
    assert.deepEqual(keys("set_arrival_dependencies"), ["op", "pageIndex", "scope", "stepId", "storyId", "waitsForArrivalOf"]);
    const json = JSON.stringify(tool.inputSchema);
    // (`after` ya existe en move_step {sameMomentAs, after}: no es nuevo)
    for (const bad of ["arrivalMs", "latency", "dependsOn", "causedBy", "arrivalEvent"]) assert.equal(json.includes(bad), false, bad);
  });
  function variants(tool: any): any[] { const items = tool.inputSchema.properties.operations.items; return items.anyOf ?? items.oneOf ?? []; }

  it("waitMs sigue siendo narrativo: por defecto 1000 (el primero 0); set_wait cuenta desde el momento anterior y desplaza los posteriores", () => {
    const doc = ok(DIAGRAM, [NEW("W"), SEND("m1", 5), RECV("m2", 2), SEND("m3", 6, { waitMs: 250 })]).document;
    const ats = (d: any) => d.doc.pages[0].scenarios[0].steps.map((s: any) => s.at);
    assert.deepEqual(ats(doc), [0, 1000, 1250]);
    assert.deepEqual(ats(ok(doc, [S("set_wait", { stepId: 2, waitMs: 1500 })]).document), [0, 1500, 1750]);
  });
});

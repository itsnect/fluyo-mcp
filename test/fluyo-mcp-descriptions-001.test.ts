/**
 * FLUYO-MCP-DESCRIPTIONS-001 — compactación de las descriptions del catálogo (variante V3R-ops de FLUYO-MCP-DESCRIPTIONS-001.md).
 * Solo cambia TEXTO: el contrato funcional (schemas, nombres, operaciones, respuestas) es el de 2672fe6.
 *
 *   T1. Tamaño: tools/list ≤ 55 000 B (54 672 al publicarse; < 63 000 y < 72 000).
 *   T2. Contrato: el catálogo SIN claves `description` es idéntico, tool a tool, al de 2672fe6 (golden mcp-descriptions-001-schema.json).
 *   T3. Orden: las reglas imprescindibles de author_document EMPIEZAN en sus primeros 2 048 caracteres (hay clientes que truncan); la
 *       lista de operaciones va al final y nombra TODAS las operaciones del oneOf, con su alcance.
 *   T4. Sin ruido: ninguna description cita un id de tarea («FLUYO-0xx»).
 *   T5. Las cuatro aclaraciones nuevas describen lo que YA hace el kernel: waitMs 0 = mismo momento; solo se espera a un SEND (un paso
 *       de elemento no); {target} de un evento de elemento es el elemento ({source}, «Origen»); create_diagram nace sin eventos ni
 *       Historias; y, con el reproductor real de fluyo/ (si está al lado), un retraso por llegada desplaza también los momentos siguientes.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument, runStory } from "../src/stories.js";
import { FIXTURES_DIR, packageRoot, startHarness, textBlocks, type Harness } from "./helpers.js";

const FLUYO = resolve(packageRoot(), process.env.FLUYO_PATH ?? join("..", "fluyo"));
const skipSinFluyo = !existsSync(join(FLUYO, "js", "story-clock.js")) && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

const stripDescriptions = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stripDescriptions)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "description").map(([k, x]) => [k, stripDescriptions(x)]))
    : v;
const authorTool = async () => (await h.client.listTools()).tools.find(t => t.name === "author_document")!;

describe("T1 · tamaño de tools/list", () => {
  it("≤ 55 000 B (la ganancia no se diluye en silencio), bajo la guarda de 63 000 y el tope de 72 000", async () => {
    const bytes = Buffer.byteLength(JSON.stringify(await h.client.listTools()));
    assert.ok(bytes <= 55_000, `tools/list = ${bytes} B`);
    assert.ok(bytes <= 63_000 && bytes < 72_000);
  });
});

describe("T2 · el contrato funcional no cambia", () => {
  it("sin descriptions, cada tool publicada es idéntica a la de 2672fe6", async () => {
    const golden = JSON.parse(readFileSync(join(FIXTURES_DIR, "mcp-descriptions-001-schema.json"), "utf8")) as Array<{ name: string }>;
    /* La forma que viaja (JSON): el cliente rellena claves con undefined, p. ej. _meta, que no se publican. */
    const now = stripDescriptions(JSON.parse(JSON.stringify((await h.client.listTools()).tools))) as Array<{ name: string }>;
    assert.deepEqual(now.map(t => t.name), golden.map(t => t.name));
    for (const [i, t] of now.entries()) assert.deepEqual(t, golden[i], t.name);
  });
});

describe("T3 · lo imprescindible de author_document cabe en los primeros 2 048 caracteres", () => {
  const RULES: Array<[string, RegExp]> = [
    ["baseRevision: de dónde sale", /CLAVE: baseRevision = la revisión de ESTE documento/],
    ["editorUrl: dárselo al usuario y encadenarlo", /editorUrl: el enlace fluyo\.space\/#d=… del resultado; dáselo al usuario y pásalo como 'document'/],
    ["run_story después", /run_story para ver el Trace/],
    ["ref del lote", /LOTE: 'ref' nombra algo creado en el lote/],
    ["estado final / REFERENCED_ENTITY", /Se evalúa el ESTADO FINAL[^.]*REFERENCED_ENTITY/],
    ["primitivas de los eventos", /primitive FLOW = conexión, OCCURRENCE = elemento, SET_AVAILABILITY/],
    ["reverse: la misma conexión, sin dibujar la inversa", /reverse:true\} recorre la conexión de to a from: la respuesta va por la MISMA conexión, no dibujes la inversa/],
    ["waitMs 0 = mismo momento", /waitMs 0 = el mismo momento que el anterior/],
    ["waitMs desde el INICIO del momento anterior", /waitMs se cuenta desde el INICIO del momento anterior/],
    ["PATRÓN de waitsForArrivalOf", /PATRÓN: todo paso que narre la recepción/],
  ];
  it("cada regla empieza antes del carácter 2 048", async () => {
    const d = (await authorTool()).description!;
    for (const [name, re] of RULES) {
      const at = d.search(re);
      assert.ok(at >= 0, `falta: ${name}`);
      assert.ok(at < 2048, `${name} empieza en el carácter ${at}`);
    }
  });
  it("la lista de operaciones va al final y nombra todas las del oneOf, con su alcance", async () => {
    const t = await authorTool();
    const d = t.description!, list = d.slice(d.indexOf("Operaciones: "));
    assert.ok(d.indexOf("Operaciones: ") > d.search(/DIAGRAMA: colores SOLO en HEX/), "la lista no va al final");
    const variants = (t.inputSchema as any).properties.operations.items.oneOf as any[];
    for (const v of variants) {
      const op = v.properties.op.const, scope = v.properties.scope.const;
      assert.match(list, new RegExp(`\\b${op}\\b`), `la lista no nombra ${op}`);
      const group = list.slice(list.indexOf(op)).match(/\(alcance '(\w+)'/)?.[1];
      assert.equal(group, scope, `${op} aparece en el grupo de alcance «${group}», no «${scope}»`);
    }
  });
});

describe("T4 · sin ids de tarea en las descriptions", () => {
  it("ninguna description (de tool o de parámetro) cita «FLUYO-0xx»", async () => {
    const text = JSON.stringify((await h.client.listTools()).tools);
    assert.equal(/FLUYO-\d/.test(text), false, text.match(/.{60}FLUYO-\d.{40}/)?.[0]);
  });
});

/* ───────── T5 · las aclaraciones describen lo que ya hace el kernel ───────── */
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const author = (document: unknown, operations: unknown[]): any => authorDocument({ document, baseRevision: rev(document), operations });
const ok = (document: unknown, operations: unknown[]): any => { const r = author(document, operations); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r; };
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
const BLANK = { version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 1, eventTypes: [],
  pages: [{ name: "P", nodes: [], edges: [], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 }] } };
/* ids: nodos 1 A, 2 B; conexión 3 A→B; eventos 1 Envía (FLOW, normal = 1100 ms), 2 Valida ({target}), 3 Origen ({source}). */
const DOC = ok(BLANK, [
  { op: "create_node", scope: "page", pageIndex: 0, ref: "A", spec: { shape: "rect", x: 200, y: 300, label: "A" } },
  { op: "create_node", scope: "page", pageIndex: 0, ref: "B", spec: { shape: "rect", x: 500, y: 300, label: "B" } },
  { op: "create_connection", scope: "page", pageIndex: 0, source: { ref: "A" }, target: { ref: "B" } },
  { op: "create_event_type", scope: "eventType", name: "Envía", primitive: "FLOW", sentence: "{source} envía a {target}", motion: "normal" },
  { op: "create_event_type", scope: "eventType", name: "Valida", primitive: "OCCURRENCE", sentence: "{target} valida" },
  { op: "create_event_type", scope: "eventType", name: "Origen", primitive: "OCCURRENCE", sentence: "{source} valida" },
  { op: "create_story", scope: "story", pageIndex: 0, name: "H" },
]).document;
const SEND = (ref: string, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId: 1, target: { edgeId: 3 }, ...extra });
const ON = (ref: string, eventTypeId: number, nodeId: number, extra: Record<string, unknown> = {}) => S("add_step", { ref, eventTypeId, target: { nodeId }, ...extra });
const moments = (doc: unknown) => (describeDocument({ document: doc }) as any).pages[0].stories[0].moments.map((m: any) => m.steps.map((s: any) => s.stepId));

describe("T5 · las aclaraciones nuevas son el comportamiento actual", () => {
  it("waitMs 0 = el mismo momento que el anterior; y ese momento no puede esperar al envío con el que lo comparte", () => {
    assert.deepEqual(moments(ok(DOC, [SEND("s1"), SEND("s2", { waitMs: 0 })]).document), [[1, 2]]);
    assert.deepEqual(moments(ok(DOC, [SEND("s1"), SEND("s2", { waitMs: 1 })]).document), [[1], [2]]);
    const r = author(DOC, [SEND("s1"), ON("v", 2, 2, { waitMs: 0, waitsForArrivalOf: [{ ref: "s1" }] })]);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, "INVALID_ARRIVAL_DEPENDENCY", JSON.stringify(r.errors));
  });
  it("solo se espera a pasos SEND: un paso de elemento no llega a ningún sitio", () => {
    const r = author(DOC, [SEND("s1"), ON("v", 2, 2, { waitMs: 300, waitsForArrivalOf: [{ ref: "s1" }] }), SEND("s2", { waitsForArrivalOf: [{ ref: "v" }] })]);
    assert.equal(r.ok, false);
    assert.equal(r.errors[0].code, "INVALID_ARRIVAL_DEPENDENCY", JSON.stringify(r.errors));
    ok(DOC, [SEND("s1"), ON("v", 2, 2, { waitMs: 300, waitsForArrivalOf: [{ ref: "s1" }] }), SEND("s2", { waitMs: 1000 })]);
  });
  it("en un evento de elemento {target} es el elemento ({source} no tiene a quién nombrar)", () => {
    const doc = ok(DOC, [ON("v", 2, 2), ON("o", 3, 2)]).document;
    const run = runStory({ document: doc, storyId: 1 }) as any;
    assert.deepEqual(run.steps.map((s: any) => s.sentence), ["B valida", "Origen valida"]);
  });
  it("create_diagram nace sin eventos ni Historias", async () => {
    const r = await h.client.callTool({ name: "create_diagram", arguments: { nodes: [{ key: "a", shape: "rect" }, { key: "b", shape: "rect" }], edges: [{ from: "a", to: "b" }] } });
    const d = describeDocument({ document: JSON.parse(textBlocks(r)[1]) }) as any;
    assert.deepEqual(d.eventTypes, []);
    assert.deepEqual(d.pages[0].stories, []);
  });
  it("con el reproductor del editor, un retraso por llegada desplaza también el momento siguiente (sin dependencia)", { skip: skipSinFluyo }, () => {
    /* s1 A→B sale en 0 y llega en 1100; v (B valida) espera su llegada; w (A valida) va 500 ms después, sin dependencia. */
    const doc = ok(DOC, [SEND("s1"), ON("v", 2, 2, { waitMs: 300, waitsForArrivalOf: [{ ref: "s1" }] }), ON("w", 2, 1, { waitMs: 500 })]).document;
    const ctx = vm.createContext({ TextEncoder, TextDecoder, atob, btoa });
    for (const f of ["config.js", "safe-svg.js", "model.js", "scenario-engine.js", "scenario-playback.js", "story-playback.js", "story-clock.js"])
      vm.runInContext(readFileSync(join(FLUYO, "js", f), "utf8"), ctx, { filename: f });
    (ctx as any).__in = JSON.stringify(doc);
    const shown = JSON.parse(vm.runInContext(`JSON.stringify((function(){
      const pg = projectFromProjectData(JSON.parse(__in)).doc.pages[0], st = FluyoStoryClock.start(pg, pg.scenarios[0], 0), shown = {};
      for (let t = 0; t <= 10000; t++) { const rs = FluyoScenarioPlayback.tick(st.playback, t); for (const e of rs.logEvents) if (shown[e.stepId] === undefined) shown[e.stepId] = t; if (rs.finished) break; }
      return shown; })())`, ctx));
    assert.deepEqual(shown, { 1: 0, 2: 1100, 3: 1600 }, "w se ve 500 ms después de v, no en su hora nominal (800)");
  });
});

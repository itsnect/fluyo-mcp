/**
 * FLUYO-PRODUCT-NARRATION-001 — `message` en CUALQUIER paso, también en un envío (contrato de fluyo, decisión 258) en el MCP.
 *
 * Extiende STEP-MESSAGE-001 (decisión 255): la misma clave y las mismas operaciones (`add_step {message}`, `set_step_message`) valen
 * ahora en un paso FLOW. Al reproducir en Fluyo es el título del momento en vez del nombre del evento. Toda la regla es del kernel
 * (model.js, scenario-engine.js, story-authoring.js, story-playback.js); el MCP solo cambia textos: la description de add_step.message,
 * la mención en describe_document y el README. Sin operaciones nuevas ni campos nuevos: el schema publicado (sin descriptions) es el de
 * 731be50.
 *
 * Se fija:
 *   · kernel = fluyo PRODUCT-NARRATION-001 (el motor filtra la clave en cualquier acción; momentText);
 *   · schema y catálogo: la forma no cambia; la description dice «también FLOW»; tools/list sigue bajo la guarda de DESCRIPTIONS-001;
 *   · autoría por tools/call en FLOW: add_step (al final, al revés), set_step_message (fijar, cambiar, null, changed:false);
 *   · describe_document y run_story: el message de un envío detrás de sentence; event.name y frase los del evento; Trace idéntico;
 *   · caso real: Cliente → API → Pagos → PSP → Base de datos narrado con 2 eventos en un solo author_document.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { KERNEL_FILES } from "../src/generated/kernel-sources.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument, runStory } from "../src/stories.js";
import { documentOf, isToolError, startHarness, textOf, type Harness } from "./helpers.js";

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
const ok = (document: unknown, operations: unknown[]): any => {
  const r: any = authorDocument({ document, baseRevision: rev(document), operations });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};
const steps = (doc: any, storyId = 1) => doc.doc.pages[0].scenarios.find((s: any) => s.id === storyId).steps;
const step = (doc: any, id: number) => steps(doc).find((s: any) => s.id === id);

/* ───────── Caso real: 1 Cliente · 2 API Checkout · 3 Pagos · 4 PSP · 5 Base de datos; 6 C→A · 7 A→P · 8 P→PSP · 9 P→DB ───────── */
const rect = (id: number, label: string) => ({ id, shape: "rect", x: id * 250, y: 300, w: 170, h: 64, label });
const edge = (id: number, from: number, to: number) => ({ id, from, to, route: "straight", fromSide: null, toSide: null, waypoints: [] });
const CASE: Array<[string, number, string, boolean?]> = [["SEND", 6, "Cliente solicita el checkout del carrito"], ["OCCURRENCE", 2, "Checkout valida la sesión del cliente"],
  ["SEND", 7, "Checkout pide a Pagos cobrar $49"], ["SEND", 8, "Pagos cobra la tarjeta en el PSP"], ["SEND", 8, "El PSP confirma el pago", true], ["SEND", 9, "El pedido queda confirmado y pagado"]];
const EMPTY = () => ({ version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 3,
  eventTypes: [{ id: 1, name: "Petición", primitive: "FLOW", sentenceTemplate: "{source} envía a {target}", visual: { kind: "token", value: "●" }, motion: "normal" },
    { id: 2, name: "Comprobación", primitive: "OCCURRENCE", sentenceTemplate: "{target} comprueba", visual: { kind: "token", value: "✓" } }],
  pages: [{ name: "Checkout", nextId: 100, behaviors: [], nextScenarioId: 2,
    nodes: [rect(1, "Cliente (web)"), rect(2, "API Checkout"), rect(3, "Servicio Pagos"), rect(4, "PSP (Stripe)"), rect(5, "Base de datos")],
    edges: [edge(6, 1, 2), edge(7, 2, 3), edge(8, 3, 4), edge(9, 3, 5)],
    scenarios: [{ id: 1, engineVersion: 2, name: "Pago con tarjeta", nextStepId: 1, steps: [] }] }] } });
const addOps = (withMessage: boolean) => CASE.map(([a, t, s, r], i) => S("add_step", { eventTypeId: a === "SEND" ? 1 : 2,
  target: a === "SEND" ? { edgeId: t, ...(r ? { reverse: true } : {}) } : { nodeId: t }, ...(i ? { waitMs: 1600 } : {}), ...(withMessage ? { message: s } : {}) }));
const NARRATED = () => ok(EMPTY(), addOps(true)).document;
const BEFORE = () => ok(EMPTY(), addOps(false)).document;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const authorTool = async (document: unknown, operations: unknown[]) => call("author_document", { document, baseRevision: rev(document), operations });

describe("PRODUCT-NARRATION-001 · kernel", () => {
  it("el kernel es el de PRODUCT-NARRATION-001: el motor filtra message en cualquier acción; momentText; engineVersion 2, v5", () => {
    const engine = KERNEL_FILES.find(f => f.name === "scenario-engine.js")!.source;
    assert.ok(engine.includes(`k!=="message"`) && !engine.includes(`!(k==="message" && step.action!=="SEND")`));
    const k = createKernel();
    assert.equal(k.call("typeof FluyoStory.momentText"), "function");
    assert.equal(k.call(`FluyoStory.momentText({id:1, at:0, action:"SEND", edgeId:1, message:"Frase"})`), "Frase");
    const d: any = describeDocument({ document: NARRATED() });
    assert.deepEqual([d.engineVersion, d.schemaVersion, d.valid], [2, 5, true]);
  });
});

describe("PRODUCT-NARRATION-001 · schema publicado y catálogo", () => {
  it("add_step.message: misma forma (1..120, opcional); la description dice que vale en FLOW y que es el título del momento", async () => {
    const lt = await h.client.listTools();
    const ad: any = lt.tools.find(t => t.name === "author_document")!;
    const items = ad.inputSchema.properties.operations.items;
    const m = (items.oneOf ?? items.anyOf).find((o: any) => o.properties.op.const === "add_step").properties.message;
    assert.deepEqual([m.type, m.minLength, m.maxLength], ["string", 1, 120]);
    assert.match(m.description, /también FLOW/);
    assert.match(m.description, /título de su momento/);
    assert.doesNotMatch(m.description, /no en FLOW/);
    assert.match(m.description, /No cambia tiempos ni Trace/);
    assert.ok(lt.tools.find(t => t.name === "describe_document")!.description!.includes("frase y message (la frase propia del paso, si la tiene)"));
  });
  it("tools/list ≤ 55 000 B (guarda de DESCRIPTIONS-001), < 63 000 y < 72 000", async () => {
    const bytes = Buffer.byteLength(JSON.stringify(await h.client.listTools()));
    assert.ok(bytes <= 55_000 && bytes <= 63_000 && bytes < 72_000, `tools/list = ${bytes} B`);
  });
});

describe("PRODUCT-NARRATION-001 · autoría en un envío (tools/call: zod + kernel)", () => {
  it("add_step {message} en FLOW (al final y al revés): el paso lleva la frase; sin message, sin clave", async () => {
    const r = await authorTool(EMPTY(), addOps(true));
    assert.ok(!isToolError(r), textOf(r));
    const doc = documentOf(r).document;
    assert.deepEqual(step(doc, 5), { id: 5, at: 6400, eventTypeId: 1, action: "SEND", edgeId: 8, reverse: true, message: "El PSP confirma el pago" });
    assert.deepEqual(steps(doc).map((s: any) => s.message), CASE.map((c) => c[2]));
    assert.ok(steps(BEFORE()).every((s: any) => !("message" in s)));
  });
  it("set_step_message en un SEND: fija, cambia y quita (null); changed:false si no cambia; affects solo el paso; el sentido se queda", async () => {
    const r = await authorTool(BEFORE(), [S("set_step_message", { stepId: 3, message: "Checkout pide el cobro" })]);
    assert.ok(!isToolError(r), textOf(r));
    const out = documentOf(r), ch = out.changes[0];
    assert.deepEqual(step(out.document, 3), { id: 3, at: 3200, eventTypeId: 1, action: "SEND", edgeId: 7, message: "Checkout pide el cobro" });
    assert.deepEqual([ch.from, ch.to, ch.changed], [null, "Checkout pide el cobro", true]);
    assert.deepEqual(ch.affects.stories.map((s: any) => s.stepIds), [[3]]);
    const n = NARRATED();
    assert.deepEqual(step(ok(n, [S("set_step_message", { stepId: 5, message: null })]).document, 5), { id: 5, at: 6400, eventTypeId: 1, action: "SEND", edgeId: 8, reverse: true });
    assert.equal(ok(n, [S("set_step_message", { stepId: 1, message: CASE[0][2] })]).changes[0].changed, false);
    assert.equal(ok(BEFORE(), [S("set_step_message", { stepId: 1, message: null })]).changes[0].changed, false);
    assert.ok(isToolError(await authorTool(n, [S("set_step_message", { stepId: 1, message: "" })])), "\"\" no pasa la forma");
  });
  it("duplicate_story y duplicate_step conservan la frase de un envío", () => {
    let r = ok(NARRATED(), [{ op: "duplicate_story", scope: "story", pageIndex: 0, storyId: 1 }]);
    assert.deepEqual(r.document.doc.pages[0].scenarios[1].steps.map((s: any) => s.message), CASE.map((c) => c[2]));
    r = ok(NARRATED(), [S("duplicate_step", { stepId: 5 })]);
    assert.deepEqual(steps(r.document).filter((s: any) => s.message === "El PSP confirma el pago").map((s: any) => s.reverse), [true, true]);
  });
});

describe("PRODUCT-NARRATION-001 · describe_document y run_story", () => {
  it("describe_document: el message de un envío detrás de sentence; event y frase son los del evento", () => {
    const d: any = describeDocument({ document: NARRATED() });
    const st = d.pages[0].stories[0].moments.flatMap((m: any) => m.steps);
    const keys = Object.keys(st[0]);
    assert.deepEqual(keys.slice(keys.indexOf("sentence"), keys.indexOf("sentence") + 2), ["sentence", "message"]);
    assert.deepEqual([st[0].event, st[0].sentence, st[0].message], ["Petición", "Cliente (web) envía a API Checkout", CASE[0][2]]);
    assert.deepEqual([st[4].sentence, st[4].message], ["PSP (Stripe) envía a Servicio Pagos", "El PSP confirma el pago"], "al revés: la frase del recorrido");
    const b: any = describeDocument({ document: BEFORE() });
    assert.ok(b.pages[0].stories[0].moments.flatMap((m: any) => m.steps).every((s: any) => !("message" in s)));
  });
  it("run_story: el message de cada paso; Trace, traceDigest y resultados IDÉNTICOS con y sin frases", () => {
    const a: any = runStory({ document: NARRATED(), storyId: 1 }), b: any = runStory({ document: BEFORE(), storyId: 1 });
    assert.equal(a.executed, true);
    assert.deepEqual(a.steps.map((s: any) => s.message), CASE.map((c) => c[2]));
    assert.deepEqual(a.steps.map((s: any) => s.event.name), ["Petición", "Comprobación", "Petición", "Petición", "Petición", "Petición"]);
    assert.deepEqual([a.trace, a.traceDigest], [b.trace, b.traceDigest]);
    assert.deepEqual(a.steps.map(({ message, ...s }: any) => s), b.steps);
  });
  it("por tools/call: la Historia narrada se escribe en UN author_document y la biblioteca sigue con 2 eventos", async () => {
    const r = await authorTool(EMPTY(), addOps(true));
    const doc = documentOf(r).document;
    assert.equal(doc.doc.eventTypes.length, 2);
    const run = documentOf(await call("run_story", { document: doc, storyId: 1 }));
    assert.deepEqual(run.steps.map((s: any) => s.message), CASE.map((c) => c[2]));
  });
});

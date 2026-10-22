/**
 * FLUYO-MCP-STEP-MESSAGE-001 — `message` de un Step de elemento (contrato de fluyo, decisión 255; fluyo 441a75c) en el MCP.
 *
 * Un paso OCCURRENCE o SET_STATE puede llevar `message`: el texto de SU globo, en vez del nodeEffects.message de su evento. Toda la regla
 * es del kernel (model.js stepMessageValid/validatePersistedStep/setStepMessage, story-authoring.js add_step/set_step_message,
 * scenario-engine.js, story-playback.js stepMeta); el MCP publica la forma (variante V10 del contrato), proyecta el texto en
 * describe_document/run_story (que construyen los pasos campo a campo: sin esto se perdería) y lo documenta.
 *
 * Se fija:
 *   · kernel = fluyo 441a75c (stepMessageValid, setStepMessage, set_step_message); engineVersion 2 y versión 5;
 *   · schema publicado: add_step.message (1..120, con su description), set_step_message {stepId, message|null} con stepRef por $ref,
 *     la operación en la lista detrás de set_wait, y las menciones en describe_document/run_story; catálogo ≤ 63 000;
 *   · autoría por tools/call (zod + kernel): add_step, set_step_message (fijar, cambiar, null, changed:false, ref), SEND, vacíos, 121,
 *     y que duplicate_step, retarget_step, duplicate_story y update_event_type lo conservan; remove_step se lo lleva;
 *   · describe_document y run_story: `message` detrás de `sentence` solo si existe; event.name, frase y Trace los del evento;
 *   · el caso real de 38 pasos (9 eventos → 5 con message): mismo Trace; documentos sin `message`: ni una clave nueva.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AuthoringOperationSchema, authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { KERNEL_FILES } from "../src/generated/kernel-sources.js";
import { openLink } from "../src/link.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument, runStory } from "../src/stories.js";
import { FIXTURES_DIR, derefSchema, documentOf, isToolError, loadFixtures, startHarness, textOf, type Harness } from "./helpers.js";

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
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

/* ───────── Documento: 1 Usuario · 2 API · 3 DB; 4 U→A · 5 A→D. Eventos: 1 Pide (FLOW), 2 Pregunta (OCCURRENCE, sin mensaje),
   3 Cae (SET_AVAILABILITY DOWN, «Caída»). Pasos: 1 Pregunta(U) «¿Cuál es mi saldo?» · 2 Pide(4) · 3 Pregunta(A) · 4 Cae(D) ───────── */
const rect = (id: number, label: string) => ({ id, shape: "rect", x: id * 200, y: 100, w: 140, h: 60, label });
const edge = (id: number, from: number, to: number) => ({ id, from, to, route: "straight", fromSide: null, toSide: null, waypoints: [] });
const ASK = "¿Cuál es mi saldo?";
const occ = (id: number, at: number, nodeId: number, extra: Record<string, unknown> = {}) => ({ id, at, eventTypeId: 2, action: "OCCURRENCE", nodeId, ...extra });
const STEPS = [occ(1, 0, 1, { message: ASK }), { id: 2, at: 900, eventTypeId: 1, action: "SEND", edgeId: 4 }, occ(3, 1300, 2),
  { id: 4, at: 2600, eventTypeId: 3, action: "SET_STATE", nodeId: 3, state: "DOWN" }];
const DOC = (stepList: unknown[] = STEPS) => ({ version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 4,
  eventTypes: [
    { id: 1, name: "Pide", primitive: "FLOW", sentenceTemplate: "{source} pide a {target}", visual: { kind: "token", value: "●" }, motion: "normal" },
    { id: 2, name: "Pregunta", primitive: "OCCURRENCE", sentenceTemplate: "{target} pregunta", visual: { kind: "token", value: "?" } },
    { id: 3, name: "Cae", primitive: "SET_AVAILABILITY", availability: "DOWN", sentenceTemplate: "{target} cae", visual: { kind: "token", value: "✕" },
      presentation: { nodeEffects: { message: "Caída" } } }],
  pages: [{ name: "Saldo", nextId: 100, behaviors: [], nextScenarioId: 2, nodes: [rect(1, "Usuario"), rect(2, "API"), rect(3, "DB")],
    edges: [edge(4, 1, 2), edge(5, 2, 3)],
    scenarios: [{ id: 1, engineVersion: 2, name: "Saldo", nextStepId: 5, arrivalDependencies: [{ stepId: 3, waitsForArrivalOf: [2] }], steps: stepList }] }] } });
const PLAIN = () => DOC(STEPS.map(({ message, ...s }: any) => s));

/* ───────── Caso real: 3, 4 y 5 («Pregunta: …») y 6, 7 y 8 («Decide: …») solo difieren en el texto → «Pregunta» y «Decide» + message ───────── */
const RAG = JSON.parse(readFileSync(join(FIXTURES_DIR, "fluyo-step-message-001-rag.json"), "utf8"));
function ragWithMessages(withMessages = true): any {
  const ets = RAG.doc.eventTypes, base = (id: number) => clone(ets.find((e: any) => e.id === id));
  const remap: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5 };
  const pregunta = Object.assign(base(3), { id: 3, name: "Pregunta", sentenceTemplate: "{target} pregunta" }); pregunta.presentation.nodeEffects.message = "";
  const decide = Object.assign(base(6), { id: 4, name: "Decide", sentenceTemplate: "{target} decide la ruta" }); decide.presentation.nodeEffects.message = "";
  const out = clone(RAG);
  out.doc.eventTypes = [base(1), base(2), pregunta, decide, Object.assign(base(9), { id: 5 })]; out.doc.nextEventTypeId = 6;
  for (const sc of out.doc.pages[0].scenarios) sc.steps = sc.steps.map((st: any) => {
    const s = { ...st, eventTypeId: remap[st.eventTypeId] };
    if (withMessages && st.eventTypeId >= 3 && st.eventTypeId <= 8) s.message = ets.find((e: any) => e.id === st.eventTypeId).presentation.nodeEffects.message;
    return s;
  });
  return out;
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const authorTool = async (document: unknown, operations: unknown[]) => call("author_document", { document, baseRevision: rev(document), operations });
const catalog = async () => {
  const lt = await h.client.listTools();
  const ad: any = lt.tools.find(t => t.name === "author_document")!;
  const items = ad.inputSchema.properties.operations.items;
  const variant = (op: string) => (items.oneOf ?? items.anyOf).find((o: any) => o.properties.op.const === op);
  return { lt, ad, variant, tool: (n: string) => lt.tools.find(t => t.name === n)! };
};

/* ═══════════════ Kernel y versiones ═══════════════ */
describe("MCP-STEP-MESSAGE-001 · kernel y versiones", () => {
  it("el kernel es fluyo 441a75c: stepMessageValid, setStepMessage y set_step_message; el motor solo filtra la clave", () => {
    const k = createKernel();
    assert.equal(k.call("typeof stepMessageValid"), "function");
    assert.equal(k.call("typeof setStepMessage"), "function");
    assert.equal(k.call("STEP_MESSAGE_MAX_LEN"), 120);
    assert.deepEqual(k.call(`["x", "x".repeat(120), "", "   ", "x".repeat(121), null].map(stepMessageValid)`), [true, true, false, false, false, false]);
    assert.equal(k.call("FluyoAuthoring.OPERATION_SCOPE.set_step_message"), "story");
    const engine = KERNEL_FILES.find(f => f.name === "scenario-engine.js")!.source;
    /* PRODUCT-NARRATION-001 (fluyo, decisión 258): el motor filtra la clave en cualquier acción */
    assert.ok(engine.includes(`k!=="message"`));
  });
  it("engineVersion sigue en 2 y el documento en v5 (sin v3)", () => {
    const d: any = describeDocument({ document: DOC() });
    assert.deepEqual([d.engineVersion, d.schemaVersion, d.valid], [2, 5, true]);
  });
});

/* ═══════════════ Schema publicado (V10) y catálogo ═══════════════ */
describe("MCP-STEP-MESSAGE-001 · schema publicado y catálogo", () => {
  it("add_step.message: texto 1..120 con su description (globo de ESTE paso, no FLOW, no cambia tiempos ni Trace)", async () => {
    const { variant } = await catalog();
    const m = variant("add_step").properties.message;
    assert.deepEqual([m.type, m.minLength, m.maxLength], ["string", 1, 120]);
    /* PRODUCT-NARRATION-001 (decisión 258): también en FLOW; en un elemento, además, su globo */
    assert.match(m.description, /Frase de ESTE paso \(cualquier evento, también FLOW\)/);
    assert.match(m.description, /en un elemento, su globo/);
    assert.match(m.description, /No cambia tiempos ni Trace/);
    assert.ok(!variant("add_step").required.includes("message"), "opcional");
  });
  it("set_step_message: {scope:'story', pageIndex, storyId, stepId, message: texto|null}; storyId/stepId por $ref (IdOrRef)", async () => {
    const { variant } = await catalog();
    const v = variant("set_step_message");
    assert.deepEqual(Object.keys(v.properties).sort(), ["message", "op", "pageIndex", "scope", "stepId", "storyId"]);
    assert.deepEqual(v.required.slice().sort(), ["message", "op", "pageIndex", "scope", "stepId", "storyId"]);
    assert.deepEqual([v.properties.storyId, v.properties.stepId], [{ $ref: "#/definitions/IdOrRef" }, { $ref: "#/definitions/IdOrRef" }]);
    assert.deepEqual(v.properties.message.anyOf, [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }]);
    assert.equal(v.properties.message.description, "null lo quita.");
    assert.equal(v.additionalProperties, false);
    assert.ok(Buffer.byteLength(JSON.stringify(v)) < 500, "la operación cuesta poco gracias a $ref");
  });
  it("las descriptions: la operación en la lista detrás de set_wait; describe_document y run_story dicen que dan `message`", async () => {
    const { ad, tool } = await catalog();
    assert.ok(ad.description.includes("set_wait, set_step_message, set_arrival_dependencies, set_observed_flow (alcance 'story')"));
    assert.ok(tool("describe_document").description!.includes("objetivo, frase y message (la frase propia del paso, si la tiene)"));
    assert.ok(tool("run_story").description!.includes("la frase de cada paso (y su message si lo tiene)"));
  });
  it("catálogo: tools/list ≤ 63 000 B (guarda de CATALOG-COMPACTION-001) y < 72 000; desreferenciado, la operación es la misma", async () => {
    const { lt, ad } = await catalog();
    const bytes = Buffer.byteLength(JSON.stringify(lt));
    assert.ok(bytes <= 63_000 && bytes < 72_000, `tools/list = ${bytes} B`);
    const flat = derefSchema(ad.inputSchema);
    const items = flat.properties.operations.items;
    const v = (items.oneOf ?? items.anyOf).find((o: any) => o.properties.op.const === "set_step_message");
    assert.equal(v.properties.stepId.anyOf.length, 2, "IdOrRef expandido: entero o {ref}");
  });
  it("Zod: message de 1 a 120 unidades UTF-16 (como el kernel); null solo en set_step_message", () => {
    const add = (message: unknown) => AuthoringOperationSchema.safeParse(S("add_step", { eventTypeId: 2, target: { nodeId: 1 }, message })).success;
    const set = (message: unknown) => AuthoringOperationSchema.safeParse(S("set_step_message", { stepId: 1, message })).success;
    assert.deepEqual(["x", "x".repeat(120), "a".repeat(118) + "😀", "", "x".repeat(121), "a".repeat(119) + "😀", null, 3].map(add), [true, true, true, false, false, false, false, false]);
    assert.deepEqual(["x", null, "", "x".repeat(121), undefined].map(set), [true, true, false, false, false]);
    assert.equal(AuthoringOperationSchema.safeParse(S("set_step_message", { stepId: 1, message: "x", at: 1 })).success, false, "strict");
  });
});

/* ═══════════════ Autoría ═══════════════ */
describe("MCP-STEP-MESSAGE-001 · autoría (tools/call: zod + kernel)", () => {
  it("add_step {message}: en un OCCURRENCE (al final) y en un SET_STATE (mismo momento); sin message, sin clave", async () => {
    const r = await authorTool(PLAIN(), [S("add_step", { eventTypeId: 2, target: { nodeId: 3 }, message: "¿Y el límite?" }),
      S("add_step", { eventTypeId: 3, target: { nodeId: 2 }, placement: { sameMomentAs: 1 }, message: "API cae" }), S("add_step", { eventTypeId: 2, target: { nodeId: 1 } })]);
    assert.ok(!isToolError(r), textOf(r));
    const doc = documentOf(r).document;
    assert.deepEqual(step(doc, 5), occ(5, 3600, 3, { message: "¿Y el límite?" }));
    assert.deepEqual(step(doc, 6), { id: 6, at: 0, eventTypeId: 3, action: "SET_STATE", nodeId: 2, state: "DOWN", message: "API cae" });
    assert.ok(!("message" in step(doc, 7)));
    assert.ok(!JSON.stringify(documentOf(r).changes).includes("¿Y el límite?"), "la respuesta no repite el texto en changes");
  });
  it("add_step en un evento FLOW: acepta message (PRODUCT-NARRATION-001, decisión 258); vacío/121/null: schema; solo espacios: INVALID_FIELD", async () => {
    assert.deepEqual(step(ok(PLAIN(), [S("add_step", { eventTypeId: 1, target: { edgeId: 5 }, message: "hola" })]).document, 5), { id: 5, at: 3600, eventTypeId: 1, action: "SEND", edgeId: 5, message: "hola" });
    for (const message of ["", "x".repeat(121), null]) {
      const r = await authorTool(PLAIN(), [S("add_step", { eventTypeId: 2, target: { nodeId: 1 }, message })]);
      assert.ok(isToolError(r) && /message/.test(textOf(r)), JSON.stringify(message));
    }
    const w = rejected(PLAIN(), [S("add_step", { eventTypeId: 2, target: { nodeId: 1 }, message: "   " })]);
    assert.deepEqual([w.code, w.field], ["INVALID_FIELD", "message"]);
  });
  it("set_step_message: fija, cambia y quita (null); changed:false si no cambia; affects solo el paso; no toca tiempos ni dependencias", async () => {
    let r: any = await authorTool(DOC(), [S("set_step_message", { stepId: 3, message: "Consulta" })]);
    assert.ok(!isToolError(r), textOf(r));
    let out = documentOf(r);
    assert.deepEqual(step(out.document, 3), occ(3, 1300, 2, { message: "Consulta" }));
    const ch = out.changes[0];
    assert.deepEqual([ch.operation, ch.from, ch.to, ch.changed], ["set_step_message", null, "Consulta", true]);
    assert.deepEqual(ch.affects.stories.map((s: any) => s.stepIds), [[3]]);
    assert.deepEqual(steps(out.document).map(({ message, ...s }: any) => s), STEPS.map(({ message, ...s }: any) => s), "ids, at, orden, objetivo, evento");
    assert.deepEqual(out.document.doc.pages[0].scenarios[0].arrivalDependencies, [{ stepId: 3, waitsForArrivalOf: [2] }]);
    r = ok(DOC(), [S("set_step_message", { stepId: 1, message: null })]);
    assert.deepEqual(step(r.document, 1), occ(1, 0, 1), "null quita la clave");
    assert.deepEqual([r.changes[0].from, r.changes[0].to, r.changes[0].changed], [ASK, null, true]);
    assert.equal(ok(DOC(), [S("set_step_message", { stepId: 1, message: ASK })]).changes[0].changed, false);
    assert.equal(ok(DOC(), [S("set_step_message", { stepId: 3, message: null })]).changes[0].changed, false);
    r = ok(PLAIN(), [S("add_step", { eventTypeId: 2, target: { nodeId: 3 }, ref: "n" }), S("set_step_message", { stepId: { ref: "n" }, message: "por ref" })]);
    assert.equal(step(r.document, 5).message, "por ref");
  });
  it("set_step_message en un SEND (texto o null): lo acepta (PRODUCT-NARRATION-001, decisión 258); vacío por tools/call: schema; solo espacios: INVALID_FIELD", async () => {
    assert.deepEqual(step(ok(DOC(), [S("set_step_message", { stepId: 2, message: "x" })]).document, 2), { id: 2, at: 900, eventTypeId: 1, action: "SEND", edgeId: 4, message: "x" });
    assert.equal(ok(DOC(), [S("set_step_message", { stepId: 2, message: null })]).changes[0].changed, false);
    const r = await authorTool(DOC(), [S("set_step_message", { stepId: 1, message: "" })]);
    assert.ok(isToolError(r), "\"\" no pasa la forma");
    assert.deepEqual([rejected(DOC(), [S("set_step_message", { stepId: 1, message: "  " })]).code], ["INVALID_FIELD"]);
    assert.equal(rejected(DOC(), [S("set_step_message", { stepId: 9, message: "x" })]).code, "STEP_NOT_FOUND");
  });
  it("duplicate_step, retarget_step, duplicate_story y update_event_type conservan el message; remove_step se lo lleva", () => {
    let r = ok(DOC(), [S("duplicate_step", { stepId: 1 }), S("retarget_step", { stepId: 1, target: { nodeId: 2 } })]);
    assert.deepEqual(steps(r.document).filter((s: any) => s.message === ASK).map((s: any) => [s.id, s.nodeId]), [[1, 2], [5, 1]]);
    r = ok(DOC(), [{ op: "duplicate_story", scope: "story", pageIndex: 0, storyId: 1 }]);
    assert.deepEqual(r.document.doc.pages[0].scenarios[1].steps, STEPS);
    r = ok(DOC(), [{ op: "update_event_type", scope: "eventType", eventTypeId: 2, presentation: { nodeEffects: { message: "genérico" } } }]);
    assert.equal(step(r.document, 1).message, ASK, "el texto del evento no pisa el del paso");
    r = ok(DOC(), [S("remove_step", { stepId: 1 })]);
    assert.ok(!JSON.stringify(r.document).includes(ASK), "sin huérfanos");
  });
  it("baseRevision: el texto cuenta en la revisión (cambiarlo cambia resultRevision)", () => {
    const r = ok(DOC(), [S("set_step_message", { stepId: 1, message: "otro" })]);
    assert.notEqual(r.resultRevision, rev(DOC()));
    assert.equal(r.resultRevision, rev(r.document));
  });
});

/* ═══════════════ describe_document y run_story ═══════════════ */
describe("MCP-STEP-MESSAGE-001 · describe_document y run_story", () => {
  it("describe_document: message detrás de sentence, solo si existe; event y frase son los del evento; eventTypes no cambian", () => {
    const d: any = describeDocument({ document: DOC() });
    const st = d.pages[0].stories[0].moments.flatMap((m: any) => m.steps);
    assert.deepEqual(Object.keys(st[0]).slice(Object.keys(st[0]).indexOf("sentence"), Object.keys(st[0]).indexOf("sentence") + 2), ["sentence", "message"]);
    assert.deepEqual([st[0].event, st[0].sentence, st[0].message], ["Pregunta", "Usuario pregunta", ASK]);
    assert.deepEqual(st.slice(1).map((s: any) => "message" in s), [false, false, false]);
    const p: any = describeDocument({ document: PLAIN() });
    assert.deepEqual(clone({ ...d, revision: 0, pages: 0 }), clone({ ...p, revision: 0, pages: 0 }), "el resto, igual");
    assert.deepEqual(d.eventTypes, p.eventTypes);
  });
  it("run_story: message detrás de sentence, solo si existe; Trace, traceDigest y resultados idénticos con y sin message", () => {
    const a: any = runStory({ document: DOC(), storyId: 1 }), b: any = runStory({ document: PLAIN(), storyId: 1 });
    assert.equal(a.executed, true);
    const keys = Object.keys(a.steps[0]);
    assert.deepEqual(keys.slice(keys.indexOf("sentence"), keys.indexOf("sentence") + 2), ["sentence", "message"]);
    assert.deepEqual([a.steps[0].event.name, a.steps[0].sentence, a.steps[0].message], ["Pregunta", "Usuario pregunta", ASK]);
    assert.ok(a.steps.slice(1).every((s: any) => !("message" in s)));
    assert.deepEqual([a.trace, a.traceDigest], [b.trace, b.traceDigest]);
    assert.deepEqual(a.steps.map(({ message, ...s }: any) => s), b.steps);
  });
  it("por tools/call y por enlace #d=: el mismo message (no se pierde en ninguna respuesta)", async () => {
    const doc = DOC();
    const viaJson = documentOf(await call("run_story", { document: doc, storyId: 1 }));
    const viaLink = documentOf(await call("run_story", { document: (openLink(doc) as { url: string }).url, baseRevision: rev(doc), storyId: 1 }));
    assert.equal(viaJson.steps[0].message, ASK);
    assert.deepEqual(viaLink.steps, viaJson.steps);
    const d = documentOf(await call("describe_document", { document: doc }));
    assert.equal(d.pages[0].stories[0].moments[0].steps[0].message, ASK);
    const authored = documentOf(await authorTool(doc, [S("rename_story", { name: "Saldo 2" })]));
    assert.equal(step(authored.document, 1).message, ASK, "author_document devuelve el documento con el texto");
  });
  it("un message inválido en el documento: no legible (invalid_step), sin Trace ni lectura a medias", () => {
    const bad = DOC([...STEPS.slice(0, 1), { id: 2, at: 900, eventTypeId: 1, action: "SEND", edgeId: 4, message: "   " }]);
    const d: any = describeDocument({ document: bad });
    assert.equal(d.readable, false);
    assert.deepEqual(d.errors.map((e: any) => e.code), ["invalid_step"]);
    const r: any = runStory({ document: DOC([occ(1, 0, 1, { message: "   " })]), storyId: 1 });
    assert.equal(r.executed, false);
  });
});

/* ═══════════════ Caso real y documentos sin message ═══════════════ */
describe("MCP-STEP-MESSAGE-001 · caso real (38 pasos) y documentos de siempre", () => {
  it("con 5 eventos y message: el mismo Trace y los mismos resultados en las 3 Historias; event.name y frase del evento, message del paso", () => {
    const now = ragWithMessages();
    for (const storyId of [1, 2, 3]) {
      const a: any = runStory({ document: RAG, storyId }), b: any = runStory({ document: now, storyId });
      assert.deepEqual([b.trace, b.traceDigest], [a.trace, a.traceDigest], "Historia " + storyId);
      const strip = (s: any) => ({ stepId: s.stepId, at: s.at, moment: s.moment, action: s.action, target: s.target, outcome: s.outcome });
      assert.deepEqual(b.steps.map(strip), a.steps.map(strip));
      assert.deepEqual(b.steps.filter((s: any) => s.message).map((s: any) => [s.stepId, s.event.name]), [[1, "Pregunta"], [4, "Decide"]]);
      assert.equal(b.steps[0].message, a.steps[0].sentence.split(": ")[1], "el texto que antes iba en la frase");
    }
    assert.equal((describeDocument({ document: now }) as any).eventTypes.length, 5);
  });
  it("se reconstruye con UN author_document de 46 operaciones (5 create_event_type + 6 message): exactamente la variante", async () => {
    const variant = ragWithMessages(), ops: any[] = [];
    for (const et of variant.doc.eventTypes) {
      const branch = et.primitive === "FLOW" ? "connectionEffects" : "nodeEffects";
      ops.push({ op: "create_event_type", scope: "eventType", name: et.name, primitive: et.primitive, sentence: et.sentenceTemplate, symbol: et.visual.value,
        ...(et.primitive === "FLOW" ? { motion: et.motion } : {}), presentation: { [branch]: et.presentation[branch] }, ref: "e" + et.id });
    }
    for (const sc of variant.doc.pages[0].scenarios) {
      ops.push({ op: "create_story", scope: "story", pageIndex: 0, name: sc.name, ref: "h" + sc.id });
      const deps = new Map((sc.arrivalDependencies || []).map((d: any) => [d.stepId, d.waitsForArrivalOf]));
      let prev: number | null = null, anchor: number | null = null;
      for (const st of sc.steps) {
        const op: any = { op: "add_step", scope: "story", pageIndex: 0, storyId: { ref: "h" + sc.id }, eventTypeId: { ref: "e" + st.eventTypeId },
          target: st.action === "SEND" ? { edgeId: st.edgeId, ...(st.reverse ? { reverse: true } : {}) } : { nodeId: st.nodeId } };
        if (prev !== null && st.at === prev) op.placement = { sameMomentAs: { ref: `h${sc.id}s${anchor}` } };
        else if (prev !== null) op.waitMs = st.at - prev;
        if (deps.has(st.id)) op.waitsForArrivalOf = (deps.get(st.id) as number[]).map((i: number) => ({ ref: `h${sc.id}s${i}` }));
        if (st.message !== undefined) op.message = st.message;
        op.ref = `h${sc.id}s${st.id}`;
        if (prev === null || st.at !== prev) anchor = st.id;
        prev = st.at; ops.push(op);
      }
    }
    const empty = clone(RAG); empty.doc.eventTypes = []; empty.doc.nextEventTypeId = 1; empty.doc.pages[0].scenarios = []; empty.doc.pages[0].nextScenarioId = 1;
    assert.equal(ops.length, 46);
    const r = await authorTool(empty, ops);
    assert.ok(!isToolError(r), textOf(r).slice(0, 400));
    const doc = documentOf(r).document;
    assert.deepEqual(doc.doc.pages[0].scenarios.map((s: any) => [s.steps, s.arrivalDependencies]), variant.doc.pages[0].scenarios.map((s: any) => [s.steps, s.arrivalDependencies]));
    for (const storyId of [1, 2, 3]) assert.deepEqual((runStory({ document: doc, storyId }) as any).trace, (runStory({ document: RAG, storyId }) as any).trace);
  });
  it("documentos sin message (ejemplos y el fixture real): describe_document y run_story sin ni una clave `message` en los pasos", () => {
    const docs = [...loadFixtures().map(f => f.doc), RAG];
    let stories = 0;
    for (const doc of docs) {
      const d: any = describeDocument({ document: doc });
      for (const pg of d.pages ?? []) for (const s of pg.stories ?? []) {
        for (const m of s.moments ?? []) for (const st of m.steps) assert.ok(!("message" in st));
        const r: any = runStory({ document: doc, pageIndex: pg.pageIndex, storyId: s.storyId });
        if (r.executed) for (const st of r.steps) assert.ok(!("message" in st));
        stories++;
      }
    }
    assert.ok(stories >= 3, `${stories} Historias`);
  });
});

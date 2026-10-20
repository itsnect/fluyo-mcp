/**
 * SCENARIOS-SEMANTICS-001 · FASE 5 (D9) — la semántica de las conexiones y la ruta observada en el MCP, sin derivación de ruta.
 *
 * Se fija:
 *   · kind en ConnectionSpec / ConnectionPatch (author_document) y en EdgeSpec (create_diagram): FLOWS_TO | REQUIRES | null; nada más.
 *     Antes, ConnectionSpec lo rechazaba y EdgeSpec lo quitaba en silencio (B3).
 *   · author_document: set_observed_flow {storyId, source, target} (id o {ref}; los dos null = automática), con la autoridad del editor
 *     (kernel: setObservedFlowIn); delete_node sigue podando la ruta (cascade.observedFlows).
 *   · describe_document: connectionKind (solo Flujo y Requisito; nombre distinto de target.kind), observedFlow guardado con etiquetas,
 *     warnings W2/W3 solo si hay; un documento sin nada de esto, sin claves nuevas.
 *   · export_diagram / pageToSVG: las marcas por port literal; golden compartido con el SVG del editor
 *     (test/fixtures/fluyo-scenarios-semantics-5-marcas-svg.json, generado en Chrome por fluyo); sin kind, el SVG de siempre; N3.
 *   · deriva de disponibilidad: los enums de zod (set_initial_availability, eventos) = SCENARIO_STATES / EVENT_TYPE_AVAILABILITY del
 *     kernel, y los de kind = EDGE_KINDS (antes no lo vigilaba ningún test).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AuthoringOperationSchema, authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { describeDocument } from "../src/stories.js";
import { createDiagram, parseDocument } from "../src/diagram.js";
import { EdgeSpecSchema, type FluyoPage } from "../src/model.js";
import { edgeKind, edgeSemanticMarks, pageToSVG } from "../src/svg.js";
import { FIXTURES_DIR, documentOf, isToolError, loadFixtures, startHarness, textOf, type Harness } from "./helpers.js";

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const author = (document: unknown, operations: unknown[]): any => authorDocument({ document, baseRevision: rev(document), operations });
const ok = (document: unknown, operations: unknown[]): any => { const r = author(document, operations); assert.equal(r.ok, true, JSON.stringify(r.errors)); return r; };
const errorOf = (document: unknown, operations: unknown[]): any => { const r = author(document, operations); assert.equal(r.ok, false, "el lote debía rechazarse"); return r.errors[0]; };
const GOLD = JSON.parse(readFileSync(join(FIXTURES_DIR, "fluyo-scenarios-semantics-5-marcas-svg.json"), "utf8")) as {
  doc: any; variants: Array<{ name: string; theme: "crema" | "dark" | "claro"; customBg: string; skin: string }>; svgs: Record<string, string>;
};
/* líneas que no dependen de medir texto (la divergencia conocida del MCP): todo salvo la cabecera <svg> y los <text> */
const geometryLines = (svg: string) => svg.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("<svg ") && !l.startsWith("<text"));
const markLines = (svg: string) => svg.split("\n").filter(l => /stroke-width="1\.6"/.test(l));

/* Cliente(1) → API(2) → Worker A(3) | Worker B(4) → BD(5) por Flujo; API → Auth(6) Requisito; API → Métricas(7) genérica. Historia 1. */
const R = (id: number, x: number, label: string) => ({ id, shape: "rect", x, y: 300, w: 140, h: 60, label, color: "#5b8db5" });
const Ed = (id: number, from: number, to: number, kind?: string) => ({ id, from, to, route: "straight", fromSide: null, toSide: null, waypoints: [], ...(kind ? { kind } : {}) });
function DOC(story: Record<string, unknown> = {}) {
  return { version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 1, eventTypes: [],
    pages: [{ name: "Workers", nextId: 30, behaviors: [], nextScenarioId: 2,
      nodes: [R(1, 100, "Cliente"), R(2, 300, "API"), R(3, 500, "Worker A"), R(4, 700, "Worker B"), R(5, 900, "BD"), R(6, 300, "Auth"), R(7, 300, "Métricas")],
      edges: [Ed(11, 1, 2, "FLOWS_TO"), Ed(12, 2, 3, "FLOWS_TO"), Ed(13, 2, 4, "FLOWS_TO"), Ed(14, 3, 5, "FLOWS_TO"), Ed(15, 4, 5, "FLOWS_TO"), Ed(16, 2, 6, "REQUIRES"), Ed(17, 2, 7)],
      scenarios: [{ id: 1, engineVersion: 2, name: "Pedido", nextStepId: 2, steps: [{ id: 1, at: 0, action: "SET_STATE", nodeId: 3, state: "DOWN" }], ...story }] }] } };
}
const SOF = (extra: Record<string, unknown>) => ({ op: "set_observed_flow", scope: "story", pageIndex: 0, storyId: 1, ...extra });
const optionOf = (op: string): any => (AuthoringOperationSchema as any).options.find((o: any) => o.shape.op.value === op);

describe("SCENARIOS-SEMANTICS-001 FASE 5 · schemas (kind y set_observed_flow)", () => {
  it("ConnectionSpec / ConnectionPatch admiten kind FLOWS_TO | REQUIRES | null y nada más (antes: rechazado)", () => {
    const create = (kind: unknown) => AuthoringOperationSchema.safeParse({ op: "create_connection", scope: "page", pageIndex: 0, source: { id: 1 }, target: { id: 2 }, spec: { kind } }).success;
    const update = (kind: unknown) => AuthoringOperationSchema.safeParse({ op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 11 }, spec: { kind } }).success;
    for (const k of ["FLOWS_TO", "REQUIRES", null]) assert.deepEqual([create(k), update(k)], [true, true], String(k));
    for (const k of ["GENERIC", "flows_to", "FUTURO", 1, true, {}]) assert.deepEqual([create(k), update(k)], [false, false], JSON.stringify(k));
  });
  it("EdgeSpec (create_diagram) conserva kind en vez de quitarlo en silencio (B3)", () => {
    assert.equal((EdgeSpecSchema.parse({ from: "a", to: "b", kind: "FLOWS_TO" }) as any).kind, "FLOWS_TO");
    assert.equal(EdgeSpecSchema.safeParse({ from: "a", to: "b", kind: "OTRO" }).success, false);
  });
  it("set_observed_flow: alcance story; source/target id o {ref} o null", () => {
    for (const [s, t] of [[1, 5], [{ ref: "x" }, 5], [null, null]]) assert.equal(AuthoringOperationSchema.safeParse(SOF({ source: s, target: t })).success, true, JSON.stringify([s, t]));
    assert.equal(AuthoringOperationSchema.safeParse({ ...SOF({ source: 1, target: 5 }), scope: "page" }).success, false);
    assert.equal(AuthoringOperationSchema.safeParse(SOF({ source: 1, target: 5, extra: 1 })).success, false, "strictObject");
    assert.equal(AuthoringOperationSchema.safeParse(SOF({ source: "1", target: 5 })).success, false);
  });
});

describe("SCENARIOS-SEMANTICS-001 FASE 5 · deriva de disponibilidad y de kind (kernel = zod)", () => {
  it("set_initial_availability.state = SCENARIO_STATES; availability de los eventos = EVENT_TYPE_AVAILABILITY; kind = EDGE_KINDS", () => {
    const k = createKernel();
    const states = k.call<string[]>("[...SCENARIO_STATES]"), avail = k.call<string[]>("[...EVENT_TYPE_AVAILABILITY]"), kinds = k.call<string[]>("EDGE_KINDS.slice()");
    assert.deepEqual([...optionOf("set_initial_availability").shape.state.options].sort(), [...states].sort());
    for (const op of ["create_event_type", "update_event_type"]) assert.deepEqual([...optionOf(op).shape.availability.unwrap().options].sort(), [...avail].sort(), op);
    const specKind = optionOf("create_connection").shape.spec.unwrap().shape.kind.unwrap().unwrap();
    assert.deepEqual([...specKind.options].sort(), [...kinds].sort(), "ConnectionSpec.kind");
    assert.deepEqual([...(EdgeSpecSchema as any).shape.kind.unwrap().unwrap().options].sort(), [...kinds].sort(), "EdgeSpec.kind");
    /* y por comportamiento: lo que el kernel no admite, zod tampoco (UNKNOWN sigue fuera: D3) */
    for (const v of ["UP", "DOWN", "UNKNOWN", "up", "DEGRADED"])
      assert.equal(AuthoringOperationSchema.safeParse({ op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: 1, state: v }).success, states.includes(v), v);
  });
});

describe("SCENARIOS-SEMANTICS-001 FASE 5 · autoría", () => {
  it("create_diagram guarda kind (null = conexión genérica, sin clave)", () => {
    const d = createDiagram({ nodes: [{ key: "a", shape: "rect", label: "A" }, { key: "b", shape: "rect", label: "B" }, { key: "c", shape: "rect", label: "C" }],
      edges: [{ from: "a", to: "b", kind: "FLOWS_TO" }, { from: "b", to: "c", kind: "REQUIRES" }, { from: "a", to: "c", kind: null }, { from: "c", to: "a" }] } as any);
    assert.deepEqual(d.doc.pages[0].edges.map((e: any) => ("kind" in e ? e.kind : "—")), ["FLOWS_TO", "REQUIRES", "—", "—"]);
  });
  it("author_document: create_connection / update_connection con kind; null lo quita", () => {
    const r = ok(DOC(), [{ op: "create_connection", scope: "page", pageIndex: 0, ref: "n", source: { id: 7 }, target: { id: 5 }, spec: { kind: "REQUIRES" } },
      { op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 16 }, spec: { kind: null } }, { op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 17 }, spec: { kind: "FLOWS_TO" } }]);
    const edges = r.document.doc.pages[0].edges, by = (id: number) => edges.find((e: any) => e.id === id);
    assert.equal(by(r.refs[0].id).kind, "REQUIRES"); assert.equal("kind" in by(16), false); assert.equal(by(17).kind, "FLOWS_TO");
  });
  it("set_observed_flow: escribe {from,to} como el editor, con {ref}; null + null = automática; lo mismo = changed:false; rechazos", () => {
    const r = ok(DOC(), [SOF({ source: 2, target: 4 })]);
    assert.deepEqual(r.document.doc.pages[0].scenarios[0].observedFlow, { from: 2, to: 4 });
    const ch = r.changes[0];
    assert.deepEqual([ch.operation, ch.from, ch.to, ch.changed, r.touchedStories], ["set_observed_flow", null, { source: 2, target: 4 }, true, [{ pageIndex: 0, storyId: 1 }]]);
    assert.deepEqual(r.document.doc.pages[0].scenarios[0].steps, DOC().doc.pages[0].scenarios[0].steps, "los pasos no cambian");
    assert.equal(ok(r.document, [SOF({ source: 2, target: 4 })]).changes[0].changed, false);
    assert.equal("observedFlow" in ok(r.document, [SOF({ source: null, target: null })]).document.doc.pages[0].scenarios[0], false);
    const withRef = ok(DOC(), [{ op: "create_node", scope: "page", pageIndex: 0, ref: "z", spec: { shape: "rect", x: 0, y: 500 } }, SOF({ source: { ref: "z" }, target: 5 })]);
    assert.deepEqual(withRef.document.doc.pages[0].scenarios[0].observedFlow, { from: withRef.refs[0].id, to: 5 });
    assert.equal(errorOf(DOC(), [SOF({ source: 2, target: 2 })]).code, "INVALID_OPERATION");
    assert.equal(errorOf(DOC(), [SOF({ source: 2, target: 99 })]).code, "TARGET_NOT_FOUND");
    assert.equal(errorOf(DOC(), [SOF({ source: null, target: 5 })]).code, "INVALID_OPERATION");
    assert.equal(errorOf(DOC(), [SOF({ storyId: 8, source: 2, target: 5 })]).code, "STORY_NOT_FOUND");
    /* la cascada de FASE 3: borrar un extremo libre poda la ruta en el mismo lote */
    const cut = ok(r.document, [SOF({ source: 2, target: 7 }), { op: "delete_node", scope: "page", pageIndex: 0, node: { id: 7 } }]);
    assert.equal("observedFlow" in cut.document.doc.pages[0].scenarios[0], false); assert.deepEqual(cut.changes[1].cascade.observedFlows, [1]);
  });
});

describe("SCENARIOS-SEMANTICS-001 FASE 5 · describe_document", () => {
  it("connectionKind solo en Flujo y Requisito; observedFlow guardado con etiquetas; sin derivación de ruta", () => {
    const d: any = describeDocument({ document: DOC({ observedFlow: { from: 1, to: 5 } }) });
    assert.deepEqual(d.pages[0].connections.map((c: any) => c.connectionKind ?? "—"), ["FLOWS_TO", "FLOWS_TO", "FLOWS_TO", "FLOWS_TO", "FLOWS_TO", "REQUIRES", "—"]);
    assert.ok(d.pages[0].connections.every((c: any) => !("kind" in c)), "nombre distinto de target.kind de los pasos");
    assert.deepEqual(d.pages[0].stories[0].observedFlow, { source: 1, target: 5, sourceLabel: "Cliente", targetLabel: "BD" });
    assert.equal("warnings" in d, false);
    assert.ok(!/AVAILABLE|NO_PATH|routeStatus/.test(JSON.stringify(d.pages)), "el MCP no deriva la ruta (D9)");
    assert.equal("observedFlow" in (describeDocument({ document: DOC() }) as any).pages[0].stories[0], false, "sin ruta guardada (automática): nada");
  });
  it("warnings W2 (extremo perdido) y W3 (kind desconocido): avisos, el documento sigue válido", () => {
    const doc: any = DOC({ observedFlow: { from: 1, to: 77 } }); doc.doc.pages[0].edges.push(Ed(18, 7, 5, "FUTURO"), Ed(19, 5, 7, "GENERIC"));
    const d: any = describeDocument({ document: doc });
    assert.equal(d.valid, true);
    assert.deepEqual(d.warnings.map((w: any) => [w.code, w.entityId ?? w.storyId]), [["unknown_connection_kind", 18], ["observed_flow_endpoint_missing", 1]], "GENERIC (la lectura de Conexión) no avisa");
    assert.equal(d.pages[0].connections.find((c: any) => c.id === 18).connectionKind, undefined, "un kind desconocido se lee como conexión");
    assert.equal(d.pages[0].stories[0].observedFlow.targetLabel, "?");
  });
  it("los ejemplos (sin kind ni observedFlow): ni connectionKind, ni observedFlow, ni warnings", () => {
    for (const fx of loadFixtures()) {
      const s = JSON.stringify(describeDocument({ document: fx.doc }));
      assert.ok(!/"connectionKind"|"observedFlow"|"warnings"/.test(s), fx.name);
    }
  });
});

describe("SCENARIOS-SEMANTICS-001 FASE 5 · export_diagram (marcas, golden compartido con el editor)", () => {
  it("golden: el SVG del MCP es línea a línea el de «Exportar → SVG» del editor (sin los <text>), plano y construido", () => {
    for (const v of GOLD.variants) {
      const d = clone(GOLD.doc); d.doc.theme = v.theme; d.doc.customBg = v.customBg;
      const page = parseDocument(d).doc.pages[0] as FluyoPage;
      const svg = pageToSVG(page, v.theme, { skin: v.skin === "built" ? "built" : null, customBg: v.customBg || null, globalFont: d.settings.font });
      assert.deepEqual(geometryLines(svg), geometryLines(GOLD.svgs[v.name]), v.name);
      assert.equal(markLines(svg).length, 9, v.name + ": 6 cuñas + 3 anillos (no es un golden trivial)");
    }
  });
  it("con kind, el SVG es el de sin kind MÁS las marcas (plano); con la piel, N3 quita el anillo de salida de los Requisitos", () => {
    const withKind = parseDocument(DOC()).doc.pages[0] as FluyoPage, plain = clone(withKind); plain.edges.forEach((e: any) => delete e.kind);
    const a = pageToSVG(withKind, "dark"), b = pageToSVG(plain, "dark");
    assert.deepEqual(a.split("\n").filter(l => !/stroke-width="1\.6"/.test(l)), b.split("\n"));
    assert.equal(markLines(a).length, 5 * 2 + 1);
    const sa = pageToSVG(withKind, "dark", { skin: "built" }), sb = pageToSVG(plain, "dark", { skin: "built" });
    const ports = (s: string) => s.split("\n").filter(l => /^<path d="[^"]*" fill="#[0-9A-Fa-f]+" stroke="[^"]*" stroke-width="[\d.]+"\/>$/.test(l) && !/stroke-width="1\.6"/.test(l)).length;
    assert.equal(ports(sb) - ports(sa), 1, "un Requisito: un anillo de salida menos");
  });
  it("edgeKind y edgeSemanticMarks: genérica, desconocida y GENERIC sin marcas; Flujo corto sin cuñas", () => {
    for (const k of [undefined, "GENERIC", "FUTURO", 3]) { assert.equal(edgeKind({ kind: k }), "GENERIC"); assert.equal(edgeSemanticMarks({ kind: k }, [{ x: 0, y: 0 }, { x: 100, y: 0 }]), null); }
    assert.deepEqual(edgeSemanticMarks({ kind: "FLOWS_TO" }, [{ x: 0, y: 0 }, { x: 20, y: 0 }]), { kind: "FLOWS_TO", chevrons: [] });
    const ring = edgeSemanticMarks({ kind: "REQUIRES" }, [{ x: 0, y: 0 }, { x: 100, y: 0 }])!.ring!;
    assert.deepEqual([ring.x, ring.y, ring.r], [10, 0, 4.2]);
  });
  let h: Harness;
  before(async () => { h = await startHarness(); });
  after(async () => { await h.close(); });
  it("las tools: create_diagram → export_diagram lleva las marcas; describe_document por la tool; author_document set_observed_flow", async () => {
    const created = await h.client.callTool({ name: "create_diagram", arguments: { nodes: [{ key: "a", shape: "rect", label: "A" }, { key: "b", shape: "rect", label: "B" }], edges: [{ from: "a", to: "b", kind: "FLOWS_TO" }] } });
    assert.ok(!isToolError(created), textOf(created));
    const doc = documentOf(created);
    const svg = textOf(await h.client.callTool({ name: "export_diagram", arguments: { document: doc } }));
    assert.equal(markLines(svg).length, 2, "dos cuñas");
    const desc = documentOf(await h.client.callTool({ name: "describe_document", arguments: { document: doc } }));
    assert.deepEqual(desc.pages[0].connections.map((c: any) => c.connectionKind), ["FLOWS_TO"], "describe_document por la tool");
    const authored = await h.client.callTool({ name: "author_document", arguments: { document: doc, baseRevision: desc.revision,
      operations: [{ op: "create_story", scope: "story", pageIndex: 0, ref: "h" }, { op: "set_observed_flow", scope: "story", pageIndex: 0, storyId: { ref: "h" }, source: 1, target: 2 }] } });
    assert.ok(!isToolError(authored), textOf(authored));
    assert.deepEqual(documentOf(authored).document.doc.pages[0].scenarios[0].observedFlow, { from: 1, to: 2 }, "set_observed_flow por la tool (zod + kernel)");
    const tools = await h.client.listTools();
    const authorTool = tools.tools.find(t => t.name === "author_document")!;
    assert.ok(authorTool.description!.includes("set_arrival_dependencies, set_observed_flow (alcance 'story')") && JSON.stringify(authorTool.inputSchema).includes("set_observed_flow"), "author_document publica set_observed_flow en su lista de operaciones");
    assert.ok(tools.tools.find(t => t.name === "describe_document")!.description!.includes("connectionKind"));
  });
});

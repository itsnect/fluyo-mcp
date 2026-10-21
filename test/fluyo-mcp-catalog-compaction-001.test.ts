/**
 * FLUYO-MCP-CATALOG-COMPACTION-001 — definiciones compartidas en tools/list (Zod `.meta({ id })`).
 *
 *   T1. Tamaño: tools/list ≤ 63 000 B (guarda de regresión; medido 61 829 sobre 2fc47c4, que daba 71 760) y < 72 000 (tope duro).
 *   T2. author_document publica exactamente 5 definitions (IdOrRef, Wait, Target, Presentation, Endpoint), cada una usada al menos
 *       dos veces; ninguna otra tool publica definitions ni $ref.
 *   T3. Forma draft-07: cada $ref apunta a una definition que existe y va solo o como único elemento de un allOf (en draft-07 los
 *       hermanos de un $ref se ignoran; Zod los pone fuera del allOf).
 *   T4. Equivalencia: desreferenciado, el catálogo es idéntico tool a tool al que publica Zod sin los ids (la forma expandida de antes);
 *       y quitar y volver a poner los ids deja el catálogo compacto byte a byte.
 *   T5. La validación es la de siempre: un lote que usa las cinco definiciones (con {ref}) se aplica por tools/call, y lo que el schema
 *       rechazaba se sigue rechazando.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { SHARED_DEFINITIONS } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { derefSchema, documentOf, isToolError, startHarness, textOf, type Harness } from "./helpers.js";

const NAMES = ["IdOrRef", "Wait", "Target", "Presentation", "Endpoint"];
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

/** El catálogo tal como lo publicaría Zod sin los ids: se quitan del registro global, se lista con un servidor nuevo y se reponen. */
async function listExpanded() {
  const saved = Object.values(SHARED_DEFINITIONS).map(s => [s, z.globalRegistry.get(s)!] as const);
  for (const [s] of saved) z.globalRegistry.remove(s);
  try {
    const other = await startHarness();
    try { return (await other.client.listTools()).tools; } finally { await other.close(); }
  } finally {
    for (const [s, meta] of saved) z.globalRegistry.add(s, meta);
  }
}

function refsOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach(x => refsOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "$ref") out.push(x as string); else refsOf(x, out); }
  return out;
}

describe("T1 · tamaño de tools/list", () => {
  it("≤ 63 000 B (guarda de la compactación) y por debajo del tope duro de 72 000", async () => {
    const bytes = Buffer.byteLength(JSON.stringify(await h.client.listTools()));
    assert.ok(bytes <= 63_000, `tools/list = ${bytes} B`);
    assert.ok(bytes < 72_000);
  });
});

describe("T2 · qué se comparte", () => {
  it("author_document publica las 5 definitions, cada una usada ≥ 2 veces; ninguna otra tool usa $ref", async () => {
    const { tools } = await h.client.listTools();
    assert.deepEqual(Object.keys(SHARED_DEFINITIONS).sort(), [...NAMES].sort());
    for (const t of tools) {
      const s = t.inputSchema as any;
      if (t.name !== "author_document") {
        assert.equal(s.definitions, undefined, `${t.name}: definitions`);
        assert.deepEqual(refsOf(s), [], `${t.name}: $ref`);
        continue;
      }
      assert.deepEqual(Object.keys(s.definitions).sort(), [...NAMES].sort());
      const refs = refsOf(s);
      for (const n of NAMES) assert.ok(refs.filter(r => r === `#/definitions/${n}`).length >= 2, `${n} se usa al menos dos veces`);
      assert.equal(refs.filter(r => r === "#/definitions/IdOrRef").length > 20, true, "IdOrRef es la que más se repite");
    }
  });

  it("las descriptions de las definiciones se publican enteras, una vez (Wait de la dec. 200, Target de STEP-REVERSE)", async () => {
    const s = (await h.client.listTools()).tools.find(t => t.name === "author_document")!.inputSchema as any;
    const text = JSON.stringify(s);
    assert.match(s.definitions.Wait.description, /INICIO del momento anterior/);
    assert.match(s.definitions.Target.description, /reverse:true \(solo conexión\) la recorre de to a from/);
    for (const d of [s.definitions.Wait.description, s.definitions.Target.description, s.definitions.Presentation.description])
      assert.equal(text.split(JSON.stringify(d)).length - 1, 1, d.slice(0, 40));
  });
});

describe("T3 · forma draft-07 de las referencias", () => {
  it("cada $ref resuelve y va solo o como único elemento de un allOf", async () => {
    const s = (await h.client.listTools()).tools.find(t => t.name === "author_document")!.inputSchema as any;
    assert.equal(s.$schema, "http://json-schema.org/draft-07/schema#");
    const walk = (v: any) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      if ("$ref" in v) {
        assert.deepEqual(Object.keys(v), ["$ref"], `$ref con hermanos: ${JSON.stringify(v).slice(0, 120)}`);
        assert.ok(/^#\/definitions\/(.+)$/.exec(v.$ref)?.[1]! in s.definitions, v.$ref);
      }
      if (Array.isArray(v.allOf) && v.allOf.some((x: any) => x && "$ref" in x)) assert.equal(v.allOf.length, 1, "allOf con $ref y algo más");
      Object.values(v).forEach(walk);
    };
    walk(s);
  });
});

describe("T4 · desreferenciado, el catálogo es el de antes", () => {
  it("tool a tool, deref(publicado) = lo que publica Zod sin los ids; reponer los ids deja el catálogo igual byte a byte", async () => {
    const before = (await h.client.listTools()).tools;
    const expanded = await listExpanded();
    assert.equal(JSON.stringify(expanded).includes("$ref"), false, "sin ids no queda ningún $ref");
    assert.ok(Buffer.byteLength(JSON.stringify(expanded)) > Buffer.byteLength(JSON.stringify(before)) + 9_000, "la forma expandida es la grande");
    assert.deepEqual(before.map(t => t.name), expanded.map(t => t.name));
    for (const [i, t] of before.entries()) assert.deepEqual({ ...t, inputSchema: derefSchema(t.inputSchema) }, expanded[i], t.name);
    assert.equal(JSON.stringify((await h.client.listTools()).tools), JSON.stringify(before), "los ids se reponen");
  });
});

describe("T5 · la validación no cambia", () => {
  const BLANK = { version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", cur: 0, nextEventTypeId: 1, eventTypes: [],
    pages: [{ name: "P", nodes: [], edges: [], nextId: 1, behaviors: [], scenarios: [], nextScenarioId: 1 }] } };
  const P = { scope: "page", pageIndex: 0 }, ST = { scope: "story", pageIndex: 0 };
  /* Un lote que pasa por las cinco definiciones: Endpoint (source/target/node), IdOrRef (storyId, eventTypeId, stepId, edgeId, nodeId),
     Target ({edgeId:{ref}, reverse}, {nodeId:{ref}}), Wait (waitMs en add_step y set_wait) y Presentation (create/update_event_type). */
  const OPS = [
    { op: "create_node", ...P, ref: "A", spec: { shape: "rect", x: 200, y: 300, label: "A" } },
    { op: "create_node", ...P, ref: "B", spec: { shape: "rect", x: 500, y: 300, label: "B" } },
    { op: "create_connection", ...P, ref: "AB", source: { ref: "A" }, target: { ref: "B" } },
    { op: "create_event_type", scope: "eventType", ref: "send", name: "Envío", primitive: "FLOW", sentence: "{source} → {target}", presentation: { connectionEffects: { arrival: "pulse" } } },
    { op: "create_event_type", scope: "eventType", ref: "occ", name: "Procesa", primitive: "OCCURRENCE", sentence: "{target} procesa" },
    { op: "update_event_type", scope: "eventType", eventTypeId: { ref: "occ" }, presentation: { nodeEffects: { highlight: true } } },
    { op: "create_story", ...ST, ref: "H", name: "Historia" },
    { op: "add_step", ...ST, storyId: { ref: "H" }, eventTypeId: { ref: "send" }, target: { edgeId: { ref: "AB" } }, ref: "s1" },
    { op: "add_step", ...ST, storyId: { ref: "H" }, eventTypeId: { ref: "occ" }, target: { nodeId: { ref: "B" } }, waitMs: 500, waitsForArrivalOf: [{ ref: "s1" }], ref: "s2" },
    { op: "add_step", ...ST, storyId: { ref: "H" }, eventTypeId: { ref: "send" }, target: { edgeId: { ref: "AB" }, reverse: true }, ref: "s3" },
    { op: "set_wait", ...ST, storyId: { ref: "H" }, stepId: { ref: "s3" }, waitMs: 800 },
  ];
  const call = (operations: unknown[], document: unknown = BLANK) =>
    h.client.callTool({ name: "author_document", arguments: { document, baseRevision: rev(document), operations } });

  it("el lote con {ref} en las cinco definiciones se aplica por tools/call", async () => {
    const r = await call(OPS);
    assert.equal(isToolError(r), false, textOf(r));
    const out = documentOf(r);
    assert.equal(out.ok, true);
    const story = out.document.doc.pages[0].scenarios[0];
    assert.deepEqual(story.steps.map((s: any) => [s.action, s.reverse ?? false]), [["SEND", false], ["OCCURRENCE", false], ["SEND", true]]);
    assert.deepEqual(story.arrivalDependencies, [{ stepId: 2, waitsForArrivalOf: [1] }]);
  });

  it("lo que el schema rechazaba se sigue rechazando (ref vacío, reverse en nodeId, waitMs fuera de rango, Endpoint con ref e id, efecto inexistente)", async () => {
    const bad = [
      { ...OPS[7], storyId: { ref: "" } },
      { ...OPS[8], target: { nodeId: { ref: "B" }, reverse: true } },
      { ...OPS[8], waitMs: 86_400_001 },
      { ...OPS[2], source: { ref: "A", id: 1 } },
      { ...OPS[3], presentation: { connectionEffects: { arrival: "boom" } } },
    ];
    for (const op of bad) {
      const r = await call([...OPS.slice(0, 7), op]);
      assert.equal(isToolError(r), true, JSON.stringify(op));
      assert.match(textOf(r), /validation|Invalid/i, JSON.stringify(op));
    }
  });
});

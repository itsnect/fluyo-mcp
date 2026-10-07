/**
 * FLUYO-018.9 — create_diagram y create_from_template por el dominio (sin tool nueva: siguen 16).
 *
 * Lo que se prueba:
 *   · documento v5 CANÓNICO: el mismo, byte a byte, que la construcción equivalente con el dominio (documento en blanco del kernel +
 *     author_document), con golden derivado de la ruta del DOMINIO (fixtures/fluyo-018-9-golden.json; UPDATE_GOLDEN=1 lo regenera);
 *   · defaults del dominio (code, icon, text, conexiones), sin claves heredadas (fs, lineColor, dotColor, meta.generator);
 *   · nombres de color solo en la ENTRADA (se traducen a HEX antes del dominio); el resto de reglas, límites y auto-lazo los decide el kernel;
 *   · errores estructurados (los mismos códigos que author_document) con la ruta de la entrada y sin trazas;
 *   · determinismo y revisión; create_from_template por la misma ruta para cada plantilla del catálogo.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { authorDocument } from "../src/authoring.js";
import { createDiagram, createDiagramResult } from "../src/diagram.js";
import { createKernel } from "../src/kernel.js";
import { layeredLayout } from "../src/layout.js";
import { revisionOf } from "../src/revision.js";
import { CODE_DEFAULT_LABEL, DEFAULT_LANG, DEFAULT_SIZES, PALETTE } from "../src/schema.js";
import { TEMPLATES } from "../src/templates.js";
import { documentOf, isToolError, packageRoot, startHarness, textBlocks, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const GOLDEN = join(ROOT, "test", "fixtures", "fluyo-018-9-golden.json");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const NO_LEAK = /TypeError|Cannot read|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const hexOf = (name: string) => PALETTE.find(p => p.name === name)!.hex;

/* ── la ruta del DOMINIO: el documento en blanco del editor (model.js) + operaciones de author_document ── */
const blank = (): any => createKernel().call("serializeProject()");
function domain(ops: unknown[], settings?: Record<string, unknown>): any {
  const base = blank();
  if (settings) Object.assign(base.settings, settings);
  if (!ops.length) return (createKernel().call("FluyoAuthoring.normalizedProject(__a)", base) as any).project;
  const r = authorDocument({ document: base, baseRevision: rev(base), operations: ops }) as any;
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.document;
}
const N = (spec: Record<string, unknown>, ref?: string) => ({ op: "create_node", scope: "page", pageIndex: 0, spec, ...(ref ? { ref } : {}) });
const C = (s: string, t: string, spec?: Record<string, unknown>) => ({ op: "create_connection", scope: "page", pageIndex: 0, source: { ref: s }, target: { ref: t }, ...(spec ? { spec } : {}) });
const RP = (name: string) => ({ op: "rename_page", scope: "document", pageIndex: 0, name });
const TH = (patch: Record<string, unknown>) => ({ op: "set_theme", scope: "document", ...patch });

/** Posiciones del auto-layout (herramienta del adaptador, decisión 98) para la parte de la paridad que depende de él. */
function layoutOf(nodes: any[], edges: any[]) {
  const ln = nodes.map(n => ({ key: n.key, w: n.w ?? DEFAULT_SIZES[n.shape as keyof typeof DEFAULT_SIZES][0], h: n.h ?? DEFAULT_SIZES[n.shape as keyof typeof DEFAULT_SIZES][1] }));
  return layeredLayout(ln, edges.map(e => ({ from: e.from, to: e.to, label: e.label, fs: e.fs, bold: e.bold }))).positions;
}

/* ── casos de paridad: entrada de create_diagram ↔ operaciones equivalentes del dominio (colores ya en HEX) ── */
interface Case { name: string; tool: "create_diagram" | "create_from_template"; input: Record<string, unknown>; ops: () => unknown[]; settings?: Record<string, unknown> }
const CASES: Case[] = [
  { name: "un nodo", tool: "create_diagram", input: { nodes: [{ key: "a", shape: "rect", x: 100, y: 120 }] }, ops: () => [N({ shape: "rect", x: 100, y: 120 }, "a")] },
  {
    name: "todas las formas creables con sus defaults", tool: "create_diagram",
    input: {
      pageName: "Formas",
      nodes: [
        { key: "r", shape: "rect", x: 0, y: 0 }, { key: "cy", shape: "cylinder", x: 200, y: 0 }, { key: "d", shape: "diamond", x: 400, y: 0 },
        { key: "ci", shape: "circle", x: 600, y: 0 }, { key: "hx", shape: "hex", x: 800, y: 0 }, { key: "t", shape: "text", x: 0, y: 200 },
        { key: "co", shape: "code", x: 200, y: 200 }, { key: "ic", shape: "icon", icon: "kafka", x: 400, y: 200 }, { key: "an", shape: "anim", anim: "spinner", x: 600, y: 200 },
      ],
    },
    ops: () => [
      RP("Formas"),
      N({ shape: "rect", x: 0, y: 0 }), N({ shape: "cylinder", x: 200, y: 0 }), N({ shape: "diamond", x: 400, y: 0 }), N({ shape: "circle", x: 600, y: 0 }),
      N({ shape: "hex", x: 800, y: 0 }), N({ shape: "text", x: 0, y: 200 }), N({ shape: "code", x: 200, y: 200 }), N({ shape: "icon", icon: "kafka", x: 400, y: 200 }),
      N({ shape: "anim", anim: "spinner", x: 600, y: 200 }),
    ],
  },
  {
    name: "estilos y colores por nombre", tool: "create_diagram",
    input: {
      nodes: [
        { key: "a", shape: "rect", x: 0, y: 0, label: "A", color: "Servicio", fill: "none", border: "dashed", lblPos: "top", textBg: "Datos", textColor: "#fff", bold: true, pulse: true, order: 3, fs: 18, w: 200, h: 90, font: "Arial, Helvetica, sans-serif" },
        { key: "b", shape: "code", x: 300, y: 0, label: "SELECT 1", lang: "none", keywords: ["SELECT"], kwBg: "éxito", kwColor: "#00000080", color: "Exito" },
        { key: "c", shape: "icon", icon: "ai", x: 600, y: 0, tint: true, color: "IA" },
      ],
      edges: [
        { from: "a", to: "b", label: "consulta", route: "ortho", dashed: true, lineColor: "Alerta", dotColor: "#abc", flowDir: "alternate", fromSide: "e", toSide: "w", startArrow: true, endArrow: false, animated: false, fs: 14, bold: true, font: "Georgia, serif", speedFac: 2 },
        { from: "b", to: "c", dots: 5 },
        { from: "c", to: "a", dots: 2, dotsGlobal: true },
      ],
    },
    ops: () => [
      N({ shape: "rect", x: 0, y: 0, label: "A", color: hexOf("Servicio"), fill: "none", border: "dashed", lblPos: "top", textBg: hexOf("Datos"), textColor: "#fff", bold: true, pulse: true, order: 3, fs: 18, w: 200, h: 90, font: "Arial, Helvetica, sans-serif" }, "a"),
      N({ shape: "code", x: 300, y: 0, label: "SELECT 1", lang: "none", keywords: ["SELECT"], kwBg: hexOf("Éxito"), kwColor: "#00000080", color: hexOf("Éxito") }, "b"),
      N({ shape: "icon", icon: "ai", x: 600, y: 0, tint: true, color: hexOf("IA") }, "c"),
      C("a", "b", { label: "consulta", route: "ortho", dashed: true, lineColor: hexOf("Alerta"), dotColor: "#abc", flowDir: "alternate", fromSide: "e", toSide: "w", startArrow: true, endArrow: false, animated: false, fs: 14, bold: true, font: "Georgia, serif", speedFac: 2 }),
      // create_diagram: «dots» propio implica dotsGlobal:false salvo que se diga otra cosa (su contrato de siempre)
      C("b", "c", { dots: 5, dotsGlobal: false }),
      C("c", "a", { dots: 2, dotsGlobal: true }),
    ],
  },
  {
    name: "code con campos parciales (keywords/kwBg sin lang, kwColor con lang)", tool: "create_diagram",
    input: { nodes: [{ key: "a", shape: "code", x: 0, y: 0, keywords: ["cat"], kwBg: "Config" }, { key: "b", shape: "code", x: 400, y: 0, lang: "none", kwColor: "#161410" }] },
    ops: () => [N({ shape: "code", x: 0, y: 0, keywords: ["cat"], kwBg: hexOf("Config") }, "a"), N({ shape: "code", x: 400, y: 0, lang: "none", kwColor: "#161410" }, "b")],
  },
  {
    name: "ajustes, tema y fondo", tool: "create_diagram",
    input: { pageName: "Ajustes", theme: "crema", customBg: "#0a0a0a", speed: 2, dots: 6, stagger: 1.2, build: true, grid: false, single: true, font: "Arial, Helvetica, sans-serif", nodes: [{ key: "a", shape: "rect", x: 0, y: 0 }] },
    ops: () => [RP("Ajustes"), TH({ theme: "crema", customBg: "#0a0a0a" }), N({ shape: "rect", x: 0, y: 0 }, "a")],
    settings: { speed: 2, dots: 6, stagger: 1.2, build: true, grid: false, single: true, font: "Arial, Helvetica, sans-serif" },
  },
  {
    name: "auto-layout de un grafo con ciclo", tool: "create_diagram",
    input: {
      nodes: [{ key: "a", shape: "rect", label: "API" }, { key: "b", shape: "cylinder", label: "DB" }, { key: "c", shape: "rect", label: "Cache" }, { key: "d", shape: "diamond", label: "?" }],
      edges: [{ from: "a", to: "b", label: "lee" }, { from: "a", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "a" }],
    },
    ops: () => {
      const nodes = [{ key: "a", shape: "rect", label: "API" }, { key: "b", shape: "cylinder", label: "DB" }, { key: "c", shape: "rect", label: "Cache" }, { key: "d", shape: "diamond", label: "?" }];
      const edges = [{ from: "a", to: "b", label: "lee" }, { from: "a", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "a" }];
      const pos = layoutOf(nodes, edges);
      return [...nodes.map(n => N({ shape: n.shape, label: n.label, ...pos.get(n.key) }, n.key)), ...edges.map(e => C(e.from, e.to, e.label ? { label: e.label } : undefined))];
    },
  },
  ...TEMPLATES.map((t): Case => ({
    name: `plantilla ${t.id}`, tool: "create_from_template", input: { templateId: t.id },
    ops: () => {
      const b = t.build({});
      const pos = layoutOf(b.nodes, b.edges);
      return [
        RP(b.suggestedPageName), TH({ theme: b.suggestedTheme }),
        ...b.nodes.map(n => { const { key, color, ...rest } = n as any; return N({ ...rest, ...(color ? { color: hexOf(color) } : {}), ...pos.get(key) }, key); }),
        ...b.edges.map(e => { const { from, to, ...rest } = e as any; return C(from, to, Object.keys(rest).length ? rest : undefined); }),
      ];
    },
  })),
];

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const createJson = async (args: Record<string, unknown>) => {
  const r = await call("create_diagram", args);
  assert.equal(isToolError(r), false, textOf(r));
  return documentOf(r);
};
const rejected = async (args: Record<string, unknown>, code: string, tool = "create_diagram") => {
  const res = await call(tool, args);
  assert.equal(isToolError(res), true, code);
  assert.equal(NO_LEAK.test(textOf(res)), false, `sin trazas: ${textOf(res)}`);
  const r = documentOf(res);
  assert.equal(r.ok, false);
  assert.equal(r.document, undefined);
  assert.equal(r.errors[0].code, code, JSON.stringify(r.errors));
  assert.match(textBlocks(res)[0], new RegExp(code));
  return r.errors[0];
};

describe("paridad con el dominio (golden derivado de la ruta del dominio)", () => {
  const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, "utf8")) : null;

  it("cada caso: la construcción con el dominio coincide con el golden (byte a byte) y con su revisión", () => {
    const out = CASES.map(c => { const document = domain(c.ops(), c.settings); return { name: c.name, tool: c.tool, input: c.input, revision: rev(document), document }; });
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, JSON.stringify({ note: "Generado por la ruta del DOMINIO (documento en blanco de model.js + author_document). UPDATE_GOLDEN=1 lo regenera.", cases: out }, null, 2) + "\n");
    assert.ok(golden || process.env.UPDATE_GOLDEN === "1", "falta el golden: UPDATE_GOLDEN=1");
    const g = process.env.UPDATE_GOLDEN === "1" || !golden ? JSON.parse(readFileSync(GOLDEN, "utf8")) : golden;
    assert.equal(g.cases.length, CASES.length);
    out.forEach((o, i) => {
      assert.equal(JSON.stringify(o.document), JSON.stringify(g.cases[i].document), o.name);
      assert.equal(o.revision, g.cases[i].revision, o.name);
    });
  });

  for (const c of CASES) {
    it(`${c.tool} = dominio: ${c.name} (estructura, orden de claves, ids, nextId, cur, campos, revisión)`, async () => {
      const r = await call(c.tool, c.input);
      assert.equal(isToolError(r), false, textOf(r));
      const got = documentOf(r), want = domain(c.ops(), c.settings);
      assert.equal(JSON.stringify(got), JSON.stringify(want), c.name);
      assert.equal(rev(got), rev(want));
      assert.deepEqual(Object.keys(got), ["version", "app", "doc", "settings"]);
      assert.equal(got.version, 5);
      assert.deepEqual(got.doc.eventTypes, []);
      assert.deepEqual([got.doc.pages[0].behaviors, got.doc.pages[0].scenarios], [[], []]);
    });
  }
});

describe("create_diagram: documento v5 canónico", () => {
  it("documento vacío: sin nodos, el adaptador da el documento en blanco del editor; la tool sigue exigiendo ≥1 nodo", async () => {
    const r = createDiagramResult({ nodes: [], edges: [] } as any);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(JSON.stringify(r.project), JSON.stringify(domain([])));
    assert.equal(r.revision, rev(blank()));
    const res = await call("create_diagram", { nodes: [] });
    assert.equal(isToolError(res), true);
    assert.equal(NO_LEAK.test(textOf(res)), false);
  });

  it("un nodo, varios nodos, una conexión y varias: ids y nextId del dominio", async () => {
    const one = await createJson({ nodes: [{ key: "a", shape: "rect", x: 0, y: 0 }] });
    assert.deepEqual([one.doc.pages[0].nodes.length, one.doc.pages[0].edges.length, one.doc.pages[0].nextId], [1, 0, 2]);
    const many = await createJson({
      nodes: [{ key: "a", shape: "rect" }, { key: "b", shape: "rect" }, { key: "c", shape: "rect" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c", label: "x" }],
    });
    const pg = many.doc.pages[0];
    assert.deepEqual(pg.nodes.map((n: any) => n.id), [1, 2, 3]);
    assert.deepEqual(pg.edges.map((e: any) => [e.id, e.from, e.to]), [[4, 1, 2], [5, 2, 3], [6, 1, 3]]);
    assert.equal(pg.nextId, 7);
    assert.equal(many.doc.cur, 0);
  });

  it("v5, sin meta.generator, sin «key» ni claves heredadas (fs, lineColor, dotColor) si nadie las pidió", async () => {
    const d = await createJson({ nodes: [{ key: "a", shape: "rect" }, { key: "b", shape: "code" }], edges: [{ from: "a", to: "b" }] });
    assert.equal(d.version, 5);
    assert.equal("meta" in d, false);
    assert.equal(JSON.stringify(d).includes("generator"), false);
    for (const n of d.doc.pages[0].nodes) for (const k of ["fs", "key", "ref"]) assert.equal(k in n, false, `nodo ${n.id}: ${k}`);
    for (const e of d.doc.pages[0].edges) for (const k of ["fs", "lineColor", "dotColor", "key", "ref"]) assert.equal(k in e, false, `conexión ${e.id}: ${k}`);
  });

  it("defaults de code: etiqueta, lang y keywords/kwBg/kwColor del dominio", async () => {
    const d = await createJson({ nodes: [{ key: "q", shape: "code" }] });
    const n = d.doc.pages[0].nodes[0];
    assert.equal(n.label, CODE_DEFAULT_LABEL);
    assert.notEqual(n.label, "Nodo");
    assert.deepEqual([n.lang, n.keywords, n.kwBg, n.kwColor], [DEFAULT_LANG, null, null, null]);
    assert.deepEqual([n.w, n.h], DEFAULT_SIZES.code);
  });

  it("campos de code parciales (createNodeIn): ni author_document ni create_diagram pierden keywords/kwBg/kwColor; el resto, null", async () => {
    const CK = ["lang", "keywords", "kwBg", "kwColor"];
    const cases: Array<[Record<string, unknown>, unknown[]]> = [
      [{ keywords: ["cat", "grep"] }, [DEFAULT_LANG, ["cat", "grep"], null, null]],
      [{ lang: "none", keywords: ["SELECT"] }, ["none", ["SELECT"], null, null]],
      [{ kwBg: "#c9b458", kwColor: "#161410" }, [DEFAULT_LANG, null, "#c9b458", "#161410"]],
      [{ lang: "sql", kwBg: "#c9b458", kwColor: "#161410" }, ["sql", null, "#c9b458", "#161410"]],
      [{}, [DEFAULT_LANG, null, null, null]],
    ];
    for (const [fields, want] of cases) {
      const viaAuthor = domain([N({ shape: "code", x: 0, y: 0, ...fields })]).doc.pages[0].nodes[0];
      const viaCreate = (await createJson({ nodes: [{ key: "q", shape: "code", x: 0, y: 0, ...fields }] })).doc.pages[0].nodes[0];
      assert.deepEqual(CK.map(k => viaAuthor[k]), want, `author_document ${JSON.stringify(fields)}`);
      assert.deepEqual(Object.keys(viaAuthor).slice(-4), CK, "las cuatro claves, en el orden del editor");
      assert.equal(JSON.stringify(viaCreate), JSON.stringify(viaAuthor), `create_diagram ${JSON.stringify(fields)}`);
    }
  });

  it("keywords propias se conservan; los campos de code no aparecen en otras formas", async () => {
    const d = await createJson({ nodes: [{ key: "q", shape: "code", keywords: ["cat", "grep"], kwBg: "#c9b458" }, { key: "r", shape: "rect" }] });
    const [q, r] = d.doc.pages[0].nodes;
    assert.deepEqual([q.keywords, q.kwBg, q.kwColor], [["cat", "grep"], "#c9b458", null]);
    for (const k of ["lang", "keywords", "kwBg", "kwColor"]) assert.equal(k in r, false, k);
  });

  it("defaults del dominio en el resto de formas y en las conexiones", async () => {
    const d = await createJson({ nodes: [{ key: "t", shape: "text" }, { key: "i", shape: "icon", icon: "kafka" }, { key: "r", shape: "rect" }], edges: [{ from: "r", to: "t" }] });
    const [t, i, r] = d.doc.pages[0].nodes;
    assert.deepEqual([t.label, i.label, r.label, i.tint], ["Texto", "", "Nodo", false]);
    assert.deepEqual([r.color, r.fill, r.border, r.lblPos, r.textBg, r.textColor, r.font, r.bold, r.pulse], [PALETTE[0].hex, null, "solid", "center", null, null, null, false, false]);
    assert.deepEqual(d.doc.pages[0].edges[0], { id: 4, from: 3, to: 1, fromSide: null, toSide: null, route: "straight", waypoints: [], label: "", font: null, bold: false, animated: true, dashed: false, startArrow: false, endArrow: true, flowDir: "normal" });
  });

  it("determinismo: dos ejecuciones idénticas dan el mismo texto, byte a byte, y la misma revisión (también la de describe_document)", async () => {
    const args = CASES[2].input;
    const a = await call("create_diagram", args), b = await call("create_diagram", args);
    assert.deepEqual(textBlocks(a), textBlocks(b));
    const doc = documentOf(a);
    const described = documentOf(await call("describe_document", { document: doc }));
    assert.equal(described.revision, rev(doc));
    assert.equal(described.valid, true);
    const r1 = createDiagramResult(args as any), r2 = createDiagramResult(args as any);
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) { assert.equal(r1.revision, r2.revision); assert.equal(r1.revision, described.revision); }
  });

  it("más de 200 operaciones: se encadenan lotes internos sin perder ids ni conexiones entre lotes", async () => {
    const nodes = Array.from({ length: 150 }, (_, i) => ({ key: `n${i}`, shape: "rect", x: (i % 15) * 200, y: Math.floor(i / 15) * 150 }));
    const edges = Array.from({ length: 149 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    const d = await createJson({ nodes, edges });
    const pg = d.doc.pages[0];
    assert.deepEqual(pg.nodes.map((n: any) => n.id), nodes.map((_, i) => i + 1));
    assert.deepEqual(pg.edges.map((e: any) => [e.from, e.to]), edges.map((_, i) => [i + 1, i + 2]));
    assert.equal(pg.nextId, 300);
    const want = domain([...nodes.map(n => N({ shape: "rect", x: n.x, y: n.y })), ...edges.map((_, i) => ({ op: "create_connection", scope: "page", pageIndex: 0, source: { id: i + 1 }, target: { id: i + 2 } }))].slice(0, 200));
    assert.equal(JSON.stringify(pg.nodes.slice(0, 150)), JSON.stringify(want.doc.pages[0].nodes));
  });

  it("campos desconocidos de la entrada se ignoran como antes (el schema de create_diagram los descarta)", async () => {
    const d = await createJson({ nodes: [{ key: "a", shape: "rect", x: 0, y: 0, inventado: 1 }], edges: [], extra: true });
    assert.equal("inventado" in d.doc.pages[0].nodes[0], false);
  });
});

describe("create_diagram: colores", () => {
  it("los nombres de la paleta (sin acentos ni mayúsculas) se traducen a HEX y el documento no contiene nombres", async () => {
    const d = await createJson({
      nodes: [{ key: "a", shape: "rect", color: "servicio", fill: "DATOS", textBg: "Éxito", textColor: "exito", x: 0, y: 0 }, { key: "b", shape: "code", kwBg: "Cola", kwColor: "red", x: 300, y: 0 }],
      edges: [{ from: "a", to: "b", lineColor: "Eventos / Kafka", dotColor: "info" }],
    });
    const [a, b] = d.doc.pages[0].nodes, e = d.doc.pages[0].edges[0];
    assert.deepEqual([a.color, a.fill, a.textBg, a.textColor], [hexOf("Servicio"), hexOf("Datos"), hexOf("Éxito"), hexOf("Éxito")]);
    assert.deepEqual([b.kwBg, b.kwColor], [hexOf("Cola"), hexOf("Red")]);
    assert.deepEqual([e.lineColor, e.dotColor], [hexOf("Eventos / Kafka"), hexOf("Info")]);
    const names = new Set(PALETTE.map(p => p.name.toLowerCase()));
    JSON.stringify(d, (_k, v) => { if (typeof v === "string") assert.equal(names.has(v.toLowerCase()), false, v); return v; });
  });

  it("HEX válidos (#rgb, #rrggbb, #rrggbbaa) pasan tal cual; fill:\"none\" es la forma hueca", async () => {
    const d = await createJson({ nodes: [{ key: "a", shape: "rect", color: "#abc", fill: "none", textBg: "#aabbcc", textColor: "#aabbccdd" }] });
    const n = d.doc.pages[0].nodes[0];
    assert.deepEqual([n.color, n.fill, n.textBg, n.textColor], ["#abc", "none", "#aabbcc", "#aabbccdd"]);
  });

  for (const [field, bad] of [["color", "#abcd"], ["color", "#12345"], ["fill", "#1234567"], ["textBg", "rgb(1,2,3)"], ["color", "Fucsia Neón"], ["textColor", "none"], ["kwBg", "transparent"]] as const) {
    it(`color inválido rechazado: ${field}=${JSON.stringify(bad)} → INVALID_FIELD con la ruta de la entrada`, async () => {
      const node = { key: "a", shape: field === "kwBg" ? "code" : "rect", [field]: bad };
      const e = await rejected({ nodes: [{ key: "z", shape: "rect" }, node] }, "INVALID_FIELD");
      assert.equal(e.field, field);
      assert.equal(e.input, "nodes[1]");
      assert.equal(e.key, "a");
      assert.match(e.message, /list_colors/);
      assert.match(e.message, /HEX/);
    });
  }

  it("colores de conexión inválidos → INVALID_FIELD en edges[i]", async () => {
    const e = await rejected({ nodes: [{ key: "a", shape: "rect" }, { key: "b", shape: "rect" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a", dotColor: "#12" }] }, "INVALID_FIELD");
    assert.deepEqual([e.field, e.input], ["dotColor", "edges[1]"]);
  });

  it("customBg: HEX válido y \"\" se aceptan; un texto que no es HEX → INVALID_FIELD (como set_theme)", async () => {
    assert.equal((await createJson({ customBg: "#123", nodes: [{ key: "a", shape: "rect" }] })).doc.customBg, "#123");
    assert.equal((await createJson({ customBg: "", nodes: [{ key: "a", shape: "rect" }] })).doc.customBg, "");
    const e = await rejected({ customBg: "not-a-color", nodes: [{ key: "a", shape: "rect" }] }, "INVALID_FIELD");
    assert.deepEqual([e.field, e.input], ["customBg", "customBg"]);
  });
});

describe("create_diagram: reglas y límites del dominio, con errores estructurados", () => {
  it("auto-lazo A → A: SELF_LOOP, sin documento", async () => {
    const e = await rejected({ nodes: [{ key: "a", shape: "rect" }, { key: "b", shape: "rect" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "a", label: "yo" }] }, "SELF_LOOP");
    assert.equal(e.input, "edges[1]");
  });

  it("auto-lazo también entre lotes internos (nodo creado en un lote anterior)", async () => {
    const nodes = Array.from({ length: 205 }, (_, i) => ({ key: `n${i}`, shape: "rect", x: i * 10, y: 0 }));
    const e = await rejected({ nodes, edges: [{ from: "n3", to: "n3" }] }, "SELF_LOOP");
    assert.equal(e.input, "edges[0]");
  });

  it("300 nodos valen; 301 → LIMIT_EXCEEDED maxNodesPerPage", async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `n${i}`, shape: "rect", x: (i % 20) * 200, y: Math.floor(i / 20) * 150 }));
    assert.equal((await createJson({ nodes: mk(300) })).doc.pages[0].nodes.length, 300);
    const e = await rejected({ nodes: mk(301) }, "LIMIT_EXCEEDED");
    assert.deepEqual([e.limitName, e.limit, e.requested], ["maxNodesPerPage", 300, 301]);
  });

  it("601 conexiones → LIMIT_EXCEEDED maxConnectionsPerPage", async () => {
    const nodes = [{ key: "a", shape: "rect", x: 0, y: 0 }, { key: "b", shape: "rect", x: 300, y: 0 }];
    const edges = Array.from({ length: 601 }, () => ({ from: "a", to: "b" }));
    const e = await rejected({ nodes, edges }, "LIMIT_EXCEEDED");
    assert.deepEqual([e.limitName, e.limit, e.requested], ["maxConnectionsPerPage", 600, 601]);
  });

  it("coordenadas: |x| = 100000 vale; 100001 → LIMIT_EXCEEDED coordMax (no se recorta)", async () => {
    assert.equal((await createJson({ nodes: [{ key: "a", shape: "rect", x: 100000, y: -100000 }] })).doc.pages[0].nodes[0].x, 100000);
    const e = await rejected({ nodes: [{ key: "a", shape: "rect", x: 0, y: 0 }, { key: "b", shape: "rect", x: 1, y: -100001 }] }, "LIMIT_EXCEEDED");
    assert.deepEqual([e.limitName, e.field, e.actual, e.input, e.key], ["coordMax", "y", -100001, "nodes[1]", "b"]);
    assert.doesNotMatch(e.message, /operación \d+/);
  });

  it("tamaños: 10 y 5000 valen; 9 → sizeMin, 5001 → sizeMax", async () => {
    const n = (await createJson({ nodes: [{ key: "a", shape: "rect", w: 10, h: 5000 }] })).doc.pages[0].nodes[0];
    assert.deepEqual([n.w, n.h], [10, 5000]);
    assert.equal((await rejected({ nodes: [{ key: "a", shape: "rect", w: 9 }] }, "LIMIT_EXCEEDED")).limitName, "sizeMin");
    assert.equal((await rejected({ nodes: [{ key: "a", shape: "rect", h: 5001 }] }, "LIMIT_EXCEEDED")).limitName, "sizeMax");
  });

  it("nombre de página: 80 caracteres valen; 81 o solo espacios → INVALID_NAME", async () => {
    assert.equal((await createJson({ pageName: "p".repeat(80), nodes: [{ key: "a", shape: "rect" }] })).doc.pages[0].name, "p".repeat(80));
    for (const bad of ["p".repeat(81), "   "]) {
      const e = await rejected({ pageName: bad, nodes: [{ key: "a", shape: "rect" }] }, "INVALID_NAME");
      assert.equal(e.input, "pageName");
    }
  });

  it("ícono o GIF desconocido → INVALID_FIELD que nombra el catálogo", async () => {
    assert.match((await rejected({ nodes: [{ key: "x", shape: "icon", icon: "no-existe" }] }, "INVALID_FIELD")).message, /list_icons/);
    assert.match((await rejected({ nodes: [{ key: "x", shape: "anim" }] }, "INVALID_FIELD")).message, /list_anims/);
  });

  it("keys: repetida → DUPLICATE_REF; arista hacia una key inexistente → UNKNOWN_REF", async () => {
    const d = await rejected({ nodes: [{ key: "a", shape: "rect" }, { key: "a", shape: "rect" }] }, "DUPLICATE_REF");
    assert.deepEqual([d.field, d.input], ["key", "nodes[1]"]);
    const u = await rejected({ nodes: [{ key: "a", shape: "rect" }], edges: [{ from: "a", to: "zz" }] }, "UNKNOWN_REF");
    assert.deepEqual([u.field, u.input, u.ref], ["to", "edges[0]", "zz"]);
  });

  it("entrada ilegible (nodes no es una lista) se rechaza sin trazas", async () => {
    const res = await call("create_diagram", { nodes: "a,b" });
    assert.equal(isToolError(res), true);
    assert.equal(NO_LEAK.test(textOf(res)), false);
  });

  it("createDiagram (uso interno) lanza un error con los mismos errores estructurados", () => {
    assert.throws(() => createDiagram({ nodes: [{ key: "a", shape: "rect" }], edges: [{ from: "a", to: "a" }] } as any), (err: any) => err.errors?.[0]?.code === "SELF_LOOP");
  });
});

describe("create_diagram: ajustes con la semántica del editor", () => {
  it("sin ajustes, los del dominio (DEFAULT_SETTINGS de model.js) con las mismas claves", async () => {
    const d = await createJson({ nodes: [{ key: "a", shape: "rect" }] });
    assert.deepEqual(d.settings, blank().settings);
    assert.deepEqual(Object.keys(d.settings), Object.keys(blank().settings));
    assert.deepEqual([d.doc.theme, d.doc.customBg, d.doc.pages[0].name], [blank().doc.theme, blank().doc.customBg, blank().doc.pages[0].name]);
  });

  it("rangos de los controles del editor: speed .2–2 y stagger .2–1,2 valen en los extremos; fuera se rechazan (no se recortan)", async () => {
    const d = await createJson({ speed: 0.2, stagger: 0.2, nodes: [{ key: "a", shape: "rect" }] });
    assert.deepEqual([d.settings.speed, d.settings.stagger], [0.2, 0.2]);
    for (const bad of [{ speed: 2.1 }, { speed: 0.1 }, { stagger: 1.3 }, { stagger: 0 }, { dots: 7 }, { dots: 0 }]) {
      const res = await call("create_diagram", { ...bad, nodes: [{ key: "a", shape: "rect" }] });
      assert.equal(isToolError(res), true, JSON.stringify(bad));
      assert.equal(NO_LEAK.test(textOf(res)), false);
    }
  });

  it("los rangos publicados son exactamente los que conserva la carga del editor (settingsFromProjectData): dentro no recorta, fuera sí", async () => {
    const k = createKernel();
    const norm = (s: Record<string, unknown>) => k.call<Record<string, number>>("settingsFromProjectData(__a)", s);
    const props: any = (await h.client.listTools()).tools.find(t => t.name === "create_diagram")!.inputSchema;
    for (const [key, step] of [["speed", 0.1], ["stagger", 0.1], ["dots", 1]] as const) {
      const lo = props.properties[key].minimum, hi = props.properties[key].maximum;
      assert.deepEqual([norm({ [key]: lo })[key], norm({ [key]: hi })[key]], [lo, hi], key);
      assert.deepEqual([norm({ [key]: lo - step })[key], norm({ [key]: hi + step })[key]], [lo, hi], `${key}: fuera del rango el editor recorta`);
    }
  });

  it("una tipografía global que el editor no conoce → INVALID_FIELD font (el editor la cambiaría en silencio)", async () => {
    const e = await rejected({ font: "Comic Sans", nodes: [{ key: "a", shape: "rect" }] }, "INVALID_FIELD");
    assert.deepEqual([e.field, e.input], ["font", "font"]);
    assert.match(e.message, /list_fonts/);
  });
});

describe("create_from_template: la misma ruta para cada plantilla del catálogo", () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: v5, nodos, conexiones, colores HEX de la paleta, sin meta, describe_document y revisión`, async () => {
      const r = await call("create_from_template", { templateId: t.id });
      assert.equal(isToolError(r), false, textOf(r));
      const d = documentOf(r), b = t.build({});
      assert.equal(d.version, 5);
      assert.equal("meta" in d, false);
      const pg = d.doc.pages[0];
      assert.deepEqual([pg.name, d.doc.theme], [b.suggestedPageName, b.suggestedTheme]);
      assert.deepEqual(pg.nodes.map((n: any) => [n.shape, n.label]), b.nodes.map(n => [n.shape, n.label ?? (n.shape === "icon" ? "" : "Nodo")]));
      assert.equal(pg.edges.length, b.edges.length);
      for (const n of pg.nodes) assert.match(n.color, HEX);
      for (const n of pg.nodes) assert.ok(PALETTE.some(p => p.hex === n.color), n.color);
      assert.deepEqual(d.settings, blank().settings, "ajustes por defecto del dominio");
      const described = documentOf(await call("describe_document", { document: d }));
      assert.equal(described.valid, true);
      assert.equal(described.revision, rev(d));
      const again = documentOf(await call("create_from_template", { templateId: t.id }));
      assert.equal(JSON.stringify(again), JSON.stringify(d), "determinista");
    });
  }

  it("labelOverrides, pageName y theme pasan por las mismas reglas del dominio", async () => {
    const d = documentOf(await call("create_from_template", { templateId: "rag_chatbot", pageName: "Mío", theme: "claro", labelOverrides: { llm: "Gemini" } }));
    assert.deepEqual([d.doc.pages[0].name, d.doc.theme], ["Mío", "claro"]);
    assert.equal(d.doc.pages[0].nodes.find((n: any) => n.icon === "ai").label, "Gemini");
    assert.equal((await rejected({ templateId: "rag_chatbot", pageName: "x".repeat(81) }, "INVALID_NAME", "create_from_template")).input, "pageName");
  });

  it("errores de plantilla estructurados: inexistente → TEMPLATE_NOT_FOUND; clave de labelOverrides desconocida → INVALID_FIELD", async () => {
    assert.match((await rejected({ templateId: "no-existe" }, "TEMPLATE_NOT_FOUND", "create_from_template")).message, /list_templates/);
    const e = await rejected({ templateId: "rag_chatbot", labelOverrides: { lmm: "x" } }, "INVALID_FIELD", "create_from_template");
    assert.equal(e.field, "labelOverrides.lmm");
    assert.match(e.message, /user, api, vectordb, llm/);
  });

  it("ninguna plantilla del catálogo contiene Historias ni Behaviors (no hay caso que cubrir más allá del documento sin ellas)", async () => {
    for (const t of TEMPLATES) {
      const d = documentOf(await call("create_from_template", { templateId: t.id }));
      assert.deepEqual([d.doc.eventTypes, d.doc.pages[0].behaviors, d.doc.pages[0].scenarios], [[], [], []]);
    }
  });
});

describe("contrato publicado", () => {
  it("siguen 16 tools; los rangos de speed/stagger publicados son los del editor y no hay defaults duplicados de ajustes", async () => {
    const { tools } = await h.client.listTools();
    assert.equal(tools.length, 16);
    const cd: any = tools.find(t => t.name === "create_diagram")!.inputSchema;
    assert.deepEqual([cd.properties.speed.minimum, cd.properties.speed.maximum, cd.properties.stagger.minimum, cd.properties.stagger.maximum], [0.2, 2, 0.2, 1.2]);
    for (const k of ["speed", "dots", "stagger", "build", "grid", "single", "pageName", "theme"]) assert.equal(cd.properties[k].default, undefined, k);
    assert.ok(!(cd.required ?? []).includes("pageName"));
  });

  it("el documento no se reutiliza entre llamadas (stateless): la entrada no se muta", () => {
    const input = { nodes: [{ key: "a", shape: "rect", color: "Servicio" }], edges: [] };
    const copy = clone(input);
    createDiagramResult(input as any);
    assert.deepEqual(input, copy);
  });
});

describe("servidor real por stdio: tools/list → create_diagram → create_from_template → describe_document → error estructurado", () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: "fluyo-018-9", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "dist-test", "src", "index.js")], stderr: "pipe" }));
  });
  after(async () => { await client?.close(); });
  it("16 tools; documentos v5 iguales a los del dominio con su revisión; rechazo estructurado sin documento", async () => {
    assert.equal((await client.listTools()).tools.length, 16);
    const c = CASES[2];
    const created = await client.callTool({ name: "create_diagram", arguments: c.input });
    assert.equal(isToolError(created), false, textOf(created));
    assert.match(textBlocks(created)[0], /#d=/);
    const doc = documentOf(created);
    assert.equal(doc.version, 5);
    assert.equal(JSON.stringify(doc), JSON.stringify(domain(c.ops(), c.settings)));
    const described = documentOf(await client.callTool({ name: "describe_document", arguments: { document: doc } }));
    assert.deepEqual([described.valid, described.revision], [true, rev(doc)]);
    for (const t of TEMPLATES) {
      const tpl = documentOf(await client.callTool({ name: "create_from_template", arguments: { templateId: t.id } }));
      assert.equal(tpl.version, 5);
      assert.equal("meta" in tpl, false);
      assert.equal(documentOf(await client.callTool({ name: "describe_document", arguments: { document: tpl } })).revision, rev(tpl));
    }
    const bad = await client.callTool({ name: "create_diagram", arguments: { nodes: [{ key: "a", shape: "rect" }], edges: [{ from: "a", to: "a" }] } });
    assert.equal(isToolError(bad), true);
    assert.equal(NO_LEAK.test(textOf(bad)), false);
    const j = documentOf(bad);
    assert.deepEqual([j.ok, j.document, j.errors[0].code, j.errors[0].input], [false, undefined, "SELF_LOOP", "edges[0]"]);
  });
});

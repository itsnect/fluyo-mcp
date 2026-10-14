/**
 * FLUYO-018.27 — `arrowSize` en el MCP, sin necesitar fluyo/ al lado: el port de edgeStroke (src/svg.ts) escala la aguja entera
 * desde la punta; export_diagram la pinta; author_document (create_connection / update_connection) y create_diagram la aceptan,
 * la acotan en [1, 2] por el kernel y la conservan; un documento sin la clave sale idéntico. La paridad vértice a vértice con
 * fluyo/js/geometry.js la mide visual-regression.test.ts (que sí necesita fluyo/).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuthoringOperationSchema, authorDocument } from "../src/authoring.js";
import { createDiagram, parseDocument } from "../src/diagram.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { ARROW_SIZE_MAX, ARROW_SIZE_MIN, EDGE_GAP, EDGE_HEAD_HALF, EDGE_HEAD_LEN, EDGE_HEAD_NOTCH, edgeArrowSize, edgeStroke, pageEdgeGeometry, pageToSVG } from "../src/svg.js";
import { EdgeSpecSchema, type FluyoEdge, type FluyoPage } from "../src/model.js";

type Pt = { x: number; y: number };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const rect = (id: number, x: number, y: number) => ({ id, shape: "rect", x, y, w: 180, h: 70, label: "", color: "#6a9fb5" });
const edge = (id: number, from: number, to: number, o: Record<string, unknown> = {}) =>
  ({ id, from, to, route: "ortho", fromSide: null, toSide: null, waypoints: [], label: "", animated: true, dashed: false, startArrow: false, endArrow: true, flowDir: "normal", ...o });
const page = (nodes: unknown[], edges: unknown[]) => ({ name: "P", nodes, edges, nextId: 99, behaviors: [], scenarios: [], nextScenarioId: 1 }) as unknown as FluyoPage;
const docOf = (pg: unknown) => ({ version: 5, app: "fluyo", doc: { theme: "dark", customBg: "", eventTypes: [], nextEventTypeId: 1, cur: 0, pages: [pg] }, settings: {} });
const rev = (document: unknown) => revisionOf(createKernel(), document) as string;
const author = (document: unknown, operations: unknown[]) => authorDocument({ document, baseRevision: rev(document), operations }) as any;
const heads = (d: string) => [...d.matchAll(/<path d="([^"]*)" fill="[^"]*"\/>/g)].map(m => m[1]);
const verts = (d: string): Pt[] => [...d.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)].map(m => ({ x: +m[1], y: +m[2] }));

describe("FLUYO-018.27: tamaño de las puntas en el MCP", () => {
  it("edgeStroke: ausente = 1 = la aguja de siempre; 1,5× y 2× escalan largo, ancho y muesca desde la punta, que sigue a EDGE_GAP; la línea muere en la muesca", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const base = edgeStroke({ endArrow: true, startArrow: true }, pts);
    assert.deepEqual(edgeStroke({ endArrow: true, startArrow: true, arrowSize: 1 }, pts), base);
    assert.deepEqual(edgeStroke({ endArrow: true, startArrow: true, arrowSize: null }, pts), base);
    assert.deepEqual([ARROW_SIZE_MIN, ARROW_SIZE_MAX, edgeArrowSize({ arrowSize: 7 }), edgeArrowSize({ arrowSize: 0.2 }), edgeArrowSize({}), edgeArrowSize(null)], [1, 2, 2, 1, 1, 1]);
    for (const k of [1.5, 2]) {
      const s = edgeStroke({ endArrow: true, startArrow: true, arrowSize: k }, pts);
      const [fin, ini] = s.heads as Array<Array<{ x: number; y: number }>>;
      assert.ok(near(fin[0].x, 100 - EDGE_GAP) && near(fin[0].y, 0), `${k}×: punta del final a 3 px`);
      assert.ok(near(ini[0].x, EDGE_GAP), `${k}×: punta del inicio a 3 px`);
      assert.ok(near(fin[0].x - fin[1].x, EDGE_HEAD_LEN * k) && near(fin[1].y - fin[3].y, 2 * EDGE_HEAD_HALF * k) && near(fin[0].x - fin[2].x, (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH) * k), `${k}×: ${JSON.stringify(fin)}`);
      const end = s.line[s.line.length - 1] as { x: number }, start = s.line[0] as { x: number };
      assert.ok(near(end.x, fin[2].x) && near(start.x, ini[2].x), `${k}×: la línea va de muesca a muesca`);
      /* cada vértice = punta + k·(v₁ − punta): proporción y orientación */
      (base.heads as Array<Array<{ x: number; y: number }>>).forEach((h1, hi) => {
        const hk = s.heads[hi] as Array<{ x: number; y: number }>;
        for (let v = 0; v < 4; v++) assert.ok(near(hk[v].x, h1[0].x + k * (h1[v].x - h1[0].x)) && near(hk[v].y, h1[0].y + k * (h1[v].y - h1[0].y)), `${k}× v${v}`);
      });
    }
  });

  it("la ruta (pageEdgeGeometry) no depende de arrowSize; en una U y en caras cercanas la punta sigue en su ancla", () => {
    const nodes = [rect(1, 300, 300), rect(2, 700, 300), rect(3, 300 + 180 + 30, 500)];
    const mk = (size?: number) => page(nodes, [edge(4, 1, 2, { fromSide: "e", ...(size ? { arrowSize: size } : {}) }), edge(5, 2, 1, { fromSide: "n", toSide: "n", startArrow: true, ...(size ? { arrowSize: size } : {}) }), edge(6, 1, 3, { ...(size ? { arrowSize: size } : {}) })]);
    const g1 = pageEdgeGeometry(mk()), g2 = pageEdgeGeometry(mk(2));
    assert.deepEqual([...g2.entries()], [...g1.entries()]);
    for (const e of mk(2).edges) {
      const pts = g2.get(e.id)!, s = edgeStroke(e, pts), z = pts[pts.length - 1];
      const tip = s.heads[0][0] as Pt;
      assert.ok(near(Math.hypot(tip.x - z.x, tip.y - z.y), EDGE_GAP), `e${e.id}: punta a ${Math.hypot(tip.x - z.x, tip.y - z.y)}`);
      if (e.startArrow) { const t0 = s.heads[1][0] as Pt; assert.ok(near(Math.hypot(t0.x - pts[0].x, t0.y - pts[0].y), EDGE_GAP), `e${e.id}: punta del inicio`); }
    }
  });

  it("export_diagram (pageToSVG): un documento sin la clave sale byte a byte igual; con 2× la punta mide 22×16 en el SVG y la línea no cambia de ruta", () => {
    const nodes = [rect(1, 300, 300), rect(2, 700, 300)];
    const sin = pageToSVG(page(nodes, [edge(3, 1, 2)]), "dark"), uno = pageToSVG(page(nodes, [edge(3, 1, 2, { arrowSize: 1 })]), "dark"), dos = pageToSVG(page(nodes, [edge(3, 1, 2, { arrowSize: 2 })]), "dark");
    assert.equal(uno, sin);
    assert.notEqual(dos, sin);
    assert.doesNotMatch(dos, /<marker/);
    const h1 = verts(heads(sin)[0]), h2 = verts(heads(dos)[0]);
    assert.deepEqual(h2[0], h1[0], "la punta no se mueve");
    assert.ok(near(h1[0].x - h1[1].x, 11, 0.011) && near(Math.abs(h1[1].y - h1[3].y), 8, 0.011));
    assert.ok(near(h2[0].x - h2[1].x, 22, 0.011) && near(Math.abs(h2[1].y - h2[3].y), 16, 0.011), JSON.stringify(h2));
    const line = (s: string) => s.match(/<path d="([^"]*)" fill="none" stroke="[^"]*" stroke-width="1.5"/)![1];
    assert.equal(line(sin).split(" L ")[0], line(dos).split(" L ")[0], "mismo arranque de la línea");
  });

  it("author_document: create_connection y update_connection aceptan arrowSize, el kernel lo acota en [1, 2], null lo quita y un valor no numérico se rechaza; el resto del documento no cambia", () => {
    const base = docOf(page([rect(1, 0, 0), rect(2, 400, 0)], [edge(3, 1, 2)]));
    const r1 = author(base, [
      { op: "create_connection", scope: "page", pageIndex: 0, source: { id: 1 }, target: { id: 2 }, spec: { arrowSize: 1.5 }, ref: "a" },
      { op: "create_connection", scope: "page", pageIndex: 0, source: { id: 1 }, target: { id: 2 }, spec: { arrowSize: 9 } },
      { op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 3 }, spec: { arrowSize: 2 } },
    ]);
    assert.ok(r1.ok, JSON.stringify(r1.errors));
    const edges = r1.document.doc.pages[0].edges as Array<Record<string, unknown>>;
    assert.deepEqual(edges.map(e => [e.id, "arrowSize" in e ? e.arrowSize : "ausente"]), [[3, 2], [99, 1.5], [100, 2]]);
    const r2 = author(r1.document, [{ op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 3 }, spec: { arrowSize: null } }]);
    assert.ok(r2.ok, JSON.stringify(r2.errors));
    assert.ok(!("arrowSize" in r2.document.doc.pages[0].edges[0]), "null quita la clave");
    const r3 = author(r1.document, [{ op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 3 }, spec: { arrowSize: "2" } }]);
    assert.ok(!r3.ok, "un string se rechaza");
    assert.ok(JSON.stringify(r3.errors).includes("arrowSize"), JSON.stringify(r3.errors));
    /* sin tocar nada más: una operación ajena deja la clave como estaba */
    const r4 = author(r1.document, [{ op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 99 }, spec: { label: "x" } }]);
    assert.ok(r4.ok, JSON.stringify(r4.errors));
    assert.equal(r4.document.doc.pages[0].edges[1].arrowSize, 1.5);
  });

  it("schemas (lo que ve el cliente MCP): ConnectionSpec/ConnectionPatch y EdgeSpec admiten arrowSize; EdgeSpec lo acota en [1, 2] ya en el schema", () => {
    const create = { op: "create_connection", scope: "page", pageIndex: 0, source: { id: 1 }, target: { id: 2 }, spec: { arrowSize: 1.5 } };
    const update = { op: "update_connection", scope: "page", pageIndex: 0, connection: { id: 3 }, spec: { arrowSize: null } };
    assert.deepEqual((AuthoringOperationSchema.parse(create) as any).spec, { arrowSize: 1.5 });
    assert.deepEqual((AuthoringOperationSchema.parse(update) as any).spec, { arrowSize: null });
    assert.throws(() => AuthoringOperationSchema.parse({ ...create, spec: { arrowSizes: 1.5 } }), "una clave desconocida sigue rechazada");
    assert.equal((EdgeSpecSchema.parse({ from: "a", to: "b", arrowSize: 2 }) as Record<string, unknown>).arrowSize, 2, "create_diagram: la clave sobrevive al parse (un z.object no estricto la quitaría si no existiera)");
    assert.throws(() => EdgeSpecSchema.parse({ from: "a", to: "b", arrowSize: 3 }), "create_diagram: 3 está fuera de [1, 2]");
    assert.throws(() => EdgeSpecSchema.parse({ from: "a", to: "b", arrowSize: "2" }));
  });

  it("create_diagram: `arrowSize` en edges[] llega al documento; sin él, la conexión no lleva la clave", () => {
    const p = createDiagram({ nodes: [{ key: "a", shape: "rect", label: "A" }, { key: "b", shape: "rect", label: "B" }], edges: [{ from: "a", to: "b", arrowSize: 1.5 }, { from: "b", to: "a" }] } as never);
    const edges = p.doc.pages[0].edges as Array<Record<string, unknown>>;
    assert.deepEqual(edges.map(e => ("arrowSize" in e ? e.arrowSize : "ausente")), [1.5, "ausente"]);
    const svg = pageToSVG(parseDocument(JSON.parse(JSON.stringify(p))).doc.pages[0], "dark");
    const hs = heads(svg).map(verts);
    assert.ok(near(Math.abs(hs[0][1].y - hs[0][3].y), 12, 0.011) || near(Math.abs(hs[0][1].x - hs[0][3].x), 12, 0.011), "1,5×: aguja de 12 de ancho en el SVG");
  });

  it("documento antiguo (passthrough): FluyoEdgeSchema acepta la clave ausente, numérica o null; el renderer no la exige", () => {
    for (const extra of [{}, { arrowSize: 1.5 }, { arrowSize: null }]) {
      const p = parseDocument(docOf(page([rect(1, 0, 0), rect(2, 400, 0)], [edge(3, 1, 2, extra)])));
      const e = p.doc.pages[0].edges[0] as FluyoEdge & { arrowSize?: number | null };
      assert.ok(pageToSVG(p.doc.pages[0], "crema").includes("<path"));
      assert.equal(edgeArrowSize(e), extra.arrowSize ?? 1);
    }
  });
});

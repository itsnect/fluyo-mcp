/**
 * FLUYO-018.25 — rutas en el renderer del MCP (src/svg.ts), sin necesitar fluyo/ al lado. La misma tabla que
 * fluyo/test/fluyo-018-25.test.cjs; que las dos geometrías coincidan vértice a vértice lo mide la suite de paridad
 * (visual-regression.test.ts), que sí necesita fluyo/.
 *
 * · Carriles por CANAL: solo comparten carril las aristas del mismo par por los mismos lados; la primera (id menor) se
 *   queda en el carril 0 y las demás van hacia fuera cuando caben; si no, el conjunto se corre lo mínimo. La directa
 *   entre caras que se miran sigue centrada y añadir una hermana no la mueve.
 * · La U: el canal va por el pasillo exterior (sin el muñón exterior de la captura).
 * · Caras muy cercanas: con menos de 2·pad de hueco los pasillos miden la mitad del hueco: sin ida y vuelta.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pageEdgeGeometry } from "../src/svg.js";
import type { FluyoPage } from "../src/model.js";

type Pt = { x: number; y: number };
const rect = (id: number, x: number, y: number) => ({ id, shape: "rect", x, y, w: 180, h: 70, label: "" });
const edge = (id: number, from: number, to: number, o: Record<string, unknown> = {}) =>
  ({ id, from, to, route: "ortho", fromSide: null, toSide: null, waypoints: [], label: "", animated: true, dashed: false, startArrow: false, endArrow: true, flowDir: "normal", ...o });
const page = (nodes: unknown[], edges: unknown[]) => ({ name: "P", nodes, edges, nextId: 99 }) as unknown as FluyoPage;
const fmt = (p: Pt[]) => p.map((q) => Math.round(q.x) + "," + Math.round(q.y)).join(" ");
function reversals(p: Pt[]): number {
  let n = 0;
  for (let i = 2; i < p.length; i++) {
    const a = p[i - 2], m = p[i - 1], c = p[i];
    if ((m.x - a.x) * (c.x - m.x) + (m.y - a.y) * (c.y - m.y) < -1 && Math.abs((m.x - a.x) * (c.y - m.y) - (m.y - a.y) * (c.x - m.x)) < 1) n++;
  }
  return n;
}
const diagonals = (p: Pt[]) => p.slice(1).filter((q, i) => Math.abs(q.x - p[i].x) > 1.5 && Math.abs(q.y - p[i].y) > 1.5).length;

describe("FLUYO-018.25: carriles, U y caras cercanas en export_diagram", () => {
  it("la captura: la directa sigue centrada (igual que sola) y la vuelta de arriba a arriba es una U limpia", () => {
    const nodes = [rect(1, 300, 300), rect(2, 700, 300)];
    const sola = pageEdgeGeometry(page(nodes, [edge(3, 1, 2, { fromSide: "e" })])).get(3)!;
    const g = pageEdgeGeometry(page(nodes, [edge(3, 1, 2, { fromSide: "e" }), edge(4, 2, 1, { fromSide: "n", toSide: "n" })]));
    assert.equal(fmt(sola), "390,300 418,300 500,300 582,300 610,300");
    assert.deepEqual(g.get(3), sola, "añadir la U no mueve la directa");
    assert.equal(fmt(g.get(4)!), "700,265 700,237 300,237 300,265");
  });

  it("barrido 10 posiciones × 25 lados × {sola, par mismo sentido, par opuesto}: 0 muñones, 0 diagonales; la primera solo se mueve (lo mínimo) donde no cabe", () => {
    const S5 = [null, "n", "e", "s", "w"];
    const POS = [[800, 500], [800, 300], [400, 200], [0, 300], [0, 500], [0, 700], [400, 800], [800, 700], [800, 507], [807, 300]];
    let edges = 0, movidas = 0;
    const bad: string[] = [];
    for (const mode of ["sola", "parMismoSentido", "parOpuesto"]) for (const [bx, by] of POS) for (const fs of S5) for (const ts of S5) {
      const nodes = [rect(1, 400, 500), rect(2, bx, by)];
      const es = [edge(3, 1, 2, { fromSide: fs, toSide: ts })];
      const sola = pageEdgeGeometry(page(nodes, es)).get(3)!;
      if (mode === "parMismoSentido") es.push(edge(4, 1, 2, { fromSide: fs, toSide: ts }));
      if (mode === "parOpuesto") es.push(edge(4, 2, 1, { fromSide: ts, toSide: fs }));
      const g = pageEdgeGeometry(page(nodes, es));
      const p = g.get(3)!;
      if (fmt(p) !== fmt(sola)) {
        /* recolocación mínima: solo donde la hermana no cabe a LANE_MIN sin mover la primera, y nunca más que eso */
        movidas++;
        const mov = Math.max(Math.abs(p[0].x - sola[0].x) + Math.abs(p[0].y - sola[0].y), Math.abs(p.at(-1)!.x - sola.at(-1)!.x) + Math.abs(p.at(-1)!.y - sola.at(-1)!.y));
        if (mov > 14) bad.push(`${mode} B(${bx},${by}) ${fs}/${ts}: la primera se movió ${mov} px`);
      }
      for (const [id, p] of g) {
        edges++;
        if (reversals(p) || diagonals(p)) bad.push(`${mode} B(${bx},${by}) ${fs}/${ts} e${id}: ${fmt(p)}`);
      }
    }
    assert.equal(edges, 1250);
    assert.equal(movidas, 10, "estabilidad cuando cabe: solo 10 de 500 pares recolocan la primera");
    assert.deepEqual(bad.slice(0, 5), [], bad.length + " problemas");
  });

  it("caras muy cercanas (5–120 px, horizontal y vertical, sola, par, opuesto y Z): 0 retrocesos, 0 diagonales", () => {
    const bad: string[] = [];
    for (const orient of ["horizontal", "vertical"]) for (const gap of [120, 72, 60, 56, 39, 20, 5]) for (const mode of ["sola", "par", "parOpuesto", "z"]) {
      const B = orient === "horizontal" ? rect(2, 300 + 180 + gap, mode === "z" ? 340 : 300) : rect(2, mode === "z" ? 340 : 300, 300 + 70 + gap);
      const fs = orient === "horizontal" ? "e" : "s", ts = orient === "horizontal" ? "w" : "n";
      const es = [edge(3, 1, 2, { fromSide: fs, toSide: mode === "z" ? ts : null })];
      if (mode === "par") es.push(edge(4, 1, 2, { fromSide: fs }));
      if (mode === "parOpuesto") es.push(edge(4, 2, 1, { toSide: fs }));
      for (const [id, p] of pageEdgeGeometry(page([rect(1, 300, 300), B], es))) if (reversals(p) || diagonals(p)) bad.push(`${orient} ${gap} ${mode} e${id}: ${fmt(p)}`);
    }
    assert.deepEqual(bad, []);
    const video = pageEdgeGeometry(page([rect(1, 300, 300), rect(2, 519, 300)], [edge(3, 1, 2, { fromSide: "e" })])).get(3)!;
    assert.equal(fmt(video), "390,300 410,300 429,300", "el caso del vídeo (39 px): recta, sin ida y vuelta");
  });
});

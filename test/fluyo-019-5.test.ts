/**
 * FLUYO-019.5 — El tinte de un color de nodo en export_diagram (decisión 207 de fluyo): port literal de `colorTint`.
 *
 *   · colorTint (src/svg.ts) = la tabla del fixture compartido con fluyo (test/fixtures/fluyo-019-5-tinte.json, generado con el
 *     colorTint del editor real) y = la regla escrita aquí: #rrggbb → rgba(r,g,b,k) (el string de siempre), #rgb expandido,
 *     #rrggbbaa → alfa k·aa/255 con 4 decimales, mayúsculas y espacios de los extremos dan igual, cualquier otro valor → null.
 *   · export_diagram: la secuencia de `fill="rgba(…)"` del SVG del documento del fixture es EXACTAMENTE la del exportador del
 *     editor, en los tres temas. Un color ilegible tiñe con PALETTE[0] (relleno) o deja el fondo del tema (panel de `code`).
 *   · Identidad: para todo #rrggbb el tinte es el string de antes de 019.5 (la fórmula vieja, escrita aquí), y el corpus de
 *     ejemplos solo usa #rrggbb: su SVG no cambia.
 * La paridad colorTint/codeColors con fluyo/js/geometry.js (vm) la mide visual-regression.test.ts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDocument } from "../src/diagram.js";
import { codeColors, colorTint, pageToSVG } from "../src/svg.js";
import { PALETTE, THEMES } from "../src/schema.js";
import type { FluyoNode } from "../src/model.js";
import { FIXTURES_DIR, isToolError, loadFixtures, startHarness, textBlocks, textOf, type Harness } from "./helpers.js";

const fixture = (f: string): any => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8"));
const G = fixture("fluyo-019-5-tinte.json");
const THEME_NAMES = ["dark", "crema", "claro"] as const;
const kOf = (t: string) => t === "crema" ? 0.16 : 0.18;

/* la regla, escrita aquí */
function rule(c: unknown, k: number): string | null {
  const m = typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim()); if (!m) return null;
  const s = m[1].length === 3 ? m[1].split("").map(x => x + x).join("") : m[1], v = parseInt(s.slice(0, 6), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${s.length === 8 ? Math.round(k * parseInt(s.slice(6), 16) / 255 * 1e4) / 1e4 : k})`;
}
/* la lectura de antes de 019.5 (svgFillColor/codePanelTint), para la identidad de #rrggbb */
const legacy = (c: string, k: number) => { const v = parseInt(c.slice(1), 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${k})`; };
function sweep(n: number) { let s = 0x5eed; const out: string[] = []; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const h = "#" + (s & 0xffffff).toString(16).padStart(6, "0"); out.push(i % 2 ? h.toUpperCase() : h); } return out; }
const fills = (svg: string) => (svg.match(/ fill="rgba\([^"]*\)"/g) ?? []).map(s => s.slice(7, -1));

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const svgOf = (r: unknown) => textBlocks(r)[textBlocks(r).length - 1];

describe("FLUYO-019.5 · colorTint (port literal)", () => {
  it("= el fixture del editor real y = la regla escrita", () => {
    assert.ok(G.tints.length >= 60, "casos: " + G.tints.length);
    for (const t of G.tints) {
      assert.equal(colorTint(t.color, t.k), t.tint, `${JSON.stringify(t.color)} · ${t.k}`);
      assert.equal(rule(t.color, t.k), t.tint, `regla: ${JSON.stringify(t.color)} · ${t.k}`);
    }
    for (const c of [null, undefined, 1, true, {}, []]) assert.equal(colorTint(c, 0.16), null, String(c));
  });

  it("tabla escrita a mano (#rgb, #rrggbbaa, espacios, 4 decimales)", () => {
    const T: Array<[string, number, string | null]> = [
      ["#7fa66b", 0.16, "rgba(127,166,107,0.16)"], ["#ABC", 0.18, "rgba(170,187,204,0.18)"], ["#7fa66b80", 0.16, "rgba(127,166,107,0.0803)"],
      ["#7fa66b80", 0.18, "rgba(127,166,107,0.0904)"], ["#7fa66bff", 0.16, "rgba(127,166,107,0.16)"], ["#7fa66b00", 0.18, "rgba(127,166,107,0)"],
      [" #d08b5b80 ", 0.16, "rgba(208,139,91,0.0803)"], ["red", 0.16, null], ["#12345", 0.16, null], ["", 0.16, null], ["#abcd", 0.16, null],
    ];
    for (const [c, k, want] of T) assert.equal(colorTint(c, k), want, `${JSON.stringify(c)} · ${k}`);
  });

  it("identidad · para todo #rrggbb (paleta, corpus y barrido con semilla) el tinte es el string de antes de 019.5", () => {
    const corpus = loadFixtures().flatMap(f => (f.doc as any).doc.pages.flatMap((p: any) => p.nodes.map((n: any) => n.color))).filter((c: unknown) => c != null) as string[];
    assert.ok(corpus.every((c: string) => /^#[0-9a-f]{6}$/i.test(c)), "el corpus de ejemplos solo usa #rrggbb");
    const colors = [...new Set([...PALETTE.map(p => p.hex), ...corpus, ...sweep(400)])];
    let n = 0;
    for (const c of colors) for (const theme of THEME_NAMES) {
      assert.equal(colorTint(c, kOf(theme)), legacy(c, kOf(theme)), `${c} ${theme}`);
      const code = { id: 1, shape: "code", x: 0, y: 0, w: 300, h: 150, label: "x", color: c } as unknown as FluyoNode;
      assert.equal(codeColors(code, theme).panel, legacy(c, kOf(theme)), `code ${c} ${theme}`); n++;
    }
    assert.ok(n > 1000, "comparaciones: " + n);
  });
});

describe("FLUYO-019.5 · export_diagram tiñe como el editor", () => {
  it("la secuencia de fills rgba del SVG = la del exportador del editor, en los tres temas", async () => {
    for (const theme of THEME_NAMES) {
      const d = JSON.parse(JSON.stringify(G.doc)); d.doc.theme = theme;
      const r = await h.client.callTool({ name: "export_diagram", arguments: { document: d } });
      assert.ok(!isToolError(r), textOf(r).slice(0, 300));
      const svg = svgOf(r);
      assert.deepEqual(fills(svg), G.svg[theme], theme);
      assert.ok(!/fill="rgba\((166,107,|139,91,204|0,10,188|0,0,237|1,35,69)/.test(svg), theme + ": ningún tinte con los canales desplazados");
      /* el documento pasa tal cual: los colores no se reescriben */
      assert.ok(svg.includes('stroke="#7FA66BCC"') && svg.includes('stroke=" #d08b5b80 "'), theme + ": el trazo lleva el color tal cual");
    }
  });

  it("ilegible → PALETTE[0] en el relleno; el panel de code conserva el fondo del tema; el relleno explícito manda", () => {
    const page = parseDocument(G.doc).doc.pages[0];
    for (const theme of THEME_NAMES) {
      const k = kOf(theme), svg = pageToSVG(page, theme);
      for (const color of ["red", "#12345"]) {
        const n = { id: 1, shape: "diamond", x: 0, y: 0, w: 140, h: 110, label: "", color, fill: null } as unknown as FluyoNode;
        const one = pageToSVG({ ...page, nodes: [n], edges: [] }, theme);
        assert.ok(one.includes(`fill="${rule(PALETTE[0].hex, k)}"`), `${color} ${theme}: PALETTE[0]`);
        assert.equal(codeColors({ ...n, shape: "code" } as FluyoNode, theme).panel, THEMES[theme].lblBg, `code ${color} ${theme}`);
      }
      assert.ok(svg.includes('fill="#ffffff80"'), theme + ": el relleno explícito #ffffff80 pasa tal cual");
    }
  });

  it("el fixture compartido es byte a byte el de fluyo (si está al lado)", () => {
    const fl = join(FIXTURES_DIR, "..", "..", "..", "fluyo", "test", "fixtures", "fluyo-019-5-tinte.json");
    let other: string; try { other = readFileSync(fl, "utf8"); } catch { return; }
    assert.equal(readFileSync(join(FIXTURES_DIR, "fluyo-019-5-tinte.json"), "utf8").replace(/\r\n/g, "\n"), other.replace(/\r\n/g, "\n"));
  });
});

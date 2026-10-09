/**
 * FLUYO-018.16 — Gramática de las conexiones en `export_diagram`.
 *
 * Las conexiones dejan los <marker> (20×16, `fill="context-stroke"` de SVG 2) y pasan a un trazo
 * de 1,5 con esquinas redondeadas más una punta de aguja explícita, de la misma geometría que el
 * lienzo (`edgeStroke`, port de fluyo/js/geometry.js; la paridad de geometría la mide
 * visual-regression.test.ts). Aquí se fija:
 *   · el SVG de export_diagram para el fixture compartido, conexión a conexión, contra el golden
 *     `fluyo-018-16-conexiones-svg.json`, que es el MISMO que comprueba el browser test de Fluyo
 *     contra el exportador del editor (editor = SVG = MCP, byte a byte en las conexiones);
 *   · colores explícitos (lineColor) en línea y punta; puntas según endArrow/startArrow;
 *   · documentos antiguos (sin endArrow, con `bidir`) se siguen dibujando con sus puntas;
 *   · nada de cian, nada de <marker>, nada de <polyline>.
 * Regenerar el golden: FLUYO_UPDATE_GOLDEN=1 npm test (y copiarlo a fluyo/test/fixtures).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { createKernel } from "../src/kernel.js";
import { normalizeWith } from "../src/revision.js";
import { edgeStroke, EDGE_W } from "../src/svg.js";
import { isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const ROOT = packageRoot();
const FIXTURE = join(ROOT, "test", "fixtures", "fluyo-018-16-conexiones.json");
const GOLDEN = join(ROOT, "test", "fixtures", "fluyo-018-16-conexiones-svg.json");
const FLUYO_FIXTURES = join(ROOT, "..", "fluyo", "test", "fixtures");
const fixture = (): any => JSON.parse(readFileSync(FIXTURE, "utf8"));

/* Las líneas de un SVG que dibujan conexiones: el trazo (stroke-width 1.5) y las puntas
   (<path> con solo `d` y `fill`). La misma función vive en el browser test de Fluyo. */
export function connectorLines(svg: string): string[] {
  return svg.split("\n").map(l => l.trim()).filter(l =>
    /^<path d="[^"]*" fill="none" stroke="[^"]*" stroke-width="1\.5"[^>]*\/>$/.test(l) || /^<path d="[^"]*" fill="[^"]*"\/>$/.test(l));
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });

describe("FLUYO-018.16: conexiones en export_diagram", () => {
  it("el SVG de las conexiones es el golden compartido con el exportador del editor", async () => {
    const r = await call("export_diagram", { document: fixture() });
    assert.ok(!isToolError(r), textOf(r));
    const lines = connectorLines(textOf(r));
    if (process.env.FLUYO_UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, JSON.stringify({ theme: "crema", connectors: lines }, null, 1) + "\n");
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    assert.deepEqual(lines, golden.connectors);
  });

  it("gramática: sin <marker> ni <polyline> ni context-stroke; trazo 1.5; una punta por extremo con flecha", async () => {
    const doc = fixture();
    const r = await call("export_diagram", { document: doc });
    const svg = textOf(r);
    assert.ok(!/<marker|<polyline|context-stroke|marker-end|marker-start/.test(svg), "nada del mecanismo antiguo");
    assert.ok(!/3aa7e8|58,\s*167,\s*232/i.test(svg), "sin cian");
    const edges = doc.doc.pages[0].edges;
    const lines = connectorLines(svg);
    const trazos = lines.filter(l => l.includes('fill="none"')), puntas = lines.filter(l => !l.includes('fill="none"'));
    assert.equal(trazos.length, edges.length, "un trazo por conexión");
    const esperadas = edges.reduce((s: number, e: any) => s + (e.endArrow !== false ? 1 : 0) + (e.startArrow ? 1 : 0), 0);
    assert.equal(puntas.length, esperadas, "una punta por extremo con flecha (endArrow:false no dibuja; startArrow sí)");
    assert.equal(EDGE_W, 1.5);
    assert.ok(trazos.every(l => l.includes(`stroke-width="${EDGE_W}"`)));
    /* esquinas redondeadas: las rutas con codos llevan Q */
    assert.ok(trazos.some(l => / Q /.test(l)), "las esquinas son cuadráticas");
  });

  it("color explícito: lineColor se conserva en el trazo y en la punta; el resto, color del tema", async () => {
    const doc = fixture();
    const svg = textOf(await call("export_diagram", { document: doc }));
    const lines = connectorLines(svg);
    const conColor = lines.filter(l => l.includes("#d08b5b"));
    assert.equal(conColor.length, 2, "trazo + punta de la conexión con lineColor");
    assert.ok(conColor.some(l => l.includes('stroke="#d08b5b"')) && conColor.some(l => l.includes('fill="#d08b5b"')));
    assert.ok(lines.filter(l => !l.includes("#d08b5b")).every(l => l.includes("#8a8275")), "las demás, el gris del tema crema");
  });

  it("documento antiguo: una conexión sin endArrow y con `bidir` se normaliza y dibuja sus dos puntas", async () => {
    const doc = fixture();
    const e = doc.doc.pages[0].edges[0];
    delete e.endArrow; delete e.startArrow; e.bidir = true;
    const norm = normalizeWith(createKernel(), doc) as any;
    const n0 = norm.doc.pages[0].edges[0];
    assert.equal(n0.endArrow, true); assert.equal(n0.startArrow, true);
    const svg = textOf(await call("export_diagram", { document: norm }));
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")).connectors as string[];
    /* la primera conexión gana una punta en el origen; todo lo demás, idéntico al golden */
    assert.equal(connectorLines(svg).length, golden.length + 1);
    assert.equal(edgeStroke({ endArrow: true, startArrow: true }, [{ x: 0, y: 0 }, { x: 100, y: 0 }]).heads.length, 2);
  });

  it("los fixtures son copia exacta de los de Fluyo (si está al lado)", () => {
    for (const f of ["fluyo-018-16-conexiones.json", "fluyo-018-16-conexiones-svg.json"]) {
      const other = join(FLUYO_FIXTURES, f);
      if (!existsSync(other)) continue;
      assert.equal(readFileSync(join(ROOT, "test", "fixtures", f), "utf8").replace(/\r\n/g, "\n"), readFileSync(other, "utf8").replace(/\r\n/g, "\n"), f);
    }
  });
});

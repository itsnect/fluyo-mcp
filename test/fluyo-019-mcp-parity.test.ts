/**
 * FLUYO-019-MCP-PARITY — el SVG «construido» del MCP con las capas de D6 (decisión 212) y el aterrizaje por silueta de 019.4a
 * (decisión 213), contra los contratos que fija fluyo:
 *
 *   · fluyo-019-d6-capas.json: por caso, el orden de capas calculado A MANO en fluyo (contenedores en preorden de fuera
 *     adentro; después las hojas). containmentPaintOrder del MCP lo reproduce, y pageToSVG pinta exactamente ese orden:
 *     contenedores → conexiones → hojas.
 *   · fluyo-019-d6-capas-svg.json: el SVG del exportador del editor para el caso D (anidado, conexiones que aterrizan sobre
 *     las tapas). Línea a línea: capas, trazos, puntas, anillos y el sitio del <defs>. Se excluyen solo los <text>: la medida
 *     de texto es la divergencia conocida del MCP (heurística frente a getBBox), y no es piel.
 *   · En plano, y con la piel sin contenedores, el SVG de antes (el orden de pintor de siempre).
 *
 * El aterrizaje por silueta lo fijan la sección `landing` de fluyo-019-1-skin.json (fluyo-019-3.test.ts), las líneas de la piel
 * de fluyo-019-2-skin-svg.json (ídem) y la paridad con el skin.js real en vm (visual-regression.test.ts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "../src/diagram.js";
import { containmentPaintOrder, isContainerNode, pageEdgeGeometry, pageToSVG } from "../src/svg.js";
import { skinEdgeLanding, skinPaintOrder, type SkinNodeInput } from "../src/skin.js";
import type { FluyoPage } from "../src/model.js";
import { FIXTURES_DIR } from "./helpers.js";

const fixture = (f: string): any => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8"));
const D6 = fixture("fluyo-019-d6-capas.json") as { cases: Array<{ name: string; nodes: any[]; edges: any[]; containers: number[]; leaves: number[] }> };
const D6SVG = fixture("fluyo-019-d6-capas-svg.json") as { case: string; svg: string };

/** El mismo documento que construye fluyo/test/fluyo-019-d6-browser.cjs (docOf): hojas #b5734a, contenedores #6a9fb5, conexiones rectas animadas. */
function docOf(c: { nodes: any[]; edges: any[]; containers: number[] }) {
  const conts = new Set(c.containers);
  const nodes = c.nodes.map(n => Object.assign({ color: conts.has(n.id) ? "#6a9fb5" : "#b5734a" }, n));
  const edges = c.edges.map(e => Object.assign({ route: "straight", animated: true, endArrow: true }, e));
  return { version: 5, app: "fluyo", settings: { grid: false, speed: 0.5, dots: 3 },
    doc: { theme: "crema", customBg: "", eventTypes: [], nextEventTypeId: 1, cur: 0, pages: [{ name: "P", behaviors: [], scenarios: [], nextScenarioId: 1, nextId: 200, nodes, edges }] } };
}
const pageOf = (c: Parameters<typeof docOf>[0]): FluyoPage => parseDocument(docOf(c)).doc.pages[0] as FluyoPage;
const nodeOrder = (svg: string) => [...svg.matchAll(/<g id="node-(\d+)">/g)].map(m => +m[1]);
/* líneas que no dependen de medir texto: todo salvo la cabecera <svg> (el MCP escribe el viewBox con dos decimales) y los <text> */
const geometryLines = (svg: string) => svg.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("<svg ") && !l.startsWith("<text"));

describe("FLUYO-019-MCP-PARITY · capas con la piel (D6, decisión 212)", () => {
  it("containmentPaintOrder reproduce el orden calculado a mano en fluyo en los 13 casos del contrato", () => {
    assert.ok(D6.cases.length >= 13, String(D6.cases.length));
    for (const c of D6.cases) {
      const lay = containmentPaintOrder(c.nodes, skinPaintOrder);
      assert.deepEqual(lay.containers.map(n => n.id), c.containers, `${c.name}: contenedores`);
      assert.deepEqual(lay.leaves.map(n => n.id), c.leaves, `${c.name}: hojas`);
      for (const n of c.nodes) assert.equal(isContainerNode(n, c.nodes), c.containers.includes(n.id), `${c.name} #${n.id}: contenedor`);
    }
  });

  it("pageToSVG con la piel: contenedores → conexiones → hojas, en el orden del contrato; <defs> antes de los contenedores", () => {
    for (const c of D6.cases) {
      const page = pageOf(c), svg = pageToSVG(page, "crema", { skin: "built" });
      assert.deepEqual(nodeOrder(svg), [...c.containers, ...c.leaves], c.name);
      if (!c.containers.length || !c.edges.length) continue;
      /* las líneas de conexión son las únicas sin relleno con trazo de 1,5 (las capas de la piel van a 1 y la línea de contacto a 2) */
      const lines = svg.split("\n"), isEdge = (l: string) => /^<path d="[^"]*" fill="none" stroke="[^"]*" stroke-width="1\.5"/.test(l);
      const lastContainer = lines.indexOf(`<g id="node-${c.containers[c.containers.length - 1]}">`), firstLeaf = lines.indexOf(`<g id="node-${c.leaves[0]}">`);
      const edges = lines.map((l, i) => (isEdge(l) ? i : -1)).filter(i => i >= 0);
      assert.equal(edges.length, c.edges.length, `${c.name}: una línea por conexión`);
      assert.ok(edges.every(i => i > lastContainer && i < firstLeaf), `${c.name}: conexiones entre contenedores y hojas`);
      const defs = lines.findIndex(l => l.startsWith("<defs"));
      if (defs >= 0) assert.ok(defs < lines.indexOf(`<g id="node-${c.containers[0]}">`), `${c.name}: <defs> antes de los contenedores`);
    }
  });

  it("con un icono (hay <defs>) y contenedores: el <defs> va antes del primer contenedor, como buildSVGDocument", () => {
    const A = D6.cases.find(x => x.name.startsWith("A "))!, Z = D6.cases.find(x => x.name.startsWith("Z "))!;
    const withIcon = (c: typeof A) => ({ ...c, nodes: c.nodes.map(n => n.id === c.leaves[0] ? { ...n, shape: "icon", icon: "kafka", h: 110 } : n) });
    const svgA = pageToSVG(pageOf(withIcon(A)), "crema", { skin: "built" }).split("\n");
    const defsA = svgA.findIndex(l => l.startsWith("<defs")), firstA = svgA.indexOf(`<g id="node-${A.containers[0]}">`);
    assert.ok(defsA > 0 && defsA < firstA, `caso A con icono: <defs> (${defsA}) antes del contenedor (${firstA})`);
    /* sin contenedores, el sitio de siempre: después de las conexiones y antes de los nodos */
    const svgZ = pageToSVG(pageOf(withIcon(Z)), "crema", { skin: "built" }).split("\n");
    const defsZ = svgZ.findIndex(l => l.startsWith("<defs")), firstZ = svgZ.findIndex(l => l.startsWith("<g id=\"node-"));
    const lastEdge = Math.max(...svgZ.map((l, i) => (/^<path d="[^"]*" fill="none" stroke="[^"]*" stroke-width="1\.5"/.test(l) ? i : -1)));
    assert.ok(lastEdge < defsZ && defsZ < firstZ, `caso Z con icono: conexiones (${lastEdge}) → <defs> (${defsZ}) → nodos (${firstZ})`);
  });

  it("golden del caso D: las líneas del SVG del editor (capas, trazos aterrizados, puntas, anillos) son exactamente las del MCP", () => {
    const c = D6.cases.find(x => x.name === D6SVG.case)!;
    assert.ok(c, D6SVG.case);
    const svg = pageToSVG(pageOf(c), "crema", { skin: "built" });
    const ours = geometryLines(svg), gold = geometryLines(D6SVG.svg);
    assert.equal(ours.length, gold.length, `líneas: ${ours.length} vs ${gold.length}`);
    assert.deepEqual(ours, gold);
    assert.deepEqual(nodeOrder(svg), nodeOrder(D6SVG.svg));
    /* y el caso D tiene a la vez contenedores anidados y una conexión que aterriza (no es un golden trivial) */
    const page = pageOf(c), geo = pageEdgeGeometry(page), byId = new Map(page.nodes.map(n => [n.id, n] as const));
    assert.ok(page.edges.some(e => JSON.stringify(skinEdgeLanding(geo.get(e.id)!, byId.get(e.to) as SkinNodeInput)) !== JSON.stringify(geo.get(e.id))), "alguna conexión aterriza");
    assert.ok(c.containers.length >= 2, "anidado");
  });

  it("en plano, el orden y el SVG de siempre; con la piel y sin contenedores, el orden de pintor de antes", () => {
    for (const c of D6.cases) {
      const page = pageOf(c), flat = pageToSVG(page, "crema", {});
      assert.deepEqual(nodeOrder(flat), page.nodes.map(n => n.id), `${c.name}: plano en orden del documento`);
      if (!c.containers.length) assert.deepEqual(nodeOrder(pageToSVG(page, "crema", { skin: "built" })), skinPaintOrder(page.nodes).map(n => n.id), `${c.name}: sin contenedores`);
    }
  });
});

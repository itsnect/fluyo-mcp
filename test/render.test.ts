/**
 * TESTS DEL RENDERER SVG
 *
 * Dos capas:
 *
 *  1. Comparación estructural contra los SVG que generó el exportador de la PROPIA
 *     app (fluyo/ejemplos/previews/, copiados en test/fixtures/previews/). Si el
 *     renderer deja de dibujar una forma, o dibuja de menos, los recuentos dejan de
 *     cuadrar. Antes de soportar `shape:"anim"`, un GIF caía en el caso por defecto
 *     y salía como un rectángulo: este test lo habría cazado.
 *
 *  2. Aserciones sobre los atributos de los estilos nuevos, que los recuentos no ven.
 *
 * Por qué solo la estructura y no el archivo entero: la app mide el texto con
 * getBBox() del navegador y aquí se estima por anchos de carácter, así que los
 * `font-size` calculados difieren en decimales. Y los previews del repo llevan un
 * viewBox recortado que el exportador actual ya no produce.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDocument } from "../src/diagram.js";
import { pageToSVG } from "../src/svg.js";
import { CANVAS } from "../src/schema.js";
import { FIXTURES_DIR, loadFixtures } from "./helpers.js";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const ELEMENTOS: Array<[string, RegExp]> = [
  ["<g> por nodo", /<g id="node-/g],
  ["<image>", /<image /g],
  ["<text>", /<text /g],
  ["<polyline>", /<polyline /g],
];

function renderFixture(doc: unknown): string {
  const project = parseDocument(doc);
  const page = project.doc.pages[project.doc.cur ?? 0];
  return pageToSVG(page, project.doc.theme, { globalFont: project.settings.font ?? null });
}

describe("el SVG coincide en estructura con el que exporta la app", () => {
  for (const fx of loadFixtures()) {
    const golden = join(FIXTURES_DIR, "previews", fx.name.replace(/\.fluyo\.json$/, ".svg"));

    it(fx.name, () => {
      assert.ok(existsSync(golden), `falta el SVG de referencia ${golden} (npm run sync:fixtures)`);
      const mine = renderFixture(fx.doc);
      const app = readFileSync(golden, "utf8");

      for (const [nombre, re] of ELEMENTOS) {
        assert.equal(
          count(mine, re),
          count(app, re),
          `número de ${nombre} distinto del que produce la app — el renderer se está dejando algo`
        );
      }
    });
  }
});

describe("el lienzo se alinea con el exportador de la app", () => {
  const fx = loadFixtures()[0];

  it("por defecto usa el lienzo completo y no pinta fondo", () => {
    const svg = renderFixture(fx.doc);
    assert.match(svg, new RegExp(`viewBox="0\\.00 0\\.00 ${CANVAS.W}\\.00 ${CANVAS.H}\\.00"`));
    assert.match(svg, new RegExp(`width="${CANVAS.W}"`));
    // La app exporta un SVG transparente: sin rectángulo de fondo del tema.
    assert.doesNotMatch(svg, /<rect x="0\.00" y="0\.00"/, "no debe haber rectángulo de fondo");
  });

  it("crop=true recorta al contenido", () => {
    const project = parseDocument(fx.doc);
    const page = project.doc.pages[0];
    const svg = pageToSVG(page, project.doc.theme, { crop: true });
    assert.doesNotMatch(svg, /viewBox="0\.00 0\.00 2560\.00 1440\.00"/);
    assert.match(svg, /viewBox="/);
  });

  it("scale multiplica width/height sin tocar el viewBox", () => {
    const project = parseDocument(fx.doc);
    const svg = pageToSVG(project.doc.pages[0], project.doc.theme, { scale: 2 });
    assert.match(svg, new RegExp(`width="${CANVAS.W * 2}"`));
    assert.match(svg, new RegExp(`viewBox="0\\.00 0\\.00 ${CANVAS.W}\\.00`));
  });
});

describe("los estilos de nodo llegan al SVG", () => {
  const conEstilo = {
    version: 3,
    app: "fluyo" as const,
    doc: {
      theme: "dark",
      cur: 0,
      pages: [
        {
          name: "Estilos",
          nextId: 4,
          nodes: [
            {
              id: 1, shape: "rect", x: 300, y: 300, w: 180, h: 70, label: "Hueco", color: "#6a9fb5",
              pulse: false, order: 0,
              fill: "none", border: "dashed", lblPos: "top",
              textColor: "#ff0000", font: "Arial, Helvetica, sans-serif", bold: true,
            },
            {
              id: 2, shape: "text", x: 700, y: 300, w: 200, h: 40, label: "Con fondo", color: "#d08b5b",
              pulse: false, order: 1, textBg: "#112233",
            },
            {
              id: 3, shape: "anim", x: 1100, y: 300, w: 120, h: 100, label: "Cargando", color: "#7fa66b",
              pulse: false, order: 2, anim: "spinner",
            },
          ],
          edges: [
            { id: 4, from: 1, to: 2, fromSide: null, toSide: null, route: "straight", waypoints: [],
              label: "en negrita", animated: true, dashed: false, startArrow: false, endArrow: true,
              flowDir: "normal", bold: true, font: "Courier New, Courier, monospace" },
          ],
        },
      ],
    },
    settings: { speed: 0.5, dots: 3, build: false, stagger: 0.45, grid: true, font: "Verdana, Geneva, sans-serif" },
  };

  const svg = renderFixture(conEstilo);

  const casos: Array<[string, RegExp]> = [
    ["fill:'none' deja la forma hueca", /fill="none"[^>]*stroke=/],
    ["border:'dashed' emite stroke-dasharray", /stroke-dasharray="9 7"/],
    ["textColor manda sobre el color del tema", /fill="#ff0000"/],
    ["font propio del nodo", /font-family="Arial, Helvetica, sans-serif"/],
    ["font global heredado por los nodos sin font", /font-family="Verdana, Geneva, sans-serif"/],
    ["bold emite font-weight", /font-weight="bold"/],
    ["textBg pinta un rect detrás del texto", /<rect[^>]*fill="#112233"/],
    ["el GIF animado se dibuja como <image>", /<image[^>]*data:image\/svg\+xml/],
    ["font propio de la arista", /font-family="Courier New, Courier, monospace"/],
  ];

  for (const [nombre, re] of casos) {
    it(nombre, () => assert.match(svg, re));
  }

  it("un nodo anim sin clave válida falla diciendo que se actualice el servidor", () => {
    const roto = structuredClone(conEstilo) as any;
    roto.doc.pages[0].nodes[2].anim = "no-existe";
    assert.throws(() => renderFixture(roto), /no-existe[\s\S]*list_anims/);
  });
});

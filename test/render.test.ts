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

/** Cuántos dibujos referenciados se PINTAN, sea cual sea el mecanismo.
 *
 *  Los íconos y los GIFs dejaron de incrustarse como un `<image>` por nodo y
 *  pasaron a un `<symbol>` en `<defs>` más un `<use>` por nodo, para no repetir
 *  el data URI tantas veces como nodos (svg.ts, «Símbolos reutilizables»). Contar
 *  `<image>` a secas mediría el mecanismo de deduplicación en vez de lo que este
 *  golden quiere medir —que no falte ningún dibujo—, y daría rojo por un cambio
 *  que no pierde nada.
 *
 *  Los `<image>` que viven DENTRO de `<defs>` no se cuentan: son la plantilla,
 *  no una instancia pintada. Los de fuera sí (las imágenes del usuario siguen
 *  yendo inline, porque no se conoce su tamaño intrínseco). */
function instanciasDibujadas(svg: string): number {
  const sinDefs = svg.replace(/<defs>[\s\S]*?<\/defs>/g, "");
  return count(sinDefs, /<image /g) + count(sinDefs, /<use /g);
}

/** Cuántas conexiones se DIBUJAN, sea cual sea el mecanismo. Los previews de referencia
 *  son de un exportador anterior a FLUYO-018.16, que pintaba cada conexión como un
 *  `<polyline>` con `<marker>`; desde 018.16 es un `<path>` de trazo (stroke-width 1.5)
 *  más las puntas rellenas. Igual que con los dibujos, se mide lo que se pinta. */
function conexionesDibujadas(svg: string): number {
  return count(svg, /<polyline /g) + count(svg, /<path d="[^"]*" fill="none" stroke="[^"]*" stroke-width="1\.5"/g);
}

const ELEMENTOS: Array<[string, (s: string) => number]> = [
  ["<g> por nodo", s => count(s, /<g id="node-/g)],
  ["dibujos pintados (<image> fuera de defs + <use>)", instanciasDibujadas],
  ["<text>", s => count(s, /<text /g)],
  ["conexiones dibujadas", conexionesDibujadas],
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

      for (const [nombre, medir] of ELEMENTOS) {
        assert.equal(
          medir(mine),
          medir(app),
          `número de ${nombre} distinto del que produce la app — el renderer se está dejando algo`
        );
      }
    });
  }
});

describe("los íconos repetidos no se incrustan una vez por nodo", () => {
  /** Página con `repeticiones` nodos que usan solo `distintos` íconos. */
  function pagina(distintos: number, repeticiones: number) {
    const claves = ["run", "cloudsql", "gke", "queue", "cache", "gcs", "bigquery", "pubsub", "vertex", "gcf"];
    const nodes = Array.from({ length: repeticiones }, (_, i) => ({
      id: i + 1, shape: "icon" as const, x: 200 + (i % 6) * 380, y: 200 + Math.floor(i / 6) * 230,
      w: 120, h: 92, label: `n${i}`, color: "#6a9fb5", fill: null, border: "solid", lblPos: "center",
      textBg: null, textColor: null, font: null, bold: false, pulse: false, order: i,
      icon: claves[i % distintos], tint: false,
    }));
    return { name: "P", nextId: 999, nodes, edges: [] };
  }

  it("un ícono usado por diez nodos se declara una sola vez", () => {
    const svg = pageToSVG(pagina(1, 10) as never, "dark", {});
    assert.equal((svg.match(/<symbol /g) ?? []).length, 1, "debería haber un único <symbol>");
    assert.equal((svg.match(/<use /g) ?? []).length, 10, "debería haber un <use> por nodo");
    assert.equal(
      (svg.match(/data:image\/svg\+xml/g) ?? []).length, 1,
      "el data URI del ícono no puede aparecer más de una vez"
    );
  });

  it("cada ícono distinto se declara una vez, y solo una", () => {
    const svg = pageToSVG(pagina(10, 30) as never, "dark", {});
    assert.equal((svg.match(/<symbol /g) ?? []).length, 10);
    assert.equal((svg.match(/<use /g) ?? []).length, 30);
  });

  /* Este es el número que motiva todo esto. Con íconos oficiales de proveedor
     (1,5–4 KB en vez de los ~430 B de los dibujados a mano) un diagrama de 30
     nodos superaba los 200 KB de DEFAULT_MAX_TOOL_RESULT_BYTES y export_diagram
     devolvía un error en vez del diagrama. Ver INFORME-ICONOS-MARCA.md §6.2. */
  it("con íconos repetidos el SVG se reduce a menos de la mitad", () => {
    const svg = pageToSVG(pagina(10, 30) as never, "dark", {});
    // Reconstruye lo que salía antes: cada <use> vuelve a llevar el URI completo.
    const uri = new Map<string, string>();
    for (const m of svg.matchAll(/<symbol id="([^"]+)"[^>]*><image[^>]*href="([^"]*)"\/><\/symbol>/g)) uri.set(m[1], m[2]);
    const antes = svg
      .replace(/<defs>\n<symbol[\s\S]*?<\/defs>\n?/, "")
      .replace(/<use href="#([^"]+)"[^>]*\/>/g, (_, id: string) => `<image href="${uri.get(id)}"/>`);
    assert.ok(
      svg.length < antes.length * 0.65,
      `esperada una reducción de más del 35 %: antes ${antes.length} B, ahora ${svg.length} B`
    );
  });

  it("el <defs> de símbolos va declarado antes del primer <use>", () => {
    const svg = pageToSVG(pagina(3, 6) as never, "dark", {});
    assert.ok(svg.indexOf("<symbol ") < svg.indexOf("<use "), "declarar antes de usar");
  });

  it("dos nodos con el mismo ícono pero distinto teñido no comparten símbolo", () => {
    const p = pagina(1, 2) as never as { nodes: Array<Record<string, unknown>> };
    p.nodes[1].tint = true;
    p.nodes[1].color = "#d0576a";
    const svg = pageToSVG(p as never, "dark", {});
    assert.equal(
      (svg.match(/<symbol /g) ?? []).length, 2,
      "el teñido cambia el dibujo, así que son dos símbolos distintos"
    );
  });
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

/* FLUYO-018.14a — `code` y cilindro en el SVG que emite export_diagram: la MISMA salida que el
   exportador de la app (los segmentos y colores los vigila la paridad de visual-regression; aquí,
   que pageToSVG los use de verdad). */
describe("FLUYO-018.14a: code y cilindro en el SVG de export_diagram", () => {
  const N = (o: Record<string, unknown>) => ({ fill: null, border: "solid", lblPos: "center", textBg: null, font: null, bold: false, pulse: false, order: 0, color: "#6a9fb5", label: "", ...o });
  const doc = (theme: string, nodes: unknown[]) => ({ version: 3, app: "fluyo", doc: { theme, customBg: "", cur: 0, pages: [{ name: "P", nodes, edges: [], nextId: 10 }] }, settings: { speed: 0.5, dots: 3, build: false, stagger: 0.45, grid: true, snap: false, font: "Georgia, serif", single: false } });
  const cyl = N({ id: 1, shape: "cylinder", x: 200, y: 200, w: 150, h: 90, label: "BD" });
  const codeAuto = N({ id: 2, shape: "code", x: 600, y: 200, w: 300, h: 150, label: "SELECT a\nFROM t", lang: "sql", keywords: null, kwBg: null, kwColor: null });
  const codeKw = N({ id: 3, shape: "code", x: 600, y: 500, w: 300, h: 150, label: "SELECT b", lang: "sql", keywords: null, kwBg: "#a8b34a", kwColor: null, font: "Georgia, serif" });

  for (const theme of ["dark", "crema", "claro"]) {
    const svg = renderFixture(doc(theme, [cyl, codeAuto, codeKw]));
    /* trozo del SVG desde el <g> del nodo hasta el siguiente nodo o el final (los <g> de code anidan) */
    const nodo = (id: number) => { const i = svg.indexOf(`<g id="node-${id}"`); const j = svg.indexOf(`<g id="node-`, i + 1); return i < 0 ? "" : svg.slice(i, j < 0 ? undefined : j); };
    it(`${theme}: el cilindro es un contorno + un labio de arcos reales, sin segunda elipse`, () => {
      const c = nodo(1);
      assert.equal(count(c, /<ellipse/g), 0, "sin <ellipse>");
      assert.equal(count(c, /<path /g), 2, "contorno + labio");
      assert.ok(!/ C /.test(c), "sin Bézier");
      assert.equal(count(c, / A /g), 3, "base, tapa trasera y labio");
    });
    it(`${theme}: code sin kwBg no pinta cajas de palabra clave; con kwBg sí; Plex Mono por defecto`, () => {
      const a = nodo(2), b = nodo(3);
      assert.ok(!/#a8b34a/i.test(a), "sin la caja verde por defecto");
      assert.equal(count(a, /<rect /g), 3, "solo el recorte, el panel y el bloque: ninguna caja de palabra clave");
      assert.ok(!/#101010/i.test(a), "sin el bloque negro por defecto");
      assert.match(a, /font-family="&apos;IBM Plex Mono&apos;/, "Plex Mono como fuente por defecto del bloque");
      assert.match(a, /font-weight="500"/, "la palabra clave se distingue por peso");
      assert.match(b, /<rect[^>]*fill="#a8b34a"/, "kwBg explícito: su caja se respeta");
      assert.match(b, /font-family="Georgia, serif"/, "font explícito: se respeta");
    });
  }
});

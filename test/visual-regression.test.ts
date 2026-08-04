/**
 * TEST DE REGRESIÓN VISUAL
 *
 * Renderiza los 5 ejemplos oficiales de Fluyo más las 2 fixtures que produjo el
 * servidor en producción, y busca automáticamente los cuatro defectos que hacían
 * ilegibles los diagramas generados por MCP:
 *
 *   A) dos aristas entre el mismo par de nodos con la MISMA ruta
 *   B) etiquetas encima de un nodo o encima de otra etiqueta
 *   C) aristas que atraviesan el dibujo de un nodo que no es ni su origen ni su destino
 *   D) extremos que no aterrizan en el borde del nodo
 *
 * Y una quinta comprobación que es la que de verdad impide que esto se vuelva a
 * abrir: que `fluyo/js/geometry.js` y `src/svg.ts` calculen EXACTAMENTE la misma
 * geometría. Los dos son ports manuales el uno del otro; sin esta comprobación,
 * arreglar uno y olvidar el otro no lo nota nadie hasta que un usuario abre el
 * diagrama en la app y lo ve distinto.
 *
 * Sobre el BASELINE: los 5 ejemplos oficiales tienen 4 cruces del tipo C que ya
 * existían antes de esta tanda de arreglos y que no se pueden quitar sin ruteo
 * con evasión de obstáculos. Están listados uno a uno más abajo. El test falla
 * si aparece un hallazgo que no está en la lista, y TAMBIÉN si uno de la lista
 * deja de aparecer — así el baseline no se pudre y quien arregle el ruteo se
 * entera de que ya puede borrar entradas.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

import { anchorBox, approxTextWidth, drawnContentBox, pageEdgeGeometry, placeEdgeLabels } from "../src/svg.js";
import { FluyoEdge, FluyoNode, FluyoPage } from "../src/model.js";
import { layeredLayout } from "../src/layout.js";
import { FIXTURES_DIR, packageRoot } from "./helpers.js";

/* ===================== Documentos bajo prueba ===================== */

interface Doc { name: string; pages: FluyoPage[]; }

function loadDocs(): Doc[] {
  const out: Doc[] = [];
  const add = (dir: string) => {
    for (const f of readdirSync(dir).filter(n => n.endsWith(".fluyo.json")).sort()) {
      const proj = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({ name: f.replace(".fluyo.json", ""), pages: proj.doc.pages });
    }
  };
  add(FIXTURES_DIR);
  add(join(FIXTURES_DIR, "regresion-visual"));
  return out;
}

const docs = loadDocs();

/* ===================== Geometría de lo dibujado ===================== */

interface Rect { x: number; y: number; w: number; h: number; }

/** Lo que el nodo ocupa en pantalla. Para un icono es el glifo más su pie, que es
 *  justo la caja a la que ancla el renderer — se pide a `anchorBox` en vez de
 *  recalcularla aquí, para que el test no pueda desincronizarse del código. */
function drawnBox(n: FluyoNode): Rect {
  const a = anchorBox(n);
  return { x: a.x - a.w / 2, y: a.y - a.h / 2, w: a.w, h: a.h };
}

function labelRect(e: FluyoEdge, at: { x: number; y: number }): Rect {
  const fs = e.fs || 13;
  const w = approxTextWidth(e.label, fs, !!e.bold);
  return { x: at.x - w / 2 - 6, y: at.y - fs * 0.85, w: w + 12, h: fs * 1.7 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Longitud del tramo que queda dentro de la caja. Se usa en vez de un booleano
 *  para no marcar como cruce el roce de un píxel en una esquina. */
function insideLength(p: { x: number; y: number }, q: { x: number; y: number }, r: Rect): number {
  const N = 240;
  let inside = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) inside++;
  }
  return (inside / N) * Math.hypot(q.x - p.x, q.y - p.y);
}

const CRUCE_MIN = 4;   // px dentro de la caja para considerarlo un cruce de verdad
const BORDE_TOL = 1.5; // px de tolerancia al comprobar que un extremo toca el borde

function onRectBorder(p: { x: number; y: number }, r: Rect): boolean {
  const inX = p.x >= r.x - BORDE_TOL && p.x <= r.x + r.w + BORDE_TOL;
  const inY = p.y >= r.y - BORDE_TOL && p.y <= r.y + r.h + BORDE_TOL;
  if (!inX || !inY) return false;
  const d = Math.min(
    Math.abs(p.x - r.x), Math.abs(p.x - (r.x + r.w)),
    Math.abs(p.y - r.y), Math.abs(p.y - (r.y + r.h))
  );
  return d <= BORDE_TOL;
}

/** Tolerancia al comprobar que un extremo cae sobre lo dibujado.
 *
 *  Es holgada a propósito, y absorbe dos cosas legítimas: los 4px de aire que el
 *  render deja sobre el glifo de un icono (`n.y - n.h/2 + 4`), y el juego entre
 *  el alto real del pie de texto y el que se estima aquí con la heurística de
 *  anchos.
 *
 *  Lo que este chequeo persigue no son esos píxeles, sino que la punta acabe a
 *  decenas de píxeles de cualquier cosa dibujada — que es lo que pasaba cuando se
 *  anclaba a la caja lógica: 34px de aire a cada lado del glifo. */
const DIBUJO_TOL = 5;

function dentroDeLoDibujado(p: { x: number; y: number }, n: FluyoNode): boolean {
  const b = drawnContentBox(n);
  return p.x >= b.x - DIBUJO_TOL && p.x <= b.x + b.w + DIBUJO_TOL
    && p.y >= b.y - DIBUJO_TOL && p.y <= b.y + b.h + DIBUJO_TOL;
}

function insideRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x - BORDE_TOL && p.x <= r.x + r.w + BORDE_TOL
    && p.y >= r.y - BORDE_TOL && p.y <= r.y + r.h + BORDE_TOL;
}

/* ===================== Los cuatro chequeos ===================== */

function findings(page: FluyoPage): string[] {
  const out: string[] = [];
  const geom = pageEdgeGeometry(page);
  const place = placeEdgeLabels(page);
  const byId = new Map(page.nodes.map(n => [n.id, n] as const));
  const nombre = (n: FluyoNode) => String(n.label || n.id).replace(/\n/g, " ");

  // A) aristas paralelas con la misma ruta
  const pares = new Map<string, FluyoEdge[]>();
  for (const e of page.edges) {
    const k = e.from < e.to ? `${e.from}-${e.to}` : `${e.to}-${e.from}`;
    if (!pares.has(k)) pares.set(k, []);
    pares.get(k)!.push(e);
  }
  for (const [, es] of pares) {
    if (es.length < 2) continue;
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      const p = geom.get(es[i].id) ?? [], q = geom.get(es[j].id) ?? [];
      const rev = [...q].reverse();
      const igualDirecta = p.length === q.length && p.every((pt, k) => Math.abs(pt.x - q[k].x) < 2 && Math.abs(pt.y - q[k].y) < 2);
      const igualInversa = p.length === rev.length && p.every((pt, k) => Math.abs(pt.x - rev[k].x) < 2 && Math.abs(pt.y - rev[k].y) < 2);
      if (igualDirecta || igualInversa) out.push(`A: e${es[i].id} y e${es[j].id} comparten ruta`);
    }
  }

  // B) etiquetas encima de un nodo o de otra etiqueta
  const etiquetas = page.edges
    .filter(e => e.label && place.has(e.id))
    .map(e => ({ e, r: labelRect(e, place.get(e.id)!) }));
  for (const { e, r } of etiquetas) {
    for (const n of page.nodes) {
      if (overlaps(r, drawnBox(n))) out.push(`B: la etiqueta "${e.label}" (e${e.id}) pisa el nodo "${nombre(n)}"`);
    }
  }
  for (let i = 0; i < etiquetas.length; i++) for (let j = i + 1; j < etiquetas.length; j++) {
    if (overlaps(etiquetas[i].r, etiquetas[j].r)) {
      out.push(`B: la etiqueta "${etiquetas[i].e.label}" solapa "${etiquetas[j].e.label}"`);
    }
  }

  // C) aristas que atraviesan un nodo ajeno
  for (const e of page.edges) {
    const p = geom.get(e.id) ?? [];
    for (const n of page.nodes) {
      if (n.id === e.from || n.id === e.to) continue;
      const b = drawnBox(n);
      let L = 0;
      for (let i = 1; i < p.length; i++) L += insideLength(p[i - 1], p[i], b);
      if (L >= CRUCE_MIN) out.push(`C: e${e.id} "${e.label}" atraviesa el nodo "${nombre(n)}"`);
    }
  }

  // D) extremos que no aterrizan en el nodo
  for (const e of page.edges) {
    const p = geom.get(e.id) ?? [];
    if (p.length < 2) continue;
    for (const [pt, id, punta] of [[p[0], e.from, "el inicio"], [p[p.length - 1], e.to, "el final"]] as const) {
      const n = byId.get(id);
      if (!n) continue;
      const b = drawnBox(n);
      // circle y diamond anclan sobre su propia silueta, que va por dentro de la
      // caja: para ellos basta con exigir que el punto no se salga.
      const ok = (n.shape === "circle" || n.shape === "diamond") ? insideRect(pt, b) : onRectBorder(pt, b);
      if (!ok) out.push(`D: ${punta} de e${e.id} "${e.label}" no toca el nodo "${nombre(n)}"`);

      // D-bis) y además tiene que caer sobre algo DIBUJADO, no sobre la caja
      // lógica. Es la comprobación que habría cazado que las flechas aterrizaran
      // a 34px del glifo de un icono: la caja lógica las daba por buenas.
      if (!dentroDeLoDibujado(pt, n)) {
        out.push(`D: ${punta} de e${e.id} "${e.label}" cae fuera del dibujo del nodo "${nombre(n)}"`);
      }
    }
  }

  return out;
}

/* ===================== Baseline ===================== */

/**
 * Cruces conocidos y aceptados, uno por línea. Los cuatro son el mismo patrón: un
 * tramo vertical largo cuya x la fija el ancla del nodo de destino, atravesando un
 * tercer icono que cae en esa misma columna. No se arreglan desplazando el canal
 * —la x no es libre— sino con ruteo que rodee obstáculos, que es un algoritmo
 * distinto y está fuera del alcance de esta tanda.
 *
 * Ya existían antes de los arreglos de rutas y etiquetas: no los introdujo esta
 * serie de cambios. Al implementar el ruteo con evasión, estas cuatro líneas
 * tienen que desaparecer y el test avisará si se olvidan.
 */
const BASELINE: Record<string, string[]> = {
  "arquitectura-serverless-aws": ['C: e16 "encola" atraviesa el nodo "Lambda: worker"'],
  "microservicios-api-gateway": ['C: e21 "consume" atraviesa el nodo "Pedidos"'],
  "oauth2-flujo-autenticacion": ['C: e12 "4. code → token" atraviesa el nodo "API protegida"'],
  "pipeline-etl-datos": ['C: e16 "sí" atraviesa el nodo "Cuarentena"'],

  /* «contexto + pregunta» mide 112px de texto y el layout viejo dejó 110px de
     hueco entre «API / Orquestador» y «Claude Opus 4». No hay ninguna posición
     a lo largo de la arista que no pise un nodo, así que el renderer no puede
     resolverlo: lo resuelve el layout, y solo para diagramas nuevos. Este
     documento ya está guardado con las coordenadas malas.

     La suite «el auto-layout deja sitio suficiente» comprueba que al recolocar
     esta misma fixture con el layout actual el defecto desaparece. */
  "rag-chatbot": [
    'B: la etiqueta "contexto + pregunta" (e8) pisa el nodo "API / Orquestador"',
  ],
};

/**
 * Baseline de la suite de auto-layout. Distinto problema, distinta lista.
 *
 * Al recolocar microservicios-api-gateway, «API Gateway» (capa 1) y «Usuarios»
 * (capa 3) caen a la misma altura y «orders-db» (capa 2) queda justo encima de la
 * recta que los une. La arista lo atraviesa.
 *
 * No es un problema de separación —darle más aire no lo mueve de esa fila— sino
 * de que el layout no trata las aristas que saltan más de una capa. Un Sugiyama
 * completo les mete nodos ficticios en las capas intermedias, precisamente para
 * que la arista rodee. Eso es un cambio del algoritmo de layout y está fuera del
 * alcance de esta tanda; queda anotado aquí para que no se pierda.
 */
const BASELINE_LAYOUT: Record<string, string[]> = {
  "microservicios-api-gateway": ['C: e15 "/users" atraviesa el nodo "orders-db"'],
};

/* ===================== Suites ===================== */

describe("regresión visual: los cuatro defectos de legibilidad", () => {
  it("hay siete documentos cargados (5 ejemplos oficiales + 2 fixtures)", () => {
    assert.equal(docs.length, 7, `documentos encontrados: ${docs.map(d => d.name).join(", ")}`);
  });

  for (const doc of docs) {
    describe(doc.name, () => {
      const halladas = doc.pages.flatMap(p => findings(p));
      const esperadas = BASELINE[doc.name] ?? [];

      it("no aparece ningún defecto nuevo", () => {
        const nuevas = halladas.filter(f => !esperadas.includes(f));
        assert.deepEqual(
          nuevas, [],
          `\n  Defectos NUEVOS en ${doc.name}:\n${nuevas.map(f => "    " + f).join("\n")}\n` +
          `  Si son aceptables, hay que justificarlos y añadirlos al BASELINE de este archivo.\n`
        );
      });

      it("los defectos aceptados en el baseline siguen existiendo", () => {
        const resueltas = esperadas.filter(f => !halladas.includes(f));
        assert.deepEqual(
          resueltas, [],
          `\n  Estos defectos del BASELINE ya NO ocurren en ${doc.name}:\n${resueltas.map(f => "    " + f).join("\n")}\n` +
          `  Buena noticia: bórralos del BASELINE para que el test los siga vigilando.\n`
        );
      });
    });
  }
});

/* ===================== El layout deja sitio ===================== */

/**
 * Los chequeos de arriba corren sobre documentos con posiciones ya guardadas, así
 * que miden el renderer. Esta suite mide lo otro: si el auto-layout coloca los
 * nodos dejando sitio de sobra para que el renderer pueda hacer su trabajo.
 *
 * Es la parte que el renderer no puede arreglar por su cuenta. Una etiqueta de
 * 112px en un hueco de 110px no tiene ninguna posición buena; el único arreglo es
 * no crear ese hueco.
 */
describe("el auto-layout deja sitio suficiente para aristas y etiquetas", () => {
  for (const d of docs) {
    it(`${d.name}: recolocado con layeredLayout, sin defectos`, () => {
      for (const page of d.pages) {
        const { positions } = layeredLayout(
          page.nodes.map(n => ({ key: n.id, w: n.w, h: n.h })),
          page.edges.map(e => ({ from: e.from, to: e.to, label: e.label, fs: e.fs, bold: e.bold }))
        );
        const recolocada: FluyoPage = {
          ...page,
          nodes: page.nodes.map(n => {
            const p = positions.get(n.id);
            return p ? { ...n, x: p.x, y: p.y } : n;
          }),
        };
        const esperadas = BASELINE_LAYOUT[d.name] ?? [];
        const halladas = findings(recolocada);
        const nuevas = halladas.filter(f => !esperadas.includes(f));
        assert.deepEqual(
          nuevas, [],
          `\n  El auto-layout deja ${d.name} con defectos:\n${nuevas.map(f => "    " + f).join("\n")}\n` +
          `  Hay que darle más aire en layout.ts, no parchearlo en el renderer.\n`
        );
        const resueltas = esperadas.filter(f => !halladas.includes(f));
        assert.deepEqual(
          resueltas, [],
          `\n  Estos defectos del BASELINE_LAYOUT ya NO ocurren en ${d.name}:\n${resueltas.map(f => "    " + f).join("\n")}\n` +
          `  Bórralos de la lista para que el test los siga vigilando.\n`
        );
      }
    });
  }
});

/* ===================== Paridad con el renderer de la app ===================== */

/**
 * Carga `fluyo/js/geometry.js` de verdad —el archivo que ejecuta el navegador— en
 * un contexto de Node con los globals mínimos que espera, y compara su geometría
 * con la de `src/svg.ts` documento a documento.
 *
 * Es la barrera que faltaba: los dos archivos son ports manuales el uno del otro
 * y hasta ahora nada comprobaba que siguieran de acuerdo.
 */
interface AppGeometry {
  edgePoints: (e: FluyoEdge) => { x: number; y: number }[];
  placeEdgeLabels: (measure: (e: FluyoEdge) => { w: number; h: number }) => Map<number, { x: number; y: number }>;
  setPage: (page: FluyoPage) => void;
}

function loadAppGeometry(fluyoPath: string): AppGeometry {
  const src = readFileSync(join(fluyoPath, "js", "geometry.js"), "utf8");
  const doc = { pages: [] as FluyoPage[], cur: 0 };
  const sandbox = {
    doc,
    DIR: { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } },
    SIDES: ["n", "e", "s", "w"],
    lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)),
    P: () => doc.pages[doc.cur],
    nodeById: (id: number) => doc.pages[doc.cur].nodes.find(n => n.id === id),
  };
  const ctx = createContext(sandbox);
  // El valor de la última expresión es lo que devuelve runInContext: es la forma
  // de sacar del script unas funciones declaradas con `function`/`const`, que no
  // se cuelgan del objeto de contexto.
  const api = runInContext(src + "\n;({edgePoints, placeEdgeLabels});", ctx) as {
    edgePoints: AppGeometry["edgePoints"];
    placeEdgeLabels: AppGeometry["placeEdgeLabels"];
  };
  return {
    ...api,
    setPage: (page: FluyoPage) => { doc.pages = [page]; doc.cur = 0; },
  };
}

const FLUYO_PATH = resolve(packageRoot(), process.env.FLUYO_PATH ?? join("..", "fluyo"));
const hayApp = existsSync(join(FLUYO_PATH, "js", "geometry.js"));

/* Sin fluyo/ al lado esta suite se salta, que es lo correcto para quien clone
   solo este repo. Pero una barrera que se desactiva sola y en silencio no es una
   barrera: con REQUIRE_FLUYO=1 —que es como corre el job `drift` de CI— la
   ausencia pasa a ser un fallo duro. */
const EXIGE_APP = process.env.REQUIRE_FLUYO === "1";

describe("paridad de geometría entre fluyo/js/geometry.js y src/svg.ts", () => {
  let app: AppGeometry;

  before(function () {
    if (!hayApp) return;
    app = loadAppGeometry(FLUYO_PATH);
  });

  it("el renderer de la app está disponible para comparar", () => {
    assert.ok(
      hayApp || !EXIGE_APP,
      `REQUIRE_FLUYO=1 pero no se encontró ${FLUYO_PATH}. Esta comprobación es la que impide que los dos renderers se desincronicen; si se salta, no protege nada.`
    );
    if (hayApp) assert.ok(app, "no se pudo cargar fluyo/js/geometry.js");
  });

  for (const d of docs) {
    it(`${d.name}: mismas rutas y mismas etiquetas`, { skip: hayApp ? false : "sin fluyo/ al lado" }, () => {
      for (const page of d.pages) {
        app.setPage(page);

        const mcpGeom = pageEdgeGeometry(page);
        for (const e of page.edges) {
          const a = app.edgePoints(e);
          const b = mcpGeom.get(e.id) ?? [];
          assert.equal(a.length, b.length, `e${e.id} de ${d.name}: la app da ${a.length} vértices y el MCP ${b.length}`);
          a.forEach((p, i) => {
            assert.ok(
              Math.abs(p.x - b[i].x) < 0.01 && Math.abs(p.y - b[i].y) < 0.01,
              `e${e.id} de ${d.name}, vértice ${i}: app (${p.x.toFixed(2)},${p.y.toFixed(2)}) vs MCP (${b[i].x.toFixed(2)},${b[i].y.toFixed(2)})`
            );
          });
        }

        // Se le pasa a la app el mismo medidor heurístico que usa el MCP: lo que
        // se compara es el ALGORITMO de colocación, no la medición de texto, que
        // es una divergencia conocida y documentada en svg.ts.
        const appLbl = app.placeEdgeLabels(e => ({ w: approxTextWidth(e.label, e.fs || 13, !!e.bold), h: (e.fs || 13) * 1.7 }));
        const mcpLbl = placeEdgeLabels(page);
        assert.equal(appLbl.size, mcpLbl.size, `${d.name}: la app coloca ${appLbl.size} etiquetas y el MCP ${mcpLbl.size}`);
        for (const [id, p] of appLbl) {
          const q = mcpLbl.get(id);
          assert.ok(q, `${d.name}: el MCP no coloca la etiqueta de e${id}`);
          assert.ok(
            Math.abs(p.x - q!.x) < 0.01 && Math.abs(p.y - q!.y) < 0.01,
            `etiqueta de e${id} en ${d.name}: app (${p.x.toFixed(2)},${p.y.toFixed(2)}) vs MCP (${q!.x.toFixed(2)},${q!.y.toFixed(2)})`
          );
        }
      }
    });
  }
});

/**
 * TEST DE REGRESIÓN VISUAL
 *
 * Renderiza los 5 ejemplos oficiales de Fluyo más las 2 fixtures que produjo el
 * servidor en producción, y busca automáticamente los defectos que hacían
 * ilegibles los diagramas generados por MCP:
 *
 *   A) dos aristas entre el mismo par de nodos con la MISMA ruta
 *   B) etiquetas encima de un nodo o encima de otra etiqueta
 *   C) aristas que atraviesan el dibujo de un nodo que no es ni su origen ni su destino
 *   D) extremos que no aterrizan en el borde del nodo
 *   E) tramos largos compartidos por aristas distintas en sentido opuesto
 *   F) aristas que entran en la caja de anclaje de su PROPIO origen o destino
 *
 * Y una comprobación más que es la que de verdad impide que esto se vuelva a
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

import { anchorBox, approxTextWidth, codeBlockLayout, codeColors, drawnContentBox, labelLayout, measureNodeLabel, pageEdgeGeometry, placeEdgeLabels } from "../src/svg.js";
import { CODE_ADV, CODE_LANGS, DEFAULT_LANG, DEFAULT_SIZES, FONTS, THEMES } from "../src/generated/config.js";
import { FluyoEdge, FluyoNode, FluyoPage } from "../src/model.js";
import { layeredLayout } from "../src/layout.js";
import { FIXTURES_DIR, packageRoot } from "./helpers.js";

/* ===================== Documentos bajo prueba ===================== */

interface Doc { name: string; pages: FluyoPage[]; theme: string; }

function loadDocs(): Doc[] {
  const out: Doc[] = [];
  const add = (dir: string) => {
    for (const f of readdirSync(dir).filter(n => n.endsWith(".fluyo.json")).sort()) {
      const proj = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({ name: f.replace(".fluyo.json", ""), pages: proj.doc.pages, theme: proj.doc.theme });
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

const SOLAPE_MIN = 40;  // px de trazo compartido para considerarlo un problema

/** Longitud de trazo que dos polilíneas comparten, colineal y a menos de
 *  COLINEAL_TOL de distancia, separada por sentido de recorrido.
 *
 *  La distinción importa y no es la misma para los dos usos: entre aristas de
 *  pares DISTINTOS solo molesta el sentido opuesto (el mismo sentido es un
 *  tronco que se lee como un bus), mientras que entre aristas del MISMO par
 *  molestan los dos, porque ahí compartir trazo es justo lo que el reparto por
 *  carriles existe para evitar. */
const COLINEAL_TOL = 1.5;
function solapeColineal(A: { x: number; y: number }[], B: { x: number; y: number }[]): { mismo: number; opuesto: number } {
  let mismo = 0, opuesto = 0;
  for (let a = 1; a < A.length; a++) for (let b = 1; b < B.length; b++) {
    const a1 = A[a - 1], a2 = A[a], b1 = B[b - 1], b2 = B[b];
    const va = { x: a2.x - a1.x, y: a2.y - a1.y }, vb = { x: b2.x - b1.x, y: b2.y - b1.y };
    const La = Math.hypot(va.x, va.y), Lb = Math.hypot(vb.x, vb.y);
    if (La < 1 || Lb < 1) continue;
    const ua = { x: va.x / La, y: va.y / La };
    if (Math.abs(ua.x * vb.y - ua.y * vb.x) / Lb > 0.02) continue;                 // no paralelos
    if (Math.abs((b1.x - a1.x) * -ua.y + (b1.y - a1.y) * ua.x) > COLINEAL_TOL) continue; // paralelos pero separados
    const proy = (q: { x: number; y: number }) => (q.x - a1.x) * ua.x + (q.y - a1.y) * ua.y;
    const lo = Math.max(0, Math.min(proy(b1), proy(b2)));
    const hi = Math.min(La, Math.max(proy(b1), proy(b2)));
    if (hi <= lo) continue;
    if (ua.x * vb.x + ua.y * vb.y > 0) mismo += hi - lo; else opuesto += hi - lo;
  }
  return { mismo, opuesto };
}

/* ===================== Los chequeos ===================== */

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
      if (igualDirecta || igualInversa) { out.push(`A: e${es[i].id} y e${es[j].id} comparten ruta`); continue; }

      // A-bis) rutas distintas pero dibujadas una encima de otra en buena parte
      // del recorrido. La comparación de arriba solo ve rutas IDÉNTICAS, y dos
      // hermanas de un par paralelo pueden acabar con el mismo canal largo y
      // separarse solo al final: `parallelLane` reparte moviendo las anclas y el
      // canal del medio, así que un canal que salga de un ancla —y no del punto
      // medio— es el MISMO para las dos por construcción.
      //
      // Medido en un barrido sintético de 400 configuraciones con carril activo:
      // 0 de ellas disparan la comparación de rutas idénticas, y 256 comparten
      // aquí más de 40px. Sin este chequeo, un par paralelo que pierda su carril
      // es invisible para la suite.
      const sol = solapeColineal(p, q);
      const total = sol.mismo + sol.opuesto;
      if (total >= SOLAPE_MIN) {
        out.push(`A: e${es[i].id} y e${es[j].id}, del mismo par, comparten ${Math.round(total)}px de trazo`);
      }
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

  // E) tramos largos compartidos por aristas de pares DISTINTOS, recorridos en
  //    sentido opuesto. Compartir tramo no es malo por sí solo: un abanico que
  //    sale de un nodo comparte tronco y se lee como un bus (medido: 11 pares en
  //    el corpus, hasta 264px, todos en diagramas que se ven bien). Lo que
  //    confunde es que el flujo vuelva sobre sus pasos por la misma línea, con
  //    dos puntas de flecha sobre un único trazo.
  const pares2 = page.edges;
  for (let i = 0; i < pares2.length; i++) for (let j = i + 1; j < pares2.length; j++) {
    const a = pares2[i], b = pares2[j];
    const ka = a.from < a.to ? `${a.from}-${a.to}` : `${a.to}-${a.from}`;
    const kb = b.from < b.to ? `${b.from}-${b.to}` : `${b.to}-${b.from}`;
    if (ka === kb) continue;   // mismo par: lo cubre A
    const op = solapeColineal(geom.get(a.id) ?? [], geom.get(b.id) ?? []).opuesto;
    if (op >= SOLAPE_MIN) out.push(`E: e${a.id} "${a.label}" y e${b.id} "${b.label}" comparten ${Math.round(op)}px de trazo en sentido opuesto`);
  }

  // F) la ruta entra en la caja de anclaje de su PROPIO origen o destino
  //
  //    El chequeo C no puede ver esto: hace `continue` sobre e.from y e.to, o sea
  //    que por construcción no mira los dos nodos que la arista toca. Este es el
  //    que caza el muñón de 28px —la ruta que atraviesa su propio nodo, se pasa
  //    de largo y vuelve al borde—, y mira LOS DOS extremos: el defecto es
  //    simétrico y medirlo solo en el destino se dejaba fuera un caso de tres.
  //
  //    Se mide contra anchorBox() y no contra la caja del nodo. Con la caja
  //    completa el mismo medidor da 26 casos, de los que 24 son falsos positivos:
  //    en un nodo `icon` la caja de anclaje es más estrecha que el nodo y el
  //    extremo cae legítimamente dentro de la grande.
  //
  //    La caja se encoge BORDE_TOL por lado para que el tramo de aproximación,
  //    que nace sobre el borde, no cuente como entrar.
  for (const e of page.edges) {
    const p = geom.get(e.id) ?? [];
    if (p.length < 2) continue;
    for (const [id, cual] of [[e.from, "su origen"], [e.to, "su destino"]] as const) {
      const n = byId.get(id);
      if (!n) continue;
      const b = drawnBox(n);
      const r = { x: b.x + BORDE_TOL, y: b.y + BORDE_TOL, w: Math.max(0, b.w - 2 * BORDE_TOL), h: Math.max(0, b.h - 2 * BORDE_TOL) };
      let L = 0;
      for (let i = 1; i < p.length; i++) L += insideLength(p[i - 1], p[i], r);
      if (L >= CRUCE_MIN) out.push(`F: e${e.id} "${e.label}" entra ${Math.round(L)}px en ${cual} "${nombre(n)}"`);
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
 * Cruces conocidos y aceptados, uno por línea. Son el mismo patrón: un tramo
 * vertical largo cuya x la fija el ancla del nodo de destino, atravesando un
 * tercer icono que cae en esa misma columna. No se arreglan desplazando el canal
 * —la x no es libre— sino con ruteo que rodee obstáculos, que es un algoritmo
 * distinto y está fuera del alcance de esta tanda.
 *
 * Ya existían antes de los arreglos de rutas y etiquetas: no los introdujo esta
 * serie de cambios. Al implementar el ruteo con evasión, estas líneas tienen que
 * desaparecer y el test avisará si se olvidan.
 *
 * ─── CUATRO ENTRADAS BORRADAS AL ARREGLAR EL MUÑÓN DE 28 px ───────────────────
 *
 * Esta lista tenía cuatro entradas más. NO se han rendido ni se han relajado los
 * chequeos: dejaron de ocurrir. Eran el muñón de 28px visto desde otro chequeo,
 * y al arreglar el conector de orthoRoute() desaparecieron solas. Se anotan por
 * nombre porque, leídas en el historial, parecen un baseline que alguien podó:
 *
 *   arquitectura-serverless-aws
 *     C: e16 "encola" atraviesa el nodo "Lambda: worker"
 *     E: e16 "encola" y e17 "dispara" comparten 108px de trazo en sentido opuesto
 *   microservicios-api-gateway
 *     C: e21 "consume" atraviesa el nodo "Pedidos"
 *     E: e20 "publica" y e21 "consume" comparten 154px de trazo en sentido opuesto
 *
 * Las dos de tipo E ya estaban señaladas en la nota (2) de más abajo como «no
 * comparten ancla, sus tramos coinciden porque los nodos están en la misma
 * columna». Eso era verdad a medias: la mitad del solape la ponía el muñón, o
 * sea el tramo que se pasaba 28px de largo y volvía. Al no pasarse, el trazo
 * compartido baja por debajo de SOLAPE_MIN. Las dos de tipo C son lo mismo: la
 * ruta que atravesaba su propio destino seguía de largo hasta un tercer nodo.
 *
 * El chequeo F es el que vigila que no vuelvan.
 */
const BASELINE: Record<string, string[]> = {
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
 *
 * Aquí también se borró una entrada al arreglar el muñón de 28px, por el mismo
 * motivo que las cuatro del BASELINE de arriba y no por haber relajado nada:
 *
 *   microservicios-api-gateway
 *     E: e20 "publica" y e21 "consume" comparten 56px de trazo en sentido opuesto
 *
 * El auto-layout es donde más se notaba el defecto: sobre los 8 documentos
 * recolocados, el chequeo F encontraba 10 aristas entrando en su propio nodo —en
 * 6 de los 8— frente a las 3 de los documentos tal como están guardados.
 */
const BASELINE_LAYOUT: Record<string, string[]> = {
  "microservicios-api-gateway": [
    'C: e15 "/users" atraviesa el nodo "orders-db"',
  ],
};

/* ═══════════════════════════════════════════════════════════════════════════
   TRABAJO PENDIENTE, MEDIDO Y CERRADO EN FALSO A PROPÓSITO

   Dos defectos conocidos que NO son fallos del test: son decisiones tomadas con
   números delante. Están aquí para que quien los retome no repita el
   experimento.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * (1) ANCLAJE VERTICAL EN NODOS `icon` — decidido: se deja como está.
 *
 * `anchorBox()` estrecha el ancho al del glifo pero CONSERVA la altura. En un
 * icono de 120×92 el glifo mide 51.5px y va pegado ARRIBA (`n.y - h/2 + 4`), con
 * el pie de texto abajo. Consecuencia: un ancla sur cae 36.5px por debajo del
 * glifo, y un ancla lateral cuya y se vaya abajo puede caer hasta 36.5px por
 * debajo. Aterrizan sobre el PIE, no sobre el icono.
 *
 * Extremos afectados hoy, por nombre, para que se vea el efecto de cualquier
 * cambio futuro:
 *
 *   arquitectura-serverless-aws  e12 "estáticos"  inicio → "CloudFront"                36.5px
 *                                e16 "encola"     inicio → "Lambda: API"               36.5px
 *                                e17 "dispara"    fin    → "Lambda: worker"            36.5px
 *   microservicios-api-gateway   e20 "publica"    inicio → "Pedidos"                   36.5px
 *                                e21 "consume"    fin    → "Usuarios"                  36.5px
 *   oauth2-flujo-autenticacion   e11 "3. login"   inicio → "Servidor de autorización"  36.5px
 *                                e14 "6. 200 OK"  inicio → "API protegida"             36.5px
 *   pipeline-etl-datos           e16 "sí"         fin    → "Data warehouse"            36.5px
 *   ingesta-v2                   e7  "publish"    inicio → "API Gateway"               36.5px
 *                                e8  "consume"    inicio → "Kafka"                     36.5px
 *                                e12 "hit"        fin    → "API Gateway"               26.5px (lateral)
 *   rag-chatbot                  e5  "pregunta"   inicio → "Usuario"                   36.5px
 *
 * Doce extremos, en los 7 documentos. Dos de ellos están en microservicios y
 * pipeline, que se ven bien: la punta cae justo debajo del pie de texto, así que
 * el efecto pasa desapercibido salvo que se mire de cerca. Eso es parte del
 * argumento para no correrlo a ciegas.
 *
 * NO es una regresión: se midió contra el árbol anterior a los arreglos de
 * anclaje y estos extremos salen idénticos. `anchorBox` arregló el eje
 * horizontal —de 34.3px a 0.0px en todos los laterales— y el vertical nunca se
 * abordó.
 *
 * Por qué no se arregla con lo obvio: anclar al glifo también en vertical
 * (`h = s`) hace que 13 aristas del corpus salgan por debajo del icono y
 * ATRAVIESEN su propio pie de texto, que no tiene fondo. Medido:
 *
 *   arquitectura-serverless-aws 4 · microservicios-api-gateway 3 ·
 *   oauth2-flujo-autenticacion 2 · pipeline-etl-datos 1 · ingesta-v2 2 ·
 *   rag-chatbot 1
 *
 * Dos de esos diagramas —microservicios y pipeline— estaban impecables antes.
 * Se cambia un defecto por otro peor.
 *
 * El arreglo bueno es anclar a la SILUETA REAL: dos rectángulos, glifo arriba y
 * pie abajo, y que `autoAnchor` intersecte con el que corresponda a esa
 * dirección. Resuelve los dos ejes sin cruzar texto. Coste: cambia la matemática
 * de anclaje (~40 líneas × 2 renderers) y vuelve a mover TODAS las aristas que
 * tocan un icono, un segundo cambio de radio completo sobre los 5 ejemplos
 * publicados. Merece su propia tanda con su medición antes/después, no un
 * apéndice de otra.
 */

/**
 * (3) EL MUÑÓN DE 28 px AL ENTRAR POR EL LADO CONTRARIO — ARREGLADO.
 *
 * Este bloque describía un defecto que se dejó medido y sin arreglar por alcance.
 * Ya no está pendiente: se arregló en orthoRoute() y el chequeo F de arriba es el
 * que impide que vuelva. Se deja el rastro porque su desaparición se llevó por
 * delante cinco entradas de baseline y eso, leído en el historial, parece otra
 * cosa.
 *
 * QUÉ ERA: el pasillo de aproximación de `pad` = 28 px es correcto —es lo que hace
 * que la flecha entre perpendicular al borde—, pero el CONECTOR entre los dos
 * puntos de pasillo se elegía con una tabla fija que no miraba por dónde pasaba.
 * Cuando el otro nodo caía del lado contrario al lado anclado, la ruta lo
 * atravesaba, se pasaba 28 px de largo y volvía al borde. Como los nodos nacen con
 * `fill:null` se veía el trazo por dentro, y por fuera asomaba el muñón.
 *
 * CUÁNTO ERA, medido contra anchorBox() y no contra la caja completa del nodo
 * (con la caja completa el mismo medidor daba 26 casos, de los que 24 eran falsos
 * positivos suyos: en un nodo `icon` la caja de anclaje es más estrecha):
 *
 *   · 16 de las 25 combinaciones de fromSide × toSide entre dos cajas
 *   · 3 aristas del corpus publicado — serverless e16 "encola", microservicios
 *     e20 "publica" y e21 "consume". La tercera entraba en su ORIGEN, no en su
 *     destino: el defecto es simétrico y una primera medición que solo miró el
 *     destino se la dejó fuera.
 *   · 10 aristas de ese mismo corpus recolocado con layeredLayout, en 6 de los 8
 *     documentos. El generador lo producía mucho más que la edición a mano.
 *
 * QUÉ SE HIZO: entre dos puntos hay siempre dos maneras de doblar en ortogonal.
 * orthoRoute() comprueba si la ruta de hoy entra en la caja de anclaje de alguno
 * de sus dos nodos y, solo en ese caso, prueba los canales alternativos y se queda
 * con el que no entra. Una arista sana sale por la cláusula de salida temprana sin
 * evaluar nada: de las 54 aristas del corpus cambiaron 3, y son las 3 defectuosas.
 * Ninguna ganó un vértice — el arreglo es doblar antes, no rodear.
 *
 * LO QUE NO ARREGLA: los cruces del tipo C que quedan en BASELINE siguen pidiendo
 * ruteo con evasión de obstáculos, que es otro algoritmo. Este cambio solo mira
 * los dos nodos que la propia arista toca; un tercer nodo en medio le da igual.
 */

/**
 * (2) TRAZOS COMPARTIDOS EN SENTIDO OPUESTO — resueltos los 3.
 *
 * Compartir tramo no es un defecto por sí solo. Medido sobre los 7 documentos:
 * 14 pares de aristas de pares distintos comparten ≥8px, y el reparto es limpio
 * —`mismo` y `opuesto` nunca son ambos distintos de cero—:
 *
 *   · 11 pares lo recorren en el MISMO sentido, hasta 264px. Son abanicos de
 *     entrada y de salida: se leen como un bus que se bifurca, y separarlos solo
 *     añadiría ruido. Están todos en diagramas que se ven bien.
 *   · 3 pares lo recorren en sentido OPUESTO. Esos sí confunden: una sola línea
 *     con dos puntas de flecha.
 *
 * De los 3, `portLane()` arregló uno —oauth2 e12/e13, que compartían el ancla
 * exacta (1560,508) en el lado sur del hex—. De los otros dos se dijo aquí que no
 * compartían ancla, sino que sus tramos largos coincidían por estar los nodos
 * alineados en la misma columna (x=1460 en serverless, x=1200 en microservicios),
 * y que solo saldrían con ruteo con evasión de obstáculos.
 *
 * Eso era verdad a medias, y el arreglo del muñón —nota (3)— los resolvió sin
 * ruteo con evasión: buena parte de la longitud compartida la ponía el propio
 * muñón, el trozo que se pasaba 28px de largo y volvía. Al doblar antes, el
 * solape cae por debajo de SOLAPE_MIN y las dos entradas del BASELINE
 * desaparecieron.
 *
 * Queda pendiente el caso general —dos tramos largos que coinciden sin que ningún
 * extremo se pase de largo— pero hoy no ocurre en ningún documento del corpus.
 */

/**
 * (4) UN PAR PARALELO EN CONFIGURACIÓN DEFECTUOSA PIERDE SU CARRIL — medido,
 *     sin arreglar, vigilado por el chequeo A.
 *
 * Se buscó a propósito al arreglar el muñón, porque era el único riesgo que no se
 * podía cerrar con los números del corpus. Barrido sintético: dos hermanas de un
 * par paralelo (las dos A→B, y una en cada sentido) × 8 posiciones del segundo
 * nodo × 25 combinaciones de lado = 400 casos con carril activo.
 *
 *   con muñón (chequeo F):                    ANTES 288   DESPUÉS 0
 *   hermanas con ≥40px de trazo colineal:     ANTES   0   DESPUÉS 256
 *
 * O sea: el arreglo quita el muñón en los 288 y, en 256, las dos hermanas acaban
 * dibujadas una encima de otra —hasta 783px— en vez de separadas por PARALLEL_SEP.
 *
 * POR QUÉ NO SE ARREGLA REORDENANDO LOS CANDIDATOS. Se probó: cambiar el
 * desempate de (penetración, codos, longitud) a (penetración, longitud, codos) no
 * mueve ni un caso, porque en esas configuraciones el canal que se elige es el
 * ÚNICO limpio de la familia. La causa es estructural: `parallelLane` separa las
 * hermanas moviendo las anclas A LO LARGO del lado, así que la coordenada
 * PERPENDICULAR al lado —la que fija el canal de aproximación— es la misma para
 * las dos por construcción. Cuando la ruta limpia tiene que ir por ese canal, las
 * dos van por él.
 *
 * Ejemplo, las dos aristas de A(400,500) a B(800,300), fromSide "s", toSide "e":
 *
 *   ANTES    e1 (386,535) (386,563) (386,286) (948,286) (920,286)   ← separadas,
 *            e2 (414,535) (414,563) (414,314) (948,314) (920,314)     y las dos
 *                                    ^^^^^^^ suben ATRAVESANDO A (239px dentro)
 *   DESPUÉS  e1 (386,535) (386,563) (948,563) (948,286) (920,286)   ← limpias,
 *            e2 (414,535) (414,563) (948,563) (948,314) (920,314)     encimadas
 *                                    ^^^^^^^^^^^^^^^^^ 534px en y=563 las dos
 *
 * Ninguno de los dos estados es bueno. DECISIÓN DEL MANTENEDOR, tomada con estos
 * 256/400 delante y no por descarte: se prefiere «dos flechas limpias que van
 * juntas y se separan al final» a «dos flechas separadas que atraviesan su propio
 * nodo». Un trazo compartido se lee; una flecha que cruza su propio nodo, no.
 * Quien reabra esto no está corrigiendo un olvido: está reabriendo una decisión.
 *
 * EL ARREGLO DE VERDAD, cuando se aborde: desplazar la ruta ELEGIDA entera,
 * tramo a tramo perpendicularmente a sí mismo, que es lo que el comentario de
 * `parallelLane` en geometry.js describe pero orthoRoute nunca implementó — hoy
 * el carril solo mueve las anclas y el canal del medio. Eso cambia la geometría
 * de todas las aristas de un par paralelo, así que pide su propia tanda con su
 * medición antes/después.
 *
 * EN EL CORPUS NO OCURRE. Hay dos pares paralelos activos —ingesta-v2 e11/e12 y
 * rag-chatbot e6/e7— y dos extremos con carril de puerto —oauth2 e12/e13—, y
 * ninguno está en configuración defectuosa: sus rutas salen idénticas al
 * centésimo de píxel antes y después del arreglo.
 *
 * QUÉ LO VIGILA: el chequeo A comparaba solo rutas IDÉNTICAS, y en los 400 casos
 * del barrido no dispara ni una vez. Por eso se le añadió la comparación de trazo
 * colineal entre aristas del mismo par (A-bis): caza los 256 y no da ningún falso
 * positivo sobre los 8 documentos, guardados ni recolocados.
 */

/* ===================== Suites ===================== */

describe("regresión visual: los cuatro defectos de legibilidad", () => {
  it("están cargados los 5 ejemplos oficiales y las fixtures de regresión", () => {
    assert.equal(docs.length, 8, `documentos encontrados: ${docs.map(d => d.name).join(", ")}`);
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
  codeBlockLayout: (n: FluyoNode) => unknown;
  codeColors: (n: FluyoNode, theme: string) => unknown;
  labelLayout: (n: FluyoNode, measure: (fs: number) => number) => unknown;
  setPage: (page: FluyoPage) => void;
}

/**
 * `node:assert/strict` compara con deepStrictEqual, que **también compara el
 * prototipo**. Los objetos que devuelve la app nacen dentro de un contexto `vm`,
 * o sea en otro realm, así que su Object.prototype no es el de este módulo y la
 * comparación falla aunque la estructura sea idéntica. El viaje por JSON los
 * devuelve a objetos planos de este realm.
 *
 * No afecta a las comparaciones de aristas porque esas son escalares.
 */
function plano<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
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
    /* Las constantes se le inyectan desde el codegen, que las extrae de
       js/config.js. Así esta suite mide el ALGORITMO de maquetación y no si las
       constantes están sincronizadas, que es trabajo de `check:config`. */
    CODE_ADV, CODE_LANGS, DEFAULT_LANG, THEMES, FONTS, DEFAULT_SIZES,
  };
  const ctx = createContext(sandbox);
  // El valor de la última expresión es lo que devuelve runInContext: es la forma
  // de sacar del script unas funciones declaradas con `function`/`const`, que no
  // se cuelgan del objeto de contexto.
  const api = runInContext(src + "\n;({edgePoints, placeEdgeLabels, codeBlockLayout, codeColors, labelLayout});", ctx) as {
    edgePoints: AppGeometry["edgePoints"];
    placeEdgeLabels: AppGeometry["placeEdgeLabels"];
    codeBlockLayout: AppGeometry["codeBlockLayout"];
    codeColors: AppGeometry["codeColors"];
    labelLayout: AppGeometry["labelLayout"];
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

        /* Bloques de código. Aquí NO se inyecta ningún medidor, porque la
           maquetación no mide texto: sale de índices de carácter sobre una
           rejilla de ancho fijo. Eso permite comparar la estructura ENTERA
           —tamaño de fuente, avance, caja del bloque y la x/ancho de cada
           token— en vez de solo el algoritmo. Es una garantía más fuerte que la
           que se puede dar para las etiquetas. */
        for (const nodo of page.nodes) {
          if (nodo.shape !== "code") continue;
          assert.deepEqual(
            plano(app.codeBlockLayout(nodo)), plano(codeBlockLayout(nodo)),
            `maquetación del bloque de código del nodo ${nodo.id} en ${d.name}`
          );
          assert.deepEqual(
            plano(app.codeColors(nodo, d.theme)), plano(codeColors(nodo, d.theme as never)),
            `colores del bloque de código del nodo ${nodo.id} en ${d.name}`
          );
        }

        /* Maquetación de la etiqueta. Se le pasa a la app el MISMO medidor
           heurístico que usa el MCP, igual que con las etiquetas de arista: lo
           que se compara es la regla de escalado —escala de caja, límite de
           ancho y límite de alto— y no la medición de texto, que es la
           divergencia conocida y documentada en svg.ts.

           Con el mismo medidor la coincidencia tiene que ser EXACTA, así que se
           compara la estructura entera: tamaño de fuente, interlineado, ancla,
           línea base y la caja que consume el editor in-situ. Esa caja es la que
           coloca el textarea transparente encima del texto; si la app y el
           servidor dejan de calcularla igual, el textarea se descuadra en la app
           y nadie se entera hasta verlo. */
        for (const nodo of page.nodes) {
          if (!nodo.label || nodo.shape === "code") continue;
          assert.deepEqual(
            plano(app.labelLayout(nodo, measureNodeLabel(nodo))),
            plano(labelLayout(nodo, measureNodeLabel(nodo))),
            `maquetación de la etiqueta del nodo ${nodo.id} (${nodo.shape}) en ${d.name}`
          );
        }

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

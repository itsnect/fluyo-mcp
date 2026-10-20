import { CANVAS, CODE_ADV, DEFAULT_SIZES, CODE_LANGS, DEFAULT_FONT, DEFAULT_LANG, FONTS, PALETTE, THEMES, animDataUri, iconDataUri, nodeIconTint } from "./schema.js";
import { FluyoNode, FluyoEdge, FluyoPage, ThemeName } from "./model.js";
import { skinActive, skinEdgeLanding, skinEdgePort, skinLabelFont, skinNode, skinPaintOrder, type SkinLayer } from "./skin.js";

/* ===================== Geometría de aristas (port de fluyo/js/geometry.js) ===================== */

interface Pt { x: number; y: number; }

/* ===================== Caja de anclaje =====================
   Port de `anchorBox()` de fluyo/js/geometry.js. La caja a la que se enganchan
   las flechas no siempre es w×h: en shape:"icon" el glifo se dibuja con
   s = min(w, h-26)*0.78 —51px sobre una caja de 120— y el resto del ancho es
   aire, así que anclar en el borde lógico dejaba la punta de flecha flotando a
   34px del icono.

   La altura se conserva: arriba el glifo, abajo la etiqueta. Y se usa el ancho
   del glifo, no el del texto del pie, porque medir texto se hace distinto en
   cada renderer y meter esa medida en la geometría haría que calculasen rutas
   distintas. La geometría sale del documento y de nada más. */
export function anchorBox(n: FluyoNode): FluyoNode {
  if (n.shape !== "icon") return n;
  const s = Math.min(n.w, n.h - 26) * 0.78;
  return { ...n, w: Math.min(n.w, Math.max(1, s)) };
}

function sidePoint(n0: FluyoNode, s: "n" | "s" | "e" | "w"): Pt {
  const n = anchorBox(n0);
  switch (s) {
    case "n": return { x: n.x, y: n.y - n.h / 2 };
    case "s": return { x: n.x, y: n.y + n.h / 2 };
    case "e": return { x: n.x + n.w / 2, y: n.y };
    case "w": return { x: n.x - n.w / 2, y: n.y };
  }
}

function autoAnchor(n0: FluyoNode, tx: number, ty: number): Pt {
  const n = anchorBox(n0);
  const dx = tx - n.x, dy = ty - n.y;
  if (dx === 0 && dy === 0) return { x: n.x, y: n.y };
  if (n.shape === "circle") {
    const r = n.w / 2, L = Math.hypot(dx, dy);
    return { x: n.x + (dx / L) * r, y: n.y + (dy / L) * r };
  }
  if (n.shape === "diamond") {
    const k = 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2));
    return { x: n.x + dx * k, y: n.y + dy * k };
  }
  const sx = n.w / 2 / Math.abs(dx || 1e-9);
  const sy = n.h / 2 / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return { x: n.x + dx * s, y: n.y + dy * s };
}

function anchorPt(n: FluyoNode, side: "n" | "s" | "e" | "w" | null | undefined, tx: number, ty: number): Pt {
  return side ? sidePoint(n, side) : autoAnchor(n, tx, ty);
}

export function inferSide(n0: FluyoNode, p: Pt): "n" | "s" | "e" | "w" {
  const n = anchorBox(n0);
  const dx = (p.x - n.x) / (n.w / 2 || 1), dy = (p.y - n.y) / (n.h / 2 || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
}

const DIR = {
  n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 },
} as const;

/* ===================== Aristas paralelas =====================
   Port de `parallelOffset()`/`slideAnchor()` de fluyo/js/geometry.js. Dos aristas
   entre el mismo par de nodos daban exactamente la misma ruta —autoAnchor y
   orthoRoute son simétricos—, así que un par bidireccional salía con una flecha
   encima de la otra y las dos etiquetas en el mismo punto.

   El signo se decide en un marco canónico (el par ordenado por id, no el sentido
   de la flecha) para que las dos mitades de un par bidireccional no reciban
   desplazamientos que se anulen. Con una sola arista el desplazamiento es 0 y la
   geometría queda intacta. */
const PARALLEL_SEP = 28;

/* FLUYO-018.25 — carriles por CANAL, estables (port de trackKey/trackSiblings/parallelLane de
   fluyo/js/geometry.js). Comparten carril solo las aristas del mismo par de nodos que salen y
   llegan por los mismos lados (lados sin correr, en el marco canónico del par ordenado por id);
   dentro del canal manda el id: la primera se queda en el carril 0 y las siguientes se apartan
   hacia fuera (+SEP, −SEP, +2·SEP…; en una U, k·SEP más afuera). Antes el abanico era simétrico
   sobre el par entero: una directa se apartaba por una U que no compartía nada con ella y añadir
   una hermana movía la que ya estaba. */
function trackKey(e: FluyoEdge, nodeById: Map<number, FluyoNode>): string | null {
  const b = baseAnchors(e, nodeById);
  if (!b) return null;
  return e.from < e.to ? `${e.from}:${b.s1}|${e.to}:${b.s2}` : `${e.to}:${b.s2}|${e.from}:${b.s1}`;
}

/** Las aristas del canal de `e`, por id. Primero el filtro de enteros y solo para esas la geometría. */
function trackSiblings(e: FluyoEdge, edges: readonly FluyoEdge[], nodeById: Map<number, FluyoNode>): FluyoEdge[] {
  if ((e.waypoints || []).length) return [e];
  const par: FluyoEdge[] = [];
  for (const o of edges) {
    if ((o.waypoints || []).length) continue;
    if ((o.from === e.from && o.to === e.to) || (o.from === e.to && o.to === e.from)) par.push(o);
  }
  if (par.length < 2) return par;
  const k = trackKey(e, nodeById);
  return par.filter(o => o === e || trackKey(o, nodeById) === k).sort((a, b) => a.id - b.id);
}

/** El carril de esta arista: `k` es su puesto en el canal (0 = la primera) y `off` su
 *  desplazamiento entre caras que se miran (0, +SEP, −SEP, +2·SEP…). */
interface Lane { off: number; half: number; k: number; clamp?: boolean }
function parallelLane(e: FluyoEdge, edges: readonly FluyoEdge[], nodeById: Map<number, FluyoNode>): Lane {
  const none: Lane = { off: 0, half: 0, k: 0 };
  const sib = trackSiblings(e, edges, nodeById);
  if (sib.length < 2) return none;
  const k = sib.indexOf(e);
  if (k < 0) return none;
  const b = baseAnchors(sib[0], nodeById);
  if (!b || b.s1 === b.s2) return k ? { off: 0, half: 0, k } : none;   // U: anidadas en edgePoints
  const L = laneLayout(sib, b, nodeById);
  return { off: L.offs[k], half: L.half || 0, k, clamp: !!L.clamp };
}

/* ===================== Carriles: estabilidad cuando cabe, recolocación mínima cuando no =====================
   Port idéntico de laneLayout de fluyo/js/geometry.js (FLUYO-018.25). Candidatas: ESTABLE (la primera en 0, las
   demás alternando ±g con el mayor g ≤ SEP que cabe y nunca menor que LANE_MIN, también en espejo) y RECOLOCADA (el
   mismo orden con la separación razonable g = LANE_MIN, corrido el mínimo que hace caber a todas). Gana la de menos defectos
   —penetración en cualquier nodo, retroceso, diagonal, cruce entre hermanas— y, a igualdad, la estable, la de menor
   movimiento y la orientación +. Sin ninguna que quepa, el abanico de antes (recortado). */
const LANE_MIN = PARALLEL_SEP / 2, LANE_INSET = 10;
function laneRange(n0: FluyoNode, side: "n" | "s" | "e" | "w", p: Pt): [number, number] {
  const n = anchorBox(n0), horiz = side === "n" || side === "s", c = horiz ? n.x : n.y;
  const lim = Math.max(0, (horiz ? n.w / 2 : n.h / 2) - LANE_INSET), v = horiz ? p.x : p.y;
  return [c - lim - v, c + lim - v];
}
function laneShift(p: Pt, side: "n" | "s" | "e" | "w", o: number): Pt {
  return side === "n" || side === "s" ? { x: p.x + o, y: p.y } : { x: p.x, y: p.y + o };
}
function laneLayout(sib: FluyoEdge[], b: BaseAnchors, nodeById: Map<number, FluyoNode>): { offs: number[]; half?: number; clamp?: boolean } {
  const n = sib.length, A = nodeById.get(sib[0].from)!, B = nodeById.get(sib[0].to)!;
  const r1 = laneRange(A, b.s1, b.p1), r2 = laneRange(B, b.s2, b.p2);
  const lo = Math.max(r1[0], r2[0]), hi = Math.min(r1[1], r2[1]);
  const alt = (k: number) => (k % 2 ? 1 : -1) * Math.ceil(k / 2);
  const cajas = [...nodeById.values()].map(obstBox);
  const ruta = (e: FluyoEdge, o: number): Pt[] => {
    const mismo = e.from === sib[0].from;
    const s = mismo ? [b.s1, b.s2] : [b.s2, b.s1], q = mismo ? [b.p1, b.p2] : [b.p2, b.p1];
    const a = laneShift(q[0], s[0], o), z = laneShift(q[1], s[1], o);
    return e.route === "ortho" ? orthoRoute(a, DIR[s[0]], z, DIR[s[1]], o, nodeById.get(e.from), nodeById.get(e.to)) : [a, z];
  };
  const defectos = (offs: number[]): number => {
    const rs = sib.map((e, k) => ruta(e, offs[k]));
    let d = 0;
    for (const r of rs) {
      if (pathInBoxes(r, cajas) >= OBST_MIN) d++;
      for (let i = 2; i < r.length; i++) { const a = r[i - 2], m = r[i - 1], c = r[i];
        if ((m.x - a.x) * (c.x - m.x) + (m.y - a.y) * (c.y - m.y) < -1 && Math.abs((m.x - a.x) * (c.y - m.y) - (m.y - a.y) * (c.x - m.x)) < 1) d++; }
      for (let i = 1; i < r.length; i++) if (Math.abs(r[i].x - r[i - 1].x) > 1.5 && Math.abs(r[i].y - r[i - 1].y) > 1.5) d++;
    }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) d += laneCrossings(rs[i], rs[j]);
    return d;
  };
  const cands: Array<{ fam: number; mov: number; sg: number; offs: number[]; def?: number }> = [];
  for (const sg of [1, -1]) {
    let g = PARALLEL_SEP;
    for (let k = 1; k < n; k++) { const a = sg * alt(k); g = Math.min(g, a > 0 ? hi / a : lo / a); }
    if (g >= LANE_MIN - 1e-9) cands.push({ fam: 0, mov: 0, sg, offs: sib.map((e, k) => (k ? sg * alt(k) * g : 0)) });
  }
  if (hi >= lo) {
    const g = n > 1 ? Math.min(LANE_MIN, (hi - lo) / (n - 1)) : 0;   // movimiento mínimo: la separación razonable, no la máxima
    for (const sg of [1, -1]) {
      const st = sib.map((e, k) => sg * alt(k) * g), t0 = Math.min(...st);
      const t = clamp(t0, lo, hi - (n - 1) * g);
      cands.push({ fam: 1, mov: Math.abs(t - t0), sg, offs: st.map(v => v - t0 + t) });
    }
  }
  if (!cands.length) return { offs: sib.map((e, k) => (k - (n - 1) / 2) * PARALLEL_SEP), half: ((n - 1) / 2) * PARALLEL_SEP, clamp: true };
  for (const c of cands) c.def = defectos(c.offs);
  cands.sort((a, b) => a.def! - b.def! || a.fam - b.fam || a.mov - b.mov || b.sg - a.sg);
  return { offs: cands[0].offs };
}
function laneCrossings(p: Pt[], q: Pt[]): number {
  const o = (P0: Pt, Q: Pt, R: Pt) => Math.sign((Q.x - P0.x) * (R.y - P0.y) - (Q.y - P0.y) * (R.x - P0.x));
  let n = 0;
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) {
    const a = p[i - 1], b = p[i], c = q[j - 1], d = q[j];
    if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) n++;
  }
  return n;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ===================== Puertos compartidos =====================
   Port de `portLane()` de fluyo/js/geometry.js. Cuando dos aristas fijan el mismo
   lado de un nodo con fromSide/toSide, sidePoint les da EL MISMO PUNTO; si una
   entra y la otra sale, el flujo parece darse la vuelta sobre la misma línea.

   Tres condiciones: anclas coincidentes (si autoAnchor ya las separó no hay nada
   que arreglar), tráfico en los dos sentidos (un abanico que sale del mismo punto
   se lee como un bus y separarlo solo añade ruido), y no ser un par paralelo, que
   ya tiene su propio reparto. Sobre el corpus reparte exactamente un grupo. */
interface BaseAnchors { p1: Pt; p2: Pt; s1: "n" | "s" | "e" | "w"; s2: "n" | "s" | "e" | "w"; }

function baseAnchors(e: FluyoEdge, nodeById: Map<number, FluyoNode>): BaseAnchors | null {
  const A = nodeById.get(e.from), B = nodeById.get(e.to);
  if (!A || !B) return null;
  const wps = e.waypoints || [];
  const tA = wps[0] || { x: B.x, y: B.y };
  const tB = wps[wps.length - 1] || { x: A.x, y: A.y };
  const p1 = anchorPt(A, e.fromSide, tA.x, tA.y);
  const p2 = anchorPt(B, e.toSide, tB.x, tB.y);
  return { p1, p2, s1: e.fromSide || inferSide(A, p1), s2: e.toSide || inferSide(B, p2) };
}

function portKey(nodeId: number, side: string, p: Pt): string {
  return `${nodeId}:${side}:${Math.round(p.x)},${Math.round(p.y)}`;
}

/** Cuántas aristas comparten el CANAL de `e` (FLUYO-018.25: antes, el par de nodos). */
function siblingCount(e: FluyoEdge, edges: readonly FluyoEdge[], nodeById: Map<number, FluyoNode>): number {
  return trackSiblings(e, edges, nodeById).length;
}

/** El reparto es por extremo, no por arista: una arista puede compartir puerto en
 *  un lado y no en el otro.
 *
 *  El orden de los filtros importa para el coste: primero se descarta con
 *  comparaciones de enteros —solo las aristas que TOCAN este nodo pueden
 *  compartir puerto— y la geometría, que es lo caro, se calcula solo para esas.
 *  Sin ese orden, una página de 90 aristas se comía el 75 % del fotograma. */
function portLane(
  e: FluyoEdge, which: "from" | "to",
  edges: readonly FluyoEdge[], nodeById: Map<number, FluyoNode>
): { off: number; half: number } {
  const none = { off: 0, half: 0 };
  if ((e.waypoints || []).length) return none;
  const nodeId = which === "from" ? e.from : e.to;
  const vecinas: FluyoEdge[] = [];
  for (const o of edges) {
    if (o.from !== nodeId && o.to !== nodeId) continue;
    if ((o.waypoints || []).length) continue;
    vecinas.push(o);
  }
  if (vecinas.length < 2) return none;
  if (siblingCount(e, edges, nodeById) > 1) return none;
  const me = baseAnchors(e, nodeById);
  if (!me) return none;
  const key = portKey(nodeId, which === "from" ? me.s1 : me.s2, which === "from" ? me.p1 : me.p2);
  const grupo: Array<{ id: number; sent: "entra" | "sale" }> = [];
  for (const o of vecinas) {
    if (siblingCount(o, edges, nodeById) > 1) continue;
    const b = baseAnchors(o, nodeById);
    if (!b) continue;
    if (o.from === nodeId && portKey(nodeId, b.s1, b.p1) === key) grupo.push({ id: o.id, sent: "sale" });
    if (o.to === nodeId && portKey(nodeId, b.s2, b.p2) === key) grupo.push({ id: o.id, sent: "entra" });
  }
  if (grupo.length < 2) return none;
  if (!(grupo.some(x => x.sent === "entra") && grupo.some(x => x.sent === "sale"))) return none;
  const yo = which === "from" ? "sale" : "entra";
  const i = grupo.findIndex(x => x.id === e.id && x.sent === yo);
  if (i < 0) return none;
  return { off: (i - (grupo.length - 1) / 2) * PARALLEL_SEP, half: ((grupo.length - 1) / 2) * PARALLEL_SEP };
}

/** Corre el ancla a lo largo de su lado sin salirse de él: el extremo tiene que
 *  seguir tocando el borde del nodo.
 *
 *  El ancla base se mete primero hacia dentro lo justo para que quepa el abanico
 *  entero. Sin ese paso, un ancla que autoAnchor dejó pegada a una esquina no
 *  tiene hueco para apartarse y el clamp se come el desplazamiento. */
function slideAnchor(n0: FluyoNode, side: "n" | "s" | "e" | "w", p: Pt, off: number, half: number): Pt {
  if (!off) return p;
  const n = anchorBox(n0);
  const inset = 10;
  const horiz = side === "n" || side === "s";
  const c = horiz ? n.x : n.y;
  const lim = Math.max(0, (horiz ? n.w / 2 : n.h / 2) - inset);
  const room = Math.max(0, lim - half);
  const base = clamp(horiz ? p.x : p.y, c - room, c + room);
  const v = clamp(base + off, c - lim, c + lim);
  return horiz ? { x: v, y: p.y } : { x: p.x, y: v };
}

/* ===================== Llegar por el lado contrario =====================
 * El pasillo de aproximación de `pad` px delante de cada extremo es correcto y
 * no se toca: es lo que hace que la flecha entre perpendicular al borde.
 *
 * Lo que estaba mal era el CONECTOR entre los dos puntos de pasillo. Se elegía
 * con una tabla fija de cuatro casos que nunca miraba por dónde pasaba. Cuando
 * el otro nodo queda del lado contrario al lado anclado, el codo caía dentro del
 * nodo: la ruta lo atravesaba, se pasaba `pad` px de largo y volvía al borde,
 * dejando un muñón de 28 px asomando. Medido antes de arreglarlo: 16 de las 25
 * combinaciones de fromSide × toSide, 3 aristas del corpus publicado y 10 de ese
 * mismo corpus recolocado con el auto-layout.
 *
 * Entre dos puntos siempre hay DOS maneras de doblar en ortogonal, y casi
 * siempre una está limpia: el arreglo no es rodear el nodo con vértices nuevos,
 * es doblar antes en vez de después.
 *
 * La cláusula que protege lo demás es la salida temprana: si la ruta de hoy no
 * entra en ninguna de las dos cajas de anclaje, se devuelve TAL CUAL. Medido: de
 * las 54 aristas del corpus cambian 3, y son las 3 defectuosas.
 *
 * Port literal de fluyo/js/geometry.js. La suite de paridad compara los dos. */
const OBST_TOL = 1.5;   // roce del borde que no cuenta como entrar
const OBST_MIN = 4;     // px dentro de la caja para considerarlo un defecto
interface Caja { x0: number; x1: number; y0: number; y1: number; }
function obstBox(n: FluyoNode): Caja {
  const a = anchorBox(n);
  return { x0: a.x - a.w / 2, x1: a.x + a.w / 2, y0: a.y - a.h / 2, y1: a.y + a.h / 2 };
}
/** Longitud del tramo que cae dentro de la caja, por recorte exacto
 *  (Liang-Barsky) y no por muestreo.
 *
 *  Tiene que valer para tramos NO ortogonales: el dedup descarta puntos a ≤1px,
 *  así que cuando dos anclas de nodos distintos difieren en 1px queda un tramo
 *  con 1px de inclinación. Un test que solo mirase tramos exactamente
 *  ortogonales daría ese caso por bueno —pasó, con microservicios e20
 *  recolocado— y el defecto se colaría. */
function segInBox(a: Pt, b: Pt, B: Caja): number {
  const x0 = B.x0 + OBST_TOL, x1 = B.x1 - OBST_TOL, y0 = B.y0 + OBST_TOL, y1 = B.y1 - OBST_TOL;
  if (x1 <= x0 || y1 <= y0) return 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const lados: Array<[number, number]> = [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]];
  for (const [p, q] of lados) {
    if (p === 0) { if (q < 0) return 0; continue; }   // paralelo al lado y fuera
    const r = q / p;
    if (p < 0) { if (r > t1) return 0; if (r > t0) t0 = r; }
    else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return Math.max(0, t1 - t0) * Math.hypot(dx, dy);
}
function pathInBoxes(pts: Pt[], cajas: Caja[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) for (const b of cajas) L += segInBox(pts[i - 1], pts[i], b);
  return L;
}
function pathLen(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return L;
}
function orthoRoute(
  p1: Pt, d1: { x: number; y: number }, p2: Pt, d2: { x: number; y: number }, off = 0,
  A?: FluyoNode, B?: FluyoNode
): Pt[] {
  // FLUYO-018.25 — caras que se miran muy cerca: el pasillo de `pad` px no cabe cuando el hueco
  // es menor que 2·pad. Los dos pasillos se cruzaban y la ruta avanzaba, retrocedía y volvía a
  // avanzar sobre la misma línea. Ahí cada pasillo mide la mitad del hueco (monótona en su eje).
  let pad = 28;
  const deFrente = d1.x === -d2.x && d1.y === -d2.y;
  const hueco = (p2.x - p1.x) * d1.x + (p2.y - p1.y) * d1.y;
  if (deFrente && hueco > 0 && hueco < 2 * pad) pad = hueco / 2;
  const s = { x: p1.x + d1.x * pad, y: p1.y + d1.y * pad };
  const t = { x: p2.x + d2.x * pad, y: p2.y + d2.y * pad };
  const armar = (mids: Pt[]): Pt[] => {
    const raw = [p1, s, ...mids, t, p2];
    const out: Pt[] = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      const a = out[out.length - 1], b = raw[i];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1) out.push(b);
    }
    return out;
  };
  // Un canal vertical en x=c, o uno horizontal en y=c. Los dos degeneran en el
  // codo simple cuando c coincide con s o con t, así que esta pareja de
  // funciones cubre las cuatro formas de la tabla de antes.
  const zx = (c: number): Pt[] => [{ x: c, y: s.y }, { x: c, y: t.y }];
  const zy = (c: number): Pt[] => [{ x: s.x, y: c }, { x: t.x, y: c }];
  let mids: Pt[];
  // El tramo central también se aparta: separar solo las anclas dejaría las dos
  // rutas compartiendo el canal largo del medio, que es donde va la etiqueta.
  //
  // FLUYO-018.25 — la U. Con los dos lados en el MISMO sentido `u` (n/n, s/s, e/e, w/w) el
  // canal no va ENTRE los pasillos sino más allá de los dos. El punto medio solo vale cuando
  // los lados se miran: en una U caía por dentro del pasillo más exterior (pasillos desiguales,
  // o el carril de un par paralelo hacia los nodos) y la ruta salía, volvía y cruzaba —un muñón
  // FUERA de los nodos que el guardián no ve—. El canal va al pasillo exterior; el carril k de una
  // U llega como off = u·k·SEP, siempre hacia fuera (edgePoints).
  //
  // Entre caras que se miran de frente, el canal del carril se queda ENTRE los dos pasillos: un
  // carril más ancho que el hueco lo dejaría más allá del pasillo de destino y la ruta volvería
  // atrás. Con hueco de sobra, (s+t)/2+off como siempre. Port idéntico de fluyo/js/geometry.js.
  const enU = (u: number, a: number, b: number) => (u > 0 ? Math.max(a, b) : Math.min(a, b)) + off;
  const medio = (a: number, b: number) => { const c = (a + b) / 2 + off; return deFrente && hueco > 0 ? clamp(c, Math.min(a, b), Math.max(a, b)) : c; };
  if (d1.x !== 0 && d2.x !== 0) { mids = zx(d1.x === d2.x ? enU(d1.x, s.x, t.x) : medio(s.x, t.x)); }
  else if (d1.y !== 0 && d2.y !== 0) { mids = zy(d1.y === d2.y ? enU(d1.y, s.y, t.y) : medio(s.y, t.y)); }
  else if (d1.x !== 0) { mids = [{ x: t.x, y: s.y }]; }
  else { mids = [{ x: s.x, y: t.y }]; }
  const actual = armar(mids);
  if (!A || !B) return actual;
  const cajas = [obstBox(A), obstBox(B)];
  let mejorPen = pathInBoxes(actual, cajas);
  if (mejorPen < OBST_MIN) return actual;        // la ruta de hoy está limpia: no se toca
  let mejor = actual, mejorCod = actual.length, mejorLar = pathLen(actual);
  const o = off || 0;
  /* EL ORDEN DE ESTA LISTA ES NORMATIVO, no estético. Los canales pegados a una
     caja van ANTES que el canal del punto medio, y los empates los gana el
     primero. Con el orden inverso, `estáticos` de arquitectura-serverless-aws
     recolocado empata en penetración y en codos, se lleva el canal medio y
     comparte 74 px de trazo en sentido opuesto con `/api/*`: un hallazgo E
     nuevo, cambiar un defecto por otro. Con los canales pegados delante el
     corpus entero sale sin un solo hallazgo nuevo. Quien reordene esto tiene que
     volver a medir los chequeos A-F sobre los 8 documentos, guardados Y
     recolocados con layeredLayout. */
  const cx = [s.x, t.x], cy = [s.y, t.y];
  for (const b of cajas) {
    cx.push(b.x0 - pad + o, b.x1 + pad + o);
    cy.push(b.y0 - pad + o, b.y1 + pad + o);
  }
  cx.push((s.x + t.x) / 2 + o); cy.push((s.y + t.y) / 2 + o);
  // El `off` del carril paralelo viaja con el canal elegido, igual que viajaba
  // con el canal medio: dos hermanas de un par paralelo tienen que seguir
  // separadas aunque las dos acaben aquí.
  const probar = (cand: Pt[]) => {
    const pen = pathInBoxes(cand, cajas), cod = cand.length, lar = pathLen(cand);
    if (pen < mejorPen - 0.01 || (pen < mejorPen + 0.01 && (cod < mejorCod || (cod === mejorCod && lar < mejorLar - 0.01)))) {
      mejor = cand; mejorPen = pen; mejorCod = cod; mejorLar = lar;
    }
  };
  for (const c of cx) probar(armar(zx(c)));
  for (const c of cy) probar(armar(zy(c)));
  return mejor;
}

function edgePoints(e: FluyoEdge, nodeById: Map<number, FluyoNode>, edges: readonly FluyoEdge[]): Pt[] {
  const A = nodeById.get(e.from), B = nodeById.get(e.to);
  if (!A || !B) return [];
  const wps = e.waypoints || [];
  const tA = wps[0] || { x: B.x, y: B.y };
  const tB = wps[wps.length - 1] || { x: A.x, y: A.y };
  let p1 = anchorPt(A, e.fromSide, tA.x, tA.y);
  let p2 = anchorPt(B, e.toSide, tB.x, tB.y);
  // Los lados se deciden con las anclas SIN correr: apartarse para no solaparse
  // no debe cambiar por qué cara sale la flecha.
  const s1 = e.fromSide || inferSide(A, p1);
  const s2 = e.toSide || inferSide(B, p2);
  const lane = parallelLane(e, edges, nodeById), off = lane.off, k = lane.k;
  let canal = off;
  if (k && s1 === s2) {
    // U (FLUYO-018.25): el carril k va k·SEP más afuera y sus anclas se apartan del otro
    // extremo, así que las U de un canal se anidan sin cruzarse.
    const ax = DIR[s1].x !== 0 ? "y" : "x", d = Math.sign(p1[ax] - p2[ax]) || 1, m = k * PARALLEL_SEP;
    p1 = slideAnchor(A, s1, p1, d * m, m); p2 = slideAnchor(B, s2, p2, -d * m, m);
    canal = (DIR[s1].x || DIR[s1].y) * m;
  }
  else if (off) {
    // Carril de laneLayout: cabe en los dos lados por construcción (o, sin sitio, el abanico recortado de antes).
    if (lane.clamp) { p1 = slideAnchor(A, s1, p1, off, lane.half); p2 = slideAnchor(B, s2, p2, off, lane.half); }
    else { p1 = laneShift(p1, s1, off); p2 = laneShift(p2, s2, off); }
  }
  else {
    // El reparto por puerto es por extremo y no toca el canal central: en el caso
    // ortogonal el canal ya sale de las anclas, así que se mueve solo.
    const o1 = portLane(e, "from", edges, nodeById), o2 = portLane(e, "to", edges, nodeById);
    if (o1.off) p1 = slideAnchor(A, s1, p1, o1.off, o1.half);
    if (o2.off) p2 = slideAnchor(B, s2, p2, o2.off, o2.half);
  }
  if (e.route === "ortho" && wps.length === 0) {
    return orthoRoute(p1, DIR[s1], p2, DIR[s2], canal, A, B);
  }
  return [p1, ...wps, p2];
}

/** Seam de pruebas: la geometría resuelta de una página, que es lo que miden el
 *  test de regresión visual y el diagnóstico. Se exporta para que ninguno de los
 *  dos tenga que reimplementar el ruteo — reimplementarlo sería garantizar que
 *  midan algo distinto de lo que se dibuja. */
export function pageEdgeGeometry(page: FluyoPage): Map<number, { x: number; y: number }[]> {
  const nodeById = new Map(page.nodes.map(n => [n.id, n] as const));
  return new Map(page.edges.map(e => [e.id, edgePoints(e, nodeById, page.edges)] as const));
}

function pointAt(pts: Pt[], f: number): Pt {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let target = f * L;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (target <= seg || i === pts.length - 1) {
      const u = seg ? target / seg : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u };
    }
    target -= seg;
  }
  return pts[pts.length - 1];
}

/* ===================== Colocación de etiquetas =====================
   Port de `placeEdgeLabels()` de fluyo/js/geometry.js. La etiqueta iba siempre al
   punto medio exacto de la ruta, sin mirar qué había debajo, así que en cuanto el
   diagrama se aprieta cae encima de un nodo o de otra etiqueta.

   Se prueban posiciones a lo largo de la arista, del medio hacia fuera, y se coge
   la primera libre; si ninguna lo está, la que menos solape. El orden de
   colocación es el de la página y cada etiqueta solo esquiva a las anteriores:
   eso es lo que hace el resultado único y reproducible entre los dos renderers. */
const LBL_FRACS: number[] = (() => { const o = [0.5]; for (let d = 0.04; d <= 0.36 + 1e-9; d += 0.04) o.push(0.5 - d, 0.5 + d); return o; })();

interface Rect { x: number; y: number; w: number; h: number; }

function rectOverlapArea(a: Rect, b: Rect): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function labelRectAt(pts: Pt[], f: number, w: number, h: number) {
  const p = pointAt(pts, f);
  return { x: p.x - w / 2 - 6, y: p.y - h / 2, w: w + 12, h, cx: p.x, cy: p.y };
}

/** Dónde va la etiqueta de cada arista de la página. */
export function placeEdgeLabels(page: FluyoPage): Map<number, Pt> {
  const geom = pageEdgeGeometry(page);
  const out = new Map<number, Pt>();
  const placed: Rect[] = [];
  const nodeBoxes: Rect[] = page.nodes.map(n => ({ x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h }));
  for (const e of page.edges) {
    if (!e.label) continue;
    const pts = geom.get(e.id);
    if (!pts || pts.length < 2) continue;
    const efs = edgeLabelFs(e);
    const w = approxTextWidth(e.label, efs, !!e.bold), h = efs * 1.7;
    if (!(w > 0)) continue;
    let best: ReturnType<typeof labelRectAt> | null = null;
    let bestCost = Infinity;
    for (const f of LBL_FRACS) {
      const r = labelRectAt(pts, f, w, h);
      let cost = 0;
      for (const b of nodeBoxes) cost += rectOverlapArea(r, b);
      for (const b of placed) cost += rectOverlapArea(r, b);
      if (cost === 0) { best = r; bestCost = 0; break; }
      if (cost < bestCost) { best = r; bestCost = cost; }
    }
    if (best) { out.set(e.id, { x: best.cx, y: best.cy }); placed.push(best); }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Texto: heurística de ancho — LIMITACIÓN CONOCIDA

   La app mide el texto de verdad: crea un <text> en un <svg> oculto y le pide el
   getBBox() al navegador (fluyo/js/export.js). Aquí no hay DOM, así que se estima
   sumando anchos por carácter.

   Consecuencia: cuando una etiqueta no cabe en su forma, el tamaño de fuente al
   que se encoge puede diferir un poco del que elegiría la app, y el fondo de las
   etiquetas de arista puede quedar unos píxeles ancho o estrecho. Las etiquetas
   que caben —la mayoría— salen idénticas.

   No se puede arreglar sin meter un motor de layout de texto o una cabeza de
   navegador, que para este servidor es un precio desproporcionado. Si algún día
   importa, el punto de extensión es inyectar el medidor en pageToSVG.
   ═══════════════════════════════════════════════════════════════════════════ */

const WIDE = new Set("MWmw@%&#GOQ".split(""));
const NARROW = new Set("iIl1.,'|!;:tfrj".split(""));

export function approxTextWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 0.32;
    else if (WIDE.has(ch)) units += 0.85;
    else if (NARROW.has(ch)) units += 0.3;
    else if (/[A-Z]/.test(ch)) units += 0.68;
    else units += 0.52;
  }
  return units * fontSize * (bold ? 1.06 : 1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ESCALADO Y MAQUETACIÓN DE LA ETIQUETA

   Port de labelBaseFs / labelCenterY / labelBoxScale / labelBandH /
   labelFontSize / labelLayout de fluyo/js/geometry.js. UNA regla, la misma que
   ya usaba `code`: el tamaño de fuente sale de las DOS dimensiones de la caja.

   Tres límites y manda el menor: la escala de caja —cuánto se ha redimensionado
   el nodo respecto al tamaño con el que nace su forma—, el ancho disponible y el
   alto de su franja. Que la escala sea RELATIVA al tamaño por defecto es lo que
   la hace retrocompatible: un nodo sin redimensionar da factor 1 y sale igual.

   Lo único que aquí difiere de la app es el MEDIDOR, que es la divergencia ya
   conocida y documentada arriba: la app mide con getBBox(), esto estima por
   anchos de carácter. Mueve el font-size en decimales, no la maquetación.
   ═══════════════════════════════════════════════════════════════════════════ */

const LABEL_LH = 1.25;
const LABEL_PAD_X = 18;
const LABEL_MIN_FS = 10;

export function labelBaseFs(n: FluyoNode): number {
  if (n.shape === "text") return 22;
  if (n.shape === "icon" || n.shape === "anim" || n.shape === "image") return 14;
  return 17;
}

export function labelCenterY(n: FluyoNode): number {
  switch (n.shape) {
    case "image": return n.y + n.h / 2 + 14;
    case "icon": return n.y + n.h / 2 - 10;
    case "anim": return n.y + n.h / 2 - 8;
    case "cylinder": return n.y + 6;
    default: return n.y;
  }
}

function labelBoxScale(n: FluyoNode): number {
  const d = (DEFAULT_SIZES as Record<string, readonly [number, number] | undefined>)[n.shape];
  if (!d || !(d[0] > 0) || !(d[1] > 0)) return 1;
  return Math.min(n.w / d[0], n.h / d[1]);
}

/** La etiqueta de un ícono vive FUERA del dibujo, en los mismos 26px que el
 *  renderer le resta al glifo: dejarla crecer hasta el alto del nodo sería
 *  dejar que se comiera el ícono. */
function labelBandH(n: FluyoNode): number {
  if (n.shape === "icon" || n.shape === "anim") return 26;
  if (n.shape === "image") return 28;
  return n.h;
}

export function labelFontSize(n: FluyoNode, measure: (fs: number) => number): number {
  if (n.fs) return n.fs;
  const nLines = String(n.label ?? "").split("\n").length;
  let fs = labelBaseFs(n) * labelBoxScale(n);
  const avail = n.w - LABEL_PAD_X;
  if (avail > 0) {
    const maxW = Math.max(measure(fs), 1);
    if (maxW > avail) fs = (fs * avail) / maxW;
  }
  const porAlto = labelBandH(n) / (nLines * LABEL_LH);
  if (fs > porAlto) fs = porAlto;
  return Math.max(LABEL_MIN_FS, fs);
}

/** Medidor de este renderer: heurística por anchos de carácter. */
export function measureNodeLabel(n: FluyoNode): (fs: number) => number {
  const lines = String(n.label ?? "").split("\n");
  const bold = !!n.bold;
  return fs => Math.max(...lines.map(l => approxTextWidth(l, fs, bold)), 1);
}

export interface LabelLayout {
  lines: string[];
  fs: number;
  lh: number;
  tx: number;
  align: "left" | "right" | "center";
  baseY: number;
  pos: string;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
}

export function labelLayout(n: FluyoNode, measure: (fs: number) => number): LabelLayout {
  const lines = String(n.label ?? "").split("\n");
  const fs = labelFontSize(n, measure), lh = fs * LABEL_LH;
  const pos = n.lblPos || "center";
  const inset = Math.min(14, n.w * 0.12, n.h * 0.18);
  let tx = n.x;
  let align: "left" | "right" | "center" = "center";
  if (pos === "left") { tx = n.x - n.w / 2 + inset; align = "left"; }
  else if (pos === "right") { tx = n.x + n.w / 2 - inset; align = "right"; }
  let baseY: number;
  if (pos === "top") baseY = n.y - n.h / 2 + inset + fs * 0.7;
  else if (pos === "bottom") baseY = n.y + n.h / 2 - inset - (lines.length - 1) * lh - fs * 0.1;
  else baseY = labelCenterY(n) - ((lines.length - 1) * lh) / 2;
  const boxW = Math.max(1, n.w - LABEL_PAD_X);
  let boxX: number;
  if (align === "left") boxX = tx;
  else if (align === "right") boxX = tx - boxW;
  else boxX = n.x - boxW / 2;
  return { lines, fs, lh, tx, align, baseY, pos, boxX, boxY: baseY - lh / 2, boxW, boxH: lines.length * lh };
}

/** Las etiquetas de arista no tienen caja de la que derivar un tamaño: flotan
 *  sobre la línea y no escalan. Port de `edgeLabelFs()`. */
export function edgeLabelFs(e: { fs?: number | null }): number {
  return e.fs || 13;
}

/* ===================== Utilidades ===================== */

function escapeXML(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/* FLUYO-019.5 — port literal de colorTint (fluyo/js/geometry.js): el tinte de un color de nodo (relleno automático, panel de
   `code`) es ese color con opacidad k. Lee exactamente los HEX del dominio (HEX_COLOR), sin distinguir mayúsculas e ignorando los
   espacios de los extremos: #rrggbb → rgba(r,g,b,k), el string de siempre; #rgb → expandido; #rrggbbaa → rgba(r,g,b,k·aa/255) con
   4 decimales (aa=ff → k exacto); cualquier otro valor → null. La paridad con la app la mide visual-regression (vm). */
export function colorTint(color: unknown, k: number): string | null {
  const m = typeof color === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return null;
  let s = m[1]; if (s.length === 3) s = s.split("").map(ch => ch + ch).join("");
  const v = parseInt(s.slice(0, 6), 16);
  const a = s.length === 8 ? Math.round(k * parseInt(s.slice(6), 16) / 255 * 1e4) / 1e4 : k;
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/* nodeTint de fluyo/js/render.js: un color ilegible tiñe con el respaldo histórico del documento, PALETTE[0]. */
function svgFillColor(hex: string, theme: ThemeName): string {
  const k = theme === "crema" ? 0.16 : 0.18;
  return colorTint(hex, k) ?? (colorTint(PALETTE[0].hex, k) as string);
}

/** Relleno de la forma: `none` deja la caja hueca, un color explícito manda, y si
 *  no hay nada se usa el color del nodo al 18 % — igual que `fillFor()` en la app. */
function svgNodeFill(n: FluyoNode, theme: ThemeName): string {
  if (n.fill === "none") return "none";
  if (n.fill) return escapeXML(n.fill);
  return svgFillColor(n.color, theme);
}

function svgDash(n: FluyoNode): string {
  if (n.border === "dashed") return ' stroke-dasharray="9 7"';
  if (n.border === "dotted") return ' stroke-dasharray="2 5"';
  return "";
}

/* ===================== Etiquetas ===================== */

/** Port de `svgLabelLines()` de fluyo/js/export.js: respeta lblPos, textBg,
 *  textColor, font y bold. */
const SVG_ANCHOR = { left: "start", right: "end", center: "middle" } as const;

/* `fo` (FLUYO-019.3, port de 019.1): voz propuesta por la piel (skinLabelFont); cambia familia y peso, no el tamaño
   (este renderer mide con approxTextWidth, sin familia: la divergencia de medidor conocida). */
function svgLabelLines(n: FluyoNode, theme: ThemeName, globalFont: string, fo?: { family: string; weight: string } | null): string {
  if (!n.label) return "";
  const T = THEMES[theme];
  const family = (fo && fo.family) || n.font || globalFont || DEFAULT_FONT;
  const bold = !!n.bold;
  const { lines, fs, lh, tx, align, baseY } = labelLayout(n, measureNodeLabel(n));
  const anchor = SVG_ANCHOR[align];

  // En un texto suelto o un GIF manda el color del nodo; dentro de una caja, el del tema.
  const fill = n.textColor || (n.shape === "text" || n.shape === "anim" ? n.color : T.text);

  const parts: string[] = [];
  if (n.textBg) {
    const maxW = Math.max(...lines.map(l => approxTextWidth(l, fs, bold)), 1);
    const padX = 10, padY = 6;
    const bw = maxW + padX * 2, bh = lines.length * lh + padY * 2;
    let bx: number;
    if (anchor === "start") bx = tx - padX;
    else if (anchor === "end") bx = tx - bw + padX;
    else bx = tx - bw / 2;
    const by = baseY - fs * 0.7 - padY;
    parts.push(
      `<rect x="${bx.toFixed(2)}" y="${by.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="8" ry="8" fill="${escapeXML(n.textBg)}"/>`
    );
  }
  const weight = bold ? ' font-weight="bold"' : (fo && fo.weight ? ` font-weight="${fo.weight}"` : "");
  lines.forEach((l, i) => {
    parts.push(
      `<text x="${tx.toFixed(2)}" y="${(baseY + i * lh).toFixed(2)}" font-family="${escapeXML(family)}" font-size="${fs.toFixed(1)}"${weight} fill="${escapeXML(fill)}" text-anchor="${anchor}" dominant-baseline="middle">${escapeXML(l)}</text>`
    );
  });
  return parts.join("\n");
}

/**
 * La caja que el nodo OCUPA EN PANTALLA, que no es ni `w×h` ni `anchorBox`.
 *
 * En un `icon` lo que se pinta son dos cosas separadas: el glifo, cuadrado y
 * estrecho, pegado arriba; y el pie de texto, más ancho y bajo. Su unión deja
 * fuera los ~34px de aire a cada lado del glifo, que es donde aterrizaban las
 * flechas antes de `anchorBox`.
 *
 * Existe para que el test de regresión pueda comprobar que todo extremo aterriza
 * sobre algo dibujado. Se calcula aquí, junto al código que dibuja, y no en el
 * test: una copia en el test se desincronizaría en cuanto cambiara el render, y
 * entonces estaría midiendo un nodo que ya no existe.
 *
 * Es la unión de dos rectángulos, así que sobreestima: incluye las esquinas
 * vacías entre glifo y pie. Para comprobar «aterriza sobre el nodo» sobra.
 */
export function drawnContentBox(n: FluyoNode, globalFont = DEFAULT_FONT): { x: number; y: number; w: number; h: number } {
  const nodeRect = { x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h };
  if (n.shape !== "icon") return nodeRect;

  const s = Math.min(n.w, n.h - 26) * 0.78;
  const glifo = { x: n.x - s / 2, y: n.y - n.h / 2 + 4, w: s, h: s };
  if (!n.label) return glifo;
  // Un pie descolocado con lblPos sale de este cálculo; en ese caso se devuelve
  // la caja entera, que es conservador y nunca da un falso positivo.
  if (n.lblPos && n.lblPos !== "center") return nodeRect;

  // Sale de la MISMA maquetación que dibuja el pie, no de una copia de sus
  // números: si el escalado cambia, esta caja lo sigue sin que nadie la toque.
  const bold = !!n.bold;
  const { lines, fs, lh, baseY } = labelLayout(n, measureNodeLabel(n));
  const anchoTexto = Math.max(...lines.map(l => approxTextWidth(l, fs, bold)), 1);
  const pie = {
    x: n.x - anchoTexto / 2,
    y: baseY - fs * 0.625,
    w: anchoTexto,
    h: (lines.length - 1) * lh + fs * 1.25,
  };

  const x = Math.min(glifo.x, pie.x), y = Math.min(glifo.y, pie.y);
  return {
    x, y,
    w: Math.max(glifo.x + glifo.w, pie.x + pie.w) - x,
    h: Math.max(glifo.y + glifo.h, pie.y + pie.h) - y,
  };
}

/* ===================== Bloques de código =====================
   Port de `codeBlockLayout()` de fluyo/js/geometry.js, y el port tiene que ser
   literal: el test de paridad compara esta estructura entera contra la que
   produce la app.

   Aquí NO se usa `approxTextWidth`. La posición y el ancho de cada token salen de
   índices de carácter sobre una rejilla de ancho fijo, así que son exactos sin
   medir nada — que es justo el caso donde una heurística sobra. La limitación
   conocida de medición de texto no aplica a esta forma. */
export interface CodeToken { t: string; k: number; kw: boolean; x: number; w: number; }
export interface CodeRow { ly: number; tokens: CodeToken[]; }
export interface CodeLayout {
  lines: string[]; fs: number; adv: number; lh: number;
  blockH: number; bx: number; by: number; bw: number; x0: number; rows: CodeRow[];
}

function codeKeywords(n: FluyoNode): readonly string[] {
  if (Array.isArray(n.keywords) && n.keywords.length) return n.keywords;
  return CODE_LANGS[n.lang || DEFAULT_LANG] || CODE_LANGS[DEFAULT_LANG];
}

/** Los espacios no se emiten: la rejilla ya los deja implícitos, y un <text> con
 *  solo espacios se colapsa a ancho cero en SVG.
 *
 *  La división es por espacios, como en el fork: `.map(parse)` es UN token, así que
 *  una palabra clave solo resalta cuando aparece suelta.
 *
 *  Tokens de UN carácter: `lengthAdjust="spacing"` reparte la diferencia ENTRE
 *  caracteres y con uno solo no hay hueco, así que el glifo conserva su avance
 *  natural (0.9px de menos con Consolas a 18px). No se acumula, porque la x de
 *  cada token es absoluta. */
function codeTokensOf(line: string): Array<{ t: string; k: number }> {
  const out: Array<{ t: string; k: number }> = [];
  let k = 0;
  for (const t of line.split(/(\s+)/)) { if (t && t.trim()) out.push({ t, k }); k += t.length; }
  return out;
}

export function codeBlockLayout(n: FluyoNode): CodeLayout {
  const lines = String(n.label == null ? "" : n.label).split("\n");
  const pad = 12, inset = 10;
  const bw = Math.max(1, n.w - pad * 2);
  const maxChars = Math.max(1, ...lines.map(l => l.length));
  const porAlto = (n.h - pad * 2) / lines.length - 4;
  const porAncho = (bw - inset * 2) / (maxChars * CODE_ADV);
  const fs = n.fs || clamp(Math.min(porAlto, porAncho), 9, 18);
  const adv = fs * CODE_ADV, lh = fs + 6;
  const blockH = lines.length * lh + 8;
  const bx = n.x - n.w / 2 + pad, by = n.y - n.h / 2 + (n.h - blockH) / 2, x0 = bx + inset;
  const kws = new Set(codeKeywords(n).map(w => String(w).toUpperCase()));
  const rows = lines.map((ln, i) => ({
    ly: by + 8 + i * lh + lh / 2 - 3,
    tokens: codeTokensOf(ln).map(({ t, k }) => ({
      t, k, kw: kws.has(t.toUpperCase()), x: x0 + k * adv, w: t.length * adv,
    })),
  }));
  return { lines, fs, adv, lh, blockH, bx, by, bw, x0, rows };
}

/* Port de codePanelTint/codeColors de fluyo/js/geometry.js (FLUYO-018.14a): el panel
   por defecto es el tinte del color del nodo (como el relleno automático de las demás
   formas); `fill:"none"` conserva el fondo del tema; `codeKwBg:""` = sin caja. Lo explícito
   del nodo manda. El test de paridad (visual-regression) compara esta función con la de la app. */
function codePanelTint(color: string | undefined, theme: ThemeName): string | null {
  return colorTint(color, theme === "crema" ? 0.16 : 0.18);   // FLUYO-019.5: la misma regla que el relleno automático
}
export function codeColors(n: FluyoNode, theme: ThemeName) {
  const T = THEMES[theme];
  return {
    panel: n.fill && n.fill !== "none" ? n.fill : (n.fill === "none" ? (T.lblBg || "#161616") : (codePanelTint(n.color, theme) || T.lblBg || "#161616")),
    paper: n.textBg || T.codeBg,
    text: n.textColor || T.codeText,
    kwBg: n.kwBg || T.codeKwBg || "",
    kwText: n.kwColor || T.codeKwText,
  };
}

/* Port de codeFont/CODE_DEFAULT_FONT: sin `font` propio, IBM Plex Mono (cuya pila acaba en «Mono»). */
const CODE_DEFAULT_FONT = (FONTS.find(f => f.name === "IBM Plex Mono") || FONTS[FONTS.length - 1]).family;
export function codeFont(n: FluyoNode): string {
  return n.font || CODE_DEFAULT_FONT;
}
/* Port de codeTokenWeight: negrita del nodo (todo lo que no sea bold:false) = 700; si no, 500 la palabra clave y 400 el resto. */
export function codeTokenWeight(n: FluyoNode, kw: boolean): number {
  return n.bold === false ? (kw ? 500 : 400) : 700;
}

/* ===================== Cilindro (port de cylinderGeom/cylinderSegments/segmentsToSVGPath) =====================
   La MISMA construcción que fluyo/js/geometry.js: arcos de elipse reales, la tapa una sola
   vez (mitad trasera en el contorno, mitad delantera como labio), laterales tangentes. El
   test de paridad compara los segmentos y el `d` con los de la app. */
export type CylSeg =
  | { op: "M" | "L"; x: number; y: number }
  | { op: "Q"; cx: number; cy: number; x: number; y: number }
  | { op: "A"; cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; ccw: boolean }
  | { op: "Z" };
/** Port de `cylinderGeom()` de fluyo/js/geometry.js: la caja del cilindro que usa la piel (FLUYO-019.3). */
export function cylinderGeom(n: { x: number; y: number; w: number; h: number }): { cx: number; rx: number; ry: number; top: number; bot: number } {
  const ry = Math.min(16, n.h * 0.18);
  return { cx: n.x, rx: n.w / 2, ry, top: n.y - n.h / 2, bot: n.y + n.h / 2 };
}
export function cylinderSegments(n: { x: number; y: number; w: number; h: number }): { outline: CylSeg[]; lip: CylSeg[] } {
  const ry = Math.min(16, n.h * 0.18), cx = n.x, rx = n.w / 2, top = n.y - n.h / 2, bot = n.y + n.h / 2;
  const L = cx - rx, R = cx + rx, capY = top + ry, baseY = bot - ry;
  return {
    outline: [
      { op: "M", x: L, y: capY },
      { op: "L", x: L, y: baseY },
      { op: "A", cx, cy: baseY, rx, ry, a0: Math.PI, a1: 0, ccw: true },
      { op: "L", x: R, y: capY },
      { op: "A", cx, cy: capY, rx, ry, a0: 0, a1: Math.PI, ccw: true },
      { op: "Z" },
    ],
    lip: [
      { op: "M", x: R, y: capY },
      { op: "A", cx, cy: capY, rx, ry, a0: 0, a1: Math.PI, ccw: false },
    ],
  };
}
export function segmentsToSVGPath(segs: CylSeg[]): string {
  const f = (v: number) => (+v).toFixed(2);
  return segs.map(s => {
    if (s.op === "M" || s.op === "L") return `${s.op} ${f(s.x)} ${f(s.y)}`;
    if (s.op === "Q") return `Q ${f(s.cx)} ${f(s.cy)} ${f(s.x)} ${f(s.y)}`;
    if (s.op === "A") return `A ${f(s.rx)} ${f(s.ry)} 0 0 ${s.ccw ? 0 : 1} ${f(s.cx + s.rx * Math.cos(s.a1))} ${f(s.cy + s.ry * Math.sin(s.a1))}`;
    return "Z";
  }).join(" ");
}

/* ===================== Trazo de una conexión (port de edgeStroke, FLUYO-018.16) =====================
   La MISMA gramática que fluyo/js/geometry.js: línea de EDGE_W, esquinas redondeadas con una
   cuadrática cuyo control es el vértice, sin marca en el origen y una aguja con muesca cuya punta
   queda a EDGE_GAP del ancla; la línea termina en la muesca. Sustituye a los <marker> de antes
   (20×16 frente al 12×12 del lienzo, con `context-stroke` de SVG 2). El test de paridad compara
   los segmentos con los de la app sobre el corpus. */
export const EDGE_W = 1.5, EDGE_CORNER = 8, EDGE_GAP = 3, EDGE_HEAD_LEN = 11, EDGE_HEAD_HALF = 4, EDGE_HEAD_NOTCH = 2.8;
/* FLUYO-018.27 (port): `arrowSize` escala la aguja entera (largo, ancho, muesca) y el recorte de la línea; la punta sigue a
   EDGE_GAP del ancla. Ausente o 1 = la de siempre; acotado en [1, 2] como en la app (model.js lo normaliza, geometry.js lo acota). */
export const ARROW_SIZE_MIN = 1, ARROW_SIZE_MAX = 2;
export function edgeArrowSize(e: { arrowSize?: number | null } | null | undefined): number {
  const k = e ? +(e.arrowSize as number) : NaN;
  return Number.isFinite(k) ? Math.min(ARROW_SIZE_MAX, Math.max(ARROW_SIZE_MIN, k)) : 1;
}
function strokeDir(pts: Pt[], fromStart: boolean): { x: number; y: number; L: number } | null {
  const n = pts.length;
  for (let k = 1; k < n; k++) {
    const a = fromStart ? pts[k] : pts[n - 1 - k], b = fromStart ? pts[k - 1] : pts[n - k];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L > 0.01) return { x: (b.x - a.x) / L, y: (b.y - a.y) / L, L };
  }
  return null;
}
function edgeHeadSegs(tip: Pt, u: { x: number; y: number }, size: number): CylSeg[] {
  const s = size || 1, len = EDGE_HEAD_LEN * s, half = EDGE_HEAD_HALF * s, k = (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH) * s;
  const nx = -u.y, ny = u.x, bx = tip.x - u.x * len, by = tip.y - u.y * len;
  return [
    { op: "M", x: tip.x, y: tip.y },
    { op: "L", x: bx + nx * half, y: by + ny * half },
    { op: "L", x: tip.x - u.x * k, y: tip.y - u.y * k },
    { op: "L", x: bx - nx * half, y: by - ny * half },
    { op: "Z" },
  ];
}
export function edgeStroke(e: { endArrow?: boolean; startArrow?: boolean; arrowSize?: number | null }, pts: Pt[]): { line: CylSeg[]; heads: CylSeg[][] } {
  const out: { line: CylSeg[]; heads: CylSeg[][] } = { line: [], heads: [] };
  if (!pts || pts.length < 2) return out;
  const line = pts.map(p => ({ x: p.x, y: p.y }));
  const trim = (i: number, j: number, d: number) => {
    const a = line[j], b = line[i], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L <= 0.01) return;
    const k = Math.min(d, Math.max(0, L - 1));
    b.x -= (b.x - a.x) / L * k; b.y -= (b.y - a.y) / L * k;
  };
  const n = line.length, size = edgeArrowSize(e), cut = EDGE_GAP + (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH) * size;
  if (e.endArrow !== false) {
    const u = strokeDir(pts, false);
    if (u) {
      const z = pts[n - 1], tip = { x: z.x - u.x * EDGE_GAP, y: z.y - u.y * EDGE_GAP };
      out.heads.push(edgeHeadSegs(tip, u, size));
      trim(n - 1, n - 2, cut);
    }
  }
  if (e.startArrow) {
    const u = strokeDir(pts, true);
    if (u) {
      const z = pts[0], tip = { x: z.x - u.x * EDGE_GAP, y: z.y - u.y * EDGE_GAP };
      out.heads.push(edgeHeadSegs(tip, u, size));
      trim(0, 1, cut);
    }
  }
  out.line.push({ op: "M", x: line[0].x, y: line[0].y });
  for (let i = 1; i < n - 1; i++) {
    const a = line[i - 1], b = line[i], c = line[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(EDGE_CORNER, l1 / 2, l2 / 2);
    // Sin giro (vértice colineal, frecuente en orthoRoute) no hay esquina que redondear.
    const giro = l1 > 0 && l2 > 0 ? Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) / (l1 * l2) : 0;
    if (k < 0.5 || giro < 1e-6) { out.line.push({ op: "L", x: b.x, y: b.y }); continue; }
    out.line.push({ op: "L", x: b.x - (b.x - a.x) / l1 * k, y: b.y - (b.y - a.y) / l1 * k });
    out.line.push({ op: "Q", cx: b.x, cy: b.y, x: b.x + (c.x - b.x) / l2 * k, y: b.y + (c.y - b.y) / l2 * k });
  }
  out.line.push({ op: "L", x: line[n - 1].x, y: line[n - 1].y });
  return out;
}

function hexPointsSVG(n: FluyoNode): string {
  const { x, y, w, h } = n, i = Math.min(24, w * 0.18);
  return [
    [x - w / 2 + i, y - h / 2], [x + w / 2 - i, y - h / 2], [x + w / 2, y],
    [x + w / 2 - i, y + h / 2], [x - w / 2 + i, y + h / 2], [x - w / 2, y],
  ].map(p => p.map(v => v.toFixed(2)).join(",")).join(" ");
}

/* ===================== Nodos ===================== */

/* ═══════════════════════════════════════════════════════════════════════════
   SÍMBOLOS REUTILIZABLES

   Port de `svgSymbols()` de fluyo/js/export.js. Un ícono se incrustaba como data
   URI COMPLETO dentro de cada nodo que lo usaba, y en una arquitectura real eso
   es lo normal: varios Cloud Run, varias Cloud SQL, tres colas.

   Con los 72 íconos dibujados a mano de Fluyo (430 B de media) apenas se notaba.
   Con los sets oficiales de proveedor, que son trazados reales de 1,5–4 KB, deja
   de ser una optimización y pasa a ser un límite duro: medido sobre un diagrama
   de 30 nodos con 10 íconos distintos a 4 KB, el SVG sale de 223 KB y supera el
   tope de 200 KB de `DEFAULT_MAX_TOOL_RESULT_BYTES`, así que export_diagram
   devolvería un error en vez del diagrama. Con <defs>/<use> son 79,5 KB.

   Se agrupan íconos y GIFs, que son catálogo y siempre miden 64×64. Las imágenes
   que pega el usuario no: no se conoce su tamaño intrínseco.

   Por qué <symbol> y no un <image> con id: un <use> que apunta a un <image> no le
   propaga width/height, y cada nodo dibuja el mismo ícono a un tamaño distinto.

   Los ids se asignan por orden de primera aparición recorriendo la página, igual
   que en la app, para que los dos renderers produzcan el mismo SVG.
   ═══════════════════════════════════════════════════════════════════════════ */

interface SvgSymbols {
  use(src: string, x: number, y: number, s: number): string;
  defs(): string;
}

function svgSymbols(): SvgSymbols {
  const ids = new Map<string, string>();
  const defs: string[] = [];
  return {
    use(src, x, y, s) {
      if (!src) return "";
      let id = ids.get(src);
      if (id === undefined) {
        id = `fluyo-sym-${ids.size}`;
        ids.set(src, id);
        defs.push(`<symbol id="${id}" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet"><image width="64" height="64" href="${escapeXML(src)}"/></symbol>`);
      }
      return `<use href="#${id}" xlink:href="#${id}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}"/>`;
    },
    defs() {
      return defs.length ? "<defs>\n" + defs.join("\n") + "\n</defs>" : "";
    },
  };
}

/* FLUYO-019.3 (port de `skinLayersToSVG` de fluyo/js/export.js): las capas de la piel como <path>, mismo orden de
   atributos; un <clipPath id="skin-clip-{id}-{k}"> delante de cada capa que lo pide. */
function skinLayersToSVG(layers: SkinLayer[], n: FluyoNode): string {
  const out: string[] = []; let k = 0;
  for (const L of layers) {
    const st = `fill="${L.fill && L.fill !== "none" ? escapeXML(L.fill) : "none"}"${L.stroke ? ` stroke="${escapeXML(L.stroke)}" stroke-width="${L.sw || 1}"` : ""}${L.dash ? ` stroke-dasharray="${L.dash.join(" ")}"` : ""} stroke-linejoin="round"`;
    if (L.clip) {
      const id = `skin-clip-${n.id}-${k++}`;
      out.push(`<clipPath id="${id}"><path d="${segmentsToSVGPath(L.clip)}"/></clipPath>`);
      out.push(`<path d="${segmentsToSVGPath(L.segs)}" ${st} clip-path="url(#${id})"/>`);
    } else out.push(`<path d="${segmentsToSVGPath(L.segs)}" ${st}/>`);
  }
  return out.join("\n");
}

/** `skinBg` (FLUYO-019.3): con la piel activa, el fondo sobre el que se mezclan los tonos (doc.customBg o el del tema);
 *  null = plano, el SVG de siempre. */
function renderNodeToSVG(n: FluyoNode, theme: ThemeName, globalFont: string, syms: SvgSymbols, skinBg: string | null = null): string {
  const fill = svgNodeFill(n, theme);
  const stroke = escapeXML(n.color);
  const dash = svgDash(n);
  const parts: string[] = [`<g id="node-${n.id}">`];
  /* con la piel, las mismas capas que la app; el glifo del icono y el rótulo, como siempre */
  const sk = skinBg !== null ? skinNode(n, theme, skinBg) : null;
  if (sk) {
    const fo = skinLabelFont(n, globalFont);
    parts.push(skinLayersToSVG(sk.layers, n));
    if (n.shape === "icon") {
      const s = Math.min(n.w, n.h - 26) * 0.78;
      parts.push(syms.use(n.icon ? iconDataUri(n.icon, nodeIconTint(n)) : "", n.x - s / 2, n.y - n.h / 2 + 4, s));
    }
    parts.push(svgLabelLines(n, theme, globalFont, fo));
    parts.push("</g>");
    return parts.filter(Boolean).join("\n");
  }

  switch (n.shape) {
    case "circle":
      parts.push(`<ellipse cx="${n.x}" cy="${n.y}" rx="${(n.w / 2).toFixed(2)}" ry="${(n.h / 2).toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, globalFont));
      break;

    case "diamond":
      parts.push(`<polygon points="${n.x},${(n.y - n.h / 2).toFixed(2)} ${(n.x + n.w / 2).toFixed(2)},${n.y} ${n.x},${(n.y + n.h / 2).toFixed(2)} ${(n.x - n.w / 2).toFixed(2)},${n.y}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, globalFont));
      break;

    case "hex":
      parts.push(`<polygon points="${hexPointsSVG(n)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, globalFont));
      break;

    case "cylinder": {
      /* FLUYO-018.14a: los mismos segmentos que el lienzo y el exportador de la app */
      const seg = cylinderSegments(n);
      parts.push(`<path d="${segmentsToSVGPath(seg.outline)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(`<path d="${segmentsToSVGPath(seg.lip)}" fill="none" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, globalFont));
      break;
    }

    case "code": {
      /* `textLength` + `lengthAdjust="spacing"` es la pieza de la que depende
         todo: el SVG lo pinta después otro motor con otra fuente. Verificado en
         Chrome/Windows, donde `monospace` resuelve a Consolas: un token de 4
         caracteres a 16px mide 35.19px natural y 38.40 exactos con textLength. */
      const L = codeBlockLayout(n), col = codeColors(n, theme);
      const x = n.x - n.w / 2, y = n.y - n.h / 2;
      const fam = escapeXML(codeFont(n));
      const clip = `code-clip-${n.id}`;
      parts.push(`<clipPath id="${clip}"><rect x="${(x + 2).toFixed(2)}" y="${(y + 2).toFixed(2)}" width="${(n.w - 4).toFixed(2)}" height="${(n.h - 4).toFixed(2)}" rx="9" ry="9"/></clipPath>`);
      parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${n.w}" height="${n.h}" rx="10" ry="10" fill="${escapeXML(col.panel)}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(`<g clip-path="url(#${clip})">`);
      parts.push(`<rect x="${L.bx.toFixed(2)}" y="${L.by.toFixed(2)}" width="${L.bw.toFixed(2)}" height="${L.blockH.toFixed(2)}" rx="6" ry="6" fill="${escapeXML(col.paper)}"/>`);
      for (const row of L.rows) {
        for (const tk of row.tokens) {
          if (tk.kw && col.kwBg) parts.push(`<rect x="${(tk.x - 2).toFixed(2)}" y="${(row.ly - L.fs / 2 - 2).toFixed(2)}" width="${(tk.w + 4).toFixed(2)}" height="${(L.fs + 6).toFixed(2)}" fill="${escapeXML(col.kwBg)}"/>`);
          const peso = codeTokenWeight(n, tk.kw), wAttr = peso === 400 ? "" : ` font-weight="${peso}"`;
          parts.push(`<text x="${tk.x.toFixed(2)}" y="${row.ly.toFixed(2)}" font-family="${fam}" font-size="${L.fs.toFixed(2)}"${wAttr} fill="${escapeXML(tk.kw ? col.kwText : col.text)}" dominant-baseline="middle" textLength="${tk.w.toFixed(3)}" lengthAdjust="spacing">${escapeXML(tk.t)}</text>`);
        }
      }
      parts.push("</g>");
      break;
    }

    case "text":
      parts.push(svgLabelLines(n, theme, globalFont));
      break;

    case "anim": {
      // El GIF se anima por fotograma en el lienzo; en un SVG estático va su vista
      // previa, exactamente como hace el exportador de la app.
      const src = n.anim ? animDataUri(n.anim) : "";
      const s = Math.max(10, Math.min(n.w, n.h - (n.label ? 26 : 8)));
      parts.push(syms.use(src, n.x - s / 2, n.y - (n.label ? 8 : 0) - s / 2, s));
      parts.push(svgLabelLines(n, theme, globalFont));
      break;
    }

    case "icon": {
      const src = n.icon ? iconDataUri(n.icon, nodeIconTint(n)) : "";
      const s = Math.min(n.w, n.h - 26) * 0.78;
      parts.push(syms.use(src, n.x - s / 2, n.y - n.h / 2 + 4, s));
      parts.push(svgLabelLines(n, theme, globalFont));
      break;
    }

    case "image":
      if (n.img) parts.push(`<image x="${(n.x - n.w / 2).toFixed(2)}" y="${(n.y - n.h / 2).toFixed(2)}" width="${n.w}" height="${n.h}" href="${escapeXML(n.img)}" preserveAspectRatio="xMidYMid meet"/>`);
      parts.push(svgLabelLines(n, theme, globalFont));
      break;

    default:
      parts.push(`<rect x="${(n.x - n.w / 2).toFixed(2)}" y="${(n.y - n.h / 2).toFixed(2)}" width="${n.w}" height="${n.h}" rx="10" ry="10" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, globalFont));
  }

  parts.push("</g>");
  return parts.filter(Boolean).join("\n");
}

/* ===================== Aristas ===================== */

function renderConnectorToSVG(e: FluyoEdge, theme: ThemeName, nodeById: Map<number, FluyoNode>, edges: readonly FluyoEdge[], globalFont: string, labelPos: Map<number, Pt>, skinBg: string | null = null): string {
  const A = nodeById.get(e.from), B = nodeById.get(e.to);
  if (!A || !B) return "";
  let pts = edgePoints(e, nodeById, edges);
  if (pts.length < 2) return "";
  /* FLUYO-019.3/019.4a: el mismo aterrizaje que la app (silueta del destino, decisión 213; copia; edgePoints no cambia) */
  if (skinBg !== null) pts = skinEdgeLanding(pts, B);
  const T = THEMES[theme];
  const lineCol = escapeXML(e.lineColor || T.edge);
  const dash = e.dashed ? ' stroke-dasharray="8 7"' : "";
  const stroke = edgeStroke(e, pts);
  const parts = [`<path d="${segmentsToSVGPath(stroke.line)}" fill="none" stroke="${lineCol}" stroke-width="${EDGE_W}" stroke-linejoin="round"${dash}/>`];
  for (const h of stroke.heads) parts.push(`<path d="${segmentsToSVGPath(h)}" fill="${lineCol}"/>`);
  if (skinBg !== null && !e.startArrow) {
    const port = skinEdgePort(pts[0], e.lineColor || T.edge, skinBg);
    parts.push(`<path d="${segmentsToSVGPath(port.segs)}" fill="${escapeXML(port.fill)}" stroke="${escapeXML(port.stroke)}" stroke-width="${port.sw}"/>`);
  }

  if (e.label) {
    const m = labelPos.get(e.id) ?? pointAt(pts, 0.5);
    const efs = edgeLabelFs(e);
    const family = e.font || globalFont || DEFAULT_FONT;
    const bold = !!e.bold;
    const tw = approxTextWidth(e.label, efs, bold);
    const rx = (m.x - tw / 2 - 6).toFixed(2), ry = (m.y - efs * 0.85).toFixed(2);
    const weight = bold ? ' font-weight="bold"' : "";
    parts.push(`<rect x="${rx}" y="${ry}" width="${(tw + 12).toFixed(2)}" height="${(efs * 1.7).toFixed(2)}" fill="${escapeXML(T.lblBg)}"/>`);
    parts.push(`<text x="${m.x.toFixed(2)}" y="${m.y.toFixed(2)}" font-family="${escapeXML(family)}" font-size="${efs}"${weight} fill="${escapeXML(T.edgeLbl)}" text-anchor="middle" dominant-baseline="middle">${escapeXML(e.label)}</text>`);
  }
  return parts.join("\n");
}

/* FLUYO-018.16: ya no hay <defs> de marcadores; las puntas son <path> explícitos (edgeStroke). */

/* ===================== Capas con la piel (FLUYO-019-HIT-TEST-D6, decisión 212) =====================
   Port literal de `isContainerNode` y `containmentPaintOrder` de fluyo/js/geometry.js. Un nodo es CONTENEDOR si el centro de
   otro nodo más pequeño cae dentro de su caja. Con la piel, el SVG pinta contenedores (de fuera adentro, en recorrido en
   profundidad preorden; raíces y hermanos en el orden `order`) → conexiones → hojas (en el orden `order`). Padre = el
   contenedor de menor área, estrictamente mayor, que contiene su centro; a igual área, el de más arriba en el documento.
   Sin contenedores, containers = [] y leaves = order(nodes): el orden de antes. Pura: el orden de pintor llega como argumento. */
export function isContainerNode<T extends { x: number; y: number; w: number; h: number }>(n: T, nodes: readonly T[]): boolean {
  const a = n.w * n.h;
  for (const m of nodes) if (m !== n && m.w * m.h < a && Math.abs(m.x - n.x) < n.w / 2 && Math.abs(m.y - n.y) < n.h / 2) return true;
  return false;
}
export function containmentPaintOrder<T extends { x: number; y: number; w: number; h: number }>(nodes: readonly T[], order: (ns: readonly T[]) => T[]): { containers: T[]; leaves: T[] } {
  const conts = nodes.filter(n => isContainerNode(n, nodes)), isCont = new Set(conts), parent = new Map<T, T | null>();
  for (const c of conts) {
    let best: T | null = null;
    for (const o of conts) {
      if (o === c || o.w * o.h <= c.w * c.h || Math.abs(c.x - o.x) >= o.w / 2 || Math.abs(c.y - o.y) >= o.h / 2) continue;
      if (!best || o.w * o.h < best.w * best.h || (o.w * o.h === best.w * best.h && nodes.indexOf(o) > nodes.indexOf(best))) best = o;
    }
    parent.set(c, best);
  }
  const containers: T[] = [];
  const walk = (c: T): void => { containers.push(c); for (const k of order(conts.filter(k => parent.get(k) === c))) walk(k); };
  for (const r of order(conts.filter(c => parent.get(c) === null))) walk(r);
  return { containers, leaves: order(nodes.filter(n => !isCont.has(n))) };
}

/** Caja que envuelve el contenido, con 40 px de aire. Port de `getBounds()`. */
function pageBounds(page: FluyoPage, nodeById: Map<number, FluyoNode>) {
  if (!page.nodes.length) return { x: 0, y: 0, w: CANVAS.W, h: CANVAS.H };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  for (const n of page.nodes) { add(n.x - n.w / 2, n.y - n.h / 2); add(n.x + n.w / 2, n.y + n.h / 2); }
  for (const e of page.edges) for (const p of edgePoints(e, nodeById, page.edges)) add(p.x, p.y);
  minX -= 40; minY -= 40; maxX += 40; maxY += 40;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export interface PageToSVGOptions {
  /** Multiplica width/height del SVG resultante. El viewBox no cambia. */
  scale?: number;
  /** Tipografía global del documento (`settings.font`); los nodos con `font` propio la ignoran. */
  globalFont?: string | null;
  /**
   * Recorta el lienzo al contenido en vez de emitir los 2560×1440 completos.
   * NO es lo que hace "Exportar → SVG" en la app: por defecto va desactivado para
   * que los dos exportadores produzcan el mismo archivo. Útil para incrustar el
   * diagrama en un documento sin márgenes enormes.
   */
  crop?: boolean;
  /**
   * FLUYO-019.3: aspecto del documento (`settings.skin`, leído con `projectSkin`). "built" pinta la piel «construido»
   * (2.5D) como «Exportar → SVG» de la app; ausente o cualquier otro valor, el SVG plano de siempre, byte a byte.
   */
  skin?: string | null;
  /** FLUYO-019.3: fondo personalizado del documento (`doc.customBg`); vacío = el del tema. Solo lo usa la piel. */
  customBg?: string | null;
}

/**
 * Genera el SVG de una página Fluyo replicando lo que produce "Exportar → SVG"
 * dentro de la app (fluyo/js/export.js): mismo viewBox del lienzo completo, mismo
 * fondo transparente, mismas formas, estilos de borde, rellenos, tipografías y
 * posiciones de etiqueta.
 *
 * Diferencia conocida: la medición de texto es una heurística, no `getBBox()`.
 * Ver el bloque de LIMITACIÓN CONOCIDA más arriba.
 *
 * Como el exportador de la app, el resultado es estático: sin puntos animados ni
 * aparición escalonada.
 */
export function pageToSVG(
  page: FluyoPage,
  theme: ThemeName,
  options: PageToSVGOptions = {}
): string {
  const { scale = 1, globalFont = null, crop = false, skin = null, customBg = null } = options;
  /* en SVG la escala del lienzo es 1: con "built" la piel siempre se pinta (skinActive), como buildSVGDocument */
  const skinBg = skinActive(skin, 1) ? (customBg || THEMES[theme].bg) : null;
  const nodeById = new Map(page.nodes.map(n => [n.id, n] as const));
  const font = globalFont || DEFAULT_FONT;

  const box = crop
    ? pageBounds(page, nodeById)
    : { x: 0, y: 0, w: CANVAS.W, h: CANVAS.H };

  const width = Math.round(box.w * scale);
  const height = Math.round(box.h * scale);
  const viewBox = `${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.w.toFixed(2)} ${box.h.toFixed(2)}`;

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${viewBox}">`,
  ];
  // Sin rectángulo de fondo: el SVG que exporta la app es transparente.
  const labelPos = placeEdgeLabels(page);
  /* FLUYO-019-HIT-TEST-D6 (decisión 212): con la piel, las mismas capas que la app (containmentPaintOrder): contenedores →
     conexiones → hojas. En plano, o con la piel y sin contenedores, el SVG de siempre byte a byte. */
  const lay = skinBg !== null ? containmentPaintOrder(page.nodes, skinPaintOrder) : { containers: [] as FluyoNode[], leaves: page.nodes };
  /* Los símbolos se recogen dibujando, así que el <defs> con los íconos solo se
     conoce al final. Se inserta antes del primer nodo (después de las conexiones si no hay contenedores), no al cierre:
     un id se resuelve igual esté donde esté, pero declarar antes de usar es lo que abren sin quejarse los editores
     externos. Mismo orden que buildSVGDocument. */
  const syms = svgSymbols();
  const contenedores = lay.containers.map(n => renderNodeToSVG(n, theme, font, syms, skinBg));
  const conexiones = page.edges.map(e => renderConnectorToSVG(e, theme, nodeById, page.edges, font, labelPos, skinBg));
  const nodos = lay.leaves.map(n => renderNodeToSVG(n, theme, font, syms, skinBg));
  const defs = syms.defs();
  if (contenedores.length) { if (defs) parts.push(defs); parts.push(...contenedores, ...conexiones); }
  else { parts.push(...conexiones); if (defs) parts.push(defs); }
  parts.push(...nodos, "</svg>");
  return parts.join("\n");
}

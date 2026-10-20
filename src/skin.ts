/* ═══════════════════════════════════════════════════════════════════════════
   PIEL «CONSTRUIDO» (2.5D) — port de fluyo/js/skin.js (FLUYO-019.1 / 019.2 / 019.3)

   Una capa PURAMENTE VISUAL: convierte un nodo o una conexión en caras, líneas y
   anillos (listas de segmentos M/L/Q/A/Z, las mismas que cylinderSegments y
   edgeStroke). No lee el documento, no escribe en el nodo ni en la conexión. La
   activa `settings.skin:"built"` (export_diagram → pageToSVG); ausente o cualquier
   otro valor, el SVG de siempre.

   Port LITERAL, función a función y en el mismo orden que la app: mismos nombres,
   mismas constantes, mismas operaciones en el mismo orden (el redondeo de las
   mezclas tiene que dar el mismo byte). La fuente de verdad es fluyo/js/skin.js y
   sus goldens: test/fixtures/fluyo-019-1-skin.json (capas por pieza y tema),
   fluyo-019-2-skin-svg.json (las líneas de la piel del SVG del editor) y
   fluyo-019-3-colores.json (la regla de color). visual-regression.test.ts ejecuta
   el skin.js real en `vm` y compara con esto sobre el corpus.

   Sistema (fluyo/.ai/tasks/FLUYO-019.md §4): vector de profundidad constante
   d = (+8, −8); la cara frontal es exactamente la caja semántica (anclas, rutas y
   etiquetas no cambian); tres tonos planos por cara mezclando el color del nodo con
   el fondo; `icon` sobre una peana; hex/diamond/circle/text/code/image/anim planos.
   Aterrizaje por silueta (FLUYO-019.4a, decisión 213; aquí) y capas por contenedor (D6, decisión 212; en svg.ts), portados en
   FLUYO-019-MCP-PARITY: el golden del aterrizaje es la sección `landing` de fluyo-019-1-skin.json.
   ═══════════════════════════════════════════════════════════════════════════ */
import { DEFAULT_FONT, FONTS, PALETTE, THEMES } from "./generated/config.js";
import { anchorBox, cylinderGeom, cylinderSegments, type CylSeg } from "./svg.js";
import type { FluyoNode } from "./model.js";

interface Pt { x: number; y: number; }
/** Lo que la piel lee de un nodo (subconjunto de FluyoNode). */
export interface SkinNodeInput { shape: string; x: number; y: number; w: number; h: number; color?: unknown; fill?: unknown; border?: unknown; font?: unknown; bold?: unknown; }
export interface SkinLayer { k: string; segs: CylSeg[]; fill?: string; stroke?: string; sw?: number; dash?: number[] | null; clip?: CylSeg[]; }
export interface SkinTones { top: string; front: string; side: string; line: string; contact: string; bg: string; color: string; }

export const SKIN_FLAT = "flat", SKIN_BUILT = "built";
export const SKIN_DEPTH = 8;          // unidades de mundo
export const SKIN_MIN_PX = 3;         // canto mínimo en pantalla para que compense dibujarlo
export const SKIN_FRONT_R = 2;        // radio del frente
export const SKIN_LED_R = 2.4, SKIN_LED_IN = 10;
export const SKIN_PORT_R = 3;         // anillo de salida de una conexión
export const SKIN_PLINTH_H = 7, SKIN_PLINTH_PAD = 8;   // peana del icono
/* mezclas con el fondo (fracción del color del nodo) y alphas de la tinta del tema */
export const SKIN_TONES = {
  light: { top: 0.10, front: 0.22, side: 0.40, line: 0.45, contact: 0.22 },
  dark: { top: 0.14, front: 0.26, side: 0.46, line: 0.55, contact: 0.50 },
} as const;
/* formas con pintor propio que la piel NO toca; lo demás (rect y formas desconocidas) es un bloque */
export const SKIN_FLAT_SHAPES: ReadonlySet<string> = new Set(["circle", "diamond", "hex", "text", "code", "image", "anim"]);

export function skinActive(skin: unknown, zoom: number): boolean {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return skin === SKIN_BUILT && SKIN_DEPTH * z >= SKIN_MIN_PX;
}
function skinHexRGB(h: unknown): [number, number, number] | null {
  if (typeof h !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim()); if (!m) return null;
  let s = m[1]; if (s.length === 3) s = s.split("").map(ch => ch + ch).join("");
  const v = parseInt(s, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function skinMix(bg: string, col: string, t: number): string {
  const a = skinHexRGB(bg)!, b = skinHexRGB(col)!;
  const c = [0, 1, 2].map(i => Math.round(a[i] * (1 - t) + b[i] * t));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}
function skinRGBA(hex: string, alpha: number): string { const c = skinHexRGB(hex)!; return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`; }
/** Lector ÚNICO de los colores que la piel interpreta (FLUYO-019.3): #rgb/#rrggbb → el mismo string; #rrggbbaa → el color
 *  opaco sobre `base` (round(fondo·(1−α) + color·α), α = aa/255, la mezcla de skinMix); otro → null (respaldo de quien llama). */
export function skinColor(c: unknown, base: string): string | null {
  if (skinHexRGB(c)) return c as string;
  const m = typeof c === "string" && /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c.trim());
  return m ? skinMix(base, "#" + m[1], parseInt(m[2], 16) / 255) : null;
}
/** Tonos de un nodo sobre el fondo real del lienzo (tema o fondo personalizado). Color ilegible → PALETTE[0]. */
export function skinTones(color: unknown, theme: string, bg: unknown): SkinTones {
  const T = (THEMES as Record<string, (typeof THEMES)["dark"]>)[theme] || THEMES.dark, K = SKIN_TONES[theme === "dark" ? "dark" : "light"];
  const base = skinHexRGB(bg) ? (bg as string) : T.bg;
  const col = skinColor(color, base) || PALETTE[0].hex;
  return { top: skinMix(base, col, K.top), front: skinMix(base, col, K.front), side: skinMix(base, col, K.side),
    line: skinRGBA(T.text, K.line), contact: skinRGBA(T.text, K.contact), bg: base, color: col };
}
/* ---- segmentos ---- */
function skinPoly(pts: Pt[]): CylSeg[] { return (pts.map((p, i) => ({ op: i ? "L" : "M", x: p.x, y: p.y })) as CylSeg[]).concat([{ op: "Z" }]); }
function skinRect(x: number, y: number, w: number, h: number, r: number): CylSeg[] {
  if (!r) return skinPoly([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
  return [{ op: "M", x: x + r, y }, { op: "L", x: x + w - r, y }, { op: "Q", cx: x + w, cy: y, x: x + w, y: y + r }, { op: "L", x: x + w, y: y + h - r }, { op: "Q", cx: x + w, cy: y + h, x: x + w - r, y: y + h },
    { op: "L", x: x + r, y: y + h }, { op: "Q", cx: x, cy: y + h, x, y: y + h - r }, { op: "L", x, y: y + r }, { op: "Q", cx: x, cy: y, x: x + r, y }, { op: "Z" }];
}
function skinEllipse(cx: number, cy: number, rx: number, ry: number): CylSeg[] {
  return [{ op: "M", x: cx - rx, y: cy }, { op: "A", cx, cy, rx, ry, a0: Math.PI, a1: 0, ccw: true }, { op: "A", cx, cy, rx, ry, a0: 0, a1: Math.PI, ccw: true }, { op: "Z" }];
}
/* tapa y lateral de un bloque cuya cara frontal es (x0,y0,w,h) */
function skinFaces(x0: number, y0: number, w: number, h: number, d: number): { top: Pt[]; side: Pt[] } {
  return { top: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w + d, y: y0 - d }, { x: x0 + d, y: y0 - d }],
    side: [{ x: x0 + w, y: y0 }, { x: x0 + w + d, y: y0 - d }, { x: x0 + w + d, y: y0 + h - d }, { x: x0 + w, y: y0 + h }] };
}
function skinDash(n: SkinNodeInput): number[] | null { return n.border === "dashed" ? [9, 7] : n.border === "dotted" ? [2, 5] : null; }
function skinHasSkin(n: SkinNodeInput | null | undefined): n is SkinNodeInput { return !!n && !SKIN_FLAT_SHAPES.has(n.shape); }
/** Tamaño del glifo de un `icon`: el de renderNodeToSVG/anchorBox. */
function skinIconGlyph(n: SkinNodeInput): number { return Math.min(n.w, n.h - 26) * 0.78; }

/** Capas de un nodo, de abajo arriba; null si la forma no tiene piel. */
export function skinNode(n: SkinNodeInput, theme: string, bg: unknown): { layers: SkinLayer[] } | null {
  if (!skinHasSkin(n)) return null;
  const d = SKIN_DEPTH, T = skinTones(n.color, theme, bg), dash = skinDash(n);
  const x0 = n.x - n.w / 2, y0 = n.y - n.h / 2;
  const layers: SkinLayer[] = [];
  if (n.shape === "cylinder") {
    const s = cylinderSegments(n), g = cylinderGeom(n), capY = g.top + g.ry, baseY = g.bot - g.ry;
    const front = n.fill === "none" ? T.bg : (skinColor(n.fill, T.bg) || T.front);
    layers.push({ k: "body", segs: s.outline, fill: front, stroke: T.line, sw: 1, dash });
    const bx = g.cx + g.rx * 0.5;
    layers.push({ k: "band", segs: skinPoly([{ x: bx, y: capY - g.ry - 2 }, { x: g.cx + g.rx + 2, y: capY - g.ry - 2 }, { x: g.cx + g.rx + 2, y: baseY + g.ry + 2 }, { x: bx, y: baseY + g.ry + 2 }]), fill: T.side, clip: s.outline });
    layers.push({ k: "cap", segs: skinEllipse(g.cx, capY, g.rx, g.ry), fill: T.top, stroke: T.line, sw: 1, dash });
    layers.push({ k: "led", segs: skinEllipse(x0 + 12, baseY - 4, SKIN_LED_R, SKIN_LED_R), fill: T.color });
    return { layers };
  }
  if (n.shape === "icon") {
    const s = skinIconGlyph(n), pw = s + 2 * SKIN_PLINTH_PAD, ph = SKIN_PLINTH_H;
    const px0 = n.x - pw / 2, py0 = y0 + 4 + s - 2, f = skinFaces(px0, py0, pw, ph, d);
    layers.push({ k: "top", segs: skinPoly(f.top), fill: T.top, stroke: T.line, sw: 1 });
    layers.push({ k: "side", segs: skinPoly(f.side), fill: T.side, stroke: T.line, sw: 1 });
    layers.push({ k: "front", segs: skinRect(px0, py0, pw, ph, 0), fill: T.front, stroke: T.line, sw: 1 });
    return { layers };
  }
  const f = skinFaces(x0, y0, n.w, n.h, d);
  const front = n.fill === "none" ? T.bg : (skinColor(n.fill, T.bg) || T.front);
  layers.push({ k: "contact", segs: [{ op: "M", x: x0 + 2, y: y0 + n.h + 1.5 }, { op: "L", x: x0 + n.w + 1, y: y0 + n.h + 1.5 }], stroke: T.contact, sw: 2 });
  layers.push({ k: "top", segs: skinPoly(f.top), fill: T.top, stroke: T.line, sw: 1 });
  layers.push({ k: "side", segs: skinPoly(f.side), fill: T.side, stroke: T.line, sw: 1 });
  layers.push({ k: "front", segs: skinRect(x0, y0, n.w, n.h, SKIN_FRONT_R), fill: front, stroke: T.line, sw: 1, dash });
  layers.push({ k: "led", segs: skinEllipse(x0 + SKIN_LED_IN, y0 + n.h - SKIN_LED_IN, SKIN_LED_R, SKIN_LED_R), fill: T.color });
  return { layers };
}
/** Voz del rótulo con la piel: IBM Plex Mono 500 si el nodo no trae fuente y la global es la de serie; null = sin cambio. */
export function skinLabelFont(n: SkinNodeInput | null | undefined, globalFont: string | null | undefined): { family: string; weight: string } | null {
  if (!n || n.font) return null;
  if (globalFont && globalFont !== DEFAULT_FONT) return null;
  const plex = FONTS.find(f => f.name === "IBM Plex Mono") || null;
  if (!plex) return null;
  return { family: plex.family, weight: n.bold ? "bold" : "500" };
}
/** Envolvente de la caja semántica y sus caras. */
export function skinExtent(n: SkinNodeInput): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!skinHasSkin(n)) return null;
  const d = SKIN_DEPTH, x0 = n.x - n.w / 2, y0 = n.y - n.h / 2, x1 = n.x + n.w / 2, y1 = n.y + n.h / 2;
  if (n.shape === "cylinder") return { x0, y0, x1: x1 + 2, y1 };
  if (n.shape === "icon") { const s = skinIconGlyph(n), pw = s + 2 * SKIN_PLINTH_PAD; return { x0: Math.min(x0, n.x - pw / 2), y0, x1: Math.max(x1, n.x + pw / 2 + d), y1 }; }
  return { x0, y0: y0 - d, x1: x1 + d, y1: y1 + 2 };
}
/** Orden de pintor con la piel: el de abajo y el de la izquierda, después. Solo para dibujar. */
export function skinPaintOrder<T extends { x: number; y: number }>(nodes: readonly T[]): T[] {
  return nodes.slice().sort((a, b) => (a.y - b.y) || (b.x - a.x));
}
/* ---- Aterrizaje por silueta (FLUYO-019.4a, decisión 213) — port literal del bloque de fluyo/js/skin.js ----
   La silueta visible de un nodo con piel son las capas CERRADAS Y RELLENAS de skinNode (una capa con `clip` solo se ve
   dentro de su recorte). No hay lista de formas: lo que cada forma pinta ya lo dice skinNode, y una forma sin piel no tiene
   silueta propia (su contorno visible es el lógico, donde ya está el ancla). Todas las capas son convexas, así que la recta
   corta cada una en UN intervalo. Cortes exactos con L, Q y A. */
const SKIN_EPS = 1e-9;
const SKIN_LANDING_MEMO = 4096, SKIN_LANDING_T = new Map<string, number>();   /* t* por destino y último tramo (ver skinEdgeLanding) */
export function skinSilhouette(n: SkinNodeInput): Array<{ segs: CylSeg[]; clip: CylSeg[] | null }> {
  const sk = skinNode(n, "dark", THEMES.dark.bg);   /* solo la geometría: los tonos no importan */
  if (!sk) return [];
  return sk.layers.filter(L => L.fill && L.segs.length && L.segs[L.segs.length - 1].op === "Z").map(L => ({ segs: L.segs, clip: L.clip || null }));
}
/** Parámetros t (en unidades de |u| = 1) donde la recta P + t·u corta el borde de `segs`. */
export function skinLineCuts(P: Pt, u: Pt, segs: readonly CylSeg[]): number[] {
  const ts: number[] = [], cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  let cur: Pt | null = null, start: Pt | null = null;
  const seg = (a: Pt, b: Pt) => {
    const dx = b.x - a.x, dy = b.y - a.y, den = cross(u.x, u.y, dx, dy), wx = a.x - P.x, wy = a.y - P.y;
    if (Math.abs(den) < SKIN_EPS) {
      if (Math.abs(cross(wx, wy, u.x, u.y)) < 1e-7) { ts.push(wx * u.x + wy * u.y, (b.x - P.x) * u.x + (b.y - P.y) * u.y); }   /* colineal: sus extremos */
      return;
    }
    const s = cross(wx, wy, u.x, u.y) / den;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(cross(wx, wy, dx, dy) / den);
  };
  const quad = (a: Pt, c: Pt, b: Pt) => {
    /* n·(B(s) − P) = 0 con n ⊥ u y B(s) = a(1−s)² + 2c·s(1−s) + b·s² */
    const nx = -u.y, ny = u.x;
    const A = nx * (a.x - 2 * c.x + b.x) + ny * (a.y - 2 * c.y + b.y), B = nx * 2 * (c.x - a.x) + ny * 2 * (c.y - a.y), C = nx * (a.x - P.x) + ny * (a.y - P.y);
    const roots: number[] = [];
    if (Math.abs(A) < SKIN_EPS) { if (Math.abs(B) > SKIN_EPS) roots.push(-C / B); }
    else { const D = B * B - 4 * A * C; if (D >= 0) { const q = Math.sqrt(D); roots.push((-B - q) / (2 * A), (-B + q) / (2 * A)); } }
    for (const s of roots) if (s >= -1e-9 && s <= 1 + 1e-9) {
      const x = a.x * (1 - s) * (1 - s) + 2 * c.x * s * (1 - s) + b.x * s * s, y = a.y * (1 - s) * (1 - s) + 2 * c.y * s * (1 - s) + b.y * s * s;
      ts.push((x - P.x) * u.x + (y - P.y) * u.y);
    }
  };
  const arc = (o: Extract<CylSeg, { op: "A" }>) => {
    /* ((P + t·u − c)/r)² = 1, y el ángulo del corte dentro del barrido (el de c.ellipse: ccw = ángulos decrecientes) */
    const px = (P.x - o.cx) / o.rx, py = (P.y - o.cy) / o.ry, ux = u.x / o.rx, uy = u.y / o.ry;
    const A = ux * ux + uy * uy, B = 2 * (px * ux + py * uy), C = px * px + py * py - 1, D = B * B - 4 * A * C;
    if (A < SKIN_EPS || D < 0) return;
    const q = Math.sqrt(D), TAU = 2 * Math.PI, mod = (v: number) => ((v % TAU) + TAU) % TAU;
    const sweep = mod(o.ccw ? o.a0 - o.a1 : o.a1 - o.a0) || TAU;
    for (const t of [(-B - q) / (2 * A), (-B + q) / (2 * A)]) {
      const th = Math.atan2(py + t * uy, px + t * ux), d = mod(o.ccw ? o.a0 - th : th - o.a0);
      if (d <= sweep + 1e-9 || d >= TAU - 1e-9) ts.push(t);
    }
  };
  for (const s of segs) {
    if (s.op === "M") { cur = { x: s.x, y: s.y }; start = cur; }
    else if (s.op === "L") { seg(cur!, { x: s.x, y: s.y }); cur = { x: s.x, y: s.y }; }
    else if (s.op === "Q") { quad(cur!, { x: s.cx, y: s.cy }, { x: s.x, y: s.y }); cur = { x: s.x, y: s.y }; }
    else if (s.op === "A") { arc(s); cur = { x: s.cx + s.rx * Math.cos(s.a1), y: s.cy + s.ry * Math.sin(s.a1) }; }
    else if (s.op === "Z" && cur && start) { seg(cur, start); cur = start; }
  }
  return ts;
}
/** Intervalo [t0, t1] de la recta dentro de una capa convexa (y de su recorte), o null. */
export function skinLayerSpan(P: Pt, u: Pt, layer: { segs: CylSeg[]; clip: CylSeg[] | null }): [number, number] | null {
  const span = (segs: CylSeg[]): [number, number] | null => { const ts = skinLineCuts(P, u, segs); return ts.length ? [Math.min(...ts), Math.max(...ts)] : null; };
  const a = span(layer.segs); if (!a) return null;
  if (!layer.clip) return a;
  const b = span(layer.clip); if (!b) return null;
  const t0 = Math.max(a[0], b[0]), t1 = Math.min(a[1], b[1]);
  return t0 <= t1 ? [t0, t1] : null;
}
/** Aterrizaje (decisión 213): la punta RETROCEDE por su propio último tramo hasta salir de la silueta visible del destino B, y el
 *  trazo deja después su EDGE_GAP de siempre. Solo se mueve el último vértice, y sobre su recta: ningún tramo se inclina, el
 *  origen y el número de puntos no cambian. No se toca si B no tiene silueta, si el ancla no está dentro de ella (t* = 0), si el
 *  último tramo llega desde dentro de la caja de anclaje o si no hay tramo para retroceder (t* > L − 1). Después de edgePoints
 *  y antes de edgeStroke; devuelve una copia; determinista e idempotente (la memo solo evita recalcular). */
export function skinEdgeLanding(pts: readonly Pt[] | null | undefined, B: SkinNodeInput | null | undefined): Pt[] {
  const out = (pts || []).map(p => ({ x: p.x, y: p.y }));
  const n = out.length;
  if (n < 2 || !B) return out;
  const z = out[n - 1], p = out[n - 2], L = Math.hypot(p.x - z.x, p.y - z.y);
  if (L < 0.01) return out;
  const a = anchorBox(B as FluyoNode);
  if (Math.abs(p.x - a.x) < a.w / 2 - SKIN_EPS && Math.abs(p.y - a.y) < a.h / 2 - SKIN_EPS) return out;   /* llega desde dentro */
  const u = { x: (p.x - z.x) / L, y: (p.y - z.y) / L };   /* hacia fuera, por el último tramo */
  /* t* solo depende de la geometría del destino (forma y caja: lo único que mira skinSilhouette) y de los dos últimos puntos */
  const key = B.shape + "|" + B.x + "|" + B.y + "|" + B.w + "|" + B.h + "|" + z.x + "|" + z.y + "|" + p.x + "|" + p.y;
  let t = SKIN_LANDING_T.get(key);
  if (t === undefined) {
    const spans = skinSilhouette(B).map(l => skinLayerSpan(z, u, l)).filter((x): x is [number, number] => !!x);
    let grew = true; t = 0;
    while (grew) { grew = false; for (const [t0, t1] of spans) if (t0 <= t + 1e-6 && t1 > t + 1e-6) { t = t1; grew = true; } }
    if (SKIN_LANDING_T.size >= SKIN_LANDING_MEMO) SKIN_LANDING_T.clear();
    SKIN_LANDING_T.set(key, t);
  }
  if (t <= 1e-6 || t > L - 1) return out;
  z.x += u.x * t; z.y += u.y * t;
  return out;
}
/** Anillo de salida de una conexión: relleno del fondo, borde del color de la línea. No interpreta colores. */
export function skinEdgePort(p: Pt, lineColor: string, bg: string): SkinLayer {
  return { k: "port", segs: skinEllipse(p.x, p.y, SKIN_PORT_R, SKIN_PORT_R), fill: bg, stroke: lineColor, sw: 1.5 };
}

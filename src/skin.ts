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
   ═══════════════════════════════════════════════════════════════════════════ */
import { DEFAULT_FONT, FONTS, PALETTE, THEMES } from "./generated/config.js";
import { cylinderGeom, cylinderSegments, type CylSeg } from "./svg.js";

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
/** Aterrizaje en la cara visible (n/e, d/2), sobre una COPIA; después de edgePoints y antes de edgeStroke. */
export function skinEdgeLanding(pts: readonly Pt[] | null | undefined, toSide: string): Pt[] {
  const out = (pts || []).map(p => ({ x: p.x, y: p.y }));
  if (out.length < 3 || (toSide !== "n" && toSide !== "e")) return out;
  const n = out.length, z = out[n - 1], p = out[n - 2];
  const vertical = Math.abs(z.x - p.x) < 0.01, horizontal = Math.abs(z.y - p.y) < 0.01;
  if (toSide === "n" && !vertical) return out;
  if (toSide === "e" && !horizontal) return out;
  const sx = SKIN_DEPTH / 2, sy = -SKIN_DEPTH / 2;
  z.x += sx; z.y += sy;
  if (toSide === "n") p.x += sx; else p.y += sy;
  return out;
}
/** Anillo de salida de una conexión: relleno del fondo, borde del color de la línea. No interpreta colores. */
export function skinEdgePort(p: Pt, lineColor: string, bg: string): SkinLayer {
  return { k: "port", segs: skinEllipse(p.x, p.y, SKIN_PORT_R, SKIN_PORT_R), fill: bg, stroke: lineColor, sw: 1.5 };
}

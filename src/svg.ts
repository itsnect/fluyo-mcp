import { CANVAS, THEMES, ICONS, iconDataUri } from "./schema.js";
import { FluyoNode, FluyoEdge, FluyoPage, ThemeName } from "./model.js";

/* ===================== Geometría de aristas (subset de fluyo.html) ===================== */

interface Pt { x: number; y: number; }

function sidePoint(n: FluyoNode, s: "n" | "s" | "e" | "w"): Pt {
  switch (s) {
    case "n": return { x: n.x, y: n.y - n.h / 2 };
    case "s": return { x: n.x, y: n.y + n.h / 2 };
    case "e": return { x: n.x + n.w / 2, y: n.y };
    case "w": return { x: n.x - n.w / 2, y: n.y };
  }
}

function autoAnchor(n: FluyoNode, tx: number, ty: number): Pt {
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

function anchorPt(n: FluyoNode, side: "n" | "s" | "e" | "w" | null, tx: number, ty: number): Pt {
  return side ? sidePoint(n, side) : autoAnchor(n, tx, ty);
}

function inferSide(n: FluyoNode, p: Pt): "n" | "s" | "e" | "w" {
  const dx = (p.x - n.x) / (n.w / 2 || 1), dy = (p.y - n.y) / (n.h / 2 || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
}

const DIR = {
  n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 },
} as const;

function orthoRoute(p1: Pt, d1: { x: number; y: number }, p2: Pt, d2: { x: number; y: number }): Pt[] {
  const pad = 28;
  const s = { x: p1.x + d1.x * pad, y: p1.y + d1.y * pad };
  const t = { x: p2.x + d2.x * pad, y: p2.y + d2.y * pad };
  let mids: Pt[];
  if (d1.x !== 0 && d2.x !== 0) { const mx = (s.x + t.x) / 2; mids = [{ x: mx, y: s.y }, { x: mx, y: t.y }]; }
  else if (d1.y !== 0 && d2.y !== 0) { const my = (s.y + t.y) / 2; mids = [{ x: s.x, y: my }, { x: t.x, y: my }]; }
  else if (d1.x !== 0) { mids = [{ x: t.x, y: s.y }]; }
  else { mids = [{ x: s.x, y: t.y }]; }
  const raw = [p1, s, ...mids, t, p2];
  const out: Pt[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = out[out.length - 1], b = raw[i];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1) out.push(b);
  }
  return out;
}

function edgePoints(e: FluyoEdge, nodeById: Map<number, FluyoNode>): Pt[] {
  const A = nodeById.get(e.from), B = nodeById.get(e.to);
  if (!A || !B) return [];
  const wps = e.waypoints || [];
  const tA = wps[0] || { x: B.x, y: B.y };
  const tB = wps[wps.length - 1] || { x: A.x, y: A.y };
  const p1 = anchorPt(A, e.fromSide, tA.x, tA.y);
  const p2 = anchorPt(B, e.toSide, tB.x, tB.y);
  if (e.route === "ortho" && wps.length === 0) {
    const d1 = DIR[e.fromSide || inferSide(A, p1)];
    const d2 = DIR[e.toSide || inferSide(B, p2)];
    return orthoRoute(p1, d1, p2, d2);
  }
  return [p1, ...wps, p2];
}

function pointAtMid(pts: Pt[]): Pt {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let target = L / 2;
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

/* ===================== Texto: heurística de ancho (sin DOM) ===================== */

const WIDE = new Set("MWmw@%&#GOQ".split(""));
const NARROW = new Set("iIl1.,'|!;:tfrj".split(""));

/** Ancho aproximado de texto en Georgia/serif. No es exacto (no hay DOM/canvas en el
 *  server), pero es suficiente para decidir cuándo achicar la fuente y para dimensionar
 *  el fondo de las etiquetas de arista. */
export function approxTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 0.32;
    else if (WIDE.has(ch)) units += 0.85;
    else if (NARROW.has(ch)) units += 0.3;
    else if (/[A-Z]/.test(ch)) units += 0.68;
    else units += 0.52;
  }
  return units * fontSize;
}

function fitFontSize(lines: string[], baseFs: number, maxWidth: number, explicitFs?: number | null): number {
  if (explicitFs) return explicitFs;
  let fs = baseFs;
  const maxW = Math.max(...lines.map(l => approxTextWidth(l, fs)), 1);
  if (maxW > maxWidth) fs = Math.max(10, (fs * maxWidth) / maxW);
  return fs;
}

function escapeXML(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgFillColor(hex: string, theme: ThemeName): string {
  const v = parseInt(hex.slice(1), 16);
  const a = theme === "crema" ? 0.16 : 0.18;
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function svgLabelLines(n: FluyoNode, theme: ThemeName, baseFs: number, cy: number): string {
  if (!n.label) return "";
  const T = THEMES[theme];
  const lines = String(n.label).split("\n");
  const fs = fitFontSize(lines, baseFs, n.w - 18, n.fs ?? undefined);
  const lh = fs * 1.25;
  const oy = cy - ((lines.length - 1) * lh) / 2;
  const fill = n.shape === "text" ? n.color : T.text;
  const clipId = `clip-label-${n.id}`;
  const parts = [
    `<clipPath id="${clipId}"><rect x="${(n.x - n.w / 2 + 2).toFixed(2)}" y="${(oy - fs * 0.6).toFixed(2)}" width="${(n.w - 4).toFixed(2)}" height="${(lines.length * lh).toFixed(2)}"/></clipPath>`,
  ];
  lines.forEach((l, i) => {
    parts.push(
      `<text x="${n.x}" y="${(oy + i * lh).toFixed(2)}" font-family="Georgia, serif" font-size="${fs.toFixed(1)}" fill="${fill}" text-anchor="middle" dominant-baseline="middle" clip-path="url(#${clipId})">${escapeXML(l)}</text>`
    );
  });
  return parts.join("\n");
}

function hexPointsSVG(n: FluyoNode): string {
  const { x, y, w, h } = n, i = Math.min(24, w * 0.18);
  return [
    [x - w / 2 + i, y - h / 2], [x + w / 2 - i, y - h / 2], [x + w / 2, y],
    [x + w / 2 - i, y + h / 2], [x - w / 2 + i, y + h / 2], [x - w / 2, y],
  ].map(p => p.map(v => v.toFixed(2)).join(",")).join(" ");
}

function renderNodeToSVG(n: FluyoNode, theme: ThemeName): string {
  const fill = svgFillColor(n.color, theme), stroke = n.color;
  const parts: string[] = [`<g id="node-${n.id}">`];
  switch (n.shape) {
    case "circle":
      parts.push(`<ellipse cx="${n.x}" cy="${n.y}" rx="${(n.w / 2).toFixed(2)}" ry="${(n.h / 2).toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y));
      break;
    case "diamond":
      parts.push(`<polygon points="${n.x},${(n.y - n.h / 2).toFixed(2)} ${(n.x + n.w / 2).toFixed(2)},${n.y} ${n.x},${(n.y + n.h / 2).toFixed(2)} ${(n.x - n.w / 2).toFixed(2)},${n.y}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y));
      break;
    case "hex":
      parts.push(`<polygon points="${hexPointsSVG(n)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y));
      break;
    case "cylinder": {
      const { x, y, w, h } = n, ry = Math.min(16, h * 0.18), top = y - h / 2, bot = y + h / 2;
      const d = `M ${(x - w / 2).toFixed(2)} ${(top + ry).toFixed(2)} L ${(x - w / 2).toFixed(2)} ${(bot - ry).toFixed(2)} C ${(x - w / 2).toFixed(2)} ${(bot + ry * 0.8).toFixed(2)} ${(x + w / 2).toFixed(2)} ${(bot + ry * 0.8).toFixed(2)} ${(x + w / 2).toFixed(2)} ${(bot - ry).toFixed(2)} L ${(x + w / 2).toFixed(2)} ${(top + ry).toFixed(2)} C ${(x + w / 2).toFixed(2)} ${(top - ry * 0.8).toFixed(2)} ${(x - w / 2).toFixed(2)} ${(top - ry * 0.8).toFixed(2)} ${(x - w / 2).toFixed(2)} ${(top + ry).toFixed(2)} Z`;
      parts.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`);
      parts.push(`<ellipse cx="${x}" cy="${(top + ry).toFixed(2)}" rx="${(w / 2).toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="2.5"/>`);
      parts.push(svgLabelLines(n, theme, 17, y + 6));
      break;
    }
    case "text":
      parts.push(svgLabelLines(n, theme, 22, n.y));
      break;
    case "icon": {
      const src = n.icon ? iconDataUri(n.icon) : "";
      const s = Math.min(n.w, n.h - 26) * 0.78;
      if (src) parts.push(`<image x="${(n.x - s / 2).toFixed(2)}" y="${(n.y - n.h / 2 + 4).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" href="${src}" preserveAspectRatio="xMidYMid meet"/>`);
      parts.push(svgLabelLines(n, theme, 14, n.y + n.h / 2 - 10));
      break;
    }
    case "image":
      if (n.img) parts.push(`<image x="${(n.x - n.w / 2).toFixed(2)}" y="${(n.y - n.h / 2).toFixed(2)}" width="${n.w}" height="${n.h}" href="${n.img}" preserveAspectRatio="xMidYMid meet"/>`);
      parts.push(svgLabelLines(n, theme, 14, n.y + n.h / 2 + 14));
      break;
    default:
      parts.push(`<rect x="${(n.x - n.w / 2).toFixed(2)}" y="${(n.y - n.h / 2).toFixed(2)}" width="${n.w}" height="${n.h}" rx="10" ry="10" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y));
  }
  parts.push("</g>");
  return parts.filter(Boolean).join("\n");
}

function renderConnectorToSVG(e: FluyoEdge, theme: ThemeName, nodeById: Map<number, FluyoNode>): string {
  const A = nodeById.get(e.from), B = nodeById.get(e.to);
  if (!A || !B) return "";
  const pts = edgePoints(e, nodeById);
  if (pts.length < 2) return "";
  const T = THEMES[theme];
  const lineCol = e.lineColor || T.edge;
  const dash = e.dashed ? ' stroke-dasharray="8 7"' : "";
  let markers = "";
  if (e.endArrow !== false) markers += ' marker-end="url(#fluyo-arrow-end)"';
  if (e.startArrow) markers += ' marker-start="url(#fluyo-arrow-start)"';
  const ptsStr = pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const parts = [`<polyline points="${ptsStr}" fill="none" stroke="${lineCol}" stroke-width="2" stroke-linejoin="round"${dash}${markers}/>`];
  if (e.label) {
    const m = pointAtMid(pts);
    const efs = e.fs || 13;
    const tw = approxTextWidth(e.label, efs);
    const rx = (m.x - tw / 2 - 6).toFixed(2), ry = (m.y - efs * 0.85).toFixed(2);
    parts.push(`<rect x="${rx}" y="${ry}" width="${(tw + 12).toFixed(2)}" height="${(efs * 1.7).toFixed(2)}" fill="${T.lblBg}"/>`);
    parts.push(`<text x="${m.x.toFixed(2)}" y="${m.y.toFixed(2)}" font-family="Georgia, serif" font-size="${efs}" fill="${T.edgeLbl}" text-anchor="middle" dominant-baseline="middle">${escapeXML(e.label)}</text>`);
  }
  return parts.join("\n");
}

function buildDefs(): string {
  return `<defs>
  <marker id="fluyo-arrow-end" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
    <path d="M 0 0 L 10 4 L 0 8 z" fill="context-stroke"/>
  </marker>
  <marker id="fluyo-arrow-start" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth">
    <path d="M 0 0 L 10 4 L 0 8 z" fill="context-stroke"/>
  </marker>
</defs>`;
}

function pageBounds(page: FluyoPage, nodeById: Map<number, FluyoNode>) {
  if (!page.nodes.length) return { x: 0, y: 0, w: CANVAS.W, h: CANVAS.H };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  for (const n of page.nodes) { add(n.x - n.w / 2, n.y - n.h / 2); add(n.x + n.w / 2, n.y + n.h / 2); }
  for (const e of page.edges) for (const p of edgePoints(e, nodeById)) add(p.x, p.y);
  minX -= 40; minY -= 40; maxX += 40; maxY += 40;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Genera el SVG de una página Fluyo, replicando exactamente lo que produce
 * "Exportar -> SVG" dentro de la app (mismos colores, formas, íconos y estilos
 * de arista). El resultado es estático: no incluye los puntos animados ni el
 * "build" escalonado, igual que el exportador original.
 */
export function pageToSVG(page: FluyoPage, theme: ThemeName, scale = 1): string {
  const nodeById = new Map(page.nodes.map(n => [n.id, n] as const));
  const bounds = pageBounds(page, nodeById);
  const width = Math.round(bounds.w * scale);
  const height = Math.round(bounds.h * scale);
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${bounds.x.toFixed(2)} ${bounds.y.toFixed(2)} ${bounds.w.toFixed(2)} ${bounds.h.toFixed(2)}">`,
    `<rect x="${bounds.x.toFixed(2)}" y="${bounds.y.toFixed(2)}" width="${bounds.w.toFixed(2)}" height="${bounds.h.toFixed(2)}" fill="${THEMES[theme].bg}"/>`,
    buildDefs(),
  ];
  for (const e of page.edges) parts.push(renderConnectorToSVG(e, theme, nodeById));
  for (const n of page.nodes) parts.push(renderNodeToSVG(n, theme));
  parts.push("</svg>");
  return parts.join("\n");
}

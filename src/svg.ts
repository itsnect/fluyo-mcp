import { CANVAS, DEFAULT_FONT, THEMES, animDataUri, iconDataUri } from "./schema.js";
import { FluyoNode, FluyoEdge, FluyoPage, ThemeName } from "./model.js";

/* ===================== Geometría de aristas (port de fluyo/js/geometry.js) ===================== */

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

function anchorPt(n: FluyoNode, side: "n" | "s" | "e" | "w" | null | undefined, tx: number, ty: number): Pt {
  return side ? sidePoint(n, side) : autoAnchor(n, tx, ty);
}

function inferSide(n: FluyoNode, p: Pt): "n" | "s" | "e" | "w" {
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

function parallelKey(e: FluyoEdge): string {
  return e.from < e.to ? `${e.from}-${e.to}` : `${e.to}-${e.from}`;
}

/** El carril de esta arista: `off` es su desplazamiento y `half` el semiancho del
 *  abanico completo del grupo, que hace falta para reservarle sitio en el lado
 *  del nodo antes de mover nada. */
function parallelLane(e: FluyoEdge, edges: readonly FluyoEdge[]): { off: number; half: number } {
  const none = { off: 0, half: 0 };
  if ((e.waypoints || []).length) return none;
  const key = parallelKey(e);
  const sib = edges.filter(o => !(o.waypoints || []).length && parallelKey(o) === key);
  if (sib.length < 2) return none;
  const i = sib.findIndex(o => o.id === e.id);
  if (i < 0) return none;
  return { off: (i - (sib.length - 1) / 2) * PARALLEL_SEP, half: ((sib.length - 1) / 2) * PARALLEL_SEP };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Corre el ancla a lo largo de su lado sin salirse de él: el extremo tiene que
 *  seguir tocando el borde del nodo.
 *
 *  El ancla base se mete primero hacia dentro lo justo para que quepa el abanico
 *  entero. Sin ese paso, un ancla que autoAnchor dejó pegada a una esquina no
 *  tiene hueco para apartarse y el clamp se come el desplazamiento. */
function slideAnchor(n: FluyoNode, side: "n" | "s" | "e" | "w", p: Pt, off: number, half: number): Pt {
  if (!off) return p;
  const inset = 10;
  const horiz = side === "n" || side === "s";
  const c = horiz ? n.x : n.y;
  const lim = Math.max(0, (horiz ? n.w / 2 : n.h / 2) - inset);
  const room = Math.max(0, lim - half);
  const base = clamp(horiz ? p.x : p.y, c - room, c + room);
  const v = clamp(base + off, c - lim, c + lim);
  return horiz ? { x: v, y: p.y } : { x: p.x, y: v };
}

function orthoRoute(p1: Pt, d1: { x: number; y: number }, p2: Pt, d2: { x: number; y: number }, off = 0): Pt[] {
  const pad = 28;
  const s = { x: p1.x + d1.x * pad, y: p1.y + d1.y * pad };
  const t = { x: p2.x + d2.x * pad, y: p2.y + d2.y * pad };
  let mids: Pt[];
  // El tramo central también se aparta: separar solo las anclas dejaría las dos
  // rutas compartiendo el canal largo del medio, que es donde va la etiqueta.
  if (d1.x !== 0 && d2.x !== 0) { const mx = (s.x + t.x) / 2 + off; mids = [{ x: mx, y: s.y }, { x: mx, y: t.y }]; }
  else if (d1.y !== 0 && d2.y !== 0) { const my = (s.y + t.y) / 2 + off; mids = [{ x: s.x, y: my }, { x: t.x, y: my }]; }
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
  const { off, half } = parallelLane(e, edges);
  if (off) { p1 = slideAnchor(A, s1, p1, off, half); p2 = slideAnchor(B, s2, p2, off, half); }
  if (e.route === "ortho" && wps.length === 0) {
    return orthoRoute(p1, DIR[s1], p2, DIR[s2], off);
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
    const efs = e.fs || 13;
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

function fitFontSize(lines: string[], baseFs: number, maxWidth: number, explicitFs?: number | null, bold = false): number {
  if (explicitFs) return explicitFs;
  let fs = baseFs;
  const maxW = Math.max(...lines.map(l => approxTextWidth(l, fs, bold)), 1);
  if (maxW > maxWidth) fs = Math.max(10, (fs * maxWidth) / maxW);
  return fs;
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

function svgFillColor(hex: string, theme: ThemeName): string {
  const v = parseInt(hex.slice(1), 16);
  const a = theme === "crema" ? 0.16 : 0.18;
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
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
function svgLabelLines(n: FluyoNode, theme: ThemeName, baseFs: number, cy: number, globalFont: string): string {
  if (!n.label) return "";
  const T = THEMES[theme];
  const lines = String(n.label).split("\n");
  const family = n.font || globalFont || DEFAULT_FONT;
  const bold = !!n.bold;
  const fs = fitFontSize(lines, baseFs, n.w - 18, n.fs, bold);
  const lh = fs * 1.25;
  const pos = n.lblPos || "center";
  const inset = Math.min(14, n.w * 0.12, n.h * 0.18);

  let baseY: number;
  if (pos === "top") baseY = n.y - n.h / 2 + inset + fs * 0.7;
  else if (pos === "bottom") baseY = n.y + n.h / 2 - inset - (lines.length - 1) * lh - fs * 0.1;
  else baseY = cy - ((lines.length - 1) * lh) / 2;

  let anchor = "middle";
  let tx = n.x;
  if (pos === "left") { anchor = "start"; tx = n.x - n.w / 2 + inset; }
  else if (pos === "right") { anchor = "end"; tx = n.x + n.w / 2 - inset; }

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
  const weight = bold ? ' font-weight="bold"' : "";
  lines.forEach((l, i) => {
    parts.push(
      `<text x="${tx.toFixed(2)}" y="${(baseY + i * lh).toFixed(2)}" font-family="${escapeXML(family)}" font-size="${fs.toFixed(1)}"${weight} fill="${escapeXML(fill)}" text-anchor="${anchor}" dominant-baseline="middle">${escapeXML(l)}</text>`
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

/* ===================== Nodos ===================== */

function renderNodeToSVG(n: FluyoNode, theme: ThemeName, globalFont: string): string {
  const fill = svgNodeFill(n, theme);
  const stroke = escapeXML(n.color);
  const dash = svgDash(n);
  const parts: string[] = [`<g id="node-${n.id}">`];

  switch (n.shape) {
    case "circle":
      parts.push(`<ellipse cx="${n.x}" cy="${n.y}" rx="${(n.w / 2).toFixed(2)}" ry="${(n.h / 2).toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y, globalFont));
      break;

    case "diamond":
      parts.push(`<polygon points="${n.x},${(n.y - n.h / 2).toFixed(2)} ${(n.x + n.w / 2).toFixed(2)},${n.y} ${n.x},${(n.y + n.h / 2).toFixed(2)} ${(n.x - n.w / 2).toFixed(2)},${n.y}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y, globalFont));
      break;

    case "hex":
      parts.push(`<polygon points="${hexPointsSVG(n)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y, globalFont));
      break;

    case "cylinder": {
      const { x, y, w, h } = n, ry = Math.min(16, h * 0.18), top = y - h / 2, bot = y + h / 2;
      const d = `M ${(x - w / 2).toFixed(2)} ${(top + ry).toFixed(2)} L ${(x - w / 2).toFixed(2)} ${(bot - ry).toFixed(2)} C ${(x - w / 2).toFixed(2)} ${(bot + ry * 0.8).toFixed(2)} ${(x + w / 2).toFixed(2)} ${(bot + ry * 0.8).toFixed(2)} ${(x + w / 2).toFixed(2)} ${(bot - ry).toFixed(2)} L ${(x + w / 2).toFixed(2)} ${(top + ry).toFixed(2)} C ${(x + w / 2).toFixed(2)} ${(top - ry * 0.8).toFixed(2)} ${(x - w / 2).toFixed(2)} ${(top - ry * 0.8).toFixed(2)} ${(x - w / 2).toFixed(2)} ${(top + ry).toFixed(2)} Z`;
      parts.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(`<ellipse cx="${x}" cy="${(top + ry).toFixed(2)}" rx="${(w / 2).toFixed(2)}" ry="${ry.toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="2.5"/>`);
      parts.push(svgLabelLines(n, theme, 17, y + 6, globalFont));
      break;
    }

    case "text":
      parts.push(svgLabelLines(n, theme, 22, n.y, globalFont));
      break;

    case "anim": {
      // El GIF se anima por fotograma en el lienzo; en un SVG estático va su vista
      // previa, exactamente como hace el exportador de la app.
      const src = n.anim ? animDataUri(n.anim) : "";
      const s = Math.max(10, Math.min(n.w, n.h - (n.label ? 26 : 8)));
      if (src) {
        const ix = n.x - s / 2;
        const iy = n.y - (n.label ? 8 : 0) - s / 2;
        parts.push(`<image x="${ix.toFixed(2)}" y="${iy.toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" href="${src}" preserveAspectRatio="xMidYMid meet"/>`);
      }
      parts.push(svgLabelLines(n, theme, 14, n.y + n.h / 2 - 8, globalFont));
      break;
    }

    case "icon": {
      const src = n.icon ? iconDataUri(n.icon) : "";
      const s = Math.min(n.w, n.h - 26) * 0.78;
      if (src) parts.push(`<image x="${(n.x - s / 2).toFixed(2)}" y="${(n.y - n.h / 2 + 4).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" href="${src}" preserveAspectRatio="xMidYMid meet"/>`);
      parts.push(svgLabelLines(n, theme, 14, n.y + n.h / 2 - 10, globalFont));
      break;
    }

    case "image":
      if (n.img) parts.push(`<image x="${(n.x - n.w / 2).toFixed(2)}" y="${(n.y - n.h / 2).toFixed(2)}" width="${n.w}" height="${n.h}" href="${escapeXML(n.img)}" preserveAspectRatio="xMidYMid meet"/>`);
      parts.push(svgLabelLines(n, theme, 14, n.y + n.h / 2 + 14, globalFont));
      break;

    default:
      parts.push(`<rect x="${(n.x - n.w / 2).toFixed(2)}" y="${(n.y - n.h / 2).toFixed(2)}" width="${n.w}" height="${n.h}" rx="10" ry="10" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${dash}/>`);
      parts.push(svgLabelLines(n, theme, 17, n.y, globalFont));
  }

  parts.push("</g>");
  return parts.filter(Boolean).join("\n");
}

/* ===================== Aristas ===================== */

function renderConnectorToSVG(e: FluyoEdge, theme: ThemeName, nodeById: Map<number, FluyoNode>, edges: readonly FluyoEdge[], globalFont: string, labelPos: Map<number, Pt>): string {
  const A = nodeById.get(e.from), B = nodeById.get(e.to);
  if (!A || !B) return "";
  const pts = edgePoints(e, nodeById, edges);
  if (pts.length < 2) return "";
  const T = THEMES[theme];
  const lineCol = escapeXML(e.lineColor || T.edge);
  const dash = e.dashed ? ' stroke-dasharray="8 7"' : "";
  let markers = "";
  if (e.endArrow !== false) markers += ' marker-end="url(#fluyo-arrow-end)"';
  if (e.startArrow) markers += ' marker-start="url(#fluyo-arrow-start)"';
  const ptsStr = pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const parts = [`<polyline points="${ptsStr}" fill="none" stroke="${lineCol}" stroke-width="2" stroke-linejoin="round"${dash}${markers}/>`];

  if (e.label) {
    const m = labelPos.get(e.id) ?? pointAt(pts, 0.5);
    const efs = e.fs || 13;
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
  const { scale = 1, globalFont = null, crop = false } = options;
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
    buildDefs(),
  ];
  // Sin rectángulo de fondo: el SVG que exporta la app es transparente.
  const labelPos = placeEdgeLabels(page);
  for (const e of page.edges) parts.push(renderConnectorToSVG(e, theme, nodeById, page.edges, font, labelPos));
  for (const n of page.nodes) parts.push(renderNodeToSVG(n, theme, font));
  parts.push("</svg>");
  return parts.join("\n");
}

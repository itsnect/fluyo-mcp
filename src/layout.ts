import { CANVAS } from "./schema.js";

export interface LayoutNodeInput<K extends string | number> {
  key: K;
  w: number;
  h: number;
}

export interface LayoutEdgeInput<K extends string | number> {
  from: K;
  to: K;
}

export interface LayoutResult<K extends string | number> {
  positions: Map<K, { x: number; y: number }>;
}

const X_GAP = 260;
const Y_GAP = 60;
const MARGIN_X = 200;
const MARGIN_Y = 140;

/**
 * Layout por capas (estilo Sugiyama simplificado): los nodos sin entradas
 * quedan en la capa 0, y cada nodo se ubica una capa a la derecha del más
 * profundo de sus predecesores. Dentro de una capa, los nodos se apilan
 * verticalmente centrados. Robusto ante ciclos (no cuelga: los nodos que no
 * se puedan resolver por orden topológico caen a la capa siguiente disponible).
 */
export function layeredLayout<K extends string | number>(
  nodes: LayoutNodeInput<K>[],
  edges: LayoutEdgeInput<K>[]
): LayoutResult<K> {
  const keys = nodes.map(n => n.key);
  const keySet = new Set(keys);
  const validEdges = edges.filter(e => keySet.has(e.from) && keySet.has(e.to) && e.from !== e.to);

  const outAdj = new Map<K, K[]>();
  const inDegree = new Map<K, number>();
  for (const k of keys) { outAdj.set(k, []); inDegree.set(k, 0); }
  for (const e of validEdges) {
    outAdj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }

  const layer = new Map<K, number>();
  for (const k of keys) layer.set(k, 0);

  // Kahn's algorithm para procesar en orden topológico y propagar capas.
  const degree = new Map(inDegree);
  const queue: K[] = keys.filter(k => degree.get(k) === 0);
  const processed = new Set<K>();
  let guard = 0;
  const maxIter = keys.length * Math.max(1, validEdges.length) + keys.length + 10;

  while (queue.length && guard < maxIter) {
    guard++;
    const u = queue.shift()!;
    if (processed.has(u)) continue;
    processed.add(u);
    for (const v of outAdj.get(u) || []) {
      layer.set(v, Math.max(layer.get(v) || 0, (layer.get(u) || 0) + 1));
      degree.set(v, (degree.get(v) || 0) - 1);
      if (degree.get(v) === 0) queue.push(v);
    }
  }

  // Ciclos residuales: cualquier nodo no procesado se coloca una capa después
  // del máximo actual, para que el layout siempre termine.
  const unresolved = keys.filter(k => !processed.has(k));
  if (unresolved.length) {
    const maxLayer = Math.max(0, ...Array.from(layer.values()));
    unresolved.forEach((k, i) => layer.set(k, maxLayer + 1 + Math.floor(i / Math.max(1, Math.ceil(Math.sqrt(unresolved.length))))));
  }

  const byLayer = new Map<number, K[]>();
  for (const k of keys) {
    const l = layer.get(k) || 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(k);
  }

  const sizeOf = new Map<K, { w: number; h: number }>();
  for (const n of nodes) sizeOf.set(n.key, { w: n.w, h: n.h });

  const positions = new Map<K, { x: number; y: number }>();
  const sortedLayers = Array.from(byLayer.keys()).sort((a, b) => a - b);

  for (const l of sortedLayers) {
    const layerKeys = byLayer.get(l)!;
    const x = MARGIN_X + l * X_GAP;
    const heights = layerKeys.map(k => sizeOf.get(k)?.h || 70);
    const totalH = heights.reduce((a, b) => a + b, 0) + Y_GAP * Math.max(0, layerKeys.length - 1);
    let cursorY = CANVAS.H / 2 - totalH / 2;
    layerKeys.forEach((k, i) => {
      const h = heights[i];
      const cy = cursorY + h / 2;
      positions.set(k, { x, y: Math.max(MARGIN_Y, cy) });
      cursorY += h + Y_GAP;
    });
  }

  return { positions };
}

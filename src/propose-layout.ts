import { authorDocument } from "./authoring.js";
import { createKernel } from "./kernel.js";
import { layoutPage } from "./layout.js";
import { normalizeWith, revisionOfProject } from "./revision.js";

/**
 * propose_layout (FLUYO-018.6): auto-layout como herramienta de LECTURA.
 *
 * Calcula con el auto-layout existente (`layoutPage` → `layeredLayout`, el mismo de create_diagram: no hay otro motor)
 * dónde pondría los nodos de UNA página y devuelve lotes `author_document` (update_node {x,y}, y update_connection {waypoints:[]} para las
 * conexiones con ruta manual cuyos extremos se mueven) que el agente aplica tal cual. No modifica nada, no guarda estado y es determinista.
 * Quien valida y escribe sigue siendo author_document (kernel: integridad, límites, baseRevision, todo o nada). Los límites salen del kernel
 * (FluyoAuthoring.LIMITS): aquí no se duplica ninguna regla. Si el layout no cabe en ellos NO se recorta: LAYOUT_EXCEEDS_LIMITS.
 */

export const LAYOUT_ALGORITHM = "layered-lr-v1";

export interface ProposeLayoutInput {
  document: unknown;
  pageIndex?: number;
  clearWaypoints?: boolean;
  baseRevision?: string;
}

interface Box { minX: number; minY: number; maxX: number; maxY: number }
type Op = Record<string, unknown>;
type Err = Record<string, unknown> & { code: string; message: string };

interface NormalizedPage {
  name: string;
  nodes: Array<{ id: number; x: number; y: number; w: number; h: number }>;
  edges: Array<{ id: number; from: number; to: number; label?: string | null; fs?: number | null; bold?: boolean; waypoints?: Array<{ x: number; y: number }> }>;
}
interface NormalizedProject { doc: { cur?: number; pages: NormalizedPage[] } }

const boundsOf = (pts: Array<{ x: number; y: number; w: number; h: number }>): Box | null => {
  if (!pts.length) return null;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x - p.w / 2); b.maxX = Math.max(b.maxX, p.x + p.w / 2);
    b.minY = Math.min(b.minY, p.y - p.h / 2); b.maxY = Math.max(b.maxY, p.y + p.h / 2);
  }
  return b;
};

export function proposeLayout(input: ProposeLayoutInput) {
  const kernel = createKernel();
  const head = { engineVersion: kernel.call<number>("FluyoScenarios.ENGINE_VERSION"), kernelId: kernel.kernelId };
  const rejected = (errors: Err[], extra: Record<string, unknown> = {}) => ({
    ok: false as const,
    ...head,
    ...extra,
    errors,
    note: "Solo lectura: el documento no se modificó y no se devuelve ninguna propuesta.",
  });

  const base = normalizeWith(kernel, input.document) as NormalizedProject | null;
  if (base === null) {
    return rejected([{ code: "DOCUMENT_UNREADABLE", message: "El documento no es legible: usa describe_document para ver los errores de validación." }]);
  }
  const revision = revisionOfProject(base);
  if (input.baseRevision !== undefined && input.baseRevision !== revision) {
    return rejected(
      [{ code: "REVISION_MISMATCH", message: "baseRevision no coincide con el documento recibido: el documento cambió o no es el que describiste. Vuelve a leerlo con describe_document.", expected: input.baseRevision, actual: revision }],
      { actualRevision: revision }
    );
  }

  const pages = base.doc.pages;
  const pageIndex = input.pageIndex === undefined ? (base.doc.cur ?? 0) : input.pageIndex;
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
    return rejected([{ code: "PAGE_NOT_FOUND", message: `pageIndex ${JSON.stringify(pageIndex)} no existe: el documento tiene ${pages.length} página(s) (0 a ${pages.length - 1}).`, pageIndex, pages: pages.length }]);
  }
  const clearWaypoints = input.clearWaypoints ?? true;
  const page = pages[pageIndex];
  const limits = kernel.call<{ coordMax: number }>("FluyoAuthoring.LIMITS");
  const maxOps = kernel.call<number>("FluyoAuthoring.MAX_OPERATIONS");

  const positions = layoutPage(page);
  const rows = page.nodes.map(n => {
    const p = positions.get(n.id) as { x: number; y: number };
    return { id: n.id, x: p.x, y: p.y, from: { x: n.x, y: n.y }, moved: p.x !== n.x || p.y !== n.y, w: n.w, h: n.h };
  });

  // Los límites de autoría NO se recortan: si el layout no cabe, se dice cuál, cuánto y dónde.
  const over = rows.flatMap(r => (["x", "y"] as const).filter(f => Math.abs(r[f]) > limits.coordMax).map(f => ({ id: r.id, field: f, value: r[f] })));
  if (over.length) {
    const worst = over.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
    const maxAbs = (f: "x" | "y") => Math.max(...rows.map(r => Math.abs(r[f])));
    return rejected(
      [{
        code: "LAYOUT_EXCEEDS_LIMITS",
        message:
          `El auto-layout de la página ${pageIndex} necesita coordenadas fuera del límite de autoría (|${worst.field}| = ${Math.abs(worst.value)} > coordMax ${limits.coordMax}) ` +
          `y no se recorta en silencio. Reduce el diagrama (menos capas encadenadas o etiquetas de conexión más cortas), reparte los nodos en otra página o coloca los nodos a mano con update_node.`,
        limit: "coordMax",
        limitName: "coordMax",
        limitValue: limits.coordMax,
        actual: Math.abs(worst.value),
        field: worst.field,
        nodeId: worst.id,
        pageIndex,
        nodes: page.nodes.length,
        offendingNodes: new Set(over.map(o => o.id)).size,
        required: { maxAbsX: maxAbs("x"), maxAbsY: maxAbs("y") },
      }],
      { pageIndex, algorithm: LAYOUT_ALGORITHM }
    );
  }

  const movedIds = new Set(rows.filter(r => r.moved).map(r => r.id));
  const ops: Op[] = rows.filter(r => r.moved).map(r => ({
    op: "update_node", scope: "page", pageIndex, node: { id: r.id }, spec: { x: r.x, y: r.y },
  }));
  const withWaypoints = page.edges.filter(e => (e.waypoints?.length ?? 0) > 0);
  const stale = withWaypoints.filter(e => movedIds.has(e.from) || movedIds.has(e.to));
  if (clearWaypoints) {
    for (const e of stale) ops.push({ op: "update_connection", scope: "page", pageIndex, connection: { id: e.id }, spec: { waypoints: [] } });
  }
  const warnings: Array<Record<string, unknown>> = [];
  if (!clearWaypoints && stale.length) {
    warnings.push({
      code: "WAYPOINTS_KEPT",
      connections: stale.map(e => e.id),
      message: "Estas conexiones tienen ruta manual (waypoints) y uno de sus extremos se mueve: se conservan y quedarán desalineadas. Usa clearWaypoints:true (por defecto) para volver a su ruta automática.",
    });
  }

  // Lotes ≤ maxOps. Cada uno se APLICA de verdad (sobre una copia, en memoria) con author_document: así la propuesta es consumible tal cual
  // y el baseRevision de cada lote es el resultRevision del anterior. Nada de esto sale de la llamada.
  const batches: Array<{ baseRevision: string; resultRevision: string; operations: Op[] }> = [];
  let current: unknown = input.document;
  let currentRevision = revision;
  for (let i = 0; i < ops.length; i += maxOps) {
    const chunk = ops.slice(i, i + maxOps);
    const r = authorDocument({ document: current, baseRevision: currentRevision, operations: chunk });
    if (!r.ok) {
      return rejected([{ code: "LAYOUT_NOT_APPLICABLE", message: "El layout calculado no se pudo aplicar con author_document (no debería ocurrir): se informa en lugar de devolver una propuesta inservible.", batch: batches.length, cause: r.errors[0] ?? null }], { pageIndex, algorithm: LAYOUT_ALGORITHM });
    }
    batches.push({ baseRevision: currentRevision, resultRevision: r.resultRevision, operations: chunk });
    current = r.document;
    currentRevision = r.resultRevision;
  }

  const before = boundsOf(page.nodes);
  const after = boundsOf(rows.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h })));
  return {
    ok: true as const,
    ...head,
    readOnly: true as const,
    revision,
    pageIndex,
    pageName: page.name,
    algorithm: LAYOUT_ALGORITHM,
    clearWaypoints,
    summary: {
      nodes: rows.length,
      moved: movedIds.size,
      unchanged: rows.length - movedIds.size,
      layers: new Set(rows.map(r => r.x)).size,
      operations: ops.length,
      batches: batches.length,
      bounds: { before, after },
    },
    positions: rows.map(r => ({ id: r.id, x: r.x, y: r.y, from: r.from, moved: r.moved })),
    connectionsWithWaypoints: withWaypoints.map(e => e.id),
    waypointsCleared: clearWaypoints ? stale.map(e => e.id) : [],
    batches,
    finalRevision: currentRevision,
    warnings,
  };
}

export function summarizeLayout(r: ReturnType<typeof proposeLayout>): string {
  if (!r.ok) {
    const first = r.errors[0];
    return `Layout NO propuesto (${first.code}): ${first.message} Solo lectura: no se modificó nada.`;
  }
  const s = r.summary;
  const how = s.batches === 0 ? "No hay nada que mover." : s.batches === 1 ? "Aplica el lote de 'batches' con author_document." : `Aplica los ${s.batches} lotes de 'batches' EN ORDEN con author_document (cada baseRevision es el resultRevision del anterior).`;
  return `Solo lectura: layout de la página ${r.pageIndex} «${r.pageName}» (${r.algorithm}): ${s.moved} de ${s.nodes} elemento(s) cambian de sitio en ${s.layers} capa(s). ${how}`;
}

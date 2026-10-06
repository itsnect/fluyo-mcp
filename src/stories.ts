import { createKernel, sha256Hex, type Kernel } from "./kernel.js";
import { revisionOf } from "./revision.js";

/**
 * describe_document y run_story (FLUYO-017.1): sólo lectura, validación y ejecución.
 *
 * Todo el criterio —normalizar el documento, validar su integridad, ejecutar el motor, derivar el
 * resultado de cada Step, escribir su frase— lo hace el kernel de Fluyo (src/kernel.ts). Este módulo
 * únicamente pide esos resultados y los da forma de contrato compacto para un agente. Aquí no hay
 * ninguna regla del motor ni ninguna simulación.
 */

/* ===================== Tipos del contrato ===================== */

export interface IntegrityError {
  code: string;
  message: string;
  scope: "document" | "page" | "story" | "step";
  pageIndex?: number;
  storyId?: number;
  stepId?: number;
  entityId?: number;
  entityKind?: "node" | "edge" | "eventType";
  [extra: string]: unknown;
}

interface ValidationReport {
  valid: boolean;
  schemaVersion: number | null;
  engineVersion: number;
  errors: IntegrityError[];
  stories: Array<{ pageIndex: number; storyId: number; executable: boolean }>;
}

/** Lo que el modelo NO representa. Se devuelve siempre: es lo que impide que el agente lo invente. */
export const UNMODELED: readonly string[] = [
  "reintentos, colas, timeouts ni dependencias causales entre pasos: un paso se ejecuta aunque uno anterior no se haya completado",
  "lógica interna de ningún elemento (procesar un pago, el funcionamiento de Kafka, etc.)",
  "latencia: los tiempos (at, ms) son virtuales; la duración visual del viaje es sólo presentación",
  "un acontecimiento OCCURRENCE es narrado: el motor lo registra aunque el elemento no esté disponible y no prueba que ocurriera nada real",
];

/** Un evento muy usado no desborda la descripción: se listan hasta MAX_USAGE_STORIES Historias y MAX_USAGE_STEPS pasos por Historia. */
const MAX_USAGE_STORIES = 25;
const MAX_USAGE_STEPS = 50;

/** Los errores de integridad pueden ser muchos en un documento muy roto; el contrato no los desborda. */
const MAX_ERRORS_IN_DESCRIPTION = 50;

/** Las etiquetas de elementos «code» pueden ser un bloque entero: se resumen a una línea de ≤ MAX_LABEL.
 *  La referencia fiable es siempre el id; la frase de cada paso la escribe el kernel con la primera línea. */
const MAX_LABEL = 80;
const oneLine = (label: unknown): string => {
  const s = String(label ?? "").replace(/\s*\r?\n\s*/g, " / ").trim();
  if (!s) return "(sin nombre)";
  return s.length > MAX_LABEL ? `${[...s].slice(0, MAX_LABEL - 1).join("")}…` : s;
};

/* ===================== Lectura del kernel ===================== */

interface KernelModel {
  documentVersion: number;
  engineVersion: number;
  limits: {
    maxSteps: number;
    maxTraceEvents: number;
    maxVirtualMs: number;
    maxRuntimeJobs: number;
    maxNodesPerPage: number;
    maxConnectionsPerPage: number;
    coordMax: number;
    sizeMin: number;
    sizeMax: number;
  };
  theme: string;
  customBg: string;
  themes: string[];
  primitives: string[];
  actions: string[];
  cur: number;
  eventTypes: Array<{
    id: number;
    name: string;
    sentenceTemplate: string;
    symbol: string;
    primitive: string;
    availability?: string;
    motion: string;
    spec: { action: string; target: string; state?: string } | null;
    usedBy: number;
    presentation: Record<string, unknown>;
    usedIn: Array<{ pageIndex: number; storyId: number; storyName: string; stepIds: number[] }>;
  }>;
  pages: Array<{
    name: string;
    nodes: Array<{ id: number; label: string; shape: string; icon?: string; x: number; y: number; w: number; h: number }>;
    edges: Array<{ id: number; from: number; to: number; label?: string; route: string; fromSide: string | null; toSide: string | null; waypoints: Array<{ x: number; y: number }> }>;
    behaviors: Array<{ nodeId: number; initialState: string }>;
    stories: Array<{
      id: number;
      name: string;
      engineVersion: number;
      stepCount: number;
      groups: Array<{
        at: number;
        steps: Array<{
          id: number;
          action: string;
          eventTypeId?: number;
          nodeId?: number;
          edgeId?: number;
          state?: string;
          sentence: string;
        }>;
      }>;
    }>;
  }>;
}

/** Proyección de lectura de lo que ya normalizó y calculó el kernel. Devuelve null si el documento no normaliza. */
const READ_MODEL = `(function(){
  let d; try { d = projectFromProjectData(__a).doc; } catch (e) { return null; }
  doc = d;
  return {
    documentVersion: serializeProject().version,
    engineVersion: FluyoScenarios.ENGINE_VERSION,
    limits: {maxSteps: FluyoScenarios.MAX_SCENARIO_STEPS, maxTraceEvents: FluyoScenarios.MAX_TRACE_EVENTS,
             maxVirtualMs: FluyoScenarios.MAX_VIRTUAL_TIME_MS, maxRuntimeJobs: FluyoScenarios.MAX_RUNTIME_JOBS,
             // Reglas de ENTRADA de author_document (018.5), no del documento: un documento antiguo que las exceda se abre igual.
             maxNodesPerPage: FluyoAuthoring.LIMITS.maxNodesPerPage, maxConnectionsPerPage: FluyoAuthoring.LIMITS.maxConnectionsPerPage,
             coordMax: FluyoAuthoring.LIMITS.coordMax, sizeMin: FluyoAuthoring.LIMITS.sizeMin, sizeMax: FluyoAuthoring.LIMITS.sizeMax},
    primitives: [...EVENT_TYPE_PRIMITIVES],
    actions: [...SCENARIO_ACTIONS],
    cur: d.cur,
    theme: d.theme, customBg: d.customBg || "", themes: Object.keys(THEMES),
    eventTypes: d.eventTypes.map(et => ({id: et.id, name: et.name, sentenceTemplate: et.sentenceTemplate,
      symbol: eventSymbol(et), primitive: et.primitive, availability: et.availability,
      motion: et.motion || DEFAULT_EVENT_MOTION, spec: FluyoIntegrity.eventActionSpec(et), usedBy: eventTypeUseCount(et.id),
      presentation: eventTypePresentationDiff(et), usedIn: eventTypeUsagesIn(d, et.id)})),
    pages: d.pages.map(pg => ({
      name: pg.name,
      nodes: pg.nodes.map(n => ({id: n.id, label: n.label, shape: n.shape, icon: n.icon, x: n.x, y: n.y, w: n.w, h: n.h})),
      edges: pg.edges.map(e => ({id: e.id, from: e.from, to: e.to, label: e.label, route: e.route,
        fromSide: e.fromSide || null, toSide: e.toSide || null, waypoints: (e.waypoints || []).map(w => ({x: w.x, y: w.y}))})),
      behaviors: pg.behaviors,
      stories: pg.scenarios.map(sc => ({
        id: sc.id, name: sc.name, engineVersion: sc.engineVersion, stepCount: sc.steps.length,
        groups: storyboardGroups(sc.steps).map(g => ({at: g.at, steps: g.steps.map(s => ({
          id: s.id, action: s.action, eventTypeId: s.eventTypeId, nodeId: s.nodeId, edgeId: s.edgeId, state: s.state,
          sentence: FluyoStory.sentence(pg, s, eventTypeById(s.eventTypeId))}))}))
      }))
    }))
  };
})()`;

function validate(kernel: Kernel, document: unknown): ValidationReport {
  return kernel.call<ValidationReport>("FluyoIntegrity.validateProject(__a)", document);
}

/* ===================== describe_document ===================== */

export interface DescribeInput {
  document: unknown;
  pageIndex?: number;
  includeSteps?: boolean;
}

/** Rectángulo que ocupan las cajas de los nodos (x,y = centro; w,h). Solo agrega lo que ya está en el documento: no calcula rutas ni layout. */
function boundsOf(nodes: Array<{ x: number; y: number; w: number; h: number }>) {
  if (!nodes.length) return null;
  return {
    minX: Math.min(...nodes.map(n => n.x - n.w / 2)),
    minY: Math.min(...nodes.map(n => n.y - n.h / 2)),
    maxX: Math.max(...nodes.map(n => n.x + n.w / 2)),
    maxY: Math.max(...nodes.map(n => n.y + n.h / 2)),
  };
}

export function describeDocument(input: DescribeInput) {
  const kernel = createKernel();
  const validation = validate(kernel, input.document);
  const base = {
    engineVersion: validation.engineVersion,
    sourceSchemaVersion: validation.schemaVersion,
    kernelId: kernel.kernelId,
    revision: revisionOf(kernel, input.document),
    valid: validation.valid,
    errorCount: validation.errors.length,
    errors: validation.errors.slice(0, MAX_ERRORS_IN_DESCRIPTION),
  };
  const model = kernel.call<KernelModel | null>(READ_MODEL, input.document);
  if (!model) {
    return { readable: false as const, ...base, unmodeled: UNMODELED };
  }
  if (input.pageIndex !== undefined && !model.pages[input.pageIndex]) {
    throw new Error(`pageIndex ${input.pageIndex} fuera de rango (el documento tiene ${model.pages.length} página(s)).`);
  }
  const includeSteps = input.includeSteps ?? true;
  const executable = new Map(validation.stories.map(s => [`${s.pageIndex}:${s.storyId}`, s.executable]));
  const etById = new Map(model.eventTypes.map(et => [et.id, et]));

  const pages = model.pages
    .map((pg, pageIndex) => ({ pg, pageIndex }))
    .filter(({ pageIndex }) => input.pageIndex === undefined || pageIndex === input.pageIndex)
    .map(({ pg, pageIndex }) => {
      const label = new Map(pg.nodes.map(n => [n.id, oneLine(n.label)]));
      const initial = new Map(pg.behaviors.map(b => [b.nodeId, b.initialState]));
      const edgeById = new Map(pg.edges.map(e => [e.id, e]));
      const target = (s: { nodeId?: number; edgeId?: number }) => {
        if (s.edgeId !== undefined) {
          const e = edgeById.get(s.edgeId);
          return { kind: "connection" as const, id: s.edgeId, from: e?.from, to: e?.to, label: e ? `${label.get(e.from) ?? "?"} → ${label.get(e.to) ?? "?"}` : "?" };
        }
        return { kind: "element" as const, id: s.nodeId, label: label.get(s.nodeId as number) ?? "?" };
      };
      return {
        pageIndex,
        name: pg.name,
        nodes: pg.nodes.map((n, z) => ({
          id: n.id,
          z,
          label: oneLine(n.label),
          shape: n.shape,
          ...(n.icon ? { icon: n.icon } : {}),
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          availability: initial.get(n.id) ?? "UP",
        })),
        connections: pg.edges.map(e => ({
          id: e.id,
          from: e.from,
          to: e.to,
          fromLabel: label.get(e.from) ?? "?",
          toLabel: label.get(e.to) ?? "?",
          ...(e.label ? { label: e.label } : {}),
          route: e.route,
          ...(e.fromSide ? { fromSide: e.fromSide } : {}),
          ...(e.toSide ? { toSide: e.toSide } : {}),
          ...(e.waypoints.length ? { waypoints: e.waypoints } : {}),
        })),
        bounds: boundsOf(pg.nodes),
        initialUnavailable: pg.behaviors.filter(b => b.initialState === "DOWN").map(b => b.nodeId),
        stories: pg.stories.map(sc => {
          const last = sc.groups.length ? sc.groups[sc.groups.length - 1].at : 0;
          return {
            storyId: sc.id,
            name: sc.name,
            engineVersion: sc.engineVersion,
            stepCount: sc.stepCount,
            durationMs: last,
            executable: executable.get(`${pageIndex}:${sc.id}`) ?? false,
            ...(includeSteps
              ? {
                  moments: sc.groups.map(g => ({
                    at: g.at,
                    steps: g.steps.map(s => {
                      const et = s.eventTypeId === undefined ? undefined : etById.get(s.eventTypeId);
                      return {
                        stepId: s.id,
                        eventTypeId: s.eventTypeId ?? null,
                        event: et ? et.name : null,
                        action: s.action,
                        ...(s.state ? { state: s.state } : {}),
                        target: target(s),
                        sentence: s.sentence,
                      };
                    }),
                  })),
                }
              : {}),
          };
        }),
      };
    });

  return {
    readable: true as const,
    schemaVersion: model.documentVersion,
    ...base,
    currentPageIndex: model.cur,
    theme: model.theme,
    customBg: model.customBg,
    capabilities: {
      themes: model.themes,
      readsDocumentVersions: `1..${model.documentVersion}`,
      engineVersion: model.engineVersion,
      eventPrimitives: model.primitives,
      stepActions: model.actions,
      limits: model.limits,
      tools: ["describe_document", "run_story", "author_document"],
      authoring: true,
      authoringScopes: ["story", "page", "eventType", "document"],
    },
    eventTypes: model.eventTypes.map(et => {
      // Con pageIndex sólo se listan los usos de esa página (usedBy sigue siendo el total del documento).
      const uses = et.usedIn.filter(u => input.pageIndex === undefined || u.pageIndex === input.pageIndex);
      return {
      id: et.id,
      name: et.name,
      sentence: et.sentenceTemplate,
      symbol: et.symbol,
      primitive: et.primitive,
      action: et.spec?.action ?? null,
      target: et.spec?.target ?? null,
      ...(et.availability ? { availability: et.availability } : {}),
      motion: et.motion,
      ...(Object.keys(et.presentation).length ? { presentation: et.presentation } : {}),
      usedBy: et.usedBy,
      ...(uses.length
        ? {
            usedIn: uses.slice(0, MAX_USAGE_STORIES).map(u => ({
              pageIndex: u.pageIndex,
              storyId: u.storyId,
              stepIds: u.stepIds.slice(0, MAX_USAGE_STEPS),
            })),
          }
        : {}),
      ...(uses.length > MAX_USAGE_STORIES ? { usedInTruncated: uses.length - MAX_USAGE_STORIES } : {}),
      };
    }),
    pages,
    unmodeled: UNMODELED,
  };
}

/* ===================== run_story ===================== */

export interface RunStoryInput {
  document: unknown;
  pageIndex?: number;
  storyId: number;
}

interface RunModel {
  error?: "page_not_found" | "story_not_found";
  pageCount?: number;
  storyIds?: number[];
  pageIndex: number;
  pageName: string;
  story: { id: number; name: string; engineVersion: number };
  nodes: Array<{ id: number; label: string }>;
  edges: Array<{ id: number; from: number; to: number }>;
  eventTypes: Array<{ id: number; name: string; symbol: string }>;
  ordered: Array<{ id: number; sentence: string }>;
  run: { ok: true; trace: { engineVersion: number; scenarioId: number; events: Array<Record<string, unknown>> } } | { ok: false; errors: unknown[] };
  outcomes?: Array<Record<string, any>>;
  finalAvailability?: Record<string, string>;
}

/** Una sola ejecución en el kernel: normaliza, localiza la Historia, la ejecuta con FluyoStory.run y deriva
 *  el resultado por Step desde el Trace con FluyoStory.outcomes. */
const RUN_STORY = `(function(){
  let d; try { d = projectFromProjectData(__a.document).doc; } catch (e) { return null; }
  doc = d;
  const pageIndex = __a.pageIndex === null ? d.cur : __a.pageIndex;
  const pg = d.pages[pageIndex];
  if (!pg) return {error: "page_not_found", pageCount: d.pages.length};
  const sc = pg.scenarios.find(s => s.id === __a.storyId);
  if (!sc) return {error: "story_not_found", pageIndex, storyIds: pg.scenarios.map(s => s.id)};
  const run = FluyoStory.run(pg, sc);
  return {
    pageIndex, pageName: pg.name,
    story: {id: sc.id, name: sc.name, engineVersion: sc.engineVersion},
    nodes: pg.nodes.map(n => ({id: n.id, label: n.label})),
    edges: pg.edges.map(e => ({id: e.id, from: e.from, to: e.to})),
    eventTypes: d.eventTypes.map(et => ({id: et.id, name: et.name, symbol: eventSymbol(et)})),
    ordered: storyboardOrderedSteps(sc.steps).map(s => ({id: s.id, sentence: FluyoStory.sentence(pg, s, eventTypeById(s.eventTypeId))})),
    run,
    outcomes: run.ok ? FluyoStory.outcomes(run.trace, sc, pg) : undefined,
    finalAvailability: run.ok ? FluyoStory.finalAvailability(run.trace, pg) : undefined
  };
})()`;

export function runStory(input: RunStoryInput) {
  const kernel = createKernel();
  const validation = validate(kernel, input.document);
  const head = {
    engineVersion: validation.engineVersion,
    sourceSchemaVersion: validation.schemaVersion,
    kernelId: kernel.kernelId,
    revision: revisionOf(kernel, input.document),
    unmodeled: UNMODELED,
  };
  const model = kernel.call<RunModel | null>(RUN_STORY, {
    document: input.document,
    pageIndex: input.pageIndex ?? null,
    storyId: input.storyId,
  });
  if (!model) {
    return { executed: false as const, reason: "document_unreadable" as const, ...head, validation: { valid: false, errors: validation.errors } };
  }
  if (model.error === "page_not_found") {
    throw new Error(`pageIndex ${input.pageIndex} fuera de rango (el documento tiene ${model.pageCount} página(s)).`);
  }
  if (model.error === "story_not_found") {
    throw new Error(
      `No existe una Historia con storyId=${input.storyId} en la página ${model.pageIndex}. ` +
        `Historias de esa página: ${model.storyIds?.length ? model.storyIds.join(", ") : "ninguna"}. ` +
        "Los storyId son por página; usa describe_document para verlos."
    );
  }

  const executable = validation.stories.find(s => s.pageIndex === model.pageIndex && s.storyId === model.story.id)?.executable ?? false;
  const common = {
    ...head,
    page: { pageIndex: model.pageIndex, name: model.pageName },
    story: model.story,
    // Todos los errores del documento (otras Historias incluidas); `storyExecutable` dice si ESTA se puede ejecutar.
    validation: { valid: validation.valid, storyExecutable: executable, errors: validation.errors },
  };
  // La Historia sólo se entrega ejecutada si el motor Y la integridad la dan por válida.
  if (!executable || !model.run.ok || !model.outcomes) {
    return { executed: false as const, reason: "story_not_executable" as const, ...common };
  }

  const label = new Map(model.nodes.map(n => [n.id, oneLine(n.label)]));
  const edge = new Map(model.edges.map(e => [e.id, e]));
  const et = new Map(model.eventTypes.map(e => [e.id, e]));
  const sentence = new Map(model.ordered.map(s => [s.id, s.sentence]));
  const trace = model.run.trace;

  let moment = -1;
  let previousAt: number | undefined;
  const steps = model.outcomes.map(o => {
    if (o.at !== previousAt) { moment++; previousAt = o.at as number; }
    const { stepId, at, action, eventTypeId, edgeId, nodeId, eventIndexes, status, reason, reasonNodeId, from, to, state, nodeAvailability, note } = o;
    const e = edgeId === undefined ? undefined : edge.get(edgeId);
    const type = eventTypeId === undefined ? undefined : et.get(eventTypeId);
    return {
      stepId,
      at,
      moment,
      event: type ? { id: type.id, name: type.name, symbol: type.symbol } : null,
      action,
      target:
        edgeId !== undefined
          ? { kind: "connection", id: edgeId, from: e?.from, to: e?.to, label: e ? `${label.get(e.from) ?? "?"} → ${label.get(e.to) ?? "?"}` : "?" }
          : { kind: "element", id: nodeId, label: label.get(nodeId) ?? "?" },
      sentence: sentence.get(stepId) ?? "",
      outcome: {
        status,
        ...(reason !== undefined ? { reason } : {}),
        ...(reasonNodeId !== undefined ? { reasonNode: { id: reasonNodeId, label: label.get(reasonNodeId) ?? "?" } } : {}),
        ...(from !== undefined ? { from, to } : {}),
        ...(state !== undefined && status === "no_change" ? { state } : {}),
        ...(nodeAvailability !== undefined ? { nodeAvailability } : {}),
        ...(note !== undefined ? { note } : {}),
        eventIndexes,
      },
    };
  });

  return {
    executed: true as const,
    ...common,
    steps,
    // Disponibilidad de cada elemento al terminar la Historia (Behaviors iniciales + cambios del Trace).
    finalAvailability: model.nodes.map(n => ({ id: n.id, label: oneLine(n.label), availability: model.finalAvailability?.[String(n.id)] ?? "UP" })),
    trace: trace.events,
    traceEngineVersion: trace.engineVersion,
    traceDigest: `sha256:${sha256Hex(JSON.stringify(trace.events))}`,
  };
}

/* ===================== Resúmenes de texto (primer bloque de la respuesta) ===================== */

export function summarizeDescription(d: ReturnType<typeof describeDocument>): string {
  if (!d.readable) {
    return `Documento NO legible: ${d.errorCount} error(es) de validación (${[...new Set(d.errors.map(e => e.code))].join(", ")}).`;
  }
  const stories = d.pages.reduce((n, p) => n + p.stories.length, 0);
  const nodes = d.pages.reduce((n, p) => n + p.nodes.length, 0);
  const verdict = d.valid ? "válido" : `con ${d.errorCount} error(es) de integridad`;
  return (
    `Documento v${d.sourceSchemaVersion ?? "?"} (se lee como v${d.schemaVersion}, motor v${d.engineVersion}) ${verdict} — ` +
    `${d.pages.length} página(s), ${nodes} elemento(s), ${d.eventTypes.length} evento(s) de biblioteca, ${stories} Historia(s).`
  );
}

export function summarizeRun(r: ReturnType<typeof runStory>): string {
  if (!r.executed) {
    return r.reason === "document_unreadable"
      ? "No se ejecutó: el documento no es legible."
      : `No se ejecutó "${r.story.name}": la Historia no es válida (${r.validation.errors.filter(e => e.storyId === r.story.id).map(e => e.code).join(", ") || "ver validation"}).`;
  }
  const notDone = r.steps.filter(s => s.outcome.status === "not_completed").length;
  return (
    `Historia "${r.story.name}" ejecutada con el motor de Fluyo v${r.traceEngineVersion}: ${r.steps.length} paso(s), ` +
    `${notDone} no se completó(aron). El Trace (${r.trace.length} eventos) es el del motor, sin modificar.`
  );
}

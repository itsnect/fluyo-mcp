import { z } from "zod";

import { createKernel } from "./kernel.js";
import { BorderSchema, CreatableShapeSchema, FlowDirSchema, LabelPosSchema, RouteSchema, SideSchema } from "./model.js";
import { normalizeWith, revisionOfProject } from "./revision.js";
import { UNMODELED } from "./stories.js";

/**
 * author_document (FLUYO-017.2 Historias · 017.3 EventTypes · 018.2 crear y 018.3 modificar/eliminar nodos y conexiones): autoría sobre una COPIA, en un lote atómico.
 *
 * Todo el criterio —tiempos («esperas entre acontecimientos»), acción derivada del EventType, destinos,
 * duplicar/mover/eliminar, qué puede cambiar un EventType usado, integridad del estado final y la explicación
 * de por qué se rechaza— lo hace el kernel de Fluyo (FluyoAuthoring + FluyoIntegrity + model.js, los mismos que
 * usa el editor; crear, modificar y eliminar nodos y conexiones son createNodeIn/updateNodeIn/deleteNodeIn y sus equivalentes de conexión, de model.js). Este módulo sólo publica el schema de las operaciones, controla la revisión (concurrencia
 * optimista) y da forma a la respuesta. Es stateless: ninguna llamada deja nada para la siguiente.
 */

/* ===================== Schema publicado de las operaciones ===================== */

const Id = z.number().int().min(1);
const Ref = z.strictObject({ ref: z.string().min(1).max(40) });
const IdOrRef = z.union([Id, Ref]);
const PageIndex = z.number().int().min(0);
const Wait = z.number().int().min(0).max(86_400_000);
const Target = z
  .union([
    z.strictObject({ edgeId: IdOrRef }),
    z.strictObject({ nodeId: IdOrRef }),
    z.strictObject({ from: IdOrRef, to: IdOrRef }),
    Ref,
  ])
  .describe(
    "{edgeId} o {from,to} si el evento es de conexión; {nodeId} si es de elemento; o {ref} de la conexión/elemento creado antes en el lote (el evento decide cuál). " +
      "Los ids de edgeId/nodeId/from/to también admiten {ref}."
  );
const story = z.literal("story");
const page = z.literal("page");
const eventType = z.literal("eventType");

/* Eventos de la biblioteca (EventTypes, globales al documento). Las listas cerradas son las de la UI de Fluyo (model.js);
   un test las compara con las del kernel. El valor lo valida el kernel: aquí sólo se publica la forma. */
const Color = z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
const Size = z.enum(["small", "medium", "large"]);
const NodeEffects = z
  .strictObject({
    showSymbol: z.boolean(), symbolSize: Size, message: z.string().max(120), messageColor: Color, messageSize: Size,
    messageWeight: z.enum(["normal", "semibold", "bold"]), messageFont: z.enum(["default", "sans", "mono"]),
    messagePosition: z.enum(["above", "center", "below"]), highlight: z.boolean(), blink: z.boolean(), dim: z.boolean(),
    fillColor: Color, visualDuration: z.enum(["brief", "normal", "long", "custom"]), visualDurationMs: z.number().int().min(300).max(10000),
  })
  .partial();
const ConnectionEffects = z
  .strictObject({
    size: Size, style: z.enum(["direct", "smooth", "impulse"]), trail: z.enum(["none", "subtle", "marked"]),
    arrival: z.enum(["none", "pulse", "glow", "bounce"]), during: z.enum(["none", "halo", "breathe"]),
  })
  .partial();
const Presentation = z
  .strictObject({ nodeEffects: NodeEffects.optional(), connectionEffects: ConnectionEffects.optional() })
  .describe("Efectos visuales (parche sobre los actuales): {connectionEffects} para eventos FLOW, {nodeEffects} para OCCURRENCE/SET_AVAILABILITY.");
const Primitive = z.enum(["FLOW", "OCCURRENCE", "SET_AVAILABILITY"]);
/** Campos de un evento; en create_event_type name, sentence y primitive son obligatorios; en update_event_type todos opcionales. */
const EventFields = {
  name: z.string().min(1).max(60),
  sentence: z.string().min(1).max(200).describe("Frase con marcadores {source}, {target}, {name}."),
  symbol: z.string().max(16).optional(),
  motion: z.enum(["fast", "normal", "slow"]).optional().describe("Sólo FLOW."),
  availability: z.enum(["UP", "DOWN"]).optional().describe("Sólo SET_AVAILABILITY: el estado que provoca."),
  presentation: Presentation.optional(),
};
/* Diagrama (018.2). Sólo la FORMA de lo que escribe el agente, con topes de tamaño para que un spec gigante se rechace
   antes de construir nada. Los valores los decide el dominio (model.js): forma, ids, source/target, auto-lazo, defaults.
   Los campos son los del documento (w/h, no width/height) y los colores van tal cual (hex): no se traducen nombres. */
const Text = (max: number) => z.string().max(max);
const NodeSpec = z
  .strictObject({
    shape: CreatableShapeSchema.describe("Todas las formas menos 'image' (necesita bytes de imagen; igual que create_diagram)."),
    x: z.number(),
    y: z.number(),
    id: Id.optional().describe("Id estructural explícito (opcional; por defecto el siguiente de la página). No puede estar en uso."),
    w: z.number().optional(),
    h: z.number().optional(),
    label: Text(500).optional(),
    color: Text(40).nullable().optional(),
    fill: Text(40).nullable().optional(),
    border: BorderSchema.optional(),
    lblPos: LabelPosSchema.optional(),
    textBg: Text(40).nullable().optional(),
    textColor: Text(40).nullable().optional(),
    font: Text(120).nullable().optional(),
    bold: z.boolean().optional(),
    pulse: z.boolean().optional(),
    order: z.number().optional(),
    fs: z.number().nullable().optional(),
    icon: Text(80).optional(),
    anim: Text(80).optional(),
    tint: z.boolean().optional(),
    lang: Text(40).nullable().optional(),
    keywords: z.array(Text(80)).max(200).nullable().optional(),
    kwBg: Text(40).nullable().optional(),
    kwColor: Text(40).nullable().optional(),
  })
  .describe("Campos del elemento: shape, x, y obligatorios; el resto toma los defaults del editor. 'ref' NO va aquí: va en la operación.");
const ConnectionSpec = z
  .strictObject({
    id: Id.optional(),
    fromSide: SideSchema.nullable().optional(),
    toSide: SideSchema.nullable().optional(),
    route: RouteSchema.optional(),
    waypoints: z.array(z.strictObject({ x: z.number(), y: z.number() })).max(100).optional(),
    label: Text(500).optional(),
    font: Text(120).nullable().optional(),
    bold: z.boolean().optional(),
    animated: z.boolean().optional(),
    dashed: z.boolean().optional(),
    startArrow: z.boolean().optional(),
    endArrow: z.boolean().optional(),
    flowDir: FlowDirSchema.optional(),
    lineColor: Text(40).nullable().optional(),
    dotColor: Text(40).nullable().optional(),
    fs: z.number().nullable().optional(),
    speedFac: z.number().optional(),
    dots: z.number().int().optional(),
    dotsGlobal: z.boolean().optional(),
  })
  .describe("Campos opcionales de la conexión (lados, ruta, etiqueta, estilo); sin ellos, los defaults del editor. 'ref', 'source' y 'target' NO van aquí.");
/* Modificar (018.3): un PARCHE con solo las claves que la UI del editor escribe (lista cerrada en model.js). id, icon, anim e img no se modifican;
   la forma solo cambia entre las del selector (no desde/hacia image, icon, anim). null vacía lo que es anulable; un campo ausente no cambia. */
const EditableShapeSchema = z.enum(["rect", "cylinder", "diamond", "circle", "hex", "text", "code"]);
const NodePatch = z
  .strictObject({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    shape: EditableShapeSchema.optional().describe("Solo entre las formas del selector; un icono, GIF o imagen no cambia de forma."),
    label: Text(500).optional(),
    color: Text(40).optional(),
    fill: Text(40).nullable().optional(),
    border: z.enum(["solid", "dashed", "dotted", "none"]).optional(),
    lblPos: LabelPosSchema.optional(),
    textBg: Text(40).nullable().optional(),
    textColor: Text(40).nullable().optional(),
    font: Text(120).nullable().optional(),
    bold: z.boolean().optional(),
    pulse: z.boolean().optional(),
    order: z.number().optional(),
    fs: z.number().nullable().optional(),
    tint: z.boolean().optional().describe("Solo en iconos."),
    lang: Text(40).nullable().optional().describe("Solo en nodos de código."),
    keywords: z.array(Text(80)).max(200).nullable().optional().describe("Solo en nodos de código."),
    kwBg: Text(40).nullable().optional().describe("Solo en nodos de código."),
    kwColor: Text(40).nullable().optional().describe("Solo en nodos de código."),
  })
  .describe("Campos del elemento a cambiar (mover = x/y; redimensionar = w/h). Al menos uno. No se toca nada que no se indique; las conexiones y sus waypoints no cambian.");
const ConnectionPatch = ConnectionSpec.omit({ id: true }).describe(
  "Campos de la conexión a cambiar (label, route, fromSide, toSide, waypoints, estilo). Los waypoints solo cambian si los envías (waypoints:[] = ruta automática). 'source'/'target' van en la operación."
);
const LocalRef = z.string().min(1).max(40);
const Endpoint = z
  .union([z.strictObject({ ref: LocalRef }), z.strictObject({ id: Id })])
  .describe("{ref} de un elemento creado ANTES en el lote, en la misma página; o {id} de un elemento existente.");
const storyRef = { pageIndex: PageIndex, storyId: IdOrRef };
const stepRef = { ...storyRef, stepId: IdOrRef };

export const AuthoringOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("create_story"), scope: story, pageIndex: PageIndex, name: z.string().min(1).max(120).optional(), ref: z.string().min(1).max(40).optional() }),
  z.strictObject({ op: z.literal("rename_story"), scope: story, ...storyRef, name: z.string().min(1).max(120) }),
  z.strictObject({ op: z.literal("duplicate_story"), scope: story, ...storyRef, name: z.string().min(1).max(120).optional(), ref: z.string().min(1).max(40).optional() }),
  z.strictObject({ op: z.literal("delete_story"), scope: story, ...storyRef }),
  z.strictObject({
    op: z.literal("add_step"),
    scope: story,
    ...storyRef,
    eventTypeId: IdOrRef,
    target: Target,
    waitMs: Wait.optional(),
    placement: z
      .strictObject({ sameMomentAs: IdOrRef, position: z.enum(["before", "after"]).optional() })
      .optional(),
    ref: z.string().min(1).max(40).optional(),
  }),
  z.strictObject({ op: z.literal("remove_step"), scope: story, ...stepRef }),
  z.strictObject({
    op: z.literal("move_step"),
    scope: story,
    ...stepRef,
    direction: z.enum(["earlier", "later"]).optional(),
    to: z.union([z.strictObject({ gapIndex: z.number().int().min(0) }), z.strictObject({ sameMomentAs: IdOrRef, after: z.boolean().optional() })]).optional(),
  }),
  z.strictObject({ op: z.literal("duplicate_step"), scope: story, ...stepRef, ref: z.string().min(1).max(40).optional() }),
  z.strictObject({ op: z.literal("retarget_step"), scope: story, ...stepRef, target: Target }),
  z.strictObject({ op: z.literal("set_wait"), scope: story, ...stepRef, waitMs: Wait }),
  z.strictObject({ op: z.literal("create_node"), scope: page, pageIndex: PageIndex, spec: NodeSpec, ref: LocalRef.optional().describe("Nombre del lote (no se guarda en el documento): luego puedes usar {ref} como source/target en la misma página.") }),
  z.strictObject({ op: z.literal("create_connection"), scope: page, pageIndex: PageIndex, source: Endpoint, target: Endpoint, spec: ConnectionSpec.optional(), ref: LocalRef.optional() }),
  z.strictObject({ op: z.literal("update_node"), scope: page, pageIndex: PageIndex, node: Endpoint.describe("{id} del elemento existente o {ref} de uno creado antes en el lote (misma página)."), spec: NodePatch }),
  z.strictObject({
    op: z.literal("update_connection"),
    scope: page,
    pageIndex: PageIndex,
    connection: Endpoint.describe("{id} de la conexión existente o {ref} de una creada antes en el lote (misma página)."),
    source: Endpoint.optional().describe("Retarget: nuevo origen."),
    target: Endpoint.optional().describe("Retarget: nuevo destino."),
    spec: ConnectionPatch.optional(),
  }),
  z.strictObject({ op: z.literal("delete_node"), scope: page, pageIndex: PageIndex, node: Endpoint.describe("Elimina el elemento, sus conexiones y su disponibilidad inicial. Rechazado (REFERENCED_ENTITY) si alguna Historia lo usa en el estado final.") }),
  z.strictObject({ op: z.literal("delete_connection"), scope: page, pageIndex: PageIndex, connection: Endpoint.describe("Rechazado (REFERENCED_ENTITY) si alguna Historia la usa en el estado final.") }),
  z.strictObject({ op: z.literal("set_initial_availability"), scope: page, pageIndex: PageIndex, nodeId: IdOrRef, state: z.enum(["UP", "DOWN"]) }),
  z.strictObject({ op: z.literal("create_event_type"), scope: eventType, ...EventFields, primitive: Primitive, ref: z.string().min(1).max(40).optional() }),
  z.strictObject({
    op: z.literal("update_event_type"),
    scope: eventType,
    eventTypeId: IdOrRef,
    ...EventFields,
    name: EventFields.name.optional(),
    sentence: EventFields.sentence.optional(),
    primitive: Primitive.optional(),
  }),
  z.strictObject({ op: z.literal("delete_event_type"), scope: eventType, eventTypeId: IdOrRef }),
]);

export type AuthoringOperation = z.infer<typeof AuthoringOperationSchema>;

/* ===================== author_document ===================== */

export interface AuthorInput {
  document: unknown;
  baseRevision: string;
  operations: unknown[];
  dryRun?: boolean;
}

interface KernelApply {
  ok: boolean;
  project?: unknown;
  changes?: Array<Record<string, unknown>>;
  refs?: Array<{ ref: string; type: "node" | "connection"; pageIndex: number; id: number }>;
  touched?: Array<{ pageIndex: number; storyId: number }>;
  validation?: { valid: boolean; preexistingErrors: number };
  errors?: Array<Record<string, unknown>>;
}

export function authorDocument(input: AuthorInput) {
  const kernel = createKernel();
  const head = { engineVersion: kernel.call<number>("FluyoScenarios.ENGINE_VERSION"), kernelId: kernel.kernelId };
  const rejected = (errors: Array<Record<string, unknown>>, actualRevision?: string | null) => ({
    ok: false as const,
    valid: false as const,
    dryRun: input.dryRun ?? false,
    baseRevision: input.baseRevision,
    ...(actualRevision ? { actualRevision } : {}),
    ...head,
    errors,
    note: "No se devolvió ningún documento: el original no se modificó.",
  });

  const base = normalizeWith(kernel, input.document);
  if (base === null) {
    return rejected([{ code: "DOCUMENT_UNREADABLE", message: "El documento no es legible: usa describe_document para ver los errores de validación." }]);
  }
  const actual = revisionOfProject(base);
  if (actual !== input.baseRevision) {
    return rejected(
      [{
        code: "REVISION_MISMATCH",
        message: "baseRevision no coincide con el documento recibido: el documento cambió o no es el que describiste. Vuelve a leerlo con describe_document.",
        expected: input.baseRevision,
        actual,
      }],
      actual
    );
  }

  const result = kernel.call<KernelApply>("FluyoAuthoring.apply(__a.p, __a.o)", { p: input.document, o: input.operations });
  if (!result.ok) return rejected(result.errors ?? [{ code: "INVALID_OPERATION", message: "El lote no se pudo aplicar." }]);

  const resultRevision = revisionOfProject(result.project);
  return {
    ok: true as const,
    valid: true as const,
    dryRun: input.dryRun ?? false,
    schemaVersion: 5,
    ...head,
    baseRevision: input.baseRevision,
    resultRevision,
    changed: resultRevision !== input.baseRevision,
    changes: result.changes ?? [],
    refs: result.refs ?? [],
    touchedStories: result.touched ?? [],
    validation: result.validation ?? { valid: true, preexistingErrors: 0 },
    unmodeled: UNMODELED,
    ...(input.dryRun ? {} : { document: result.project }),
  };
}

export function summarizeAuthoring(r: ReturnType<typeof authorDocument>): string {
  if (!r.ok) {
    const first = r.errors[0] ?? {};
    return `Lote RECHAZADO (${String(first.code ?? "ERROR")}): ${String(first.message ?? "")} El documento original no se modificó y no se devuelve ninguno.`;
  }
  const n = r.changes.length;
  const count = (kind: string, flag: "created" | "updated" | "deleted") => r.changes.filter(c => c.entityKind === kind && c[flag] === true).length;
  const part = (flag: "created" | "updated" | "deleted", word: string) =>
    count("node", flag) + count("connection", flag) > 0 ? `${count("node", flag)} elemento(s) y ${count("connection", flag)} conexión(es) ${word}. ` : "";
  const diagram = part("created", "creados") + part("updated", "modificados") + part("deleted", "eliminados");
  return (
    `${r.dryRun ? "Simulación (dryRun): " : ""}${n} operación(es) aplicada(s) sobre una copia; ` +
    diagram +
    `${r.touchedStories.length} Historia(s) creada(s)/editada(s), todas ejecutables. ` +
    `${r.dryRun ? "No se devuelve documento." : "Documento nuevo en el 2.º bloque."} resultRevision ${r.resultRevision.slice(0, 19)}…`
  );
}

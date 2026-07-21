import { z } from "zod";

/* ===================== Documento Fluyo (formato .fluyo.json) ===================== */

export const ShapeSchema = z.enum(["rect", "cylinder", "diamond", "circle", "hex", "text", "icon", "image"]);
/** Formas que se pueden crear/editar vía MCP. Se excluye 'image': ese shape depende de
 *  datos binarios pegados a mano en la app (Ctrl+V / arrastrar archivo) y no tiene forma
 *  de recibirse por este canal de texto. Los documentos existentes con nodos 'image'
 *  igual se leen y editan sin problema vía FluyoNodeSchema (round-trip completo). */
export const CreatableShapeSchema = z.enum(["rect", "cylinder", "diamond", "circle", "hex", "text", "icon"]);
export const ThemeSchema = z.enum(["dark", "crema", "claro"]);
export const SideSchema = z.enum(["n", "s", "e", "w"]);
export const RouteSchema = z.enum(["straight", "ortho"]);
export const FlowDirSchema = z.enum(["normal", "reverse", "alternate"]);

export const WaypointSchema = z.object({ x: z.number(), y: z.number() });

export const FluyoNodeSchema = z.object({
  id: z.number(),
  shape: ShapeSchema,
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  label: z.string().default(""),
  color: z.string(),
  pulse: z.boolean().default(false),
  order: z.number().default(0),
  icon: z.string().optional(),
  img: z.string().optional(),
  fs: z.number().nullable().optional(),
});

export const FluyoEdgeSchema = z.object({
  id: z.number(),
  from: z.number(),
  to: z.number(),
  fromSide: SideSchema.nullable().default(null),
  toSide: SideSchema.nullable().default(null),
  route: RouteSchema.default("straight"),
  waypoints: z.array(WaypointSchema).default([]),
  label: z.string().default(""),
  animated: z.boolean().default(true),
  dashed: z.boolean().default(false),
  startArrow: z.boolean().default(false),
  endArrow: z.boolean().default(true),
  flowDir: FlowDirSchema.default("normal"),
  lineColor: z.string().nullable().optional(),
  dotColor: z.string().nullable().optional(),
  fs: z.number().nullable().optional(),
});

export const FluyoPageSchema = z.object({
  name: z.string(),
  nodes: z.array(FluyoNodeSchema),
  edges: z.array(FluyoEdgeSchema),
  nextId: z.number(),
});

export const FluyoDocSchema = z.object({
  theme: ThemeSchema,
  pages: z.array(FluyoPageSchema).min(1),
  cur: z.number().default(0),
});

export const FluyoSettingsSchema = z.object({
  speed: z.number().default(0.5),
  dots: z.number().default(3),
  build: z.boolean().default(false),
  stagger: z.number().default(0.45),
  grid: z.boolean().default(true),
});

/** Formato completo tal como lo produce/lee "Guardar" / "Abrir" en fluyo.html (serializeProject). */
export const FluyoProjectSchema = z.object({
  version: z.number().default(3),
  app: z.literal("fluyo").default("fluyo"),
  doc: FluyoDocSchema,
  settings: FluyoSettingsSchema,
});

export type Shape = z.infer<typeof ShapeSchema>;
export type CreatableShape = z.infer<typeof CreatableShapeSchema>;
export type ThemeName = z.infer<typeof ThemeSchema>;
export type Side = z.infer<typeof SideSchema>;
export type FluyoNode = z.infer<typeof FluyoNodeSchema>;
export type FluyoEdge = z.infer<typeof FluyoEdgeSchema>;
export type FluyoPage = z.infer<typeof FluyoPageSchema>;
export type FluyoDoc = z.infer<typeof FluyoDocSchema>;
export type FluyoProject = z.infer<typeof FluyoProjectSchema>;

/* ===================== Inputs de alto nivel para create_diagram ===================== */

const commonNodeFields = {
  key: z.string().describe("Identificador temporal usado solo dentro de esta llamada para que las aristas referencien este nodo (ej: 'gateway', 'kafka')."),
  shape: CreatableShapeSchema,
  label: z.string().default(""),
  color: z.string().optional().describe("Nombre semántico (Servicio, Eventos / Kafka, Datos, IA, Alerta, Externo, Config) o hex (#6a9fb5)."),
  icon: z.string().optional().describe("Solo si shape='icon'. Usa list_icons para ver claves válidas (kafka, gke, cloudsql, lambda, s3, azvm, etc)."),
  x: z.number().optional().describe("Posición X manual. Si se omite junto con y, se calcula con auto-layout."),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  pulse: z.boolean().optional().describe("Resalta el nodo con un pulso de brillo (útil para el componente central de un diagrama)."),
  order: z.number().optional().describe("Orden de aparición si se anima 'build' (0 = primero)."),
  fs: z.number().optional().describe("Tamaño de fuente manual del texto."),
};

export const NodeSpecSchema = z.object(commonNodeFields);
export type NodeSpec = z.infer<typeof NodeSpecSchema>;
/** Igual que NodeSpec pero con 'label' opcional: usado internamente (ej. al construir un
 *  nodo desde una operación add_node, donde 'label' no pasó por el default de zod). */
export type NodeBuildSpec = Omit<NodeSpec, "label"> & { label?: string };

const commonEdgeFields = {
  from: z.string().describe("key del nodo de origen (el mismo 'key' usado en nodes)."),
  to: z.string().describe("key del nodo de destino."),
  label: z.string().optional(),
  route: RouteSchema.optional().describe("'ortho' para líneas en ángulo recto (recomendado en diagramas técnicos), 'straight' para línea directa."),
  dashed: z.boolean().optional(),
  animated: z.boolean().optional().describe("Puntos animados fluyendo por la línea (default true)."),
  flowDir: FlowDirSchema.optional(),
  fromSide: SideSchema.optional(),
  toSide: SideSchema.optional(),
  startArrow: z.boolean().optional(),
  endArrow: z.boolean().optional(),
  lineColor: z.string().optional(),
  dotColor: z.string().optional(),
  fs: z.number().optional(),
};

export const EdgeSpecSchema = z.object(commonEdgeFields);
export type EdgeSpec = z.infer<typeof EdgeSpecSchema>;

export const CreateDiagramInputShape = {
  pageName: z.string().default("Página 1"),
  theme: ThemeSchema.default("dark"),
  grid: z.boolean().default(true),
  build: z.boolean().default(false).describe("Si es true, los nodos aparecen escalonados según 'order' al reproducir la animación."),
  autoLayout: z.boolean().default(true).describe("Si es true, calcula x/y de los nodos que no las traigan explícitas, en capas de izquierda a derecha según el grafo de aristas."),
  nodes: z.array(NodeSpecSchema).min(1),
  edges: z.array(EdgeSpecSchema).default([]),
};

/* ===================== Operaciones de edición ===================== */

const editNodeFields = {
  label: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  pulse: z.boolean().optional(),
  order: z.number().optional(),
  fs: z.number().optional(),
};

const editEdgeFields = {
  label: z.string().optional(),
  route: RouteSchema.optional(),
  dashed: z.boolean().optional(),
  animated: z.boolean().optional(),
  flowDir: FlowDirSchema.optional(),
  fromSide: SideSchema.optional(),
  toSide: SideSchema.optional(),
  startArrow: z.boolean().optional(),
  endArrow: z.boolean().optional(),
  lineColor: z.string().optional(),
  dotColor: z.string().optional(),
  fs: z.number().optional(),
};

export const OperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_node"), key: z.string().describe("Referencia temporal para usar en add_edge dentro de la misma llamada."), ...editNodeFields, shape: CreatableShapeSchema }),
  z.object({ op: z.literal("update_node"), id: z.number(), ...editNodeFields, shape: CreatableShapeSchema.optional() }),
  z.object({ op: z.literal("remove_node"), id: z.number() }),
  z.object({ op: z.literal("add_edge"), from: z.union([z.number(), z.string()]).describe("id numérico de un nodo existente, o key de un nodo agregado en esta misma llamada."), to: z.union([z.number(), z.string()]), ...editEdgeFields }),
  z.object({ op: z.literal("update_edge"), id: z.number(), ...editEdgeFields }),
  z.object({ op: z.literal("remove_edge"), id: z.number() }),
  z.object({ op: z.literal("set_theme"), theme: ThemeSchema }),
  z.object({ op: z.literal("rename_page"), name: z.string() }),
  z.object({ op: z.literal("relayout") }).describe("Recalcula x/y de todos los nodos de la página en capas, a partir de las aristas actuales."),
]);
export type Operation = z.infer<typeof OperationSchema>;

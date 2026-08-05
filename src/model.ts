import { z } from "zod";

import { CODE_LANGS, SHAPE_NAMES, SIDES, THEME_NAMES } from "./generated/config.js";

/** Los presets de lenguaje salen del codegen, así que el enum publicado en
 *  tools/list sigue a `js/config.js` sin que haya que tocar nada aquí. */
const CODE_LANG_NAMES = Object.keys(CODE_LANGS) as [string, ...string[]];

/* ═══════════════════════════════════════════════════════════════════════════
   Documento Fluyo (formato .fluyo.json v3)

   Dos reglas gobiernan este archivo:

   1. LIBERAL AL LEER, ESTRICTO AL ESCRIBIR. Los schemas del *documento* aceptan
      lo que la app produzca, sin adivinar qué valores son legales; los schemas de
      *entrada* (lo que el modelo rellena) sí usan enums cerrados, que es donde la
      restricción sirve de guía. Rechazar un documento real de un usuario porque
      Fluyo estrenó un valor de borde sería el peor resultado posible.

   2. TODO LLEVA .passthrough(). Los campos explícitos documentan la entrada y
      permiten editarla; el passthrough es la red que evita que la próxima función
      de Fluyo desaparezca en silencio del documento del usuario. Hacen falta los
      dos: sin campos explícitos el modelo va a ciegas, y sin passthrough cualquier
      campo nuevo se borra sin avisar. Eso último ya pasó — ver DRIFT.md §7.2.

   Las listas de formas, temas y anclas salen de src/generated/config.ts, así que
   una forma nueva en Fluyo queda aceptada aquí en cuanto se corre `sync:config`.
   ═══════════════════════════════════════════════════════════════════════════ */

export const ShapeSchema = z.enum(SHAPE_NAMES);
export const ThemeSchema = z.enum(THEME_NAMES);
export const SideSchema = z.enum(SIDES);

/** Todas las formas menos `image`: ese shape lleva los bytes de la imagen dentro
 *  (`img`, un data URI que se pega o se arrastra en la app) y no hay forma de
 *  recibirlo por un canal de texto. Los documentos que ya tengan nodos `image` se
 *  leen, editan y exportan con normalidad. */
export const CreatableShapeSchema = ShapeSchema.exclude(["image"]);

export const RouteSchema = z.enum(["straight", "ortho"]);
export const FlowDirSchema = z.enum(["normal", "reverse", "alternate"]);
export const BorderSchema = z.enum(["solid", "dashed", "dotted"]);
export const LabelPosSchema = z.enum(["center", "top", "bottom", "left", "right"]);

export const WaypointSchema = z.object({ x: z.number(), y: z.number() }).passthrough();

export const FluyoNodeSchema = z
  .object({
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
    /** Clave del GIF animado, solo en nodos `shape:"anim"`. */
    anim: z.string().optional(),
    /** Solo en `shape:"icon"`. Si es true, la pastilla del ícono se pinta con
     *  `color` en vez de con su color original. */
    tint: z.boolean().optional(),
    fs: z.number().nullable().optional(),

    /* Estilo. Todos opcionales y sin `.default()` a propósito: si el documento no
       los trae, el round-trip no debe inventarlos. */
    fill: z.string().nullable().optional(),
    border: z.string().optional(),
    lblPos: z.string().optional(),
    textBg: z.string().nullable().optional(),
    textColor: z.string().nullable().optional(),
    font: z.string().nullable().optional(),
    bold: z.boolean().optional(),

    /* Solo en `shape:"code"`. Liberales igual que el resto del documento: si la
       app estrena un preset de lenguaje, un diagrama real no debe rebotar. */
    lang: z.string().nullable().optional(),
    keywords: z.array(z.string()).nullable().optional(),
    kwBg: z.string().nullable().optional(),
    kwColor: z.string().nullable().optional(),
  })
  .passthrough();

export const FluyoEdgeSchema = z
  .object({
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

    /* Tipografía y animación por arista. Opcionales sin default, igual que arriba. */
    font: z.string().nullable().optional(),
    bold: z.boolean().optional(),
    /** Multiplicador de velocidad de los puntos (1–4 en la app). */
    speedFac: z.number().nullable().optional(),
    /** Número de puntos propio; solo manda si `dotsGlobal` es false. */
    dots: z.number().nullable().optional(),
    dotsGlobal: z.boolean().optional(),
  })
  .passthrough();

export const FluyoPageSchema = z
  .object({
    name: z.string(),
    nodes: z.array(FluyoNodeSchema),
    edges: z.array(FluyoEdgeSchema),
    nextId: z.number(),
  })
  .passthrough();

export const FluyoDocSchema = z
  .object({
    theme: ThemeSchema,
    pages: z.array(FluyoPageSchema).min(1),
    cur: z.number().default(0),
    /** Color de fondo que sobrescribe el del tema. "" = usar el del tema. */
    customBg: z.string().optional(),
  })
  .passthrough();

export const FluyoSettingsSchema = z
  .object({
    speed: z.number().default(0.5),
    dots: z.number().default(3),
    build: z.boolean().default(false),
    stagger: z.number().default(0.45),
    grid: z.boolean().default(true),
    /** Ajuste a rejilla al mover nodos. */
    snap: z.boolean().optional(),
    /** Tipografía global; los nodos con `font: null` la heredan. */
    font: z.string().optional(),
    /** Modo "pelota única por ruta" en vez de puntos por flecha. */
    single: z.boolean().optional(),
  })
  .passthrough();

/** Formato completo tal como lo produce/lee "Guardar" / "Abrir" en la app
 *  (`serializeProject()` en fluyo/js/state.js). */
export const FluyoProjectSchema = z
  .object({
    version: z.number().default(3),
    app: z.literal("fluyo").default("fluyo"),
    doc: FluyoDocSchema,
    settings: FluyoSettingsSchema,
  })
  .passthrough();

/**
 * Envoltorio del documento para la ENTRADA de las tools.
 *
 * Documenta la forma sin publicar el schema entero, por dos razones:
 *
 *  · El JSON Schema completo del documento son cientos de líneas que viajarían en
 *    cada `tools/list`, y el modelo nunca escribe este objeto a mano: lo reenvía
 *    tal cual lo recibió.
 *  · Si la validación profunda la hiciera el SDK, un documento inválido se
 *    rechazaría con el volcado JSON de issues de Zod, que es justo el mensaje
 *    ilegible que este servidor quiere dejar de producir.
 *
 * Así que aquí solo se comprueba que sea un objeto, y la validación de verdad la
 * hace el handler con `FluyoProjectSchema`, que sí puede explicarse (ver errors.ts).
 *
 * Dónde queda la frontera: si `document` no es un objeto (un texto, una lista), lo
 * rechaza el SDK antes de llegar al handler y el mensaje es el suyo, no el nuestro.
 * Se acepta: "expected object, received string" ya es claro, y el caso solo aparece
 * si alguien pasa el JSON sin parsear. Todo input que SEA un objeto —que es donde
 * están los fallos interesantes— llega al handler y se explica en prosa.
 */
export const DocumentInputSchema = z
  .looseObject({
    app: z.literal("fluyo").optional(),
    version: z.number().optional(),
    doc: z
      .looseObject({
        theme: z.string().optional(),
        pages: z.array(z.unknown()).optional(),
        cur: z.number().optional(),
        customBg: z.string().optional(),
      })
      .optional(),
    settings: z.looseObject({}).optional(),
  })
  .describe(
    "El documento Fluyo completo (.fluyo.json): el objeto que devuelve create_diagram / edit_diagram, " +
      "o el contenido de un archivo guardado con Ctrl+S en la app."
  );

export type Shape = z.infer<typeof ShapeSchema>;
export type CreatableShape = z.infer<typeof CreatableShapeSchema>;
export type ThemeName = z.infer<typeof ThemeSchema>;
export type Side = z.infer<typeof SideSchema>;
export type FluyoNode = z.infer<typeof FluyoNodeSchema>;
export type FluyoEdge = z.infer<typeof FluyoEdgeSchema>;
export type FluyoPage = z.infer<typeof FluyoPageSchema>;
export type FluyoDoc = z.infer<typeof FluyoDocSchema>;
export type FluyoProject = z.infer<typeof FluyoProjectSchema>;

/* ═══════════════════════════════════════════════════════════════════════════
   Entradas de alto nivel — aquí sí, enums cerrados
   ═══════════════════════════════════════════════════════════════════════════ */

const commonNodeFields = {
  key: z.string().describe("Identificador temporal usado solo dentro de esta llamada para que las aristas referencien este nodo (ej: 'gateway', 'kafka')."),
  shape: CreatableShapeSchema,
  /** Sin default: si se omite, buildNode aplica el mismo que `newNode()` en la app
   *  ("Nodo" en una forma, "Texto" en un texto, vacío en iconos y GIFs). */
  label: z.string().optional(),
  color: z.string().optional().describe("Nombre semántico (usa list_colors) o hex (#6a9fb5)."),
  icon: z.string().optional().describe("Solo si shape='icon'. Usa list_icons para ver claves válidas (kafka, gke, cloudsql, lambda, s3, azvm, etc)."),
  anim: z.string().optional().describe("Solo si shape='anim'. Usa list_anims para ver claves válidas (spinner, progress, check, etc)."),
  tint: z.boolean().optional().describe("Solo si shape='icon'. Tiñe la pastilla del ícono con `color` en vez de dejarle el suyo. Por defecto false: los íconos conservan su color de marca."),
  x: z.number().optional().describe("Posición X manual. Si se omite junto con y, se calcula con auto-layout."),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  pulse: z.boolean().optional().describe("Resalta el nodo con un pulso de brillo (útil para el componente central de un diagrama)."),
  order: z.number().optional().describe("Orden de aparición si se anima 'build' (0 = primero)."),
  fs: z.number().optional().describe("Tamaño de fuente manual del texto."),
  fill: z.string().optional().describe("Relleno de la forma: hex, o 'none' para dejarla hueca. Por defecto, el color del nodo al 18% de opacidad."),
  border: BorderSchema.optional().describe("Estilo del borde de la forma."),
  lblPos: LabelPosSchema.optional().describe("Dónde va la etiqueta dentro de la forma."),
  textBg: z.string().optional().describe("Color de una caja de fondo tras el texto (hex)."),
  textColor: z.string().optional().describe("Color del texto. Por defecto lo decide el tema."),
  font: z.string().optional().describe("Familia tipográfica. Usa list_fonts; si se omite, hereda la global."),
  bold: z.boolean().optional(),

  /* Solo tienen efecto en shape:"code". */
  lang: z.enum(CODE_LANG_NAMES).optional()
    .describe("Solo en shape='code'. Preset de palabras clave a resaltar. 'sql' cubre SQL y ksqlDB; 'none' desactiva el resaltado. Por defecto 'sql'."),
  keywords: z.array(z.string()).optional()
    .describe("Solo en shape='code'. Lista propia de palabras clave; si se da y no está vacía, sustituye al preset de 'lang'."),
  kwBg: z.string().optional()
    .describe("Solo en shape='code'. Color de fondo del resaltado de las palabras clave. Por defecto lo pone el tema."),
  kwColor: z.string().optional()
    .describe("Solo en shape='code'. Color del texto de las palabras clave resaltadas. Por defecto lo pone el tema."),
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
  font: z.string().optional().describe("Familia tipográfica de la etiqueta. Usa list_fonts."),
  bold: z.boolean().optional(),
  speedFac: z.number().min(1).max(4).optional().describe("Multiplica la velocidad de los puntos de esta arista (1–4)."),
  dots: z.number().int().min(1).max(6).optional().describe("Número de puntos propio de esta arista. Requiere dotsGlobal=false."),
  dotsGlobal: z.boolean().optional().describe("Si es false, esta arista usa su propio 'dots' en vez del global."),
};

export const EdgeSpecSchema = z.object(commonEdgeFields);
export type EdgeSpec = z.infer<typeof EdgeSpecSchema>;

export const CreateDiagramInputShape = {
  pageName: z.string().default("Página 1"),
  theme: ThemeSchema.default("dark"),
  grid: z.boolean().default(true),
  build: z.boolean().default(false).describe("Si es true, los nodos aparecen escalonados según 'order' al reproducir la animación."),
  autoLayout: z.boolean().default(true).describe("Si es true, calcula x/y de los nodos que no las traigan explícitas, en capas de izquierda a derecha según el grafo de aristas."),
  speed: z.number().min(0.05).max(5).default(0.5).describe("Velocidad del flujo animado."),
  dots: z.number().int().min(1).max(6).default(3).describe("Cuántos puntos recorren cada arista."),
  stagger: z.number().min(0).max(5).default(0.45).describe("Segundos entre la aparición de un nodo y el siguiente cuando build=true."),
  single: z.boolean().default(false).describe("Modo 'pelota única por ruta': en vez de puntos por flecha, una sola pelota recorre el diagrama y se parte en cada bifurcación."),
  font: z.string().optional().describe("Tipografía global del diagrama. Usa list_fonts; si se omite, Georgia."),
  customBg: z.string().optional().describe("Color de fondo (hex) que sobrescribe el del tema."),
  nodes: z.array(NodeSpecSchema).min(1),
  edges: z.array(EdgeSpecSchema).default([]),
};

/* ===================== Operaciones de edición ===================== */

const editNodeFields = {
  label: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  anim: z.string().optional(),
  tint: z.boolean().optional().describe("Solo en shape='icon'. Tiñe la pastilla del ícono con el color del nodo."),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  pulse: z.boolean().optional(),
  order: z.number().optional(),
  fs: z.number().optional(),
  fill: z.string().optional(),
  border: BorderSchema.optional(),
  lblPos: LabelPosSchema.optional(),
  textBg: z.string().optional(),
  textColor: z.string().optional(),
  font: z.string().optional(),
  bold: z.boolean().optional(),

  /* Solo tienen efecto en shape:"code". Van también aquí y no solo en
     `commonNodeFields`: si estuvieran solo allí, se podría crear un nodo de
     código con create_diagram pero no tocar sus colores ni sus palabras clave
     con edit_diagram, que es una asimetría que el usuario sufriría sin
     entenderla. */
  lang: z.enum(CODE_LANG_NAMES).optional()
    .describe("Solo en shape='code'. Preset de palabras clave: 'sql' cubre SQL y ksqlDB, 'none' desactiva el resaltado."),
  keywords: z.array(z.string()).optional()
    .describe("Solo en shape='code'. Lista propia de palabras clave; si se da y no está vacía, sustituye al preset de 'lang'."),
  kwBg: z.string().optional()
    .describe("Solo en shape='code'. Fondo del resaltado de las palabras clave."),
  kwColor: z.string().optional()
    .describe("Solo en shape='code'. Color del texto de las palabras clave resaltadas."),
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
  font: z.string().optional(),
  bold: z.boolean().optional(),
  speedFac: z.number().min(1).max(4).optional(),
  dots: z.number().int().min(1).max(6).optional(),
  dotsGlobal: z.boolean().optional(),
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
  z.object({ op: z.literal("relayout") }).describe("Recalcula x/y de todos los nodos de la página en capas, a partir de las aristas actuales. Borra TODOS los waypoints manuales de la página: tras mover los nodos quedarían descolgados."),
]);
export type Operation = z.infer<typeof OperationSchema>;

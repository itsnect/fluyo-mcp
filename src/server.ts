import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ANIMS, CANVAS, DEFAULT_FONT, FONTS, ICON_GROUPS, ICONS, PALETTE } from "./schema.js";
import { CreateDiagramInputShape, DocumentInputSchema, ReturnDocumentSchema, ThemeSchema, projectSkin } from "./model.js";
import { createDiagramResult, createFromTemplateResult, parseDocument, type CreateDiagramResult, type CreatedIds } from "./diagram.js";
import type { FluyoProject } from "./model.js";
import { pageToSVG } from "./svg.js";
import { openLink, openLinkLine } from "./link.js";
import { TEMPLATES } from "./templates.js";
import { describeDocument, runStory, summarizeDescription, summarizeRun } from "./stories.js";
import { AuthoringOperationSchema, DuplicateFields, ThemeFields, ZPlacement, authorDocument, authorSingle, summarizeAuthoring } from "./authoring.js";
import { proposeLayout, summarizeLayout } from "./propose-layout.js";
import { linkErrorText, resolveDocument } from "./link-input.js";
import { createKernel } from "./kernel.js";
import { REVISION_MISMATCH_MESSAGE, revisionOf } from "./revision.js";

/**
 * Las quince tools de este servidor son funciones puras: reciben JSON, devuelven
 * JSON, y no tocan disco, red ni ningún estado fuera de su propia respuesta. No
 * hay nada que un cliente deba confirmar antes de llamarlas. Las que modifican un
 * documento (author_document y las de una operación) devuelven uno NUEVO sin pisar
 * el recibido: estas anotaciones hablan del entorno, así que `destructiveHint:false`
 * es correcto.
 */
const TOOL_PURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** MCP-TOKEN-EFFICIENCY-002: el 2.º bloque es JSON SIN sangría. Lo lee un modelo, no una persona, y la sangría era ~40 % de lo que
 *  recibía. El contenido es el mismo (JSON.parse da el mismo valor) y la revisión no depende del formato (JSON canónico, revision.ts). */
const json = (value: unknown): string => JSON.stringify(value);

function ok(...texts: string[]): ToolResult {
  return { content: texts.map(text => ({ type: "text" as const, text })) };
}
function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
function summarize(project: FluyoProject): string {
  const page = project.doc.pages[project.doc.cur] ?? project.doc.pages[0];
  return `Diagrama "${page.name}" — ${page.nodes.length} nodo(s), ${page.edges.length} arista(s), tema "${project.doc.theme}".`;
}

/**
 * El resumen más el enlace que abre el diagrama animado en la app.
 *
 * El enlace va DENTRO del bloque de resumen y no en uno propio: `content[]`
 * sigue teniendo dos elementos —resumen y JSON— y ningún cliente que ya lea
 * estas respuestas tiene que cambiar nada.
 *
 * Cuando no cabe, se dice por qué y qué hacer, en vez de callarse. El JSON sale
 * igual: el diagrama es perfectamente válido, lo que no cabe es la URL.
 */
function summarizeWithLink(project: FluyoProject): string {
  return `${summarize(project)}\n${openLinkLine(openLink(project))}`;
}

/** MCP-TOKEN-EFFICIENCY-002: create_* dice en el resumen la revisión y los ids que asignó el dominio, para seguir con author_document
 *  sin pedir antes describe_document. Van fuera del documento: el 2.º bloque sigue siendo el .fluyo.json tal cual. */
function summarizeCreated(project: FluyoProject, revision: string, ids: CreatedIds): string {
  const nodes = ids.nodes.map(n => `${n.key}=${n.id}`).join(", ");
  return `${summarizeWithLink(project)}\n` +
    `revision ${revision} (baseRevision para author_document).` +
    (nodes ? `\nIds por key: ${nodes}.` : "") +
    (ids.edges.length ? `\nIds de aristas (orden de edges): ${ids.edges.join(", ")}.` : "");
}

/** create_diagram / create_from_template (FLUYO-018.9): el documento v5 del dominio, o el rechazo estructurado con la misma forma
 *  que author_document ([resumen, JSON {ok:false, errors…}], isError) y sin documento.
 *  MCP-TOKEN-EFFICIENCY-004: con returnDocument:false y enlace, solo el resumen (que ya trae enlace, revisión e ids); sin enlace, igual
 *  que siempre. */
function createdOrRejected(r: CreateDiagramResult, returnDocument = true): ToolResult {
  if (r.ok && !returnDocument && openLink(r.project).ok) {
    return ok(`${summarizeCreated(r.project, r.revision, r.ids)}\nSin documento (returnDocument:false): sigue con el enlace y la revision.`);
  }
  if (r.ok) return ok(summarizeCreated(r.project, r.revision, r.ids), json(r.project));
  const first = r.errors[0] ?? { code: "ERROR", message: "" };
  return { ...ok(`Diagrama RECHAZADO (${first.code}): ${first.message} No se devuelve ningún documento.`, json(r)), isError: true };
}

/* ===================== el enlace #d= como document (MCP-TOKEN-EFFICIENCY-003) =====================
   author_document, las tools de una operación y propose_layout lo resuelven dentro de su dominio (errores estructurados). */

/** baseRevision de export_diagram / describe_document / run_story: obligatorio con un enlace; opcional con un objeto. */
const LinkRevision = z.string().regex(/^sha256:[0-9a-f]{64}$/).optional();

/** El document de las tools de lectura. Un enlace se resuelve (link-input.ts) al documento normalizado de su revisión; con un objeto,
 *  baseRevision, si se pasa, se comprueba como en propose_layout (REVISION_MISMATCH con 'actual'). Los errores son `Error: …`. */
function readDocument(document: unknown, baseRevision: string | undefined): unknown {
  const r = resolveDocument(document, baseRevision);
  if (!r.ok) throw new Error(linkErrorText(r.error));
  if (typeof document !== "string" && baseRevision !== undefined) {
    const actual = revisionOf(createKernel(), document);
    if (actual !== baseRevision) throw new Error(`REVISION_MISMATCH: ${REVISION_MISMATCH_MESSAGE} actual: ${actual ?? "ninguna (el documento no es legible)"}`);
  }
  return r.document;
}

/* ===================== schema publicado (MCP-TOKEN-EFFICIENCY-002) =====================
   Zod 4 publica cada z.number().int() con minimum/maximum = ±Number.MAX_SAFE_INTEGER (eran 79 topes, ~2 KB de tools/list). Esos topes
   solo repiten lo que ya exige la validación real (Zod, que no se toca: un entero no seguro se sigue rechazando); los topes propios
   (min(1), max(86_400_000)…) se conservan. Sin $defs/$ref: el resto del schema sale igual que lo genera el SDK. */

const SAFE = Number.MAX_SAFE_INTEGER;

/** El schema JSON sin los topes de entero seguro implícitos de Zod (solo en nodos type:"integer"). No muta la entrada. */
export function withoutSafeIntBounds(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutSafeIntBounds);
  if (schema === null || typeof schema !== "object") return schema;
  const o = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (o.type === "integer" && ((k === "minimum" && v === -SAFE) || (k === "maximum" && v === SAFE))) continue;
    out[k] = withoutSafeIntBounds(v);
  }
  return out;
}

type ListHandler = (request: unknown, extra: unknown) => Promise<{ tools: Array<{ inputSchema?: unknown }> }>;

/** Envuelve el tools/list que instala McpServer (al registrar la primera tool) para publicar el schema sin esos topes. El SDK no
 *  ofrece un gancho público para esto; la versión está fijada (1.29.0) y, si cambia el mapa de handlers, esto falla al arrancar en
 *  vez de publicar en silencio otro catálogo (lo cubre test/fluyo-mcp-token-efficiency-002.test.ts). */
function withCompactToolSchemas(server: McpServer): McpServer {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, ListHandler> })._requestHandlers;
  const list = handlers?.get("tools/list");
  if (!handlers || !list) throw new Error("fluyo-mcp: el SDK ya no expone el handler de tools/list; revisa withCompactToolSchemas.");
  handlers.set("tools/list", async (request, extra) => {
    const r = await list(request, extra);
    return { ...r, tools: r.tools.map(t => ({ ...t, inputSchema: withoutSafeIntBounds(t.inputSchema) })) };
  });
  return server;
}

/** Registra las herramientas de Fluyo sobre una instancia nueva de McpServer. Separado de
 *  index.ts para poder conectarlo tanto a stdio (uso real) como a un InMemoryTransport
 *  (los tests de test/) sin duplicar las definiciones de herramientas. */
export function buildServer(): McpServer {
  return withCompactToolSchemas(buildServerAsSdkPublishes());
}

/** Las mismas tools, con el catálogo tal como lo genera el SDK (con los topes de entero seguro). Solo para tests y mediciones:
 *  demuestra que el schema publicado es este mismo salvo esos topes. */
export function buildServerAsSdkPublishes(): McpServer {
  // Debe coincidir con la versión de package.json; hay un test que lo comprueba.
  const server = new McpServer({ name: "fluyo-mcp", version: "1.0.0" });

/* ===================== create_diagram ===================== */

server.registerTool(
  "create_diagram",
  {
    title: "Crear diagrama Fluyo",
    annotations: TOOL_PURA,
    description:
      "Crea un diagrama de arquitectura completo (formato .fluyo.json) a partir de una lista de nodos y aristas. " +
      "Si un nodo no trae x/y, se posiciona automáticamente en capas de izquierda a derecha según las aristas (auto-layout). " +
      "La respuesta trae un enlace fluyo.space/#d=… que abre el diagrama YA ANIMADO en la app: dáselo al usuario, " +
      "es la forma más rápida de que vea el resultado y no requiere guardar ningún archivo. " +
      "El JSON es el documento v5 del editor (mismos defaults, ids y revisión que crearlo con author_document): se puede guardar como .fluyo.json, seguir editando con author_document o exportar con export_diagram. " +
      "El resumen trae su 'revision' (el baseRevision de author_document: no hace falta describe_document) y los ids asignados (key→id; aristas en el orden de edges). " +
      "Colores: nombre de list_colors o HEX. Valen las reglas y límites de author_document (HEX, catálogos, auto-lazo, capabilities.limits, página 1–80): si algo no cumple se rechaza TODO con errores estructurados (code, field, input = nodes[i]/edges[j]) y sin documento. " +
      "Usa list_icons para ver íconos válidos y list_templates si el patrón ya existe como plantilla.",
    inputSchema: CreateDiagramInputShape,
  },
  async ({ returnDocument, ...input }) => {
    try {
      return createdOrRejected(createDiagramResult(input), returnDocument);
    } catch (err) {
      return fail(err);
    }
  }
);

/* ===================== export_diagram ===================== */

server.registerTool(
  "export_diagram",
  {
    title: "Exportar diagrama Fluyo a SVG",
    annotations: TOOL_PURA,
    description:
      "Renderiza una página de un documento Fluyo a SVG estático, con las mismas formas, colores, íconos, " +
      "rellenos, bordes y tipografías que produce 'Exportar → SVG' dentro de la app. " +
      "Útil para pegar el diagrama en Notion/Confluence/Markdown o previsualizarlo sin abrir Fluyo. " +
      "No incluye animación (puntos de flujo ni aparición escalonada), igual que el SVG que exporta la app; " +
      "para el GIF animado hay que abrir el documento en Fluyo. PNG y GIF no están disponibles aquí: " +
      "necesitan un renderer de canvas. Respeta el aspecto del documento: con settings.skin = \"built\" sale la piel " +
      "«construido» (2.5D) de Present, el Viewer y la exportación de la app; sin la clave (o con cualquier otro valor), plano. " +
      "Con kind, las marcas de Flujo y Requisito, como la app.",
    inputSchema: {
      document: DocumentInputSchema,
      baseRevision: LinkRevision,
      pageIndex: z.number().optional().describe("Índice de página a exportar (por defecto, la página actual)."),
      scale: z.number().min(0.25).max(4).default(1).describe("Escala de las dimensiones width/height del SVG resultante."),
      crop: z
        .boolean()
        .default(false)
        .describe(
          "Si es true, recorta el lienzo al contenido en vez de emitir los 2560×1440 completos. " +
            "Por defecto false, que es lo que hace la app: así el SVG de aquí y el de 'Exportar' son idénticos."
        ),
    },
  },
  async ({ document, baseRevision, pageIndex, scale, crop }) => {
    try {
      const project = parseDocument(readDocument(document, baseRevision));
      const idx = pageIndex ?? project.doc.cur ?? 0;
      const page = project.doc.pages[idx];
      if (!page) throw new Error(`pageIndex ${idx} fuera de rango (el documento tiene ${project.doc.pages.length} página(s)).`);
      const svg = pageToSVG(page, project.doc.theme, {
        scale,
        globalFont: project.settings.font ?? null,
        crop,
        /* FLUYO-019.3: el aspecto del documento, con la lectura canónica del kernel (solo "built" pinta la piel) */
        skin: projectSkin(project.settings),
        customBg: project.doc.customBg ?? null,
      });
      return ok(`SVG de "${page.name}" (${page.nodes.length} nodos, ${page.edges.length} aristas).`, svg);
    } catch (err) {
      return fail(err);
    }
  }
);

/* ===================== list_icons / list_colors ===================== */

server.registerTool(
  "list_icons",
  {
    title: "Listar íconos disponibles",
    annotations: TOOL_PURA,
    /* Los grupos salen de ICON_GROUPS, no de una lista escrita a mano: esta misma
       frase ya se quedó nombrando seis grupos cuando la app tenía ocho. */
    description:
      `Devuelve las claves de ícono válidas para nodos shape='icon', agrupadas (${ICON_GROUPS.join(", ")}). ` +
      "Son los mismos íconos que ofrece el cajón de la aplicación.",
    inputSchema: {},
  },
  async () => {
    const byGroup: Record<string, string[]> = {};
    for (const [key, def] of Object.entries(ICONS)) {
      (byGroup[def.group] ??= []).push(`${key} (${def.label})`);
    }
    const text = Object.entries(byGroup)
      .map(([group, items]) => `${group}:\n  ${items.join(", ")}`)
      .join("\n\n");
    return ok(text);
  }
);

server.registerTool(
  "list_colors",
  {
    title: "Listar colores semánticos",
    annotations: TOOL_PURA,
    description:
      "Devuelve los nombres de color semántico de la paleta de Fluyo, con su hex. Los nombres los aceptan create_diagram y create_from_template en 'color', 'lineColor' y 'dotColor' (también cualquier hex #rrggbb). " +
      "author_document NO acepta nombres: ahí los colores (de elementos y de conexiones, incl. lineColor y dotColor) van SOLO en HEX; usa el hex de esta lista. fill admite además \"none\" (sin relleno).",
    inputSchema: {},
  },
  async () => {
    const text = PALETTE.map(p => `${p.name} -> ${p.hex}`).join("\n");
    return ok(text);
  }
);

/* ===================== list_anims / list_fonts ===================== */

server.registerTool(
  "list_anims",
  {
    title: "Listar GIFs animados",
    annotations: TOOL_PURA,
    description:
      "Devuelve las claves válidas para nodos shape='anim'. Son pequeñas animaciones que Fluyo dibuja " +
      "fotograma a fotograma en el lienzo y en el GIF exportado (un spinner girando, una barra de progreso " +
      "avanzando, un tick que se traza). En un SVG estático se ve su fotograma de referencia. " +
      "Sirven para señalar estados —cargando, procesando, error— dentro de un diagrama.",
    inputSchema: {},
  },
  async () => {
    const text = Object.entries(ANIMS)
      .map(([key, def]) => `${key} (${def.label})`)
      .join("\n");
    return ok(text);
  }
);

server.registerTool(
  "list_fonts",
  {
    title: "Listar tipografías",
    annotations: TOOL_PURA,
    description:
      "Devuelve las familias tipográficas que ofrece Fluyo, para el campo 'font' de nodos y aristas. " +
      "El valor que se guarda en el documento es la familia CSS completa, no el nombre corto. " +
      "Un nodo sin 'font' hereda la tipografía global del documento.",
    inputSchema: {},
  },
  async () => {
    const text = FONTS.map(
      f => `${f.name} -> ${f.family}${f.family === DEFAULT_FONT ? "   (global por defecto)" : ""}`
    ).join("\n");
    return ok(text);
  }
);

/* ===================== list_templates / create_from_template ===================== */

server.registerTool(
  "list_templates",
  {
    title: "Listar templates de diagramas",
    annotations: TOOL_PURA,
    description: "Devuelve los patrones de arquitectura predefinidos disponibles para instanciar con create_from_template.",
    inputSchema: {},
  },
  async () => {
    const text = TEMPLATES.map(
      t => `${t.id} — ${t.name}\n  ${t.description}\n  Labels personalizables: ${t.overridableKeys.join(", ")}`
    ).join("\n\n");
    return ok(text);
  }
);

server.registerTool(
  "create_from_template",
  {
    title: "Crear diagrama desde un template",
    annotations: TOOL_PURA,
    description:
      "Instancia uno de los templates de list_templates como un documento Fluyo completo, con auto-layout aplicado. " +
      "Se pueden personalizar los labels de los nodos vía 'labelOverrides' (mapa key -> nuevo texto). Sigue la misma ruta y reglas que create_diagram (documento v5 del editor; el resumen trae revision e ids por key). " +
      "La respuesta trae un enlace fluyo.space/#d=… que abre el diagrama animado en la app.",
    inputSchema: {
      templateId: z.string(),
      pageName: z.string().optional(),
      theme: ThemeSchema.optional(),
      labelOverrides: z.record(z.string(), z.string()).default({}).describe("Ej: {\"gateway\": \"Ingress\", \"db\": \"Cloud SQL\"}"),
    },
  },
  async ({ templateId, pageName, theme, labelOverrides }) => {
    try {
      return createdOrRejected(createFromTemplateResult({ templateId, pageName, theme, labelOverrides }));
    } catch (err) {
      return fail(err);
    }
  }
);

/* ===================== describe_document / run_story (FLUYO-017.1) ===================== */

server.registerTool(
  "describe_document",
  {
    title: "Describir un documento Fluyo",
    annotations: TOOL_PURA,
    description:
      "Lee un documento Fluyo (cualquier versión que abra la app, v1–v5) y devuelve una descripción COMPACTA pensada para un agente: " +
      "páginas con sus elementos (id, nombre, forma, x/y = centro, w/h) y conexiones (id, origen, destino, ruta, lados y waypoints si los hay; sin estilos), los 'bounds' que ocupa cada página, disponibilidad inicial, la biblioteca de eventos " +
      "(id, nombre, frase, símbolo, primitiva, acción, a qué se aplica —conexión o elemento—, presentación distinta del defecto y dónde se usa: Historias y pasos; " +
      "es lo que responde «¿qué eventos puedo usar?») y las Historias con sus pasos agrupados por momento, su evento, objetivo, frase y message (el globo propio del paso, si lo tiene). " +
      "Si una Historia tiene dependencias de llegada: arrivalDependencies (lo guardado), inactiveArrivalDependencies (lo guardado que no aplica, con su razón), " +
      "waitsForArrivalOf en cada paso y waitsFor en cada momento (solo lo que aplica al reproducir). " +
      "Un paso con target.reverse:true recorre su conexión de to a from: label y frase van en ese sentido (from/to son los de la conexión). " +
      "Solo si los hay: connectionKind (FLOWS_TO|REQUIRES), observedFlow {source,target} de una Historia (sin él, la ruta automática; su disponibilidad no se calcula aquí) y warnings (extremo perdido, kind desconocido). " +
      "También valida la integridad del documento (referencias a elementos, conexiones y eventos) con la misma regla que el motor de Fluyo, " +
      "indica la versión de schema y de motor, y declara lo que el modelo NO representa. No modifica nada. " +
      "Usa los ids numéricos que devuelve (los storyId son por página) para pedir run_story. " +
      "Con includeSteps:false se omiten los pasos de cada Historia.",
    inputSchema: {
      document: DocumentInputSchema,
      baseRevision: LinkRevision,
      pageIndex: z.number().int().min(0).optional().describe("Describe sólo esta página (por defecto, todas)."),
      includeSteps: z.boolean().default(true).describe("Incluir los pasos de cada Historia."),
    },
  },
  async ({ document, baseRevision, pageIndex, includeSteps }) => {
    try {
      const description = describeDocument({ document: readDocument(document, baseRevision), pageIndex, includeSteps });
      return ok(summarizeDescription(description), json(description));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "run_story",
  {
    title: "Ejecutar una Historia de Fluyo",
    annotations: TOOL_PURA,
    description:
      "Ejecuta una Historia de un documento Fluyo con el MISMO motor determinista que usa el editor (no es una simulación nueva ni la hace el modelo) " +
      "y devuelve: la validación del documento, el Trace del motor sin modificar, el resultado de cada paso (completed, not_completed con su razón, " +
      "state_changed, no_change o narrated), la frase de cada paso (y su message si lo tiene) y las versiones de schema y motor. " +
      "Un paso OCCURRENCE es siempre 'narrated': el motor lo registra aunque el elemento esté no disponible y NO prueba que ocurriera nada real. " +
      "Si la Historia no es válida no hay Trace: se devuelven los errores. No modifica el documento. " +
      "Un paso con target.reverse:true recorre su conexión de to a from: frase, reasonNode y Trace (reverse:true) van en ese sentido. " +
      "Pide antes describe_document para conocer pageIndex y storyId.",
    inputSchema: {
      document: DocumentInputSchema,
      baseRevision: LinkRevision,
      pageIndex: z.number().int().min(0).optional().describe("Página de la Historia (por defecto, la página actual del documento)."),
      storyId: z.number().int().min(1).describe("Id de la Historia en esa página (los ids de Historia son por página)."),
    },
  },
  async ({ document, baseRevision, pageIndex, storyId }) => {
    try {
      const result = runStory({ document: readDocument(document, baseRevision), pageIndex, storyId });
      return ok(summarizeRun(result), json(result));
    } catch (err) {
      return fail(err);
    }
  }
);

/* ===================== author_document (FLUYO-017.2) ===================== */

server.registerTool(
  "author_document",
  {
    title: "Crear, modificar y eliminar el diagrama (nodos y conexiones), Historias y eventos de un documento Fluyo",
    annotations: TOOL_PURA,
    description:
      "Aplica un LOTE ATÓMICO de operaciones de Historia y de eventos sobre una COPIA del documento y devuelve un documento nuevo que Fluyo puede ejecutar tal cual (el original no se modifica). " +
      "Operaciones: create_story, rename_story, duplicate_story, delete_story, add_step, remove_step, move_step, duplicate_step, retarget_step, set_wait, set_step_message, set_arrival_dependencies, set_observed_flow (alcance 'story'); " +
      "set_initial_availability, create_node, create_connection, update_node, update_connection, delete_node, delete_connection, reorder_nodes, duplicate_node (alcance 'page'); create_page, rename_page, delete_page, set_theme (alcance 'document'); create_event_type, update_event_type, delete_event_type (alcance 'eventType': los eventos son GLOBALES al documento, sin pageIndex; las Historias sólo los referencian por id). Cada operación declara su 'scope'. " +
      "Un evento se define con name, primitive (FLOW=conexión, OCCURRENCE=elemento, SET_AVAILABILITY=elemento que cambia su disponibilidad con availability UP|DOWN), sentence (marcadores {source} {target} {name}), symbol, motion (sólo FLOW) y presentation ({connectionEffects}|{nodeEffects}, parche); la acción de los pasos la sigue decidiendo el evento. " +
      "Las reglas son las del editor: un evento en uso no cambia de primitiva ni de disponibilidad (EVENT_TYPE_LOCKED) y no se elimina (REFERENCED_ENTITY, con las Historias y pasos que lo usan; quita antes esos pasos); cambiar nombre, frase, símbolo o presentación es global y no toca pasos, tiempos ni objetivos. Puedes usar {ref} de un evento creado en el lote en add_step. " +
      "DIAGRAMA (create_node, create_connection): 'ref' es un nombre del LOTE (no se guarda): " +
      "source/target son {ref} de algo creado antes en el lote EN LA MISMA PÁGINA (las refs son por página) o {id} de un elemento existente; así puedes crear Cliente → Comercio → Banco en una sola llamada sin conocer los ids. " +
      "Los ids los asigna Fluyo (la respuesta trae 'refs': [{ref,type,pageIndex,id}] para seguir trabajando) y los defaults, la geometría de las conexiones y las reglas (auto-lazo, ids duplicados, forma) son las del editor; los campos son los del documento (w/h, color en hex). " +
      "MODIFICAR (update_node, update_connection): mover = x/y, redimensionar = w/h; solo cambia lo que envías y las conexiones no se tocan; source/target = retarget; los waypoints solo cambian si los envías (waypoints:[] vuelve a la ruta automática). " +
      "ELIMINAR: delete_node quita también sus conexiones y su disponibilidad inicial. " +
      "SEMÁNTICA (la decide el autor, nunca se infiere): spec.kind; set_observed_flow {storyId, source, target} (elementos distintos; los dos null = ruta automática) guarda la ruta observada de la Historia, sin tocar pasos. " +
      "Las Historias mandan (B2): si el estado final del lote dejaría una Historia inválida (un paso apunta a lo eliminado) se rechaza TODO con REFERENCED_ENTITY (entidad eliminada, Historias y pasos afectados, operación y razón); nada se limpia en silencio. " +
      "Retargetear/quitar pasos y eliminar en el mismo lote es válido (se evalúa el estado final). Las {ref} valen también en update_*/delete_* y en los destinos de los pasos (target: {ref} | {edgeId:{ref}} | {nodeId:{ref}} | {from:{ref},to:{ref}}, nodeId de set_initial_availability). " +
      "SENTIDO de un paso FLOW: target {edgeId|ref, reverse:true} recorre la conexión de to a from (la respuesta va por la MISMA conexión: no dibujes la inversa); retarget_step fija conexión y sentido (sin reverse = normal). " +
      "PÁGINAS: create_page añade SIEMPRE al final, no cambia la página activa; sin nombre usa el del editor; 1–80 caracteres. " +
      "create_page devuelve el pageIndex creado en changes[].pageIndex: las operaciones siguientes del MISMO lote ya pueden usarlo (create_node, create_connection, create_story…); las páginas no tienen id. " +
      "delete_page {pageIndex, expectedName}: expectedName = nombre ACTUAL exacto (si no, PAGE_MISMATCH); la página se va con sus elementos, conexiones, disponibilidad e Historias (changes[].affects); los eventos se conservan; nunca la única (CANNOT_DELETE_LAST_PAGE). " +
      "Dentro del lote los pageIndex NO se desplazan (los del inicio + los creados al final); usar una página eliminada es PAGE_DELETED. La respuesta trae pageMap [{from,to}] (to null = eliminada): refs y touchedStories ya usan los índices finales. " +
      "ASPECTO, ORDEN Z Y DUPLICADO (las mismas reglas que el editor; también son tools de una sola operación con el mismo nombre): " +
      "set_theme: parche e idempotente; customBg en HEX o null/\"\" para quitarlo; " +
      "reorder_nodes: el Z es la posición del elemento en la página (las conexiones van siempre debajo); el orden relativo lo fija el documento, no la lista; no cambiar nada es válido (changed:false); " +
      "duplicate_node duplica UNO o VARIOS elementos a la vez con las conexiones ENTRE ellos y su disponibilidad inicial (por defecto desplazados 20,20 como Ctrl+D): ids nuevos, nunca se copian pasos ni Historias; 'ref' nombra la copia y vale en el resto del lote; changes[].created lista {kind,from,id}. " +
      "REGLAS DE ENTRADA de create_node/update_node: colores SOLO en HEX (#rgb, #rrggbb, #rrggbbaa); icon/anim deben existir en el catálogo (list_icons/list_anims) y las formas icon/anim los exigen; border admite solid|dashed|dotted|none. " +
      "LÍMITES (capabilities.limits de describe_document): |x|,|y| ≤ coordMax, w/h entre sizeMin y sizeMax, ≤ maxNodesPerPage nodos y ≤ maxConnectionsPerPage conexiones por página; se evalúan sobre el ESTADO FINAL del lote (puedes crear y borrar dentro del mismo lote) y solo sobre lo que el lote escribe: un documento antiguo que ya los exceda se abre y se edita igual. Si se superan se rechaza TODO con LIMIT_EXCEEDED {limit, actual, field}. " +
      "El tiempo es narrativo: add_step añade al final tras 'waitMs' (o 'al mismo tiempo' con placement) y set_wait fija la espera de un momento " +
      "(no se escribe el tiempo absoluto). waitMs se cuenta desde el INICIO del momento anterior y no incluye ni espera el viaje visual del token de un SEND: ese viaje es presentación (motion fast/normal/slow = 500/1100/1800 ms; no lo uses para calcular esperas), así que con waitMs:500 tras un envío normal el paso se ve 600 ms ANTES de que llegue el token. " +
      "Eliminar y duplicar siguen la política de la app (eliminar colapsa la espera; duplicar entra en el mismo momento). " +
      "DEPENDENCIAS DE LLEGADA (explícitas, nunca se infieren de las conexiones): add_step {waitsForArrivalOf:[stepId|{ref}]} o set_arrival_dependencies {stepId, waitsForArrivalOf} (reemplaza; [] las quita) declaran que el MOMENTO de ese paso no empieza, al reproducir en Fluyo, hasta que llegue el token de esos envíos (pasos SEND de la misma Historia en un momento ANTERIOR); " +
      "el momento es atómico, lo independiente no se retrasa y el Trace del motor no cambia. " +
      "PATRÓN: todo paso que narre la recepción, el procesamiento o la consecuencia de un envío declara waitsForArrivalOf de ese SEND (A→B→C: M1 A envía a B; M2 B procesa, waitsForArrivalOf [M1]; M3 B envía a C; M4 C procesa, waitsForArrivalOf [M3]); lo que no dependa de una llegada (otro nodo cae, otro envío) lleva solo waitMs y no se retrasa; un paso sobre el nodo destino sin dependencia no es una recepción: Fluyo no la deduce. " +
      "Un envío fallido (destino caído) también llega: el momento que lo espera empieza cuando se ve el fallo en el destino. " +
      "Se guardan en la Historia (arrivalDependencies), no en el paso. Una dependencia inválida (no existe, no es SEND, mismo momento o posterior, sí misma, ciclo, otra Historia) se rechaza con INVALID_ARRIVAL_DEPENDENCY {stepId, sendId, reason}. " +
      "remove_step quita las dependencias del paso y las que lo esperaban (changes[].cascade.arrivalDependencies); duplicate_step copia las válidas a la copia y no redirige las que esperan al original; duplicate_story las copia con los mismos ids de paso. " +
      "Si move_step/set_wait dejan una dependencia sin efecto, se conserva y se avisa en 'warnings' (ARRIVAL_DEPENDENCY_INACTIVE). " +
      "Requiere 'baseRevision': la revisión de ESTE documento (la del resumen de create_*, el resultRevision de la autoría anterior o la 'revision' de describe_document); si no coincide se rechaza con REVISION_MISMATCH, que trae la real ('actual'). " +
      "Con dryRun:true se valida y se devuelven los cambios sin documento. " +
      "waitMs: add_step por defecto 1000 (el primero 0); set_wait lo cuenta desde el momento anterior y desplaza los posteriores; move_step {direction}|{to:{gapIndex}|{sameMomentAs,after}}. " +
      "Devuelve 'changes' (qué hizo cada operación y a qué Historias/pasos afecta), 'resultRevision' y 'editorUrl': el enlace fluyo.space/#d=… que abre el documento resultante en Fluyo (dáselo al usuario; si no cabe, editorUrlError LINK_TOO_LARGE). Después usa run_story para ver el Trace.",
    inputSchema: {
      document: DocumentInputSchema,
      baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).describe("La revisión de este documento (create_*, resultRevision anterior o describe_document)."),
      operations: z.array(AuthoringOperationSchema).min(1).max(200),
      dryRun: z.boolean().default(false).describe("Sólo validar y devolver los cambios; no se devuelve documento."),
      returnDocument: ReturnDocumentSchema,
    },
  },
  async ({ document, baseRevision, operations, dryRun, returnDocument }) => {
    try {
      const result = authorDocument({ document, baseRevision, operations, dryRun, returnDocument });
      const blocks = [summarizeAuthoring(result), json(result)];
      return result.ok ? ok(...blocks) : { ...ok(...blocks), isError: true };
    } catch (err) {
      return fail(err);
    }
  }
);

/* ===================== propose_layout (FLUYO-018.6) ===================== */

server.registerTool(
  "propose_layout",
  {
    title: "Proponer posiciones (auto-layout) para una página de un documento Fluyo",
    annotations: TOOL_PURA,
    description:
      "SOLO LECTURA: no modifica el documento ni devuelve uno nuevo. Calcula con el auto-layout por capas de Fluyo (el de create_diagram) dónde colocar los elementos de UNA página (pageIndex; por defecto la actual) " +
      "y devuelve 'batches': lotes de author_document ya listos (update_node {x,y}; update_connection {waypoints:[]} para conexiones con ruta manual cuyos extremos se mueven, salvo clearWaypoints:false). " +
      "Flujo: describe_document → propose_layout → author_document con cada lote EN ORDEN (≤200 operaciones; el baseRevision del primero es la 'revision' del documento y el de cada siguiente el resultRevision del anterior). " +
      "Solo cambia x/y (y waypoints si lo pides): no toca Historias, eventos, disponibilidad, conexiones, tamaños, formas ni otras páginas. Es determinista. " +
      "Respeta capabilities.limits: si el layout necesita |x| o |y| > coordMax NO recorta: LAYOUT_EXCEEDS_LIMITS {limit, limitValue, actual, field, nodeId, required}. Reubica TODA la página (Sugiyama simplificado; en grafos muy ramificados conviene retocar a mano). " +
      "Errores: PAGE_NOT_FOUND, REVISION_MISMATCH (si pasas baseRevision), DOCUMENT_UNREADABLE.",
    inputSchema: {
      document: DocumentInputSchema,
      pageIndex: z.number().int().min(0).optional().describe("Página a ordenar (por defecto, la página actual del documento)."),
      clearWaypoints: z.boolean().default(true).describe("Si true, las conexiones con waypoints manuales cuyos extremos se mueven vuelven a su ruta automática (update_connection waypoints:[]). Si false se conservan y se avisa."),
      baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional().describe("Opcional: la 'revision' de este documento según describe_document; si no coincide se rechaza."),
    },
  },
  async ({ document, pageIndex, clearWaypoints, baseRevision }) => {
    try {
      const result = proposeLayout({ document, pageIndex, clearWaypoints, baseRevision });
      const blocks = [summarizeLayout(result), json(result)];
      return result.ok ? ok(...blocks) : { ...ok(...blocks), isError: true };
    } catch (err) {
      return fail(err);
    }
  }
);


/* ===================== set_theme · reorder_nodes · duplicate_node (FLUYO-018.7a) =====================
   Tools de UNA operación: llaman a authorDocument con la operación homónima (mismo kernel, revisión, reglas y respuesta que author_document;
   en un lote, con refs entre operaciones, usa author_document). */

const SingleBase = {
  document: DocumentInputSchema,
  baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).describe("Revisión del documento (create_*, resultRevision o describe_document)."),
  dryRun: z.boolean().default(false).describe("Solo validar: sin documento."),
};
const NodeIds = z.array(z.strictObject({ id: z.number().int().min(1) })).min(1).max(100).describe("Elementos por {id}.");

async function runSingle(input: { document: unknown; baseRevision: string; dryRun?: boolean }, operation: Record<string, unknown>): Promise<ToolResult> {
  try {
    const result = authorSingle(input, operation);
    const blocks = [summarizeAuthoring(result), json(result)];
    return result.ok ? ok(...blocks) : { ...ok(...blocks), isError: true };
  } catch (err) {
    return fail(err);
  }
}

server.registerTool(
  "set_theme",
  {
    title: "Cambiar el tema y el fondo de un documento Fluyo",
    annotations: TOOL_PURA,
    description:
      "Cambia el tema (dark, crema, claro) y/o el fondo personalizado (customBg en HEX; null o \"\" lo quita) sobre una COPIA y devuelve el documento nuevo. Parche: solo cambia lo que envías; repetir el valor actual no es un error (changed:false). " +
      "Requiere baseRevision. Equivale a set_theme de author_document.",
    inputSchema: { ...SingleBase, ...ThemeFields },
  },
  async ({ document, baseRevision, dryRun, theme, customBg }) =>
    runSingle({ document, baseRevision, dryRun }, { op: "set_theme", scope: "document", ...(theme !== undefined ? { theme } : {}), ...(customBg !== undefined ? { customBg } : {}) })
);

server.registerTool(
  "reorder_nodes",
  {
    title: "Cambiar el orden Z (capas) de elementos de una página",
    annotations: TOOL_PURA,
    description:
      "Reordena elementos de UNA página (pageIndex) al frente, al fondo, una capa arriba o una abajo (to). El orden Z es la posición del elemento en la página y las conexiones siempre van debajo de todos. " +
      "Con varios conservan su orden relativo del documento (la lista no importa). Si ya estaban en su sitio no es un error (changed:false). Requiere baseRevision. Equivale a reorder_nodes de author_document.",
    inputSchema: { ...SingleBase, pageIndex: z.number().int().min(0), nodes: NodeIds, to: ZPlacement },
  },
  async ({ document, baseRevision, dryRun, pageIndex, nodes, to }) =>
    runSingle({ document, baseRevision, dryRun }, { op: "reorder_nodes", scope: "page", pageIndex, nodes, to })
);

server.registerTool(
  "duplicate_node",
  {
    title: "Duplicar uno o varios elementos de una página",
    annotations: TOOL_PURA,
    description:
      "Duplica los elementos indicados (nodes, uno o varios) de UNA página en una sola operación atómica: ids nuevos, desplazados (offset; por defecto 20,20 como Ctrl+D), con las conexiones que hay ENTRE ellos (connections:internal; none las omite) incluidos sus waypoints, y con su disponibilidad inicial. " +
      "No copia conexiones con un extremo fuera del conjunto ni pasos, Historias o eventos (siguen apuntando a los originales). changes[].created lista {kind,from,id}. Requiere baseRevision. Para nombrar las copias y usarlas en el mismo lote, usa author_document.",
    inputSchema: { ...SingleBase, pageIndex: z.number().int().min(0), nodes: NodeIds, ...DuplicateFields },
  },
  async ({ document, baseRevision, dryRun, pageIndex, nodes, connections, offset }) =>
    runSingle({ document, baseRevision, dryRun }, {
      op: "duplicate_node", scope: "page", pageIndex, nodes: nodes.map(n => ({ source: { id: n.id } })),
      ...(connections !== undefined ? { connections } : {}), ...(offset !== undefined ? { offset } : {}),
    })
);

  return server;
}

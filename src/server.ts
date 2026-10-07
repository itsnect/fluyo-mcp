import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ANIMS, CANVAS, DEFAULT_FONT, FONTS, ICON_GROUPS, ICONS, PALETTE } from "./schema.js";
import { CreateDiagramInputShape, DocumentInputSchema, OperationSchema, ThemeSchema } from "./model.js";
import { createDiagram, editDiagram, parseDocument } from "./diagram.js";
import { pageToSVG } from "./svg.js";
import { MAX_LINK_CHARS, buildOpenLink } from "./link.js";
import { TEMPLATES, assertOverridableKeys, getTemplate } from "./templates.js";
import { describeDocument, runStory, summarizeDescription, summarizeRun } from "./stories.js";
import { AuthoringOperationSchema, DuplicateFields, ThemeFields, ZPlacement, authorDocument, authorSingle, summarizeAuthoring } from "./authoring.js";
import { proposeLayout, summarizeLayout } from "./propose-layout.js";

/**
 * Las dieciséis tools de este servidor son funciones puras: reciben JSON, devuelven
 * JSON, y no tocan disco, red ni ningún estado fuera de su propia respuesta. No
 * hay nada que un cliente deba confirmar antes de llamarlas.
 *
 * Matiz sobre `destructiveHint`: la operación `relayout` de edit_diagram sí es
 * destructiva respecto al CONTENIDO (borra los waypoints manuales, y así lo dice
 * su descripción), pero no respecto al entorno — devuelve un documento nuevo sin
 * pisar nada. Estas anotaciones hablan del entorno, así que `false` es correcto.
 */
const TOOL_PURA = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(...texts: string[]): ToolResult {
  return { content: texts.map(text => ({ type: "text" as const, text })) };
}
function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
function summarize(project: ReturnType<typeof createDiagram>): string {
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
function summarizeWithLink(project: ReturnType<typeof createDiagram>): string {
  const link = buildOpenLink(project);
  if (link) return `${summarize(project)}\nÁbrelo animado en Fluyo: ${link}`;
  return (
    `${summarize(project)}\n` +
    `Este diagrama no cabe en un enlace (el tope son ${MAX_LINK_CHARS.toLocaleString("es-ES")} caracteres de URL). ` +
    "Casi siempre es por nodos shape:\"image\", que llevan la imagen entera dentro como data URI: " +
    "uno solo puede pesar más que un diagrama de cien nodos. " +
    "Guarda el JSON de abajo como .fluyo.json y ábrelo en Fluyo con «Abrir»."
  );
}

/** Registra las herramientas de Fluyo sobre una instancia nueva de McpServer. Separado de
 *  index.ts para poder conectarlo tanto a stdio (uso real) como a un InMemoryTransport
 *  (los tests de test/) sin duplicar las definiciones de herramientas. */
export function buildServer(): McpServer {
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
      "El JSON también se puede guardar como .fluyo.json y abrir con «Abrir», seguir editando con edit_diagram o exportar con export_diagram. " +
      "Usa list_icons para ver íconos válidos y list_templates si el patrón ya existe como plantilla.",
    inputSchema: CreateDiagramInputShape,
  },
  async (input) => {
    try {
      const project = createDiagram(input);
      return ok(summarizeWithLink(project), JSON.stringify(project, null, 2));
    } catch (err) {
      return fail(err);
    }
  }
);

/* ===================== edit_diagram ===================== */

server.registerTool(
  "edit_diagram",
  {
    title: "Editar diagrama Fluyo",
    annotations: TOOL_PURA,
    description:
      "Aplica una lista de operaciones (add_node, update_node, remove_node, add_edge, update_edge, remove_edge, set_theme, rename_page, relayout) " +
      "sobre un documento Fluyo existente (el JSON completo devuelto por create_diagram o cargado desde un .fluyo.json). " +
      "Las operaciones se aplican en orden; add_node puede definir un 'key' temporal que add_edge referencia en la misma llamada. " +
      "Para editar nodos/aristas ya existentes en el documento, usa su 'id' numérico (visible en el JSON del documento). " +
      "La respuesta trae un enlace fluyo.space/#d=… con el diagrama YA EDITADO, listo para abrir en la app. " +
      "LEGACY: se mantiene sin cambios por compatibilidad. Para autoría moderna (nodos, conexiones, páginas, Historias; reglas y límites del editor, baseRevision y lotes atómicos) usa author_document.",
    inputSchema: {
      document: DocumentInputSchema,
      pageIndex: z.number().optional().describe("Índice de página a editar (por defecto, la página actual del documento)."),
      operations: z.array(OperationSchema).min(1),
    },
  },
  async ({ document, pageIndex, operations }) => {
    try {
      const project = editDiagram({ document, pageIndex, operations });
      return ok(summarizeWithLink(project), JSON.stringify(project, null, 2));
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
      "necesitan un renderer de canvas.",
    inputSchema: {
      document: DocumentInputSchema,
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
  async ({ document, pageIndex, scale, crop }) => {
    try {
      const project = parseDocument(document);
      const idx = pageIndex ?? project.doc.cur ?? 0;
      const page = project.doc.pages[idx];
      if (!page) throw new Error(`pageIndex ${idx} fuera de rango (el documento tiene ${project.doc.pages.length} página(s)).`);
      const svg = pageToSVG(page, project.doc.theme, {
        scale,
        globalFont: project.settings.font ?? null,
        crop,
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
      "Devuelve los nombres de color semántico de la paleta de Fluyo, con su hex. Los nombres los aceptan create_diagram, edit_diagram y create_from_template en 'color', 'lineColor' y 'dotColor' (también cualquier hex #rrggbb). " +
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
      "Se pueden personalizar los labels de los nodos vía 'labelOverrides' (mapa key -> nuevo texto). " +
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
      const tpl = getTemplate(templateId);
      assertOverridableKeys(tpl, labelOverrides);
      const { nodes, edges, suggestedTheme, suggestedPageName } = tpl.build(labelOverrides);
      const project = createDiagram({
        pageName: pageName ?? suggestedPageName,
        theme: theme ?? suggestedTheme,
        grid: true,
        build: false,
        autoLayout: true,
        speed: 0.5,
        dots: 3,
        stagger: 0.45,
        single: false,
        nodes,
        edges,
      });
      return ok(summarizeWithLink(project), JSON.stringify(project, null, 2));
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
      "es lo que responde «¿qué eventos puedo usar?») y las Historias con sus pasos agrupados por momento, su evento, objetivo y frase. " +
      "También valida la integridad del documento (referencias a elementos, conexiones y eventos) con la misma regla que el motor de Fluyo, " +
      "indica la versión de schema y de motor, y declara lo que el modelo NO representa. No modifica nada. " +
      "Usa los ids numéricos que devuelve (los storyId son por página) para pedir run_story. " +
      "Con includeSteps:false se omiten los pasos de cada Historia.",
    inputSchema: {
      document: DocumentInputSchema,
      pageIndex: z.number().int().min(0).optional().describe("Describe sólo esta página (por defecto, todas)."),
      includeSteps: z.boolean().default(true).describe("Incluir los pasos de cada Historia."),
    },
  },
  async ({ document, pageIndex, includeSteps }) => {
    try {
      const description = describeDocument({ document, pageIndex, includeSteps });
      return ok(summarizeDescription(description), JSON.stringify(description, null, 2));
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
      "state_changed, no_change o narrated), la frase de cada paso y las versiones de schema y motor. " +
      "Un paso OCCURRENCE es siempre 'narrated': el motor lo registra aunque el elemento esté no disponible y NO prueba que ocurriera nada real. " +
      "Si la Historia no es válida no hay Trace: se devuelven los errores. No modifica el documento. " +
      "Pide antes describe_document para conocer pageIndex y storyId.",
    inputSchema: {
      document: DocumentInputSchema,
      pageIndex: z.number().int().min(0).optional().describe("Página de la Historia (por defecto, la página actual del documento)."),
      storyId: z.number().int().min(1).describe("Id de la Historia en esa página (los ids de Historia son por página)."),
    },
  },
  async ({ document, pageIndex, storyId }) => {
    try {
      const result = runStory({ document, pageIndex, storyId });
      return ok(summarizeRun(result), JSON.stringify(result, null, 2));
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
      "Operaciones: create_story, rename_story, duplicate_story, delete_story, add_step, remove_step, move_step, duplicate_step, retarget_step, set_wait (alcance 'story'); " +
      "set_initial_availability, create_node, create_connection, update_node, update_connection, delete_node, delete_connection, reorder_nodes, duplicate_node (alcance 'page'); create_page, rename_page, delete_page, set_theme (alcance 'document'); create_event_type, update_event_type, delete_event_type (alcance 'eventType': los eventos son GLOBALES al documento, sin pageIndex; las Historias sólo los referencian por id). Cada operación declara su 'scope'. " +
      "Un evento se define con name, primitive (FLOW=conexión, OCCURRENCE=elemento, SET_AVAILABILITY=elemento que cambia su disponibilidad con availability UP|DOWN), sentence (marcadores {source} {target} {name}), symbol, motion (sólo FLOW) y presentation ({connectionEffects}|{nodeEffects}, parche); la acción de los pasos la sigue decidiendo el evento. " +
      "Las reglas son las del editor: un evento en uso no cambia de primitiva ni de disponibilidad (EVENT_TYPE_LOCKED) y no se elimina (REFERENCED_ENTITY, con las Historias y pasos que lo usan; quita antes esos pasos); cambiar nombre, frase, símbolo o presentación es global y no toca pasos, tiempos ni objetivos. Puedes usar {ref} de un evento creado en el lote en add_step. " +
      "DIAGRAMA (create_node, create_connection): 'ref' es un nombre del LOTE (no se guarda): " +
      "source/target son {ref} de algo creado antes en el lote EN LA MISMA PÁGINA (las refs son por página) o {id} de un elemento existente; así puedes crear Cliente → Comercio → Banco en una sola llamada sin conocer los ids. " +
      "Los ids los asigna Fluyo (la respuesta trae 'refs': [{ref,type,pageIndex,id}] para seguir trabajando) y los defaults, la geometría de las conexiones y las reglas (auto-lazo, ids duplicados, forma) son las del editor; los campos son los del documento (w/h, color en hex). " +
      "MODIFICAR (update_node, update_connection): mover = x/y, redimensionar = w/h; solo cambia lo que envías y las conexiones no se tocan; source/target = retarget; los waypoints solo cambian si los envías (waypoints:[] vuelve a la ruta automática). " +
      "ELIMINAR: delete_node quita también sus conexiones y su disponibilidad inicial. " +
      "Las Historias mandan (B2): si el estado final del lote dejaría una Historia inválida (un paso apunta a lo eliminado) se rechaza TODO con REFERENCED_ENTITY (entidad eliminada, Historias y pasos afectados, operación y razón); nada se limpia en silencio. " +
      "Retargetear/quitar pasos y eliminar en el mismo lote es válido (se evalúa el estado final). Las {ref} valen también en update_*/delete_* y en los destinos de los pasos (target: {ref} | {edgeId:{ref}} | {nodeId:{ref}} | {from:{ref},to:{ref}}, nodeId de set_initial_availability). " +
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
      "edit_diagram es LEGACY (no se retira, no cambia): la autoría moderna del diagrama usa author_document. " +
      "El tiempo es narrativo: add_step añade al final tras 'waitMs' (o 'al mismo tiempo' con placement) y set_wait fija la espera de un momento " +
      "(no se escribe el tiempo absoluto). Eliminar y duplicar siguen la política de la app (eliminar colapsa la espera; duplicar entra en el mismo momento). " +
      "Requiere 'baseRevision': la 'revision' que devolvió describe_document para ESTE documento; si no coincide se rechaza. " +
      "Con dryRun:true se valida y se devuelven los cambios sin documento. " +
      "waitMs: add_step por defecto 1000 (el primero 0); set_wait lo cuenta desde el momento anterior y desplaza los posteriores; move_step {direction}|{to:{gapIndex}|{sameMomentAs,after}}. " +
      "Devuelve 'changes' (qué hizo cada operación y a qué Historias/pasos afecta) y 'resultRevision'. Después usa run_story para ver el Trace.",
    inputSchema: {
      document: DocumentInputSchema,
      baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).describe("La 'revision' de este documento según describe_document."),
      operations: z.array(AuthoringOperationSchema).min(1).max(200),
      dryRun: z.boolean().default(false).describe("Sólo validar y devolver los cambios; no se devuelve documento."),
    },
  },
  async ({ document, baseRevision, operations, dryRun }) => {
    try {
      const result = authorDocument({ document, baseRevision, operations, dryRun });
      const blocks = [summarizeAuthoring(result), JSON.stringify(result, null, 2)];
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
      "SOLO LECTURA: no modifica el documento ni devuelve uno nuevo. Calcula con el auto-layout por capas de Fluyo (el de create_diagram y edit_diagram.relayout) dónde colocar los elementos de UNA página (pageIndex; por defecto la actual) " +
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
      const blocks = [summarizeLayout(result), JSON.stringify(result, null, 2)];
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
  baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).describe("La 'revision' de describe_document."),
  dryRun: z.boolean().default(false).describe("Solo validar: sin documento."),
};
const NodeIds = z.array(z.strictObject({ id: z.number().int().min(1) })).min(1).max(100).describe("Elementos por {id}.");

async function runSingle(input: { document: unknown; baseRevision: string; dryRun?: boolean }, operation: Record<string, unknown>): Promise<ToolResult> {
  try {
    const result = authorSingle(input, operation);
    const blocks = [summarizeAuthoring(result), JSON.stringify(result, null, 2)];
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
      "Requiere baseRevision (la 'revision' de describe_document). Equivale a set_theme de author_document.",
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

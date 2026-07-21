import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { PALETTE, ICONS, CANVAS } from "./schema.js";
import { CreateDiagramInputShape, OperationSchema, ThemeSchema, FluyoProjectSchema } from "./model.js";
import { createDiagram, editDiagram } from "./diagram.js";
import { pageToSVG } from "./svg.js";
import { TEMPLATES, getTemplate } from "./templates.js";

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

/** Registra las herramientas de Fluyo sobre una instancia nueva de McpServer. Separado de
 *  index.ts para poder conectarlo tanto a stdio (uso real) como a un InMemoryTransport
 *  (scripts/smoke-test.ts) sin duplicar las definiciones de herramientas. */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "fluyo-mcp", version: "0.1.0" });

/* ===================== create_diagram ===================== */

server.registerTool(
  "create_diagram",
  {
    title: "Crear diagrama Fluyo",
    description:
      "Crea un diagrama de arquitectura completo (formato .fluyo.json) a partir de una lista de nodos y aristas. " +
      "Si un nodo no trae x/y, se posiciona automáticamente en capas de izquierda a derecha según las aristas (auto-layout). " +
      "El JSON resultante se puede abrir directo en fluyo (botón Abrir) o seguir editando con edit_diagram / exportando con export_diagram. " +
      "Usa list_icons para ver íconos válidos y list_templates si el patrón ya existe como plantilla.",
    inputSchema: CreateDiagramInputShape,
  },
  async (input) => {
    try {
      const project = createDiagram(input);
      return ok(summarize(project), JSON.stringify(project, null, 2));
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
    description:
      "Aplica una lista de operaciones (add_node, update_node, remove_node, add_edge, update_edge, remove_edge, set_theme, rename_page, relayout) " +
      "sobre un documento Fluyo existente (el JSON completo devuelto por create_diagram o cargado desde un .fluyo.json). " +
      "Las operaciones se aplican en orden; add_node puede definir un 'key' temporal que add_edge referencia en la misma llamada. " +
      "Para editar nodos/aristas ya existentes en el documento, usa su 'id' numérico (visible en el JSON del documento).",
    inputSchema: {
      document: z.any().describe("El documento Fluyo completo (objeto JSON, tal como lo devuelve create_diagram o export/abre la app)."),
      pageIndex: z.number().optional().describe("Índice de página a editar (por defecto, la página actual del documento)."),
      operations: z.array(OperationSchema).min(1),
    },
  },
  async ({ document, pageIndex, operations }) => {
    try {
      const project = editDiagram({ document, pageIndex, operations });
      return ok(summarize(project), JSON.stringify(project, null, 2));
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
    description:
      "Renderiza una página de un documento Fluyo a SVG estático (mismos colores, formas e íconos que 'Exportar' dentro de la app). " +
      "Útil para pegar el diagrama en Notion/Confluence/Markdown o previsualizarlo sin abrir Fluyo. " +
      "No incluye animación (puntos de flujo ni aparición escalonada), igual que el SVG que exporta la app.",
    inputSchema: {
      document: z.any().describe("El documento Fluyo completo a exportar."),
      pageIndex: z.number().optional().describe("Índice de página a exportar (por defecto, la página actual)."),
      format: z.enum(["svg"]).default("svg").describe("Formato de salida. Por ahora solo 'svg' (PNG/GIF requieren un renderer de canvas y están en el roadmap)."),
      scale: z.number().min(0.25).max(4).default(1).describe("Escala de las dimensiones width/height del SVG resultante."),
    },
  },
  async ({ document, pageIndex, scale }) => {
    try {
      const project = FluyoProjectSchema.parse(document);
      const idx = pageIndex ?? project.doc.cur ?? 0;
      const page = project.doc.pages[idx];
      if (!page) throw new Error(`pageIndex ${idx} fuera de rango (el documento tiene ${project.doc.pages.length} página(s)).`);
      const svg = pageToSVG(page, project.doc.theme, scale);
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
    description: "Devuelve las claves de ícono válidas para nodos shape='icon', agrupadas por proveedor (General, GCP, AWS, Azure).",
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
    description: "Devuelve los nombres de color semántico aceptados en 'color', 'lineColor' y 'dotColor' (también se acepta cualquier hex #rrggbb).",
    inputSchema: {},
  },
  async () => {
    const text = PALETTE.map(p => `${p.name} -> ${p.hex}`).join("\n");
    return ok(text);
  }
);

/* ===================== list_templates / create_from_template ===================== */

server.registerTool(
  "list_templates",
  {
    title: "Listar templates de diagramas",
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
    description:
      "Instancia uno de los templates de list_templates como un documento Fluyo completo, con auto-layout aplicado. " +
      "Se pueden personalizar los labels de los nodos vía 'labelOverrides' (mapa key -> nuevo texto).",
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
      const { nodes, edges, suggestedTheme, suggestedPageName } = tpl.build(labelOverrides);
      const project = createDiagram({
        pageName: pageName ?? suggestedPageName,
        theme: theme ?? suggestedTheme,
        grid: true,
        build: false,
        autoLayout: true,
        nodes,
        edges,
      });
      return ok(summarize(project), JSON.stringify(project, null, 2));
    } catch (err) {
      return fail(err);
    }
  }
);

  return server;
}

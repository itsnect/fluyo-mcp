import { ANIMS, CANVAS, DEFAULT_SIZES, ICONS, colorNameToHex, resolveColor } from "./schema.js";
import { describeDocumentIssues, describeInternalIssues } from "./errors.js";
import { createKernel } from "./kernel.js";
import { layeredLayout, layoutPage } from "./layout.js";
import { revisionOfProject } from "./revision.js";
import { findTemplate, unknownOverrideKeys, unknownOverridesMessage } from "./templates.js";
import {
  FluyoNode,
  FluyoEdge,
  FluyoProject,
  FluyoProjectSchema,
  NodeSpec,
  NodeBuildSpec,
  EdgeSpec,
  Operation,
  ThemeName,
} from "./model.js";

/* ===================== Validación del documento ===================== */

/** Valida un documento que llega de fuera. Nunca deja escapar un ZodError crudo:
 *  el modelo tiene que poder leer qué pasó y qué hacer. */
export function parseDocument(document: unknown): FluyoProject {
  const res = FluyoProjectSchema.safeParse(document);
  if (!res.success) throw new Error(describeDocumentIssues(document, res.error.issues));
  return res.data;
}

/** Revalida lo que produce el propio servidor antes de devolverlo. Un fallo aquí es
 *  un bug de fluyo-mcp, y el mensaje lo dice en vez de culpar al usuario. */
function parseOwnOutput(project: unknown): FluyoProject {
  const res = FluyoProjectSchema.safeParse(project);
  if (!res.success) throw new Error(describeInternalIssues(res.error.issues));
  return res.data;
}

/* ===================== Utilidades comunes ===================== */

function assertValidIcon(shape: string, icon: string | undefined) {
  if (shape === "icon") {
    if (!icon) throw new Error("Los nodos con shape='icon' requieren el campo 'icon' (usa list_icons).");
    if (!ICONS[icon]) throw new Error(`Ícono desconocido: "${icon}". Usa list_icons para ver las claves válidas.`);
  }
}

function assertValidAnim(shape: string, anim: string | undefined) {
  if (shape === "anim") {
    if (!anim) throw new Error("Los nodos con shape='anim' requieren el campo 'anim' (usa list_anims).");
    if (!ANIMS[anim]) throw new Error(`GIF animado desconocido: "${anim}". Usa list_anims para ver las claves válidas.`);
  }
}

/* defaultLabelFor / buildNode / buildEdge: SOLO edit_diagram (LEGACY, decisión 96; su retirada es FLUYO-018.10). create_diagram y
   create_from_template ya no los usan: crean con el dominio (createNodeIn/createConnectionIn vía FluyoAuthoring). */

/** Etiqueta por defecto según la forma, igual que `newNode()` en fluyo/js/state.js:
 *  un rectángulo recién creado dice "Nodo" y un texto dice "Texto", mientras que los
 *  iconos, imágenes y GIFs nacen sin etiqueta. */
function defaultLabelFor(shape: string): string {
  if (shape === "text") return "Texto";
  if (shape === "icon" || shape === "image" || shape === "anim") return "";
  return "Nodo";
}

/** Construye un FluyoNode completo a partir de una especificación de alto nivel.
 *  Los campos de estilo solo se escriben si vienen: un nodo sin `fill` no debe
 *  acabar con `fill: null`, porque eso ya es una decisión que nadie tomó. */
function buildNode(
  id: number,
  spec: Omit<NodeBuildSpec, "key">,
  fallbackOrder: number
): FluyoNode {
  assertValidIcon(spec.shape, spec.icon);
  assertValidAnim(spec.shape, spec.anim);
  const [defW, defH] = DEFAULT_SIZES[spec.shape];
  return {
    id,
    shape: spec.shape,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    w: spec.w ?? defW,
    h: spec.h ?? defH,
    label: spec.label ?? defaultLabelFor(spec.shape),
    color: resolveColor(spec.color),
    pulse: spec.pulse ?? false,
    order: spec.order ?? fallbackOrder,
    icon: spec.shape === "icon" ? spec.icon : undefined,
    anim: spec.shape === "anim" ? spec.anim : undefined,
    /* Igual que `newNode()` en la app: el interruptor solo existe donde significa
       algo, y nace apagado para que un ícono creado por MCP y uno creado a mano
       se vean igual. */
    ...(spec.shape === "icon" ? { tint: spec.tint ?? false } : {}),
    fs: spec.fs ?? null,
    // 'none' es un valor legal de fill (forma hueca), no un color a resolver.
    ...(spec.fill !== undefined ? { fill: spec.fill === "none" ? "none" : resolveColor(spec.fill) } : {}),
    ...(spec.border !== undefined ? { border: spec.border } : {}),
    ...(spec.lblPos !== undefined ? { lblPos: spec.lblPos } : {}),
    ...(spec.textBg !== undefined ? { textBg: resolveColor(spec.textBg) } : {}),
    ...(spec.textColor !== undefined ? { textColor: resolveColor(spec.textColor) } : {}),
    ...(spec.lang !== undefined ? { lang: spec.lang } : {}),
    ...(spec.keywords !== undefined ? { keywords: spec.keywords } : {}),
    ...(spec.kwBg !== undefined ? { kwBg: resolveColor(spec.kwBg) } : {}),
    ...(spec.kwColor !== undefined ? { kwColor: resolveColor(spec.kwColor) } : {}),
    ...(spec.font !== undefined ? { font: spec.font } : {}),
    ...(spec.bold !== undefined ? { bold: spec.bold } : {}),
  };
}

/** Construye un FluyoEdge completo a partir de una especificación de alto nivel. */
function buildEdge(
  id: number,
  fromId: number,
  toId: number,
  spec: Omit<EdgeSpec, "from" | "to">
): FluyoEdge {
  return {
    id,
    from: fromId,
    to: toId,
    fromSide: spec.fromSide ?? null,
    toSide: spec.toSide ?? null,
    route: spec.route ?? "straight",
    waypoints: [],
    label: spec.label ?? "",
    animated: spec.animated ?? true,
    dashed: spec.dashed ?? false,
    startArrow: spec.startArrow ?? false,
    endArrow: spec.endArrow ?? true,
    flowDir: spec.flowDir ?? "normal",
    lineColor: spec.lineColor ? resolveColor(spec.lineColor) : null,
    dotColor: spec.dotColor ? resolveColor(spec.dotColor) : null,
    fs: spec.fs ?? null,
    ...(spec.font !== undefined ? { font: spec.font } : {}),
    ...(spec.bold !== undefined ? { bold: spec.bold } : {}),
    ...(spec.speedFac !== undefined ? { speedFac: spec.speedFac } : {}),
    ...(spec.dots !== undefined ? { dots: spec.dots, dotsGlobal: spec.dotsGlobal ?? false } : {}),
    ...(spec.dots === undefined && spec.dotsGlobal !== undefined ? { dotsGlobal: spec.dotsGlobal } : {}),
  };
}

function boundingBox(nodes: FluyoNode[]) {
  if (!nodes.length) return { minX: CANVAS.W / 2, maxX: CANVAS.W / 2, minY: 0, maxY: CANVAS.H };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  return { minX, maxX, minY, maxY };
}

/* ===================== create_diagram / create_from_template (FLUYO-018.9) =====================
   ADAPTADORES DE ENTRADA sobre el dominio. Aquí no se construye ningún documento, nodo ni conexión:

     entrada de la tool ─► keys, nombres de color → HEX, auto-layout (lo único propio de estas tools)
                        ─► documento en blanco del editor + ajustes (model.js: `doc` inicial, settingsFromProjectData)
                        ─► rename_page · set_theme · create_node · create_connection ─► FluyoAuthoring.apply (lotes ≤ MAX_OPERATIONS)
                        ─► documento v5 canónico del kernel (el mismo, byte a byte, que la construcción con author_document)

   Defaults, ids, campos persistidos, reglas de entrada (HEX, catálogos), auto-lazo, límites y nombre de página los decide el
   kernel, exactamente como en author_document. Este módulo solo traduce el contrato de la tool y sus errores. */

export interface CreateDiagramInput {
  pageName?: string;
  theme?: ThemeName;
  grid?: boolean;
  build?: boolean;
  autoLayout?: boolean;
  speed?: number;
  dots?: number;
  stagger?: number;
  single?: boolean;
  font?: string;
  customBg?: string;
  nodes: NodeSpec[];
  edges?: EdgeSpec[];
}

export type DiagramError = Record<string, unknown> & { code: string; message: string };
interface Head { engineVersion: number; kernelId: string }
export type CreateDiagramResult =
  | { ok: true; project: FluyoProject; revision: string }
  | ({ ok: false; valid: false; errors: DiagramError[]; note: string } & Head);

interface KernelApply {
  ok: boolean;
  project?: unknown;
  refs?: Array<{ ref: string; type: "node" | "connection"; id: number }>;
  errors?: DiagramError[];
}

/** Ajustes que fija create_diagram. No hay operación de ajustes en author_document (set_settings está fuera de alcance): van en el
 *  documento en blanco y los normaliza la carga del editor. */
const SETTING_KEYS = ["speed", "dots", "build", "stagger", "grid", "single", "font"] as const;
const NODE_COLOR_FIELDS = ["color", "fill", "textBg", "textColor", "kwBg", "kwColor"];
const EDGE_COLOR_FIELDS = ["lineColor", "dotColor"];

/** De qué parte de la entrada sale cada operación interna: los errores hablan de nodes[i] / edges[j], no de operaciones que nadie escribió. */
interface Origin { input: string; key?: string; spec?: Record<string, unknown> }
interface Step { op: Record<string, unknown>; origin: Origin; ends?: [string, string] }

function rejection(errors: DiagramError[], kernel = createKernel()): CreateDiagramResult {
  return {
    ok: false, valid: false,
    engineVersion: kernel.call<number>("FluyoScenarios.ENGINE_VERSION"), kernelId: kernel.kernelId,
    errors,
    note: "No se devolvió ningún documento.",
  };
}

/** Nombres de la paleta → HEX en los campos de color; lo demás pasa tal cual y lo valida el kernel. */
function withHexColors(spec: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out = { ...spec };
  for (const f of fields) if (out[f] !== undefined) out[f] = colorNameToHex(out[f]);
  return out;
}

/** Las keys son del contrato de esta tool (el dominio usa refs por lote): únicas, y las aristas solo hacia keys declaradas. */
function keyError(nodes: NodeSpec[], edges: EdgeSpec[]): DiagramError | null {
  const seen = new Set<string>();
  for (const [i, n] of nodes.entries()) {
    if (seen.has(n.key)) return { code: "DUPLICATE_REF", message: `nodes[${i}]: la key «${n.key}» está repetida; cada nodo necesita una key única.`, field: "key", input: `nodes[${i}]`, key: n.key, ref: n.key };
    seen.add(n.key);
  }
  for (const [j, e] of edges.entries()) {
    for (const end of ["from", "to"] as const) {
      if (!seen.has(e[end])) return { code: "UNKNOWN_REF", message: `edges[${j}]: '${end}' = «${e[end]}» no es la key de ningún nodo de esta llamada.`, field: end, input: `edges[${j}]`, ref: e[end] };
    }
  }
  return null;
}

/** El ajuste que la carga del editor cambiaría: se rechaza en vez de dejar que el documento diga otra cosa que lo pedido. */
function settingError(key: string, wanted: unknown, normalized: unknown): DiagramError {
  const message = key === "font"
    ? `font: ${JSON.stringify(wanted)} no es una tipografía de Fluyo (el editor la cambiaría por la global por defecto). Usa la familia CSS completa de list_fonts.`
    : `${key}: ${JSON.stringify(wanted)} no es un valor que el editor conserve (lo abriría como ${JSON.stringify(normalized)}).`;
  return { code: "INVALID_FIELD", message, field: key, input: key };
}

/** Posiciones de los nodos sin x/y: auto-layout por capas (el motor de siempre, decisión 98) o rejilla simple. */
function positionsFor(nodes: NodeSpec[], edges: EdgeSpec[], autoLayout: boolean): Map<string, { x: number; y: number }> {
  if (!nodes.some(n => n.x === undefined || n.y === undefined)) return new Map();
  const layoutNodes = nodes.map(n => {
    const [dw, dh] = DEFAULT_SIZES[n.shape];
    return { key: n.key, w: n.w ?? dw, h: n.h ?? dh };
  });
  if (autoLayout) return layeredLayout(layoutNodes, edges.map(e => ({ from: e.from, to: e.to, label: e.label, fs: e.fs, bold: e.bold }))).positions;
  const cols = Math.max(1, Math.ceil(Math.sqrt(layoutNodes.length)));
  return new Map(layoutNodes.map((n, i) => [n.key, { x: 220 + (i % cols) * 260, y: 180 + Math.floor(i / cols) * 180 }]));
}

/** Plan de operaciones de autoría equivalente a la entrada (en el orden del documento: página, aspecto, nodos, conexiones). */
function planOf(input: CreateDiagramInput, edges: EdgeSpec[]): Step[] {
  const steps: Step[] = [];
  if (input.pageName !== undefined) steps.push({ op: { op: "rename_page", scope: "document", pageIndex: 0, name: input.pageName }, origin: { input: "pageName" } });
  const look = { ...(input.theme !== undefined ? { theme: input.theme } : {}), ...(input.customBg !== undefined ? { customBg: input.customBg } : {}) };
  if (Object.keys(look).length) steps.push({ op: { op: "set_theme", scope: "document", ...look }, origin: { input: "theme" } });
  const positions = positionsFor(input.nodes, edges, input.autoLayout ?? true);
  input.nodes.forEach((n, i) => {
    const { key, ...rest } = n;
    const at = positions.get(key);
    const spec = withHexColors({ ...rest, x: n.x ?? at?.x ?? 0, y: n.y ?? at?.y ?? 0 }, NODE_COLOR_FIELDS);
    steps.push({ op: { op: "create_node", scope: "page", pageIndex: 0, ref: key, spec }, origin: { input: `nodes[${i}]`, key, spec: rest } });
  });
  edges.forEach((e, j) => {
    const { from, to, ...rest } = e;
    /* Contrato de siempre de create_diagram: un «dots» propio solo manda con dotsGlobal:false (render.js), así que darlo lo implica. */
    const spec = withHexColors(rest.dots !== undefined && rest.dotsGlobal === undefined ? { ...rest, dotsGlobal: false } : rest, EDGE_COLOR_FIELDS);
    steps.push({
      op: { op: "create_connection", scope: "page", pageIndex: 0, ...(Object.keys(spec).length ? { spec } : {}) },
      origin: { input: `edges[${j}]`, spec: rest },
      ends: [from, to],
    });
  });
  return steps;
}

/** Error del kernel → contrato de la tool: la ruta de la entrada (nodes[i], edges[j], pageName…) en vez del índice de una operación interna. */
function toToolError(e: DiagramError, origin: Origin | undefined, input: CreateDiagramInput, edgeCount: number): DiagramError {
  const { operationIndex: _internal, ...rest } = e;
  if (e.code === "LIMIT_EXCEEDED" && (e.limitName === "maxNodesPerPage" || e.limitName === "maxConnectionsPerPage")) {
    const nodes = e.limitName === "maxNodesPerPage", requested = nodes ? input.nodes.length : edgeCount;
    return { ...rest, input: nodes ? "nodes" : "edges", requested,
      message: `${nodes ? "nodes" : "edges"}: la página tendría ${requested} ${nodes ? "elementos" : "conexiones"} y el límite ${String(e.limitName)} es ${String(e.limit)}.` };
  }
  const where = origin?.input === "theme" && typeof e.field === "string" ? e.field : origin?.input;
  let message = String(e.message).replace(/, operación \d+: \w+\)/, ")");
  const field = typeof e.field === "string" ? e.field : undefined;
  if (e.code === "INVALID_FIELD" && field && origin?.spec && [...NODE_COLOR_FIELDS, ...EDGE_COLOR_FIELDS].includes(field)) {
    message = `«${field}» debe ser un nombre de color de list_colors o un HEX (#rgb, #rrggbb o #rrggbbaa)${field === "fill" ? ' o "none" (sin relleno)' : ""}; recibido ${JSON.stringify(origin.spec[field])}.`;
  }
  const label = where ? `${where}${origin?.key !== undefined ? ` («${origin.key}»)` : ""}: ` : "";
  return { ...rest, ...(typeof rest.where === "string" ? { where: rest.where.replace(/, operación \d+: \w+\)/, ")") } : {}),
    message: label + message, ...(where ? { input: where } : {}), ...(origin?.key !== undefined ? { key: origin.key } : {}) };
}

export function createDiagramResult(input: CreateDiagramInput): CreateDiagramResult {
  const edges = input.edges ?? [];
  const kernel = createKernel();
  const keys = keyError(input.nodes, edges);
  if (keys) return rejection([keys], kernel);

  /* Documento en blanco del editor (`doc` y `settings` iniciales de model.js) con los ajustes pedidos, normalizados por la carga del editor. */
  const wanted: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) if (input[k] !== undefined) wanted[k] = input[k];
  let project = kernel.call<{ settings: Record<string, unknown> }>("projectToSerializable(doc, settingsFromProjectData(Object.assign({}, settings, __a)))", wanted) as unknown;
  const normalized = (project as { settings: Record<string, unknown> }).settings;
  const changed = Object.keys(wanted).find(k => normalized[k] !== wanted[k]);
  if (changed) return rejection([settingError(changed, wanted[changed], normalized[changed])], kernel);

  const steps = planOf(input, edges);
  if (!steps.length) {
    project = kernel.call<{ project: unknown }>("FluyoAuthoring.normalizedProject(__a)", project).project;
  }
  /* Lotes encadenados (≤ MAX_OPERATIONS, como propose_layout): dentro del lote las conexiones usan la ref de sus nodos; entre lotes, el
     id que el dominio asignó (respuesta `refs`). Los límites se evalúan en cada lote sobre el estado acumulado. */
  const max = kernel.call<number>("FluyoAuthoring.MAX_OPERATIONS");
  const idByKey = new Map<string, number>();
  for (let start = 0; start < steps.length; start += max) {
    const chunk = steps.slice(start, start + max);
    const here = new Set(chunk.filter(s => s.op.op === "create_node").map(s => s.op.ref as string));
    const end = (k: string) => (here.has(k) ? { ref: k } : { id: idByKey.get(k) });
    const ops = chunk.map(s => (s.ends ? { ...s.op, source: end(s.ends[0]), target: end(s.ends[1]) } : s.op));
    const r = kernel.call<KernelApply>("FluyoAuthoring.apply(__a.p, __a.o)", { p: project, o: ops });
    if (!r.ok) {
      const errors = r.errors ?? [{ code: "INVALID_OPERATION", message: "El diagrama no se pudo construir." }];
      return rejection(errors.map(e => toToolError(e, chunk[e.operationIndex as number]?.origin, input, edges.length)), kernel);
    }
    for (const ref of r.refs ?? []) if (ref.type === "node") idByKey.set(ref.ref, ref.id);
    project = r.project;
  }
  return { ok: true, project: project as FluyoProject, revision: revisionOfProject(project) };
}

/** Uso interno (tests, scripts): el documento, o un error que lleva los mismos errores estructurados. */
export class DiagramRejected extends Error {
  constructor(readonly errors: DiagramError[]) {
    super(errors[0]?.message ?? "Diagrama rechazado.");
  }
}
export function createDiagram(input: CreateDiagramInput): FluyoProject {
  const r = createDiagramResult(input);
  if (!r.ok) throw new DiagramRejected(r.errors);
  return r.project;
}

export interface CreateFromTemplateInput {
  templateId: string;
  pageName?: string;
  theme?: ThemeName;
  labelOverrides?: Record<string, string>;
}

/** create_from_template: la plantilla da la ENTRADA de create_diagram (nodos, aristas y nombre/tema sugeridos) y sigue la misma ruta. */
export function createFromTemplateResult(args: CreateFromTemplateInput): CreateDiagramResult {
  const tpl = findTemplate(args.templateId);
  if (!tpl) {
    return rejection([{ code: "TEMPLATE_NOT_FOUND", message: `Template desconocido: «${args.templateId}». Usa list_templates para ver los disponibles.`, field: "templateId", input: "templateId" }]);
  }
  const overrides = args.labelOverrides ?? {};
  const unknown = unknownOverrideKeys(tpl, overrides);
  if (unknown.length) {
    return rejection([{ code: "INVALID_FIELD", message: unknownOverridesMessage(tpl, unknown), field: `labelOverrides.${unknown[0]}`, input: "labelOverrides", unknownKeys: unknown, allowed: tpl.overridableKeys }]);
  }
  const { nodes, edges, suggestedTheme, suggestedPageName } = tpl.build(overrides);
  return createDiagramResult({ pageName: args.pageName ?? suggestedPageName, theme: args.theme ?? suggestedTheme, nodes, edges });
}

/* ===================== edit_diagram ===================== */

export interface EditDiagramInput {
  document: unknown;
  pageIndex?: number;
  operations: Operation[];
}

export function editDiagram(input: EditDiagramInput): FluyoProject {
  const project = parseDocument(input.document);
  const pageIndex = input.pageIndex ?? project.doc.cur ?? 0;
  const page = project.doc.pages[pageIndex];
  if (!page) throw new Error(`pageIndex ${pageIndex} fuera de rango (el documento tiene ${project.doc.pages.length} página(s)).`);

  let nextId = page.nextId;
  const keyMap = new Map<string, number>(); // keys temporales de add_node -> id asignado en esta llamada
  let freshCount = 0; // para separar verticalmente nodos agregados sin coords en el mismo batch

  const findNodeIdx = (id: number) => {
    const idx = page.nodes.findIndex(n => n.id === id);
    if (idx === -1) throw new Error(`No existe un nodo con id=${id} en la página ${pageIndex}.`);
    return idx;
  };
  const findEdgeIdx = (id: number) => {
    const idx = page.edges.findIndex(e => e.id === id);
    if (idx === -1) throw new Error(`No existe una arista con id=${id} en la página ${pageIndex}.`);
    return idx;
  };
  const resolveRef = (ref: number | string): number => {
    if (typeof ref === "number") {
      if (!page.nodes.some(n => n.id === ref)) throw new Error(`add_edge referencia un nodo id=${ref} que no existe.`);
      return ref;
    }
    const id = keyMap.get(ref);
    if (id === undefined) throw new Error(`add_edge referencia el key "${ref}", pero ningún add_node anterior en esta llamada lo definió.`);
    return id;
  };

  for (const op of input.operations) {
    switch (op.op) {
      case "add_node": {
        const id = nextId++;
        const { key, shape, op: _discriminant, ...rest } = op;
        let { x, y } = rest;
        if (x === undefined || y === undefined) {
          const bb = boundingBox(page.nodes);
          const [dw] = DEFAULT_SIZES[shape];
          x = x ?? bb.maxX + 260 + dw / 2;
          y = y ?? (bb.minY + bb.maxY) / 2 + freshCount * 130;
          freshCount++;
        }
        const node = buildNode(id, { ...rest, shape, x, y }, page.nodes.length);
        page.nodes.push(node);
        keyMap.set(key, id);
        break;
      }
      case "update_node": {
        const idx = findNodeIdx(op.id);
        const current = page.nodes[idx];
        const { id, op: _discriminant, ...fields } = op;
        assertValidIcon(fields.shape ?? current.shape, fields.icon ?? current.icon);
        page.nodes[idx] = {
          ...current,
          ...fields,
          color: fields.color !== undefined ? resolveColor(fields.color) : current.color,
        };
        break;
      }
      case "remove_node": {
        findNodeIdx(op.id); // valida que exista
        page.nodes = page.nodes.filter(n => n.id !== op.id);
        page.edges = page.edges.filter(e => e.from !== op.id && e.to !== op.id);
        break;
      }
      case "add_edge": {
        const id = nextId++;
        const fromId = resolveRef(op.from);
        const toId = resolveRef(op.to);
        const { from, to, op: _discriminant, ...rest } = op;
        page.edges.push(buildEdge(id, fromId, toId, rest));
        break;
      }
      case "update_edge": {
        const idx = findEdgeIdx(op.id);
        const current = page.edges[idx];
        const { id, op: _discriminant, ...fields } = op;
        page.edges[idx] = {
          ...current,
          ...fields,
          lineColor: fields.lineColor !== undefined ? resolveColor(fields.lineColor) : current.lineColor,
          dotColor: fields.dotColor !== undefined ? resolveColor(fields.dotColor) : current.dotColor,
        };
        break;
      }
      case "remove_edge": {
        findEdgeIdx(op.id);
        page.edges = page.edges.filter(e => e.id !== op.id);
        break;
      }
      case "set_theme": {
        project.doc.theme = op.theme;
        break;
      }
      case "rename_page": {
        page.name = op.name;
        break;
      }
      case "relayout": {
        const positions = layoutPage(page);
        page.nodes = page.nodes.map(n => {
          const p = positions.get(n.id);
          return p ? { ...n, x: p.x, y: p.y } : n;
        });
        // Las aristas con waypoints manuales pueden quedar desalineadas tras relayout.
        page.edges = page.edges.map(e => ({ ...e, waypoints: [] }));
        break;
      }
    }
  }

  page.nextId = nextId;
  return parseOwnOutput(project);
}

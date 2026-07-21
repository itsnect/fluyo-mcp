import { CANVAS, DEFAULT_SIZES, ICONS, resolveColor } from "./schema.js";
import { layeredLayout } from "./layout.js";
import {
  FluyoNode,
  FluyoEdge,
  FluyoPage,
  FluyoProject,
  FluyoProjectSchema,
  NodeSpec,
  NodeBuildSpec,
  EdgeSpec,
  Operation,
} from "./model.js";

/* ===================== Utilidades comunes ===================== */

function assertValidIcon(shape: string, icon: string | undefined) {
  if (shape === "icon") {
    if (!icon) throw new Error("Los nodos con shape='icon' requieren el campo 'icon' (usa list_icons).");
    if (!ICONS[icon]) throw new Error(`Ícono desconocido: "${icon}". Usa list_icons para ver las claves válidas.`);
  }
}

/** Construye un FluyoNode completo a partir de una especificación de alto nivel. */
export function buildNode(
  id: number,
  spec: Omit<NodeBuildSpec, "key">,
  fallbackOrder: number
): FluyoNode {
  assertValidIcon(spec.shape, spec.icon);
  const [defW, defH] = DEFAULT_SIZES[spec.shape];
  return {
    id,
    shape: spec.shape,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    w: spec.w ?? defW,
    h: spec.h ?? defH,
    label: spec.label ?? "",
    color: resolveColor(spec.color),
    pulse: spec.pulse ?? false,
    order: spec.order ?? fallbackOrder,
    icon: spec.shape === "icon" ? spec.icon : undefined,
    fs: spec.fs ?? null,
  };
}

/** Construye un FluyoEdge completo a partir de una especificación de alto nivel. */
export function buildEdge(
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

/* ===================== create_diagram ===================== */

export interface CreateDiagramInput {
  pageName: string;
  theme: "dark" | "crema" | "claro";
  grid: boolean;
  build: boolean;
  autoLayout: boolean;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

export function createDiagram(input: CreateDiagramInput): FluyoProject {
  const keys = input.nodes.map(n => n.key);
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupKey) throw new Error(`El key de nodo "${dupKey}" está repetido. Cada nodo necesita un key único.`);

  const idByKey = new Map<string, number>();
  input.nodes.forEach((n, i) => idByKey.set(n.key, i + 1));

  for (const e of input.edges) {
    if (!idByKey.has(e.from)) throw new Error(`La arista referencia un 'from' inexistente: "${e.from}".`);
    if (!idByKey.has(e.to)) throw new Error(`La arista referencia un 'to' inexistente: "${e.to}".`);
  }

  // Posiciones: auto-layout por capas para los nodos sin x/y explícitos.
  const needsLayout = input.nodes.filter(n => n.x === undefined || n.y === undefined);
  let computedPositions = new Map<string, { x: number; y: number }>();
  if (needsLayout.length) {
    const layoutNodes = input.nodes.map(n => {
      const [dw, dh] = DEFAULT_SIZES[n.shape];
      return { key: n.key, w: n.w ?? dw, h: n.h ?? dh };
    });
    const layoutEdges = input.edges.map(e => ({ from: e.from, to: e.to }));
    if (input.autoLayout) {
      computedPositions = layeredLayout(layoutNodes, layoutEdges).positions;
    } else {
      // Grid simple de respaldo si el llamante desactivó el auto-layout.
      const cols = Math.max(1, Math.ceil(Math.sqrt(layoutNodes.length)));
      layoutNodes.forEach((n, i) => {
        computedPositions.set(n.key, {
          x: 220 + (i % cols) * 260,
          y: 180 + Math.floor(i / cols) * 180,
        });
      });
    }
  }

  const nodes: FluyoNode[] = input.nodes.map((spec, i) => {
    const id = idByKey.get(spec.key)!;
    const pos = spec.x === undefined || spec.y === undefined ? computedPositions.get(spec.key) : undefined;
    return buildNode(id, { ...spec, x: spec.x ?? pos?.x, y: spec.y ?? pos?.y }, i);
  });

  let nextId = nodes.length + 1;
  const edges: FluyoEdge[] = input.edges.map(spec => {
    const id = nextId++;
    return buildEdge(id, idByKey.get(spec.from)!, idByKey.get(spec.to)!, spec);
  });

  const page: FluyoPage = { name: input.pageName, nodes, edges, nextId };

  const project: FluyoProject = {
    version: 3,
    app: "fluyo",
    doc: { theme: input.theme, pages: [page], cur: 0 },
    settings: { speed: 0.5, dots: 3, build: input.build, stagger: 0.45, grid: input.grid },
  };

  return FluyoProjectSchema.parse(project);
}

/* ===================== edit_diagram ===================== */

export interface EditDiagramInput {
  document: unknown;
  pageIndex?: number;
  operations: Operation[];
}

export function editDiagram(input: EditDiagramInput): FluyoProject {
  const project = FluyoProjectSchema.parse(input.document);
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
        const layoutNodes = page.nodes.map(n => ({ key: n.id, w: n.w, h: n.h }));
        const layoutEdges = page.edges.map(e => ({ from: e.from, to: e.to }));
        const { positions } = layeredLayout(layoutNodes, layoutEdges);
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
  return FluyoProjectSchema.parse(project);
}

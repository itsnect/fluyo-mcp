/**
 * MCP-TOKEN-EFFICIENCY-003 — la sesión típica de un agente (la de la auditoría, §1), repetible con el documento como JSON o como enlace.
 *
 * No importa nada de src/: la misma sesión se ejecuta contra este servidor (test) y contra la build de la base (hoy 3d9cda7, FASE 5; captura del
 * golden de test/fixtures/mcp-token-efficiency-003-golden.json, con `node` directamente: solo usa tipos borrables).
 *
 *   modo "json": cada llamada lleva el documento como objeto, como hasta ahora (las de lectura, sin baseRevision).
 *   modo "link": cada llamada lleva el ENLACE que trajo la respuesta anterior (resumen de create_*, editorUrl de la autoría) y su
 *                revisión como baseRevision. Las respuestas deben ser idénticas byte a byte a las del modo "json".
 */

export interface ToolResponse { content: Array<{ type: string; text: string }>; isError?: boolean }
export type Call = (name: string, args: Record<string, unknown>) => Promise<ToolResponse>;
export interface SessionStep { tag: string; name: string; args: Record<string, unknown>; response: ToolResponse }

/** Lo que el agente lleva de una respuesta a la siguiente. */
interface Carry { doc: unknown; link: string; revision: string; ids: Record<string, number> }

const LINK_IN_TEXT = /\S*#d=[A-Za-z0-9_-]+/;

function fromCreate(r: ToolResponse): Carry {
  const summary = r.content[0].text;
  const revision = /^revision (sha256:[0-9a-f]{64}) /m.exec(summary)?.[1];
  const link = LINK_IN_TEXT.exec(summary)?.[0];
  if (!revision || !link) throw new Error(`create_* sin revisión o enlace en el resumen: ${summary.slice(0, 300)}`);
  const ids: Record<string, number> = {};
  for (const p of /^Ids por key: (.*)\.$/m.exec(summary)?.[1].split(", ") ?? []) { const [k, v] = p.split("="); ids[k] = Number(v); }
  return { doc: JSON.parse(r.content[1].text), link, revision, ids };
}
function fromAuthor(r: ToolResponse, prev: Carry): Carry {
  const j = JSON.parse(r.content[1].text);
  if (!j.ok) throw new Error(`autoría rechazada: ${JSON.stringify(j.errors).slice(0, 400)}`);
  return { doc: j.document, link: j.editorUrl, revision: j.resultRevision, ids: prev.ids };
}

export async function runSession(call: Call, opts: { n: number; mode: "json" | "link" }): Promise<SessionStep[]> {
  const steps: SessionStep[] = [];
  const link = opts.mode === "link";
  const go = async (tag: string, name: string, args: Record<string, unknown>) => {
    const response = await call(name, args);
    steps.push({ tag, name, args, response });
    return response;
  };
  /** El documento como lo pasa el agente: objeto, o enlace + su revisión (en las de lectura, la revisión solo con enlace). */
  const doc = (c: Carry, read: boolean): Record<string, unknown> =>
    link ? { document: c.link, baseRevision: c.revision } : read ? { document: c.doc } : { document: c.doc, baseRevision: c.revision };

  const N = opts.n;
  const keys = Array.from({ length: N }, (_, i) => `n${i}`);
  const nodes = keys.map((key, i) => ({ key, shape: i % 4 === 3 ? "cylinder" : "rect", label: `Servicio ${i}` }));
  const edges: Array<Record<string, unknown>> = keys.slice(1).map((k, i) => (i % 3 ? { from: keys[i], to: k } : { from: keys[i], to: k, label: "HTTP" }));
  edges.push({ from: keys[0], to: keys[3] }, { from: keys[2], to: keys[5] });

  let c = fromCreate(await go("1 create_diagram", "create_diagram", { pageName: "Checkout", nodes, edges }));
  const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
  const story = [
    { op: "create_event_type", scope: "eventType", ref: "req", name: "Petición", primitive: "FLOW", sentence: "{source} pide a {target}" },
    { op: "create_event_type", scope: "eventType", ref: "res", name: "Respuesta", primitive: "FLOW", sentence: "{source} responde a {target}" },
    { op: "create_event_type", scope: "eventType", ref: "down", name: "Cae", primitive: "SET_AVAILABILITY", availability: "DOWN", sentence: "{target} cae" },
    { op: "create_story", scope: "story", pageIndex: 0, name: "Compra" },
    ...keys.slice(1).map((k, i) => S("add_step", { eventTypeId: { ref: "req" }, target: { from: c.ids[keys[i]], to: c.ids[k] }, waitMs: 500 })),
    S("add_step", { eventTypeId: { ref: "down" }, target: { nodeId: c.ids[keys[N - 1]] }, waitMs: 500 }),
  ];
  c = fromAuthor(await go("2 author_document (eventos + Historia)", "author_document", { ...doc(c, false), operations: story }), c);
  await go("3 run_story", "run_story", { ...doc(c, true), storyId: 1 });

  const edgeTo = (key: string) => ((c.doc as any).doc.pages[0].edges as Array<{ id: number; to: number }>).find(e => e.to === c.ids[key])!.id;
  const replies = keys.slice(1).reverse().slice(0, 3).map(k => S("add_step", { eventTypeId: 2, target: { edgeId: edgeTo(k), reverse: true }, waitMs: 500 }));
  c = fromAuthor(await go("4 author_document (respuestas reverse)", "author_document", {
    ...doc(c, false),
    operations: [...replies, { op: "update_node", scope: "page", pageIndex: 0, node: { id: c.ids.n0 }, spec: { label: "Cliente" } }],
  }), c);
  await go("5 run_story", "run_story", { ...doc(c, true), storyId: 1, pageIndex: 0 });
  await go("6 describe_document", "describe_document", { ...doc(c, true) });
  await go("7 describe_document (sin pasos, página 0)", "describe_document", { ...doc(c, true), includeSteps: false, pageIndex: 0 });
  await go("8 export_diagram", "export_diagram", { ...doc(c, true), crop: true, scale: 0.5 });
  await go("9 propose_layout", "propose_layout", { document: link ? c.link : c.doc, baseRevision: c.revision });
  await go("10 author_document dryRun", "author_document", { ...doc(c, false), dryRun: true, operations: [S("set_wait", { stepId: 2, waitMs: 800 })] });
  c = fromAuthor(await go("11 set_theme", "set_theme", { ...doc(c, false), theme: "crema" }), c);
  c = fromAuthor(await go("12 reorder_nodes", "reorder_nodes", { ...doc(c, false), pageIndex: 0, nodes: [{ id: c.ids.n1 }], to: "front" }), c);
  c = fromAuthor(await go("13 duplicate_node", "duplicate_node", { ...doc(c, false), pageIndex: 0, nodes: [{ id: c.ids.n1 }, { id: c.ids.n2 }] }), c);
  await go("14 run_story (final)", "run_story", { ...doc(c, true), storyId: 1 });
  await go("15 export_diagram (final)", "export_diagram", { ...doc(c, true) });

  const t = fromCreate(await go("16 create_from_template", "create_from_template", { templateId: "microservices_gateway", labelOverrides: { db: "Cloud SQL" } }));
  await go("17 describe_document (plantilla)", "describe_document", { ...doc(t, true) });
  return steps;
}

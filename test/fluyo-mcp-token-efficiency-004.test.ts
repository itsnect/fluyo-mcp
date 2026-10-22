/**
 * FLUYO-MCP-TOKEN-EFFICIENCY-004 — `returnDocument:false` en author_document y create_diagram (contrato §7 de
 * FLUYO-MCP-TOKEN-EFFICIENCY-004.md, alcance A4).
 *
 *   T1. Catálogo: returnDocument {default:true, description, type:"boolean"} SOLO en author_document y create_diagram, sin $ref y fuera
 *       de required; tools/list ≤ 63 000 B (< 72 000).
 *   T2. Identidad: sin el flag y con returnDocument:true, cada respuesta es la misma byte a byte (sesión de TE-003 en JSON y en enlace,
 *       N=10, y una autoría por ejemplo publicado).
 *   T3. author_document con false y enlace: sin la clave `document`; el resto, el de true; la frase del resumen. También con pageMap
 *       (delete_page) y con warnings (ARRIVAL_DEPENDENCY_INACTIVE).
 *   T4. create_diagram con false y enlace: un bloque = el resumen de true + la línea; con LINK_TOO_LARGE, la respuesta de siempre.
 *   T5. author_document con false y LINK_TOO_LARGE: la respuesta de siempre (document + editorUrlError).
 *   T6. dryRun y rechazos con false: idénticos a sin el flag (REVISION_MISMATCH, LINK_REVISION_MISMATCH, DOCUMENT_LINK_UNREADABLE,
 *       REFERENCED_ENTITY, LIMIT_EXCEEDED, validación de Zod, rechazo de create_diagram).
 *   T7. Encadenado: una sesión entera con enlace + false, sin leer nunca un documento, acaba en la misma revisión que con documento; la
 *       recuperación (repetir la última escritura sin el flag) da un documento de esa revisión.
 *   T8. Fuera de alcance: returnDocument en set_theme, reorder_nodes, duplicate_node y create_from_template no cambia la respuesta.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../src/server.js";
import { createKernel } from "../src/kernel.js";
import { revisionOf } from "../src/revision.js";
import { isToolError, loadFixtures, textBlocks } from "./helpers.js";
import { runSession, type Call, type ToolResponse } from "./token-efficiency-003-session.js";

const WITH_FLAG = ["author_document", "create_diagram"];
const OMITTED_AUTHOR = "Sin documento (returnDocument:false): sigue con editorUrl y resultRevision.";
const OMITTED_CREATE = "\nSin documento (returnDocument:false): sigue con el enlace y la revision.";
const OTHER_REV = "sha256:" + "0".repeat(64);
const LINK_IN_TEXT = /\S*#d=[A-Za-z0-9_-]+/;

async function connect() {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "token-efficiency-004", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const call: Call = (name, args) => client.callTool({ name, arguments: args }) as Promise<ToolResponse>;
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}
let h: Awaited<ReturnType<typeof connect>>;
before(async () => { h = await connect(); });
after(async () => { await h.close(); });

const bytesOf = (r: ToolResponse) => JSON.stringify(r);
const json = (r: ToolResponse) => JSON.parse(textBlocks(r)[1]);
const rev = (doc: unknown) => revisionOf(createKernel(), doc) as string;
const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, storyId: 1, ...extra });
const rect = (key: string, label = key) => ({ key, shape: "rect", label });

/** Un diagrama A→B→C por create_diagram: enlace, revisión, ids de aristas y el documento (para las comparaciones con true). */
async function abc() {
  const r = await h.call("create_diagram", { nodes: [rect("a", "A"), rect("b", "B"), rect("c", "C")], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] });
  const summary = textBlocks(r)[0];
  return {
    doc: JSON.parse(textBlocks(r)[1]),
    link: LINK_IN_TEXT.exec(summary)![0],
    revision: /^revision (sha256:[0-9a-f]{64}) /m.exec(summary)![1],
    edges: /^Ids de aristas \(orden de edges\): (.*)\.$/m.exec(summary)![1].split(", ").map(Number),
  };
}
/** La misma llamada a author_document con returnDocument false y true (y sin el flag). */
async function authorBoth(args: Record<string, unknown>) {
  const plain = await h.call("author_document", args);
  const yes = await h.call("author_document", { ...args, returnDocument: true });
  const no = await h.call("author_document", { ...args, returnDocument: false });
  assert.equal(bytesOf(yes), bytesOf(plain), "returnDocument:true = sin el flag");
  return { yes, no };
}
/** Comprueba T3 sobre un par true/false de una autoría aceptada con enlace. */
function assertOmitted(yes: ToolResponse, no: ToolResponse) {
  assert.equal(isToolError(no), false, textBlocks(no)[0]?.slice(0, 300));
  assert.equal(textBlocks(no).length, 2);
  const a = json(yes), b = json(no);
  assert.equal(typeof a.editorUrl, "string");
  assert.ok("document" in a);
  assert.equal("document" in b, false, "sin la clave document");
  const { document, ...rest } = a;
  assert.equal(JSON.stringify(b), JSON.stringify(rest), "el resto, idéntico y en el mismo orden");
  assert.equal(rev(document), b.resultRevision, "editorUrl/resultRevision siguen siendo los del documento omitido");
  assert.equal(textBlocks(no)[0], textBlocks(yes)[0].replace("Documento nuevo en el 2.º bloque.", OMITTED_AUTHOR));
}

/** Un documento cuyo enlace pasa de 16 000 caracteres: 280 nodos con etiquetas incompresibles (deterministas). */
function bigNodes() {
  const label = (i: number) => createHash("sha256").update(`te004-${i}`).digest("base64").slice(0, 40);
  const nodes = Array.from({ length: 280 }, (_, i) => rect(`k${i}`, label(i)));
  const edges = nodes.slice(1).map((n, i) => ({ from: `k${i}`, to: n.key }));
  return { nodes, edges };
}

/* ═══════════════ T1 ═══════════════ */

describe("T1 · catálogo", () => {
  it("returnDocument solo en author_document y create_diagram: {default:true, description, type:boolean}, sin $ref, opcional", async () => {
    const { tools } = await h.client.listTools();
    for (const t of tools) {
      const s = t.inputSchema as any;
      if (!WITH_FLAG.includes(t.name)) { assert.equal("returnDocument" in (s.properties ?? {}), false, t.name); continue; }
      assert.deepEqual(s.properties.returnDocument, { default: true, description: "false: sin documento; sigue con el enlace y la revisión.", type: "boolean" }, t.name);
      assert.equal((s.required ?? []).includes("returnDocument"), false, t.name);
    }
  });
  it("tools/list ≤ 63 000 B y < 72 000", async () => {
    const bytes = Buffer.byteLength(JSON.stringify(await h.client.listTools()));
    assert.ok(bytes <= 63_000, `tools/list = ${bytes} B`);
    assert.ok(bytes < 72_000);
  });
});

/* ═══════════════ T2 ═══════════════ */

describe("T2 · identidad sin el flag", () => {
  for (const mode of ["json", "link"] as const) {
    it(`sesión de TE-003 (N=10, ${mode}): sin el flag = returnDocument:true, byte a byte`, async () => {
      const plain = await runSession(h.call, { n: 10, mode });
      const withTrue: Call = (name, args) => h.call(name, WITH_FLAG.includes(name) ? { ...args, returnDocument: true } : args);
      const yes = await runSession(withTrue, { n: 10, mode });
      assert.equal(yes.length, plain.length);
      plain.forEach((p, i) => assert.equal(bytesOf(yes[i].response), bytesOf(p.response), p.tag));
    });
  }
  it("una autoría por ejemplo publicado: sin el flag = true; con false, lo mismo sin document", async () => {
    for (const f of loadFixtures()) {
      const d = await h.call("describe_document", { document: f.doc });
      const { yes, no } = await authorBoth({ document: f.doc, baseRevision: json(d).revision, operations: [{ op: "rename_page", scope: "document", pageIndex: 0, name: "Renombrada" }] });
      assertOmitted(yes, no);
    }
  });
});

/* ═══════════════ T3 ═══════════════ */

describe("T3 · author_document con false y enlace", () => {
  it("lote de Historia: sin document; changes, refs, touchedStories, editorUrl y resultRevision intactos", async () => {
    const c = await abc();
    const ops = [
      { op: "create_event_type", scope: "eventType", ref: "pide", name: "Pide", primitive: "FLOW", sentence: "{source} pide a {target}" },
      { op: "create_story", scope: "story", pageIndex: 0, name: "Ida y vuelta" },
      S("add_step", { eventTypeId: { ref: "pide" }, target: { edgeId: c.edges[0] } }),
      S("add_step", { eventTypeId: { ref: "pide" }, target: { edgeId: c.edges[0], reverse: true }, waitMs: 500 }),
      { op: "create_node", scope: "page", pageIndex: 0, ref: "d", spec: { shape: "rect", label: "D", x: 1200, y: 400 } },
    ];
    const { yes, no } = await authorBoth({ document: c.link, baseRevision: c.revision, operations: ops });
    assertOmitted(yes, no);
    assert.deepEqual(json(no).refs.map((r: any) => r.ref), ["d"]);
  });
  it("con pageMap (delete_page) y con warnings (ARRIVAL_DEPENDENCY_INACTIVE)", async () => {
    const c = await abc();
    const paged = await authorBoth({ document: c.link, baseRevision: c.revision, operations: [
      { op: "create_page", scope: "document", name: "Otra" }, { op: "delete_page", scope: "document", pageIndex: 0, expectedName: "Página 1" },
    ] });
    assertOmitted(paged.yes, paged.no);
    assert.ok(Array.isArray(json(paged.no).pageMap));

    const chain = await h.call("author_document", { document: c.link, baseRevision: c.revision, returnDocument: false, operations: [
      { op: "create_event_type", scope: "eventType", ref: "pide", name: "Pide", primitive: "FLOW", sentence: "{source} pide a {target}" },
      { op: "create_event_type", scope: "eventType", ref: "hace", name: "Procesa", primitive: "OCCURRENCE", sentence: "{target} procesa" },
      { op: "create_story", scope: "story", pageIndex: 0, name: "Cadena" },
      S("add_step", { ref: "s1", eventTypeId: { ref: "pide" }, target: { edgeId: c.edges[0] } }),
      S("add_step", { eventTypeId: { ref: "hace" }, target: { nodeId: 2 }, waitMs: 500, waitsForArrivalOf: [{ ref: "s1" }] }),
    ] });
    const j = json(chain);
    const moved = await authorBoth({ document: j.editorUrl, baseRevision: j.resultRevision, operations: [S("move_step", { stepId: 1, direction: "later" })] });
    assertOmitted(moved.yes, moved.no);
    assert.deepEqual(json(moved.no).warnings.map((w: any) => w.code), ["ARRIVAL_DEPENDENCY_INACTIVE"]);
  });
  it("con el documento como objeto también se omite (lo decide el enlace de la RESPUESTA, no la forma de la entrada)", async () => {
    const c = await abc();
    const { yes, no } = await authorBoth({ document: c.doc, baseRevision: c.revision, operations: [{ op: "set_theme", scope: "document", theme: "crema" }] });
    assertOmitted(yes, no);
  });
});

/* ═══════════════ T4 / T5 ═══════════════ */

describe("T4 · create_diagram", () => {
  it("false con enlace: UN bloque, el resumen de true + la línea; revisión e ids iguales", async () => {
    const args = { nodes: [rect("a", "A"), rect("b", "B")], edges: [{ from: "a", to: "b" }] };
    const plain = await h.call("create_diagram", args);
    const yes = await h.call("create_diagram", { ...args, returnDocument: true });
    const no = await h.call("create_diagram", { ...args, returnDocument: false });
    assert.equal(bytesOf(yes), bytesOf(plain));
    assert.equal(isToolError(no), false);
    assert.deepEqual(textBlocks(no), [textBlocks(yes)[0] + OMITTED_CREATE]);
    assert.match(textBlocks(no)[0], /^revision sha256:[0-9a-f]{64} /m);
    assert.match(textBlocks(no)[0], LINK_IN_TEXT);
  });
  it("false con LINK_TOO_LARGE: la respuesta de siempre (dos bloques, con el documento)", async () => {
    const args = bigNodes();
    const yes = await h.call("create_diagram", args);
    const no = await h.call("create_diagram", { ...args, returnDocument: false });
    assert.match(textBlocks(yes)[0], /no cabe en un enlace/);
    assert.equal(bytesOf(no), bytesOf(yes));
    assert.equal(textBlocks(no).length, 2);
  });
});

describe("T5 · author_document con LINK_TOO_LARGE", () => {
  it("false sin enlace: document presente y editorUrlError LINK_TOO_LARGE; idéntica a sin el flag", async () => {
    const created = await h.call("create_diagram", bigNodes());
    const doc = JSON.parse(textBlocks(created)[1]);
    const { yes, no } = await authorBoth({ document: doc, baseRevision: rev(doc), operations: [{ op: "rename_page", scope: "document", pageIndex: 0, name: "Grande" }] });
    assert.equal(bytesOf(no), bytesOf(yes));
    assert.ok("document" in json(no));
    assert.equal(json(no).editorUrlError.code, "LINK_TOO_LARGE");
  });
});

/* ═══════════════ T6 ═══════════════ */

describe("T6 · dryRun y rechazos con false", () => {
  it("dryRun + false = dryRun", async () => {
    const c = await abc();
    const args = { document: c.link, baseRevision: c.revision, dryRun: true, operations: [{ op: "set_theme", scope: "document", theme: "claro" }] };
    const plain = await h.call("author_document", args);
    assert.equal(bytesOf(await h.call("author_document", { ...args, returnDocument: false })), bytesOf(plain));
    assert.equal("document" in json(plain), false);
  });
  it("REVISION_MISMATCH, LINK_REVISION_MISMATCH, DOCUMENT_LINK_UNREADABLE, REFERENCED_ENTITY, LIMIT_EXCEEDED y Zod: idénticos", async () => {
    const c = await abc();
    const used = json(await h.call("author_document", { document: c.link, baseRevision: c.revision, returnDocument: false, operations: [
      { op: "create_event_type", scope: "eventType", name: "Pide", primitive: "FLOW", sentence: "{source} pide a {target}" },
      { op: "create_story", scope: "story", pageIndex: 0, name: "H" }, S("add_step", { eventTypeId: 1, target: { edgeId: c.edges[0] } }),
    ] }));
    const cases: Array<[string, Record<string, unknown>]> = [
      ["REVISION_MISMATCH", { document: c.doc, baseRevision: OTHER_REV, operations: [{ op: "set_theme", scope: "document", theme: "claro" }] }],
      ["LINK_REVISION_MISMATCH", { document: c.link, baseRevision: OTHER_REV, operations: [{ op: "set_theme", scope: "document", theme: "claro" }] }],
      ["DOCUMENT_LINK_UNREADABLE", { document: c.link.slice(0, -3), baseRevision: c.revision, operations: [{ op: "set_theme", scope: "document", theme: "claro" }] }],
      ["REFERENCED_ENTITY", { document: used.editorUrl, baseRevision: used.resultRevision, operations: [{ op: "delete_event_type", scope: "eventType", eventTypeId: 1 }] }],
      ["LIMIT_EXCEEDED", { document: c.link, baseRevision: c.revision, operations: [{ op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 100001, y: 0 } }] }],
      ["Zod", { document: c.link, baseRevision: c.revision, operations: [{ op: "no_existe", scope: "document" }] }],
    ];
    for (const [code, args] of cases) {
      const plain = await h.call("author_document", args);
      assert.equal(isToolError(plain), true, code);
      assert.equal(code === "Zod" ? /Input validation error/.test(textBlocks(plain)[0]) : json(plain).errors[0].code, code === "Zod" ? true : code);
      assert.equal(bytesOf(await h.call("author_document", { ...args, returnDocument: false })), bytesOf(plain), code);
    }
  });
  it("create_diagram rechazado con false: idéntico", async () => {
    const args = { nodes: [{ key: "a", shape: "rect", label: "A", color: "#zzz" }] };
    const plain = await h.call("create_diagram", args);
    assert.equal(isToolError(plain), true);
    assert.equal(bytesOf(await h.call("create_diagram", { ...args, returnDocument: false })), bytesOf(plain));
  });
});

/* ═══════════════ T7 ═══════════════ */

describe("T7 · encadenado sin documento", () => {
  /** create → Historia → respuestas reverse → tema, como un agente: con false, solo enlace + revisión + ids del resumen y refs. */
  async function session(returnDocument: boolean) {
    const flag = returnDocument ? {} : { returnDocument: false };
    const nodes = ["c", "w", "api", "db"].map(k => rect(k, k.toUpperCase()));
    const created = await h.call("create_diagram", { nodes, edges: [{ from: "c", to: "w" }, { from: "w", to: "api" }, { from: "api", to: "db" }], ...flag });
    const summary = textBlocks(created)[0];
    if (!returnDocument) assert.equal(textBlocks(created).length, 1);
    let link = LINK_IN_TEXT.exec(summary)![0], revision = /^revision (sha256:[0-9a-f]{64}) /m.exec(summary)![1];
    const edges = /^Ids de aristas \(orden de edges\): (.*)\.$/m.exec(summary)![1].split(", ").map(Number);
    const step = async (operations: unknown[]) => {
      const r = await h.call("author_document", { document: link, baseRevision: revision, operations, ...flag });
      const j = json(r);
      assert.equal(j.ok, true, JSON.stringify(j.errors));
      if (!returnDocument) assert.equal("document" in j, false);
      const prev = { link, revision };
      link = j.editorUrl; revision = j.resultRevision;
      return { j, prev, operations };
    };
    await step([
      { op: "create_event_type", scope: "eventType", ref: "pide", name: "Pide", primitive: "FLOW", sentence: "{source} pide a {target}" },
      { op: "create_story", scope: "story", pageIndex: 0, name: "Compra" },
      ...edges.map(e => S("add_step", { eventTypeId: { ref: "pide" }, target: { edgeId: e }, waitMs: 400 })),
    ]);
    await step([...edges.slice().reverse().map(e => S("add_step", { eventTypeId: 1, target: { edgeId: e, reverse: true }, waitMs: 400 })),
      { op: "update_node", scope: "page", pageIndex: 0, node: { id: 2 }, spec: { label: "Tienda" } }]);
    const run = await h.call("run_story", { document: link, baseRevision: revision, storyId: 1 });
    assert.equal(isToolError(run), false);
    const last = await step([{ op: "set_theme", scope: "document", theme: "crema" }]);
    return { revision, link, last, run: textBlocks(run)[1] };
  }
  it("la misma revisión final, el mismo enlace y el mismo run_story que con documento; recuperar = repetir sin el flag", async () => {
    const withDoc = await session(true), without = await session(false);
    assert.equal(without.revision, withDoc.revision);
    assert.equal(without.link, withDoc.link);
    assert.equal(without.run, withDoc.run);
    const again = await h.call("author_document", { document: without.last.prev.link, baseRevision: without.last.prev.revision, operations: without.last.operations });
    const j = json(again);
    assert.equal(j.resultRevision, without.revision);
    assert.equal(rev(j.document), without.revision, "el documento recuperado es el de esa revisión");
  });
});

/* ═══════════════ T8 ═══════════════ */

describe("T8 · tools fuera de alcance", () => {
  it("returnDocument en set_theme, reorder_nodes, duplicate_node y create_from_template no cambia la respuesta", async () => {
    const c = await abc();
    const base = { document: c.link, baseRevision: c.revision };
    const cases: Array<[string, Record<string, unknown>]> = [
      ["set_theme", { ...base, theme: "crema" }],
      ["reorder_nodes", { ...base, pageIndex: 0, nodes: [{ id: 1 }], to: "front" }],
      ["duplicate_node", { ...base, pageIndex: 0, nodes: [{ id: 1 }] }],
      ["create_from_template", { templateId: "microservices_gateway" }],
    ];
    for (const [name, args] of cases) {
      const plain = await h.call(name, args);
      assert.equal(isToolError(plain), false, `${name}: ${textBlocks(plain)[0]?.slice(0, 200)}`);
      assert.equal(bytesOf(await h.call(name, { ...args, returnDocument: false })), bytesOf(plain), name);
    }
  });
});

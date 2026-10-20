/**
 * FLUYO-MCP-TOKEN-EFFICIENCY-002 — el tramo seguro de la auditoría 001: menos bytes, la misma semántica.
 *
 *   1. El 2.º bloque es JSON SIN sangría y es EXACTAMENTE el valor del dominio (createDiagramResult, describeDocument, runStory,
 *      authorDocument, proposeLayout); las revisiones son las de la base 4ff3dc6 (fijadas aquí).
 *   2. create_diagram / create_from_template dicen en el RESUMEN la revisión y los ids (key→id; aristas en el orden de edges), y con
 *      eso author_document funciona sin describe_document. El documento (2.º bloque) no cambia.
 *   3. El enlace #d= va UNA vez: en editorUrl para author_document y las tools de una operación; en el resumen para create_*.
 *   4. REVISION_MISMATCH trae la revisión real ('actual') y dice cómo reintentar sin releer el documento.
 *   5. tools/list sin los topes ±MAX_SAFE_INTEGER de Zod: es el catálogo del SDK salvo esos topes, y la validación es la misma.
 *   6. Textos desfasados: README (íconos, grupos, autoría de Historias, número de tools) y el error de tamaño del HTTP.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildServer, buildServerAsSdkPublishes, withoutSafeIntBounds } from "../src/server.js";
import { createDiagramResult, createFromTemplateResult } from "../src/diagram.js";
import { authorDocument } from "../src/authoring.js";
import { describeDocument, runStory } from "../src/stories.js";
import { proposeLayout } from "../src/propose-layout.js";
import { ICONS, ICON_GROUPS } from "../src/schema.js";
import { isToolError, loadFixture, packageRoot, textBlocks, textOf } from "./helpers.js";
import { connectHttpClient, startHttpHarness } from "./http-helpers.js";

const SAFE = Number.MAX_SAFE_INTEGER;
const REV = /^sha256:[0-9a-f]{64}$/;
/* Revisiones medidas con la base 4ff3dc6 (antes de este cambio) para las mismas entradas. */
const PINNED = {
  create: "sha256:3237ae298d3e0432ec6f2d49ff96780d95939a576281cc204b0c3bae15846b7b",
  template: "sha256:1217b1d9bd3d21a30d5dc7a23e24ea4f89f864879e0b8a3f1f0500d9ea4111e6",
  story: "sha256:304967f036aa422a1566d1563d169aa496c6e00781e805cc0e6b2474e0b60880",
  author: "sha256:a2f0609504e0166c97f3b155b4cc4c30e89d54a1449625c0758f93dba8da91a2",
};
const CREATE = {
  pageName: "Checkout",
  nodes: [{ key: "web", shape: "rect", label: "Web" }, { key: "api", shape: "rect", label: "API" }, { key: "db", shape: "cylinder", label: "DB" }],
  edges: [{ from: "web", to: "api" }, { from: "api", to: "db", label: "SQL" }],
};
const UPD = (id: number, label: string) => ({ op: "update_node", scope: "page", pageIndex: 0, node: { id }, spec: { label } });
const STORY = (): any => loadFixture("stories/fluyo-017-1-qa-complejo.fluyo.json");

async function connect(server: McpServer) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "token-efficiency-002", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
let h: Awaited<ReturnType<typeof connect>>, raw: Awaited<ReturnType<typeof connect>>;
before(async () => { h = await connect(buildServer()); raw = await connect(buildServerAsSdkPublishes()); });
after(async () => { await h.close(); await raw.close(); });

const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const json = (res: unknown) => JSON.parse(textBlocks(res)[1]);
const summary = (res: unknown) => textBlocks(res)[0];
const revisionIn = (s: string) => /^revision (sha256:[0-9a-f]{64}) \(baseRevision para author_document\)\.$/m.exec(s)?.[1] ?? null;
function idsIn(s: string) {
  const nodes = /^Ids por key: (.*)\.$/m.exec(s)?.[1].split(", ").map(p => p.split("=")) ?? [];
  const edges = /^Ids de aristas \(orden de edges\): (.*)\.$/m.exec(s)?.[1].split(", ").map(Number) ?? [];
  return { nodes: new Map(nodes.map(([k, v]) => [k, Number(v)])), edges };
}
const describeVia = async (document: unknown) => json(await call("describe_document", { document }));
const decodeLink = (url: string) => JSON.parse(inflateRawSync(Buffer.from(url.split("#d=")[1], "base64url").subarray(1)).toString("utf8"));
const linkCount = (res: unknown) => (textOf(res).match(/#d=/g) ?? []).length;
/** editorUrl codifica el documento con su orden de claves: se compara lo que abre, no la cadena. */
const byValue = (v: any) => (v && typeof v.editorUrl === "string" ? { ...v, editorUrl: decodeLink(v.editorUrl) } : v);

/* ═══════════════ 1. JSON sin sangría, mismo contenido, mismas revisiones ═══════════════ */

describe("1. el 2.º bloque es JSON compacto y es exactamente el valor del dominio", () => {
  it("cada tool que devuelve JSON: sin sangría ni saltos de línea, y con el valor exacto del resultado del dominio", async () => {
    const created = createDiagramResult(CREATE as any);
    assert.equal(created.ok, true);
    const doc = (created as any).project, rev = (created as any).revision;
    const story = STORY(), sd = describeDocument({ document: story }) as any;
    const sp = sd.pages.find((p: any) => p.stories.length);
    const bad = "sha256:" + "0".repeat(64);
    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ["create_diagram", CREATE, doc],
      ["create_diagram", { nodes: [{ key: "a", shape: "rect" }, { key: "a", shape: "rect" }] }, createDiagramResult({ nodes: [{ key: "a", shape: "rect" }, { key: "a", shape: "rect" }] } as any)],
      ["create_from_template", { templateId: "rag_chatbot" }, (createFromTemplateResult({ templateId: "rag_chatbot" }) as any).project],
      ["describe_document", { document: story }, describeDocument({ document: story, includeSteps: true })],
      ["describe_document", { document: story, includeSteps: false }, describeDocument({ document: story, includeSteps: false })],
      ["run_story", { document: story, pageIndex: sp.pageIndex, storyId: sp.stories[0].storyId }, runStory({ document: story, pageIndex: sp.pageIndex, storyId: sp.stories[0].storyId })],
      ["author_document", { document: doc, baseRevision: rev, operations: [UPD(2, "API v2")] }, authorDocument({ document: doc, baseRevision: rev, operations: [UPD(2, "API v2")], dryRun: false })],
      ["author_document", { document: doc, baseRevision: rev, operations: [UPD(2, "API v2")], dryRun: true }, authorDocument({ document: doc, baseRevision: rev, operations: [UPD(2, "API v2")], dryRun: true })],
      ["author_document", { document: doc, baseRevision: bad, operations: [UPD(2, "x")] }, authorDocument({ document: doc, baseRevision: bad, operations: [UPD(2, "x")], dryRun: false })],
      ["set_theme", { document: doc, baseRevision: rev, theme: "claro" }, authorDocument({ document: doc, baseRevision: rev, operations: [{ op: "set_theme", scope: "document", theme: "claro" }], dryRun: false })],
      ["propose_layout", { document: doc }, proposeLayout({ document: doc, clearWaypoints: true })],
    ];
    /* El valor, no los bytes: el documento de ENTRADA pasa por Zod (que ordena sus claves como el schema) y el dominio conserva ese
       orden; ya era así antes y la revisión no lo ve (JSON canónico). */
    for (const [name, args, expected] of cases) {
      const block = textBlocks(await call(name, args))[1];
      assert.equal(block.includes("\n"), false, `${name}: el JSON lleva saltos de línea (sangría)`);
      assert.equal(block, JSON.stringify(JSON.parse(block)), `${name}: el JSON no es compacto`);
      assert.deepEqual(byValue(JSON.parse(block)), byValue(JSON.parse(JSON.stringify(expected, null, 2))), `${name}: el contenido no es el del dominio`);
    }
    assert.equal(textBlocks(await call("create_diagram", CREATE))[1], JSON.stringify(doc), "sin documento de entrada, byte a byte");
  });

  it("las revisiones son las de la base 4ff3dc6 (create_diagram, create_from_template, describe_document, author_document)", async () => {
    const c = await call("create_diagram", CREATE);
    assert.equal(revisionIn(summary(c)), PINNED.create);
    assert.equal((await describeVia(json(c))).revision, PINNED.create);
    assert.equal(revisionIn(summary(await call("create_from_template", { templateId: "rag_chatbot" }))), PINNED.template);
    assert.equal((await describeVia(STORY())).revision, PINNED.story);
    const a = json(await call("author_document", { document: json(c), baseRevision: PINNED.create, operations: [UPD(2, "API v2")] }));
    assert.equal(a.resultRevision, PINNED.author);
    assert.equal((await describeVia(a.document)).revision, PINNED.author, "el documento devuelto (compacto) tiene la revisión que anuncia");
  });
});

/* ═══════════════ 2. create_* dice revision e ids ═══════════════ */

describe("2. create_diagram y create_from_template: revision y key→id en el resumen", () => {
  async function checkIds(res: unknown, edges: Array<{ from: string; to: string }>) {
    const s = summary(res), doc = json(res), d = await describeVia(doc);
    assert.equal(revisionIn(s), d.revision, "la revisión del resumen es la de describe_document");
    const ids = idsIn(s), p = d.pages[0];
    assert.deepEqual([...ids.nodes.values()].sort((x, y) => x - y), p.nodes.map((n: any) => n.id).sort((x: number, y: number) => x - y), "un id por nodo, todos los del documento");
    assert.equal(ids.edges.length, edges.length);
    edges.forEach((e, j) => {
      const c = p.connections.find((k: any) => k.id === ids.edges[j]);
      assert.ok(c, `edges[${j}]: el id ${ids.edges[j]} no es una conexión`);
      assert.deepEqual([c.from, c.to], [ids.nodes.get(e.from), ids.nodes.get(e.to)], `edges[${j}] (${e.from}→${e.to})`);
    });
    return { ids, doc, revision: revisionIn(s)!, d };
  }

  it("create_diagram: la revisión es la de describe_document y cada key/arista apunta a su elemento/conexión", async () => {
    const res = await call("create_diagram", CREATE);
    const { ids, d } = await checkIds(res, CREATE.edges);
    assert.deepEqual([...ids.nodes], [["web", 1], ["api", 2], ["db", 3]]);
    assert.deepEqual(d.pages[0].nodes.map((n: any) => [n.id, n.label]), [[1, "Web"], [2, "API"], [3, "DB"]]);
  });

  it("sin describe_document: author_document acepta la revisión del resumen y los ids del resumen sirven tal cual", async () => {
    const res = await call("create_diagram", CREATE);
    const { ids, revision, doc } = await checkIds(res, CREATE.edges);
    const a = await call("author_document", {
      document: doc, baseRevision: revision,
      operations: [UPD(ids.nodes.get("api")!, "API v2"), { op: "update_connection", scope: "page", pageIndex: 0, connection: { id: ids.edges[1] }, spec: { label: "SQL v2" } }],
    });
    assert.equal(isToolError(a), false, textOf(a));
    const d = await describeVia(json(a).document);
    assert.equal(d.revision, json(a).resultRevision);
    assert.equal(d.pages[0].nodes.find((n: any) => n.id === ids.nodes.get("api")).label, "API v2");
    assert.equal(json(a).document.doc.pages[0].edges.find((e: any) => e.id === ids.edges[1]).label, "SQL v2");
  });

  it("create_from_template: revision e ids de las keys de la plantilla", async () => {
    const res = await call("create_from_template", { templateId: "rag_chatbot" });
    const s = summary(res);
    assert.match(revisionIn(s) ?? "", REV);
    const ids = idsIn(s);
    assert.ok(ids.nodes.size > 0 && ids.edges.length > 0, s);
    const d = await describeVia(json(res));
    assert.equal(revisionIn(s), d.revision);
    assert.equal(new Set([...ids.nodes.values(), ...ids.edges]).size, d.pages[0].nodes.length + d.pages[0].connections.length, "ids distintos y todos del documento");
  });

  it("más de un lote del dominio (≥ 200 operaciones): los ids de todos los lotes son los del documento", async () => {
    const N = 150;
    const nodes = Array.from({ length: N }, (_, i) => ({ key: "n" + i, shape: "rect", label: "S" + i }));
    const edges = Array.from({ length: N - 1 }, (_, i) => ({ from: "n" + Math.floor(i / 2), to: "n" + (i + 1) }));
    const res = await call("create_diagram", { nodes, edges });
    assert.equal(isToolError(res), false, textOf(res));
    const { ids, d } = await checkIds(res, edges);
    for (const n of nodes) assert.equal(d.pages[0].nodes.find((x: any) => x.id === ids.nodes.get(n.key)).label, n.label, n.key);
  });

  it("el 2.º bloque sigue siendo el documento sin más (ni revision ni ids dentro); un rechazo no trae revision ni ids", async () => {
    const res = await call("create_diagram", CREATE);
    assert.deepEqual(Object.keys(json(res)).sort(), Object.keys((createDiagramResult(CREATE as any) as any).project).sort());
    assert.equal("revision" in json(res) || "ids" in json(res), false);
    const bad = await call("create_diagram", { nodes: [{ key: "a", shape: "rect" }], edges: [{ from: "a", to: "zz" }] });
    assert.equal(isToolError(bad), true);
    assert.equal(revisionIn(summary(bad)), null);
    assert.equal(/Ids por key/.test(summary(bad)), false);
  });

  it("sin aristas no hay línea de aristas; la descripción publicada lo anuncia", async () => {
    const s = summary(await call("create_diagram", { nodes: [{ key: "solo", shape: "rect" }] }));
    assert.match(s, /^Ids por key: solo=1\.$/m);
    assert.equal(/Ids de aristas/.test(s), false);
    const tools = (await h.client.listTools()).tools;
    assert.match(tools.find(t => t.name === "create_diagram")!.description!, /'revision'.*no hace falta describe_document/);
  });
});

/* ═══════════════ 3. editorUrl una sola vez ═══════════════ */

describe("3. el enlace #d= viaja una sola vez", () => {
  it("author_document y las tools de una operación: solo en editorUrl (2.º bloque), que abre el documento devuelto", async () => {
    const c = json(await call("create_diagram", CREATE)), rev = PINNED.create;
    for (const [name, args] of [
      ["author_document", { operations: [UPD(1, "W")] }],
      ["set_theme", { theme: "claro" }],
      ["reorder_nodes", { pageIndex: 0, nodes: [{ id: 1 }], to: "front" }],
      ["duplicate_node", { pageIndex: 0, nodes: [{ id: 1 }] }],
    ] as const) {
      const res = await call(name, { document: c, baseRevision: rev, ...args });
      assert.equal(isToolError(res), false, textOf(res));
      assert.equal(linkCount(res), 1, `${name}: el enlace se repite`);
      assert.equal(summary(res).includes("#d="), false, `${name}: la URL sigue en el resumen`);
      assert.match(summary(res), /editorUrl/);
      assert.deepEqual(decodeLink(json(res).editorUrl), json(res).document, name);
    }
  });

  it("create_diagram y create_from_template: una vez, en el resumen (su 2.º bloque es el .fluyo.json)", async () => {
    for (const [name, args] of [["create_diagram", CREATE], ["create_from_template", { templateId: "rag_chatbot" }]] as const) {
      const res = await call(name, args);
      assert.equal(linkCount(res), 1, name);
      assert.deepEqual(decodeLink(/https?:\/\/\S+#d=[A-Za-z0-9\-_]+/.exec(summary(res))![0]), json(res), name);
    }
  });

  it("dryRun: ni enlace ni mención", async () => {
    const res = await call("author_document", { document: json(await call("create_diagram", CREATE)), baseRevision: PINNED.create, operations: [UPD(1, "W")], dryRun: true });
    assert.equal(linkCount(res), 0);
    assert.equal(/editorUrl/.test(summary(res)), false);
  });
});

/* ═══════════════ 4. REVISION_MISMATCH ═══════════════ */

describe("4. REVISION_MISMATCH: la revisión real basta para reintentar", () => {
  it("documento de la respuesta anterior con el baseRevision de antes: rechazo, actual = su resultRevision, y reintentar con actual funciona", async () => {
    const created = await call("create_diagram", CREATE);
    const r0 = revisionIn(summary(created))!;
    const a = json(await call("author_document", { document: json(created), baseRevision: r0, operations: [UPD(2, "A")] }));
    const stale = await call("author_document", { document: a.document, baseRevision: r0, operations: [UPD(3, "B")] });
    assert.equal(isToolError(stale), true);
    const e = json(stale);
    assert.deepEqual([e.ok, e.errors[0].code, e.errors[0].expected, e.errors[0].actual, e.actualRevision], [false, "REVISION_MISMATCH", r0, a.resultRevision, a.resultRevision]);
    assert.equal("document" in e, false, "el error no copia el documento");
    for (const t of [e.errors[0].message, summary(stale)]) {
      assert.match(t, /'actual'/);
      assert.match(t, /resultRevision/);
      assert.match(t, /describe_document/, "y sigue diciendo qué hacer si el documento no es el que se cree");
    }
    const retry = await call("author_document", { document: a.document, baseRevision: e.errors[0].actual, operations: [UPD(3, "B")] });
    assert.equal(isToolError(retry), false, textOf(retry));
    assert.equal(json(retry).baseRevision, a.resultRevision);
  });

  it("propose_layout: el mismo error y el mismo texto", async () => {
    const doc = json(await call("create_diagram", CREATE));
    const res = await call("propose_layout", { document: doc, baseRevision: "sha256:" + "1".repeat(64) });
    const e = json(res);
    assert.deepEqual([isToolError(res), e.errors[0].code, e.errors[0].actual], [true, "REVISION_MISMATCH", PINNED.create]);
    const author = json(await call("author_document", { document: doc, baseRevision: "sha256:" + "1".repeat(64), operations: [UPD(1, "x")] }));
    assert.equal(e.errors[0].message, author.errors[0].message);
  });
});

/* ═══════════════ 5. schema publicado ═══════════════ */

/** Lo inverso de withoutSafeIntBounds: en un nodo integer, el tope que falta es el de entero seguro. */
function restore(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(restore);
  if (s === null || typeof s !== "object") return s;
  const o = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, restore(v)]));
  if (o.type === "integer") return { ...o, minimum: o.minimum ?? -SAFE, maximum: o.maximum ?? SAFE };
  return o;
}

describe("5. tools/list sin los topes de entero seguro, la misma validación", () => {
  it("el catálogo publicado es el del SDK salvo los ±MAX_SAFE_INTEGER (ni uno queda) y es más pequeño", async () => {
    const pub = (await h.client.listTools()).tools, sdk = (await raw.client.listTools()).tools;
    const rawText = JSON.stringify(sdk), pubText = JSON.stringify(pub);
    assert.ok(rawText.split(String(SAFE)).length - 1 > 50, "el SDK publica los topes (si no, este test no prueba nada)");
    assert.equal(pubText.includes(String(SAFE)), false);
    assert.deepEqual(pub, sdk.map(t => ({ ...t, inputSchema: withoutSafeIntBounds(t.inputSchema) })));
    assert.deepEqual(pub.map(t => ({ ...t, inputSchema: restore(t.inputSchema) })), sdk, "volviendo a poner los topes sale el catálogo del SDK");
    assert.ok(Buffer.byteLength(pubText) < Buffer.byteLength(rawText) - 2000, `${Buffer.byteLength(pubText)} vs ${Buffer.byteLength(rawText)}`);
    assert.ok(Buffer.byteLength(pubText) < 72_000);
  });

  it("los topes propios se conservan (min(1), min(0), max(86 400 000), .min(1).max(200))", async () => {
    const pub = (await h.client.listTools()).tools;
    const run = pub.find(t => t.name === "run_story")!.inputSchema as any;
    assert.deepEqual([run.properties.storyId.type, run.properties.storyId.minimum, run.properties.storyId.maximum], ["integer", 1, undefined]);
    assert.deepEqual([run.properties.pageIndex.minimum, run.properties.pageIndex.maximum], [0, undefined]);
    const ad = JSON.stringify(pub.find(t => t.name === "author_document")!.inputSchema);
    assert.ok(ad.includes('"type":"integer","minimum":0,"maximum":86400000'), "waitMs");
    assert.ok(ad.includes('"minItems":1,"maxItems":200'), "operations");
  });

  it("no muta el schema que recibe", () => {
    const s = { type: "object", properties: { n: { type: "integer", minimum: -SAFE, maximum: SAFE }, m: { type: "number", maximum: SAFE } } };
    const copy = structuredClone(s);
    assert.deepEqual(withoutSafeIntBounds(s), { type: "object", properties: { n: { type: "integer" }, m: { type: "number", maximum: SAFE } } });
    assert.deepEqual(s, copy);
  });

  it("validación idéntica: los mismos valores se aceptan y se rechazan en los dos catálogos (Zod no cambia)", async () => {
    const story = STORY();
    for (const storyId of [1, 0, -1, 1.5, SAFE, 2 ** 53, 1e300, "1"]) {
      const a = await call("run_story", { document: story, pageIndex: 0, storyId });
      const b = await raw.client.callTool({ name: "run_story", arguments: { document: story, pageIndex: 0, storyId } });
      assert.deepEqual([isToolError(a), textOf(a)], [isToolError(b), textOf(b)], `storyId ${storyId}`);
    }
    const unsafe = await call("run_story", { document: story, pageIndex: 0, storyId: 2 ** 53 });
    assert.equal(isToolError(unsafe), true, "un entero no seguro se sigue rechazando aunque el schema publicado ya no lo diga");
    for (const pageIndex of [0, -1, 2 ** 53]) {
      const a = await call("describe_document", { document: story, pageIndex });
      const b = await raw.client.callTool({ name: "describe_document", arguments: { document: story, pageIndex } });
      assert.deepEqual([isToolError(a), textOf(a)], [isToolError(b), textOf(b)], `pageIndex ${pageIndex}`);
    }
  });

  it("también por HTTP (el despliegue remoto usa el mismo buildServer)", async () => {
    const http = await startHttpHarness();
    try {
      const { client, close } = await connectHttpClient(http);
      try {
        const text = JSON.stringify((await client.listTools()).tools);
        assert.equal(text.includes(String(SAFE)), false);
        assert.equal((await client.listTools()).tools.length, 15);
      } finally { await close(); }
    } finally { await http.close(); }
  });
});

/* ═══════════════ 6. textos desfasados ═══════════════ */

describe("6. textos que ya no decían la verdad", () => {
  const README = readFileSync(join(packageRoot(), "README.md"), "utf8");

  it("README: list_icons dice el número real de claves y de grupos, con sus nombres", () => {
    const row = README.split(/\r?\n/).find(l => l.startsWith("| `list_icons` |"))!;
    assert.ok(row.includes(`Las ${Object.keys(ICONS).length} claves`), row);
    assert.ok(row.includes(`${ICON_GROUPS.length} grupos (${ICON_GROUPS.join(", ")})`), row);
  });

  it("README: hay autoría de Historias y son quince tools", async () => {
    assert.equal(/No hay autoría de Historias/.test(README), false);
    assert.equal(/Las doce tools/.test(README), false);
    assert.equal((await h.client.listTools()).tools.length, 15);
    assert.ok(README.includes("Las quince tools"));
  });

  it("HTTP: el error de tamaño de export_diagram ya no dice que cada ícono se repite por nodo", async () => {
    const http = await startHttpHarness({ maxToolResultBytes: 2048 });
    try {
      const { client, close } = await connectHttpClient(http);
      try {
        const r = await client.callTool({ name: "export_diagram", arguments: { document: json(await call("create_diagram", CREATE)) } });
        const t = textOf(r);
        assert.match(t, /supera el límite/);
        assert.equal(/se repite por nodo/.test(t), false);
        assert.match(t, /<defs>/);
      } finally { await close(); }
    } finally { await http.close(); }
  });
});

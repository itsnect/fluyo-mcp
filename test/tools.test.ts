/**
 * TESTS DE LAS TOOLS — flujo extremo a extremo sobre un transporte en memoria.
 *
 * Sustituye al antiguo `scripts/smoke-test.ts`, que hacía estas mismas
 * comprobaciones pero (a) nadie lo ejecutaba en CI y (b) solo operaba sobre
 * documentos que el propio servidor acababa de crear — nunca sobre uno guardado
 * por la aplicación, que es donde estaban los fallos reales.
 *
 * El caso «preserva el estilo» del final es el que cubre ese hueco: mete una
 * fixture real por la ruta de edición (`author_document` desde FLUYO-018.10, que
 * retiró `edit_diagram`) y comprueba que solo cambia lo pedido respecto a lo que
 * la app tendría al abrirla (el documento normalizado).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FONTS } from "../src/generated/config.js";
import { createKernel } from "../src/kernel.js";
import { normalizeWith, revisionOf } from "../src/revision.js";
import { join } from "node:path";

import {
  collectDiffs,
  documentOf,
  isToolError,
  loadFixture,
  packageRoot,
  startHarness,
  summarizeDiffs,
  textBlocks,
  textOf,
  type Harness,
} from "./helpers.js";

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

/* La ruta de edición (FLUYO-018.10): author_document con baseRevision. normalized = el documento tal como lo abre la app. */
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const normalized = (doc: unknown): any => normalizeWith(createKernel(), doc);
const edit = (document: unknown, operations: unknown[]) =>
  h.client.callTool({ name: "author_document", arguments: { document, baseRevision: rev(document), operations } });
const editedDoc = async (document: unknown, operations: unknown[]) => {
  const r = await edit(document, operations);
  assert.ok(!isToolError(r), textOf(r));
  return documentOf(r).document;
};
const RENAME = (name: string) => ({ op: "rename_page", scope: "document", pageIndex: 0, name });

/* ===================== Superficie publicada ===================== */

const TOOLS_ESPERADAS = [
  "create_diagram",
  "export_diagram",
  "list_icons",
  "list_colors",
  "list_anims",
  "list_fonts",
  "list_templates",
  "create_from_template",
  "describe_document",
  "run_story",
  "author_document",
  "propose_layout",
  "set_theme",
  "reorder_nodes",
  "duplicate_node",
];

describe("identidad del servidor", () => {
  /** La versión que anuncia el servidor en el handshake es la que ven los
   *  directorios; si se desincroniza de package.json, reportan otra cosa. */
  it("la versión del handshake coincide con la de package.json", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8"));
    assert.equal(h.client.getServerVersion()?.version, pkg.version);
    assert.equal(h.client.getServerVersion()?.name, pkg.name);
  });
});

describe("lo que ve un cliente en tools/list", () => {
  it("están las quince tools (edit_diagram retirada en 018.10)", async () => {
    const { tools } = await h.client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), [...TOOLS_ESPERADAS].sort());
  });

  it("todas tienen title legible y descripción", async () => {
    const { tools } = await h.client.listTools();
    for (const t of tools) {
      assert.ok(t.title, `${t.name} no tiene title`);
      assert.ok((t.description ?? "").length > 30, `${t.name} no tiene una descripción útil`);
    }
  });

  /** Los directorios usan las annotations para decidir qué avisar al usuario.
   *  Las quince son funciones puras, así que el juego es uniforme. */
  it("todas declaran annotations de función pura", async () => {
    const { tools } = await h.client.listTools();
    for (const t of tools) {
      assert.ok(t.annotations, `${t.name} no declara annotations`);
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name}: readOnlyHint`);
      assert.equal(t.annotations?.destructiveHint, false, `${t.name}: destructiveHint`);
      assert.equal(t.annotations?.idempotentHint, true, `${t.name}: idempotentHint`);
      assert.equal(t.annotations?.openWorldHint, false, `${t.name}: openWorldHint`);
    }
  });

  /** El JSON Schema de tools/list viaja en cada conexión. Si alguien publica
   *  FluyoProjectSchema entero aquí, esto lo caza antes que la factura de tokens. */
  it("el schema publicado no arrastra el documento entero", async () => {
    const { tools } = await h.client.listTools();
    const bytes = JSON.stringify(tools).length;
    // 018.2: create_node/create_connection publican la forma de sus specs (≈2 KB cada una): tope subido de 45 000 a 50 000.
    // 018.3: update_node/update_connection/delete_node/delete_connection (parches de campos) y refs en destinos: de 50 000 a 60 000.
    // 018.6: propose_layout (≈2,5 KB): de 60 000 a 62 000.
    // 018.7a: set_theme, reorder_nodes y duplicate_node (tools de una operación, ≈2 KB cada una) y sus operaciones en author_document: de 62 000 a 70 000.
    // 018.7c: operación delete_page de author_document (esquema + descripción, ≈1 KB): de 70 000 a 72 000.
    assert.ok(bytes < 72_000, `tools/list ocupa ${bytes} caracteres, demasiado para enviarlo en cada conexión`);
  });
});

/* ===================== Catálogos ===================== */

describe("catálogos", () => {
  it("list_icons agrupa por proveedor", async () => {
    const r = await h.client.callTool({ name: "list_icons", arguments: {} });
    assert.ok(!isToolError(r), textOf(r));
    const text = textOf(r);
    for (const group of ["General", "GCP", "AWS", "Azure"]) {
      assert.match(text, new RegExp(`^${group}:`, "m"), `falta el grupo ${group}`);
    }
    assert.match(text, /kafka/, "debe listar el ícono kafka");
  });

  it("list_colors incluye la paleta semántica", async () => {
    const r = await h.client.callTool({ name: "list_colors", arguments: {} });
    assert.ok(!isToolError(r), textOf(r));
    assert.match(textOf(r), /Eventos \/ Kafka/);
  });

  it("list_icons incluye los grupos que faltaban (Estados y Varios)", async () => {
    const r = await h.client.callTool({ name: "list_icons", arguments: {} });
    const text = textOf(r);
    for (const group of ["Estados", "Varios"]) {
      assert.match(text, new RegExp(`^${group}:`, "m"), `falta el grupo ${group}`);
    }
    for (const key of ["bell", "cache", "cdn", "file", "graph", "warn"]) {
      assert.match(text, new RegExp(`\\b${key}\\b`), `falta el ícono ${key}`);
    }
  });

  it("list_colors trae los 14 colores, no los 7 de antes", async () => {
    const r = await h.client.callTool({ name: "list_colors", arguments: {} });
    const text = textOf(r);
    for (const name of ["Cache", "Cola", "Red", "Almacén", "Éxito", "Error", "Info"]) {
      assert.match(text, new RegExp(name), `falta el color ${name}`);
    }
  });

  it("list_anims trae los 8 GIFs", async () => {
    const r = await h.client.callTool({ name: "list_anims", arguments: {} });
    assert.ok(!isToolError(r), textOf(r));
    const text = textOf(r);
    for (const key of ["spinner", "progress", "ticket", "errmove", "check", "typing", "upload", "pulse"]) {
      assert.match(text, new RegExp(`^${key}\\b`, "m"), `falta el GIF ${key}`);
    }
  });

  /* Contra FONTS.length y no contra un número escrito a mano: el catálogo lo
     genera el codegen desde js/config.js, así que fijar la cifra aquí obliga a
     tocar el test cada vez que Fluyo añade una fuente — y ese acoplamiento es el
     que hizo fallar esta suite al añadir `Mono`. */
  it("list_fonts trae todas las tipografías del catálogo y marca la global", async () => {
    const r = await h.client.callTool({ name: "list_fonts", arguments: {} });
    assert.ok(!isToolError(r), textOf(r));
    const text = textOf(r);
    assert.equal(text.trim().split("\n").length, FONTS.length);
    assert.match(text, /Georgia.*global por defecto/);
  });

  it("list_templates incluye los tres patrones", async () => {
    const r = await h.client.callTool({ name: "list_templates", arguments: {} });
    assert.ok(!isToolError(r), textOf(r));
    const text = textOf(r);
    for (const id of ["event_driven_pipeline", "rag_chatbot", "microservices_gateway"]) {
      assert.match(text, new RegExp(id), `falta el template ${id}`);
    }
  });
});

/* ===================== create_diagram ===================== */

describe("create_diagram", () => {
  const args = {
    pageName: "Pipeline de eventos",
    theme: "dark",
    nodes: [
      { key: "gw", shape: "rect", label: "API\nGateway", color: "Servicio" },
      { key: "kafka", shape: "icon", icon: "kafka", label: "Kafka", pulse: true, color: "Eventos / Kafka" },
      { key: "svc", shape: "rect", label: "Servicio de\npedidos", color: "Servicio" },
      { key: "db", shape: "cylinder", label: "Cloud SQL", color: "Datos" },
    ],
    edges: [
      { from: "gw", to: "kafka", label: "evento", route: "ortho" },
      { from: "kafka", to: "svc", label: "topic: pedidos", route: "ortho" },
      { from: "svc", to: "db", label: "persistencia", dashed: true },
    ],
  };

  it("devuelve [resumen, json] con el grafo pedido", async () => {
    const r = await h.client.callTool({ name: "create_diagram", arguments: args });
    assert.ok(!isToolError(r), textOf(r));
    assert.equal(textBlocks(r).length, 2, "debe devolver [resumen, json]");
    const page = documentOf(r).doc.pages[0];
    assert.equal(page.nodes.length, 4);
    assert.equal(page.edges.length, 3);
  });

  it("resuelve los nombres de color semánticos a hex", async () => {
    const r = await h.client.callTool({ name: "create_diagram", arguments: args });
    assert.equal(documentOf(r).doc.pages[0].nodes[0].color, "#6a9fb5");
  });

  it("el auto-layout asigna x/y y avanza en capas hacia la derecha", async () => {
    const r = await h.client.callTool({ name: "create_diagram", arguments: args });
    const nodes = documentOf(r).doc.pages[0].nodes;
    const kafka = nodes.find((n: any) => n.icon === "kafka");
    assert.ok(kafka, "debe existir el nodo icon=kafka");
    assert.equal(typeof kafka.x, "number");
    assert.equal(typeof kafka.y, "number");
    assert.ok(nodes[2].x > nodes[0].x, "capas sucesivas deben avanzar en X");
  });

  it("los ajustes de animación son configurables, no cableados", async () => {
    const r = await h.client.callTool({
      name: "create_diagram",
      arguments: {
        ...args,
        speed: 1.5, dots: 5, stagger: 0.2, build: true, single: true,
        font: "Arial, Helvetica, sans-serif", customBg: "#0a0a0a",
      },
    });
    assert.ok(!isToolError(r), textOf(r));
    const doc = documentOf(r);
    assert.equal(doc.settings.speed, 1.5);
    assert.equal(doc.settings.dots, 5);
    assert.equal(doc.settings.stagger, 0.2);
    assert.equal(doc.settings.build, true);
    assert.equal(doc.settings.single, true);
    assert.equal(doc.settings.font, "Arial, Helvetica, sans-serif");
    assert.equal(doc.doc.customBg, "#0a0a0a");
  });

  it("sin ajustes explícitos produce la misma forma que guarda la app", async () => {
    const r = await h.client.callTool({ name: "create_diagram", arguments: args });
    const doc = documentOf(r);
    assert.deepEqual(
      Object.keys(doc.settings).sort(),
      ["build", "dots", "font", "grid", "single", "snap", "speed", "stagger"],
      "settings debe traer las mismas claves que escribe serializeProject() en la app"
    );
    assert.equal(typeof doc.doc.customBg, "string");
  });

  it("el documento que produce vuelve a entrar sin pérdida", async () => {
    const r = await h.client.callTool({ name: "create_diagram", arguments: args });
    const created = documentOf(r);
    const again = await edit(created, [RENAME(created.doc.pages[0].name)]);
    assert.ok(!isToolError(again), textOf(again));
    assert.equal(documentOf(again).changed, false, "renombrar con el mismo nombre no cambia nada");
    const diffs = collectDiffs(created, documentOf(again).document);
    assert.equal(diffs.length, 0, `create → edit no es lossless:\n${summarizeDiffs(diffs)}\n`);
  });
});

/* ===================== Editar (lo que hacía edit_diagram, por author_document) ===================== */

describe("editar un documento con author_document (sustituto de edit_diagram)", () => {
  async function baseDocument() {
    const r = await h.client.callTool({
      name: "create_diagram",
      arguments: {
        pageName: "Base",
        nodes: [
          { key: "gw", shape: "rect", label: "Gateway", color: "Servicio" },
          { key: "svc", shape: "rect", label: "Servicio", color: "Servicio" },
          { key: "db", shape: "cylinder", label: "BD", color: "Datos" },
        ],
        edges: [{ from: "gw", to: "svc" }, { from: "svc", to: "db" }],
      },
    });
    return documentOf(r);
  }

  it("crea un nodo y una conexión, modifica otro y reordena con propose_layout (antes: add_node, add_edge, update_node, relayout)", async () => {
    const doc = await baseDocument();
    const edited = await editedDoc(doc, [
      { op: "create_node", scope: "page", pageIndex: 0, ref: "monitor", spec: { shape: "icon", icon: "ai", label: "Monitoreo", color: "#9b7fb5", x: 0, y: 0 } },
      { op: "create_connection", scope: "page", pageIndex: 0, source: { id: 3 }, target: { ref: "monitor" }, spec: { label: "métricas" } },
      { op: "update_node", scope: "page", pageIndex: 0, node: { id: 1 }, spec: { label: "Gateway v2", pulse: true } },
    ]);
    const plan = documentOf(await h.client.callTool({ name: "propose_layout", arguments: { document: edited } }));
    assert.equal(plan.ok, true);
    let out = edited;
    for (const b of plan.batches) out = await editedDoc(out, b.operations);
    const page = out.doc.pages[0];
    assert.equal(page.nodes.length, 4, "create_node debe sumar un nodo");
    assert.equal(page.edges.length, 3, "create_connection debe sumar una conexión");
    const gw = page.nodes.find((n: any) => n.id === 1);
    assert.equal(gw.label, "Gateway v2");
    assert.equal(gw.pulse, true);
    assert.deepEqual(page.nodes.map((n: any) => [n.id, n.x, n.y]), plan.positions.map((q: any) => [q.id, q.x, q.y]), "las posiciones son las propuestas");
  });

  it("delete_node arrastra sus conexiones (antes: remove_node)", async () => {
    const page = (await editedDoc(await baseDocument(), [{ op: "delete_node", scope: "page", pageIndex: 0, node: { id: 2 } }])).doc.pages[0];
    assert.equal(page.nodes.length, 2);
    assert.equal(page.edges.length, 0, "las dos conexiones tocaban el nodo 2");
  });

  it("set_theme cambia el tema del documento", async () => {
    assert.equal((await editedDoc(await baseDocument(), [{ op: "set_theme", scope: "document", theme: "crema" }])).doc.theme, "crema");
  });
});

/* ===================== export_diagram ===================== */

describe("export_diagram", () => {
  it("produce un SVG con un <g> por nodo", async () => {
    const created = await h.client.callTool({
      name: "create_diagram",
      arguments: {
        pageName: "Export",
        nodes: [
          { key: "a", shape: "rect", label: "A" },
          { key: "b", shape: "cylinder", label: "B" },
          { key: "c", shape: "icon", icon: "kafka", label: "C" },
        ],
        edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
      },
    });
    const r = await h.client.callTool({ name: "export_diagram", arguments: { document: documentOf(created) } });
    assert.ok(!isToolError(r), textOf(r));
    const svg = textBlocks(r)[1];
    assert.ok(svg.startsWith("<?xml"), "debe ser un documento SVG completo");
    assert.match(svg, /<svg[\s>]/);
    assert.equal((svg.match(/<g id="node-/g) ?? []).length, 3, "un <g> por cada nodo");
  });
});

/* ===================== create_from_template ===================== */

describe("create_from_template", () => {
  it("instancia rag_chatbot y aplica labelOverrides", async () => {
    const r = await h.client.callTool({
      name: "create_from_template",
      arguments: { templateId: "rag_chatbot", labelOverrides: { llm: "Gemini / Vertex AI" } },
    });
    assert.ok(!isToolError(r), textOf(r));
    const llm = documentOf(r).doc.pages[0].nodes.find((n: any) => n.icon === "ai");
    assert.equal(llm.label, "Gemini / Vertex AI");
  });

  /** Antes una clave mal escrita se ignoraba y el modelo creía haber
   *  personalizado el diagrama cuando no había cambiado nada. */
  it("una clave de labelOverrides que no existe da error en vez de ignorarse", async () => {
    const r = await h.client.callTool({
      name: "create_from_template",
      arguments: { templateId: "rag_chatbot", labelOverrides: { lmm: "typo" } },
    });
    assert.ok(isToolError(r), "una clave desconocida no puede pasar en silencio");
    assert.match(textOf(r), /lmm/, "debe nombrar la clave mala");
    assert.match(textOf(r), /user|api|vectordb|llm/, "debe listar las claves válidas");
  });

  it("un templateId inexistente da error accionable", async () => {
    const r = await h.client.callTool({ name: "create_from_template", arguments: { templateId: "no-existe" } });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /list_templates/, "el error debe indicar la salida");
  });
});

/* ===================== Errores ===================== */

describe("errores accionables", () => {
  it("un ícono inexistente falla nombrando list_icons", async () => {
    const r = await h.client.callTool({
      name: "create_diagram",
      arguments: { nodes: [{ key: "x", shape: "icon", label: "malo", icon: "no-existe" }] },
    });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /list_icons/);
  });

  it("un color inexistente falla nombrando las alternativas", async () => {
    const r = await h.client.callTool({
      name: "create_diagram",
      arguments: { nodes: [{ key: "x", shape: "rect", label: "malo", color: "Fucsia Neón" }] },
    });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /hex|#/, "el error debe explicar qué se acepta");
  });

  it("editar un id inexistente falla diciendo cuál", async () => {
    const created = await h.client.callTool({
      name: "create_diagram",
      arguments: { nodes: [{ key: "a", shape: "rect", label: "A" }] },
    });
    const r = await edit(documentOf(created), [{ op: "update_node", scope: "page", pageIndex: 0, node: { id: 9999 }, spec: { label: "x" } }]);
    assert.ok(isToolError(r));
    assert.match(textOf(r), /9999/);
    assert.equal(documentOf(r).errors[0].code, "NODE_NOT_FOUND");
  });

  it("un pageIndex fuera de rango dice cuántas páginas hay", async () => {
    const created = await h.client.callTool({
      name: "create_diagram",
      arguments: { nodes: [{ key: "a", shape: "rect", label: "A" }] },
    });
    const r = await h.client.callTool({
      name: "export_diagram",
      arguments: { document: documentOf(created), pageIndex: 7 },
    });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /página/i);
  });
});

/* ===================== Documentos que el servidor no puede procesar ===================== */

describe("un documento inválido se explica en prosa, no con un volcado de Zod", () => {
  /** Simula lo que pasará el día que Fluyo estrene una forma y este servidor no la
   *  conozca todavía: el usuario tiene que entender que actualice el servidor. */
  it("una forma desconocida dice cuál es y que hay que actualizar el servidor", async () => {
    const doc: any = loadFixture("kafka-event-pipeline.fluyo.json");
    doc.doc.pages[0].nodes[0].shape = "holograma";

    const r = await h.client.callTool({ name: "export_diagram", arguments: { document: doc } });
    assert.ok(isToolError(r));
    const text = textOf(r);
    assert.match(text, /holograma/, "debe nombrar la forma que no reconoce");
    assert.match(text, /actualiza/i, "debe decir que la salida es actualizar el servidor");
    assert.doesNotMatch(text, /"code":|invalid_value/, "no debe filtrar el JSON de issues de Zod");
  });

  it("un documento en formato v1 explica cómo migrarlo", async () => {
    const r = await h.client.callTool({
      name: "export_diagram",
      arguments: { document: { state: { nodes: [], edges: [], theme: "dark" } } },
    });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /v1/, "debe identificar el formato antiguo");
    assert.match(textOf(r), /guard/i, "debe decir que se reabra y se vuelva a guardar");
  });

  it("un objeto que no es un diagrama dice qué falta", async () => {
    const r = await h.client.callTool({ name: "export_diagram", arguments: { document: { cualquiera: 1 } } });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /'doc'|\bdoc\b/, "debe decir que falta la clave doc");
    assert.doesNotMatch(textOf(r), /"code":/, "no debe filtrar el JSON de issues de Zod");
  });

  /** La frontera declarada en DocumentInputSchema: un no-objeto lo rechaza el SDK
   *  antes del handler. El mensaje es suyo y es aceptable; se fija aquí para que el
   *  día que cambie se vea en el diff en vez de descubrirse en producción. */
  it("un document que no es objeto lo rechaza el SDK con un mensaje claro", async () => {
    const r = await h.client.callTool({ name: "export_diagram", arguments: { document: "no soy un objeto" } });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /expected object/i);
  });

  it("editar un documento roto tampoco filtra Zod: author_document lo rechaza estructurado y export_diagram señala la ruta", async () => {
    const doc: any = loadFixture("kafka-event-pipeline.fluyo.json");
    doc.doc.pages[0].nodes[0].x = "no soy un número";

    const r = await h.client.callTool({
      name: "author_document",
      arguments: { document: doc, baseRevision: "sha256:" + "0".repeat(64), operations: [RENAME("x")] },
    });
    assert.ok(isToolError(r));
    assert.equal(documentOf(r).errors[0].code, "DOCUMENT_UNREADABLE");
    assert.doesNotMatch(textOf(r), /"path":|invalid_type/, "no debe filtrar el JSON de issues de Zod");
    const e = await h.client.callTool({ name: "export_diagram", arguments: { document: doc } });
    assert.ok(isToolError(e));
    assert.match(textOf(e), /doc\.pages\[0\]\.nodes\[0\]\.x/, "debe señalar la ruta del campo malo");
    assert.doesNotMatch(textOf(e), /"code":/, "no debe filtrar el JSON de issues de Zod");
  });
});

/* ===================== El caso que el smoke test antiguo no cubría ===================== */

describe("un documento guardado por la app sobrevive a la edición (author_document; antes edit_diagram)", () => {
  it("preserva todo el estilo al renombrar la página", async () => {
    const original: any = loadFixture("kafka-event-pipeline.fluyo.json");
    const nombreOriginal = original.doc.pages[0].name;

    const salida = await editedDoc(original, [RENAME("Renombrada")]);
    assert.equal(salida.doc.pages[0].name, "Renombrada", "rename_page debe haber surtido efecto");

    // Deshacemos el único cambio pedido: lo demás tiene que ser idéntico a lo que la app tendría al abrirlo.
    salida.doc.pages[0].name = nombreOriginal;
    const diffs = collectDiffs(normalized(original), salida);
    assert.equal(
      diffs.length,
      0,
      `la edición alteró el documento más allá de lo pedido — ${diffs.length} diferencia(s):\n${summarizeDiffs(diffs)}\n`
    );
  });

  /* La fixture de `code` vive fuera del directorio que mira el test de contrato
     —ese es un espejo exacto de los ejemplos publicados—, así que sus campos
     nuevos necesitan su propia comprobación de round-trip. */
  it("preserva lang, keywords, kwBg y kwColor de los nodos code", async () => {
    const original: any = loadFixture(join("regresion-visual", "bloque-codigo.fluyo.json"));
    const nombreOriginal = original.doc.pages[0].name;

    const salida = await editedDoc(original, [RENAME("Renombrada")]);
    salida.doc.pages[0].name = nombreOriginal;
    const diffs = collectDiffs(normalized(original), salida);
    assert.equal(
      diffs.length, 0,
      `el round-trip perdió o cambió campos de code — ${diffs.length} diferencia(s):\n${summarizeDiffs(diffs)}\n`
    );

    // Y que los valores concretos siguen ahí, no solo que no hay diffs.
    const nodos = salida.doc.pages[0].nodes;
    assert.equal(nodos[0].lang, "sql");
    assert.deepEqual(nodos[2].keywords, ["cat", "grep", "sort"]);
    assert.equal(nodos[1].kwBg, "#c9b458");
    assert.equal(nodos[1].kwColor, "#161410");
    assert.equal(nodos[3].lang, "none");
  });

  /* Los campos de `code` se crean por create_diagram y se crean/editan por author_document (create_node,
     update_node): que se pueda crear un nodo de código pero no editarlo sería una asimetría. Lo fija por los dos caminos. */
  it("create_node y update_node aceptan los campos de code", async () => {
    const creado = await h.client.callTool({
      name: "create_diagram",
      arguments: {
        pageName: "code", theme: "dark",
        nodes: [{ key: "q", shape: "code", label: "SELECT 1", lang: "none", kwBg: "#ffffff", kwColor: "#000000" }],
        edges: [],
      },
    });
    assert.ok(!isToolError(creado), textOf(creado));
    const doc1 = documentOf(creado);
    assert.equal(doc1.doc.pages[0].nodes[0].lang, "none");
    assert.equal(doc1.doc.pages[0].nodes[0].kwBg, "#ffffff");

    const nodos = (await editedDoc(doc1, [
      { op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "code", x: 400, y: 0, label: "CREATE STREAM s", keywords: ["CREATE", "STREAM"], kwBg: "#a8b34a" } },
      { op: "update_node", scope: "page", pageIndex: 0, node: { id: doc1.doc.pages[0].nodes[0].id }, spec: { lang: "sql", kwColor: "#111111" } },
    ])).doc.pages[0].nodes;
    assert.equal(nodos[0].lang, "sql", "update_node debe poder cambiar lang");
    assert.equal(nodos[0].kwColor, "#111111", "update_node debe poder cambiar kwColor");
    assert.deepEqual(nodos[1].keywords, ["CREATE", "STREAM"], "create_node debe poder poner keywords");
    assert.equal(nodos[1].kwBg, "#a8b34a");
  });

  /* El caso que más importa para no romper nada: un documento anterior a esta
     forma no tiene ninguno de los campos nuevos y no debe salir con ellos
     inventados. Los 5 ejemplos oficiales lo cubren en el contrato; esto lo fija
     de forma explícita para que se lea al revisar. */
  it("un documento sin campos de code no los gana en el round-trip", async () => {
    const original: any = loadFixture("microservicios-api-gateway.fluyo.json");
    const salida = await editedDoc(original, [RENAME("x")]);
    for (const n of salida.doc.pages[0].nodes) {
      for (const campo of ["lang", "keywords", "kwBg", "kwColor"]) {
        assert.ok(!(campo in n), `el nodo ${n.id} ganó '${campo}' sin que nadie lo pidiera`);
      }
    }
  });
});

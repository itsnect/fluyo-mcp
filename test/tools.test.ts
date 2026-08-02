/**
 * TESTS DE LAS TOOLS — flujo extremo a extremo sobre un transporte en memoria.
 *
 * Sustituye al antiguo `scripts/smoke-test.ts`, que hacía estas mismas
 * comprobaciones pero (a) nadie lo ejecutaba en CI y (b) solo operaba sobre
 * documentos que el propio servidor acababa de crear — nunca sobre uno guardado
 * por la aplicación, que es donde estaban los fallos reales.
 *
 * El caso «preserva el estilo» del final es el que cubre ese hueco: mete una
 * fixture real por `edit_diagram` y comprueba que sale intacta.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

/* ===================== Superficie publicada ===================== */

const TOOLS_ESPERADAS = [
  "create_diagram",
  "edit_diagram",
  "export_diagram",
  "list_icons",
  "list_colors",
  "list_anims",
  "list_fonts",
  "list_templates",
  "create_from_template",
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
  it("están las nueve tools", async () => {
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
   *  Las nueve son funciones puras, así que el juego es uniforme. */
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
    assert.ok(bytes < 30_000, `tools/list ocupa ${bytes} caracteres, demasiado para enviarlo en cada conexión`);
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

  it("list_fonts trae las 11 tipografías y marca la global", async () => {
    const r = await h.client.callTool({ name: "list_fonts", arguments: {} });
    assert.ok(!isToolError(r), textOf(r));
    const text = textOf(r);
    assert.equal(text.trim().split("\n").length, 11);
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
    pageName: "Dispersiones MX",
    theme: "dark",
    nodes: [
      { key: "gw", shape: "rect", label: "API\nGateway", color: "Servicio" },
      { key: "kafka", shape: "icon", icon: "kafka", label: "Kafka", pulse: true, color: "Eventos / Kafka" },
      { key: "spei", shape: "rect", label: "Router SPEI", color: "Servicio" },
      { key: "db", shape: "cylinder", label: "Cloud SQL", color: "Datos" },
    ],
    edges: [
      { from: "gw", to: "kafka", label: "evento", route: "ortho" },
      { from: "kafka", to: "spei", label: "topic: dispersiones", route: "ortho" },
      { from: "spei", to: "db", label: "persistencia", dashed: true },
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
    const again = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: created, operations: [{ op: "rename_page", name: created.doc.pages[0].name }] },
    });
    assert.ok(!isToolError(again), textOf(again));
    const diffs = collectDiffs(created, documentOf(again));
    assert.equal(diffs.length, 0, `create → edit no es lossless:\n${summarizeDiffs(diffs)}\n`);
  });
});

/* ===================== edit_diagram ===================== */

describe("edit_diagram", () => {
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

  it("aplica add_node, add_edge, update_node y relayout en orden", async () => {
    const doc = await baseDocument();
    const r = await h.client.callTool({
      name: "edit_diagram",
      arguments: {
        document: doc,
        operations: [
          { op: "add_node", key: "monitor", shape: "icon", icon: "ai", label: "Monitoreo", color: "IA" },
          { op: "add_edge", from: 3, to: "monitor", label: "métricas" },
          { op: "update_node", id: 1, label: "Gateway v2", pulse: true },
          { op: "relayout" },
        ],
      },
    });
    assert.ok(!isToolError(r), textOf(r));
    const page = documentOf(r).doc.pages[0];
    assert.equal(page.nodes.length, 4, "add_node debe sumar un nodo");
    assert.equal(page.edges.length, 3, "add_edge debe sumar una arista");
    const gw = page.nodes.find((n: any) => n.id === 1);
    assert.equal(gw.label, "Gateway v2");
    assert.equal(gw.pulse, true);
  });

  it("remove_node arrastra sus aristas", async () => {
    const doc = await baseDocument();
    const r = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: doc, operations: [{ op: "remove_node", id: 2 }] },
    });
    const page = documentOf(r).doc.pages[0];
    assert.equal(page.nodes.length, 2);
    assert.equal(page.edges.length, 0, "las dos aristas tocaban el nodo 2");
  });

  it("set_theme cambia el tema del documento", async () => {
    const doc = await baseDocument();
    const r = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: doc, operations: [{ op: "set_theme", theme: "crema" }] },
    });
    assert.equal(documentOf(r).doc.theme, "crema");
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
    const r = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: documentOf(created), operations: [{ op: "update_node", id: 9999, label: "x" }] },
    });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /9999/);
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

  it("edit_diagram sobre un documento roto tampoco filtra Zod", async () => {
    const doc: any = loadFixture("kafka-event-pipeline.fluyo.json");
    doc.doc.pages[0].nodes[0].x = "no soy un número";

    const r = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: doc, operations: [{ op: "rename_page", name: "x" }] },
    });
    assert.ok(isToolError(r));
    assert.match(textOf(r), /doc\.pages\[0\]\.nodes\[0\]\.x/, "debe señalar la ruta del campo malo");
    assert.doesNotMatch(textOf(r), /"code":/, "no debe filtrar el JSON de issues de Zod");
  });
});

/* ===================== El caso que el smoke test antiguo no cubría ===================== */

describe("un documento guardado por la app sobrevive a edit_diagram", () => {
  it("preserva todo el estilo al renombrar la página", async () => {
    const original: any = loadFixture("kafka-event-pipeline.fluyo.json");
    const nombreOriginal = original.doc.pages[0].name;

    const r = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: original, operations: [{ op: "rename_page", name: "Renombrada" }] },
    });
    assert.ok(!isToolError(r), textOf(r));

    const salida = documentOf(r);
    assert.equal(salida.doc.pages[0].name, "Renombrada", "rename_page debe haber surtido efecto");

    // Deshacemos el único cambio pedido: lo demás tiene que ser idéntico.
    salida.doc.pages[0].name = nombreOriginal;
    const diffs = collectDiffs(original, salida);
    assert.equal(
      diffs.length,
      0,
      `edit_diagram alteró el documento más allá de lo pedido — ${diffs.length} diferencia(s):\n${summarizeDiffs(diffs)}\n`
    );
  });
});

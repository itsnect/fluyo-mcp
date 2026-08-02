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

import {
  collectDiffs,
  documentOf,
  isToolError,
  loadFixture,
  startHarness,
  summarizeDiffs,
  textBlocks,
  textOf,
  type Harness,
} from "./helpers.js";

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

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

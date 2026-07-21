import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALLÓ: ${msg}`);
}

function firstText(result: any): string {
  const block = result.content?.find((c: any) => c.type === "text");
  assert(block, "la respuesta no trae ningún bloque de texto");
  return block.text as string;
}

async function main() {
  const server = buildServer();
  const client = new Client({ name: "smoke-test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  console.log("== list_icons ==");
  const icons = await client.callTool({ name: "list_icons", arguments: {} });
  assert(!icons.isError, "list_icons no debería fallar");
  console.log(firstText(icons).slice(0, 120) + "...");

  console.log("\n== list_colors ==");
  const colors = await client.callTool({ name: "list_colors", arguments: {} });
  assert(!colors.isError, "list_colors no debería fallar");
  assert(firstText(colors).includes("Eventos / Kafka"), "debe listar el color 'Eventos / Kafka'");

  console.log("\n== list_templates ==");
  const templates = await client.callTool({ name: "list_templates", arguments: {} });
  assert(!templates.isError, "list_templates no debería fallar");
  assert(firstText(templates).includes("event_driven_pipeline"), "debe listar el template event_driven_pipeline");

  console.log("\n== create_diagram (auto-layout + colores + ícono) ==");
  const created = await client.callTool({
    name: "create_diagram",
    arguments: {
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
    },
  });
  assert(!created.isError, `create_diagram falló: ${created.isError ? firstText(created) : ""}`);
  const createdTexts = (created.content as any[]).filter(c => c.type === "text").map(c => c.text);
  assert(createdTexts.length === 2, "create_diagram debe devolver [resumen, json]");
  console.log(createdTexts[0]);
  const project = JSON.parse(createdTexts[1]);
  assert(project.doc.pages[0].nodes.length === 4, "deben existir 4 nodos");
  assert(project.doc.pages[0].edges.length === 3, "deben existir 3 aristas");
  assert(project.doc.pages[0].nodes[0].color === "#6a9fb5", "el color 'Servicio' debe resolver a #6a9fb5");
  const kafkaNode = project.doc.pages[0].nodes.find((n: any) => n.icon === "kafka");
  assert(kafkaNode, "debe existir el nodo icon=kafka");
  assert(typeof kafkaNode.x === "number" && typeof kafkaNode.y === "number", "el auto-layout debe asignar x/y numéricos");
  // El auto-layout debe ir de izquierda a derecha siguiendo las aristas: gw < kafka < spei < db en X.
  const byKey = (k: string) => project.doc.pages[0].nodes.find((n: any) => n.label.replace("\n", " ").toLowerCase().includes(k));
  const gwX = project.doc.pages[0].nodes[0].x;
  const speiNode = project.doc.pages[0].nodes[2];
  assert(speiNode.x > gwX, "el auto-layout debe avanzar hacia la derecha en capas sucesivas");

  console.log("\n== edit_diagram (add_node + add_edge + update_node + relayout) ==");
  const edited = await client.callTool({
    name: "edit_diagram",
    arguments: {
      document: project,
      operations: [
        { op: "add_node", key: "monitor", shape: "icon", icon: "ai", label: "Monitoreo", color: "IA" },
        { op: "add_edge", from: 3, to: "monitor", label: "métricas" },
        { op: "update_node", id: 1, label: "API\nGateway v2", pulse: true },
        { op: "relayout" },
      ],
    },
  });
  assert(!edited.isError, `edit_diagram falló: ${edited.isError ? firstText(edited) : ""}`);
  const editedTexts = (edited.content as any[]).filter(c => c.type === "text").map(c => c.text);
  const editedProject = JSON.parse(editedTexts[1]);
  assert(editedProject.doc.pages[0].nodes.length === 5, "deben existir 5 nodos tras add_node");
  assert(editedProject.doc.pages[0].edges.length === 4, "deben existir 4 aristas tras add_edge");
  const gwNode = editedProject.doc.pages[0].nodes.find((n: any) => n.id === 1);
  assert(gwNode.label === "API\nGateway v2", "update_node debe haber cambiado el label");
  assert(gwNode.pulse === true, "update_node debe haber activado pulse");
  console.log(editedTexts[0]);

  console.log("\n== export_diagram (SVG) ==");
  const exported = await client.callTool({
    name: "export_diagram",
    arguments: { document: editedProject, format: "svg" },
  });
  assert(!exported.isError, `export_diagram falló: ${exported.isError ? firstText(exported) : ""}`);
  const exportedTexts = (exported.content as any[]).filter(c => c.type === "text").map(c => c.text);
  const svg = exportedTexts[1];
  assert(svg.startsWith("<?xml"), "el export debe producir un documento SVG válido");
  assert(svg.includes("<svg"), "debe incluir la etiqueta <svg>");
  assert((svg.match(/<g id="node-/g) || []).length === 5, "el SVG debe tener un <g> por cada uno de los 5 nodos");
  console.log(`SVG generado: ${svg.length} caracteres.`);

  console.log("\n== create_from_template (rag_chatbot con overrides) ==");
  const fromTemplate = await client.callTool({
    name: "create_from_template",
    arguments: {
      templateId: "rag_chatbot",
      labelOverrides: { llm: "Gemini / Vertex AI" },
    },
  });
  assert(!fromTemplate.isError, `create_from_template falló: ${fromTemplate.isError ? firstText(fromTemplate) : ""}`);
  const templateProject = JSON.parse((fromTemplate.content as any[])[1].text);
  const llmNode = templateProject.doc.pages[0].nodes.find((n: any) => n.icon === "ai");
  assert(llmNode.label === "Gemini / Vertex AI", "labelOverrides debe sobreescribir el label del nodo 'llm'");

  console.log("\n== validación de errores esperados ==");
  const badIcon = await client.callTool({
    name: "create_diagram",
    arguments: { nodes: [{ key: "x", shape: "icon", label: "malo", icon: "no-existe" }] },
  });
  assert(badIcon.isError, "un ícono inexistente debe producir isError=true");
  console.log("OK:", firstText(badIcon));

  const badRef = await client.callTool({
    name: "edit_diagram",
    arguments: { document: project, operations: [{ op: "update_node", id: 9999, label: "x" }] },
  });
  assert(badRef.isError, "editar un id inexistente debe producir isError=true");
  console.log("OK:", firstText(badRef));

  await client.close();
  await server.close();
  console.log("\n✅ Todos los smoke tests pasaron.");
}

main().catch(err => {
  console.error("\n❌ Smoke test falló:", err);
  process.exit(1);
});

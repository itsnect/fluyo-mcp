/**
 * FLUYO-018.15 — color con el que nace un nodo (DEFAULT_NODE_COLOR del kernel) y compatibilidad.
 *
 *   · Un nodo creado sin `color` (create_diagram, author_document) nace con #857F6C, igual que en el editor.
 *   · «Servicio» sigue siendo #6a9fb5 en list_colors y en las plantillas: la paleta no cambia.
 *   · Un color explícito se conserva tal cual, también #6a9fb5.
 *   · Un nodo guardado SIN color se sigue leyendo como #6a9fb5 (respaldo histórico): ningún documento cambia.
 *   · export_diagram dibuja esos colores: la firma de color del SVG del fixture compartido es la MISMA que fija
 *     fluyo/test/fluyo-018-15-browser.cjs con el exportador del editor (paridad transitiva MCP = editor).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { PALETTE } from "../src/generated/config.js";
import { createKernel } from "../src/kernel.js";
import { normalizeWith, revisionOf } from "../src/revision.js";
import { documentOf, isToolError, packageRoot, startHarness, textOf, type Harness } from "./helpers.js";

const NEW_DEFAULT = "#857F6C", SERVICIO = "#6a9fb5";
const ROOT = packageRoot();
const FIXTURE = join(ROOT, "test", "fixtures", "fluyo-018-15-colores.json");
const FLUYO_FIXTURE = join(ROOT, "..", "fluyo", "test", "fixtures", "fluyo-018-15-colores.json");
const fixture = (): any => JSON.parse(readFileSync(FIXTURE, "utf8"));

/* Firma de color del SVG: los valores de stroke y fill, en orden de aparición, sin el fondo.
   La misma función vive en el browser test de Fluyo; si cambia aquí, cambia allí. */
export const SIGNATURE = [
  "#857F6C|rgba(133,127,108,0.16)", "#6a9fb5|rgba(106,159,181,0.16)",                 // caja por defecto · «Servicio» explícito
  "#857F6C|rgba(133,127,108,0.16)", "#857F6C|none",                                   // BD: contorno + labio
  "#857F6C|rgba(133,127,108,0.16)",                                                   // code: panel teñido
  "#7fa66b|rgba(127,166,107,0.16)", "#6a9fb5|rgba(106,159,181,0.16)",                 // «Datos» explícito · histórico sin color
  "text:#857F6C",                                                                     // nodo `text`: su color es el del texto
];

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const blank = (): any => createKernel().call("serializeProject()");

describe("FLUYO-018.15: color con el que nace un nodo", () => {
  it("el kernel define DEFAULT_NODE_COLOR = #857F6C y la paleta conserva «Servicio» = #6a9fb5 en primer lugar", () => {
    const k = createKernel();
    assert.equal(k.call("DEFAULT_NODE_COLOR"), NEW_DEFAULT);
    assert.equal(k.call("PALETTE[0].c"), SERVICIO);
    assert.deepEqual([PALETTE[0].name, PALETTE[0].hex, PALETTE.length], ["Servicio", SERVICIO, 14]);
    assert.ok(!PALETTE.some(p => p.hex.toLowerCase() === NEW_DEFAULT.toLowerCase()), "el color por defecto no es una categoría de la paleta");
  });

  it("list_colors no cambia: 14 nombres, «Servicio -> #6a9fb5» el primero", async () => {
    const lines = textOf(await call("list_colors", {})).split("\n").filter(l => l.includes("->"));
    assert.equal(lines.length, 14);
    assert.equal(lines[0].trim(), "Servicio -> #6a9fb5");
    assert.ok(!lines.some(l => /857F6C/i.test(l)));
  });

  it("create_diagram: sin color → #857F6C; «Servicio» y #6a9fb5 explícitos → #6a9fb5", async () => {
    const r = await call("create_diagram", { nodes: [
      { key: "a", shape: "rect", label: "Sin color" },
      { key: "b", shape: "rect", label: "Con nombre", color: "Servicio" },
      { key: "c", shape: "rect", label: "Con hex", color: SERVICIO },
      { key: "d", shape: "text", label: "Título" },
    ], connections: [{ from: "a", to: "b" }] });
    assert.ok(!isToolError(r), textOf(r));
    const colors = documentOf(r).doc.pages[0].nodes.map((n: any) => n.color);
    assert.deepEqual(colors, [NEW_DEFAULT, SERVICIO, SERVICIO, NEW_DEFAULT]);
  });

  it("author_document create_node sin color → #857F6C (la misma createNodeIn que el editor)", async () => {
    const b = blank();
    const r = await call("author_document", { document: b, baseRevision: rev(b), operations: [
      { op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 0, y: 0, label: "Nuevo" } },
      { op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 300, y: 0, label: "Explícito", color: SERVICIO } },
    ] });
    assert.ok(!isToolError(r), textOf(r));
    assert.deepEqual(documentOf(r).document.doc.pages[0].nodes.map((n: any) => n.color), [NEW_DEFAULT, SERVICIO]);
  });

  it("documento antiguo: un nodo SIN color se normaliza a #6a9fb5 y una edición ajena no lo toca", async () => {
    const doc = fixture();
    const legacy = doc.doc.pages[0].nodes.find((n: any) => n.label === "Histórico");
    assert.ok(legacy && !("color" in legacy), "el fixture tiene un nodo sin color");
    const r = await call("author_document", { document: doc, baseRevision: rev(doc), operations: [{ op: "rename_page", scope: "document", pageIndex: 0, name: "Otra" }] });
    assert.ok(!isToolError(r), textOf(r));
    const nodes = documentOf(r).document.doc.pages[0].nodes;
    assert.equal(nodes.find((n: any) => n.label === "Histórico").color, SERVICIO);
    assert.deepEqual(nodes.map((n: any) => n.color), [NEW_DEFAULT, SERVICIO, NEW_DEFAULT, NEW_DEFAULT, NEW_DEFAULT, "#7fa66b", SERVICIO]);
  });

  it("export_diagram: firma de color del fixture compartido (= exportador del editor), sin cian", async () => {
    /* El documento tal como lo guarda el editor (normalizado: el nodo histórico ya lleva #6a9fb5). export_diagram
       exige `color` en cada nodo desde antes de este slice; ver la tarea FLUYO-018.15 § compatibilidad. */
    const r = await call("export_diagram", { document: normalizeWith(createKernel(), fixture()) });
    assert.ok(!isToolError(r), textOf(r));
    const svg = textOf(r);
    assert.deepEqual(colorSignature(svg), SIGNATURE);
    assert.ok(!/3aa7e8|58,\s*167,\s*232/i.test(svg), "sin el cian del editor antiguo");
  });

  it("el fixture es copia exacta del de Fluyo (si está al lado)", () => {
    if (!existsSync(FLUYO_FIXTURE)) return;
    assert.equal(readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n"), readFileSync(FLUYO_FIXTURE, "utf8").replace(/\r\n/g, "\n"));
  });
});

/* Por cada forma de nodo, «stroke|fill» en orden de aparición, y el fill del texto del nodo `text`. Se ignoran
   las conexiones (color del tema): hasta 018.15 eran <polyline>; desde FLUYO-018.16 son un <path> de
   stroke-width 1.5 (las puntas son <path> sin stroke y ya caen fuera). */
export function colorSignature(svg: string): string[] {
  const out: string[] = [];
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, "");
  for (const m of body.matchAll(/<(rect|path|polygon|circle|ellipse)\b([^>]*)>/g)) {
    const stroke = /\bstroke="([^"]+)"/.exec(m[2])?.[1], fill = /\bfill="([^"]+)"/.exec(m[2])?.[1];
    if (!stroke || stroke === "none") continue;
    if (m[2].includes('stroke-width="1.5"')) continue;   // conexión (FLUYO-018.16)
    out.push(stroke + "|" + fill);
  }
  for (const m of body.matchAll(/<text\b[^>]*\bfill="([^"]+)"[^>]*>Título</g)) out.push("text:" + m[1]);
  return out;
}

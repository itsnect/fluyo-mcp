/**
 * TESTS DEL ENLACE `fluyo.space/#d=…`
 *
 * Lo que fijan, por orden de importancia:
 *
 *   a) El formato es el que la app sabe leer. El lector vive en OTRO
 *      repositorio (`fluyo/js/deeplink.js`) y nadie compila los dos juntos, así
 *      que este acoplamiento puede romperse sin que ningún build se queje. Aquí
 *      se comprueba la mitad que se puede comprobar desde Node —byte de versión,
 *      alfabeto base64url, y que descomprimir devuelve el documento exacto—; la
 *      otra mitad está en `fluyo/test/documento-entrante.html`, que lee con el
 *      navegador cargas generadas por este mismo código.
 *
 *   b) Que el enlace no se cuele donde no toca ni rompa la forma de la
 *      respuesta: `content[]` sigue siendo [resumen, json].
 *
 *   c) Que un diagrama que no cabe se explique en vez de producir una URL rota.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";

import { DEFAULT_APP_URL, MAX_LINK_CHARS, buildOpenLink } from "../src/link.js";
import { createDiagram } from "../src/diagram.js";
import {
  documentOf,
  loadFixtures,
  startHarness,
  textBlocks,
  type Harness,
} from "./helpers.js";

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

const DIAGRAMA_BASE = {
  pageName: "Prueba",
  theme: "dark" as const,
  grid: true,
  build: false,
  autoLayout: true,
  speed: 0.5,
  dots: 3,
  stagger: 0.45,
  single: false,
  nodes: [
    { key: "a", label: "A", shape: "rect" as const },
    { key: "b", label: "B", shape: "rect" as const },
  ],
  edges: [{ from: "a", to: "b" }],
};

/** Deshace lo que hace buildOpenLink: es el lector del navegador, en Node. */
function leerEnlace(url: string): { version: number; doc: unknown } {
  const payload = /#d=([A-Za-z0-9\-_]+)$/.exec(url)?.[1];
  assert.ok(payload, `la URL no termina en un #d= legible: ${url.slice(0, 60)}…`);
  const bytes = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const version = bytes[0];
  const json = version === 1 ? inflateRawSync(bytes.subarray(1)) : bytes.subarray(1);
  return { version, doc: JSON.parse(json.toString("utf8")) };
}

/* ===================== Formato ===================== */

describe("el formato del enlace", () => {
  it("apunta a la app pública y lleva la carga en el fragmento", () => {
    const url = buildOpenLink(createDiagram(DIAGRAMA_BASE), {})!;
    assert.ok(url.startsWith(DEFAULT_APP_URL + "#d="), `empieza por «${url.slice(0, 40)}»`);
  });

  it("el primer byte de la carga es la versión de formato, y es 1 (deflate-raw)", () => {
    const { version } = leerEnlace(buildOpenLink(createDiagram(DIAGRAMA_BASE), {})!);
    assert.equal(version, 1);
  });

  /** Un `+`, un `/` o un `=` en el fragmento sobreviven a una barra de
   *  direcciones pero no a todo lo que hay entre el chat y el navegador. */
  it("usa el alfabeto base64url y no lleva relleno", () => {
    const url = buildOpenLink(createDiagram(DIAGRAMA_BASE), {})!;
    const payload = url.split("#d=")[1];
    assert.match(payload, /^[A-Za-z0-9\-_]+$/, "hay caracteres fuera de base64url");
  });

  /* Se compara contra el JSON del proyecto y no contra el objeto en memoria, y
     no es un atajo: el enlace transporta exactamente lo mismo que el bloque de
     texto que devuelve la tool, o sea `JSON.stringify(project)`. El objeto en
     memoria trae además claves con valor `undefined` —`icon` y `anim` en los
     nodos que no son de ese tipo— que JSON no representa. Lo que este test
     tiene que fijar es que el enlace y el JSON digan lo mismo. */
  it("descomprimir devuelve el documento EXACTO que se codificó", () => {
    const project = createDiagram(DIAGRAMA_BASE);
    const { doc } = leerEnlace(buildOpenLink(project, {})!);
    assert.deepStrictEqual(doc, JSON.parse(JSON.stringify(project)));
  });

  /** El caso real: los ocho diagramas que Fluyo publica. Si alguno dejara de
   *  caber, el recorrido se rompería para los documentos más representativos
   *  que hay. */
  it("los ocho ejemplos reales caben, y con muchísimo margen", () => {
    const medidas = loadFixtures().map(fx => {
      const url = buildOpenLink(fx.doc as any, {});
      assert.ok(url, `${fx.name} no cupo en un enlace`);
      const { doc } = leerEnlace(url!);
      assert.deepStrictEqual(doc, fx.doc, `${fx.name} no sobrevive al round-trip`);
      return { name: fx.name, chars: url!.length };
    });
    const peor = medidas.reduce((a, b) => (a.chars > b.chars ? a : b));
    assert.ok(
      peor.chars < MAX_LINK_CHARS / 4,
      `el peor caso (${peor.name}) ocupa ${peor.chars} de ${MAX_LINK_CHARS} caracteres`
    );
  });
});

/* ===================== Base configurable ===================== */

describe("dónde apunta el enlace", () => {
  it("FLUYO_APP_URL manda, para self-host o una copia local", () => {
    const url = buildOpenLink(createDiagram(DIAGRAMA_BASE), { FLUYO_APP_URL: "https://diagramas.interno/" })!;
    assert.ok(url.startsWith("https://diagramas.interno/#d="));
  });

  it("si la base ya traía fragmento, se sustituye en vez de encadenarse", () => {
    const url = buildOpenLink(createDiagram(DIAGRAMA_BASE), { FLUYO_APP_URL: "https://fluyo.space/#d=viejo" })!;
    assert.equal(url.split("#").length, 2, `hay más de un fragmento: ${url.slice(0, 60)}…`);
    assert.ok(!url.includes("viejo"));
  });

  it("un valor que no es una URL se ignora en vez de producir enlaces rotos", () => {
    const url = buildOpenLink(createDiagram(DIAGRAMA_BASE), { FLUYO_APP_URL: "no es una url" })!;
    assert.ok(url.startsWith(DEFAULT_APP_URL));
  });
});

/* ===================== Lo que no cabe ===================== */

/**
 * Ruido pseudoaleatorio determinista, que es lo que hace falta para simular una
 * foto. El primer intento de este test usaba una secuencia periódica y no pasó
 * del tope: deflate se la comió entera y el enlace salió cortísimo. Una imagen
 * de verdad es incompresible —ya viene comprimida—, así que si el test quiere
 * medir el tope tiene que darle algo que de verdad no se comprima.
 */
function ruido(n: number): string {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let x = 123456789;
  let out = "";
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out += alfabeto[x % 64];
  }
  return out;
}

describe("un diagrama que no cabe en una URL", () => {
  /** Nodos `image`: el MCP no puede crearlos, pero sí recibe documentos que ya
   *  los traen, y llevan la imagen entera dentro como data URI. Es el único caso
   *  realista que revienta el tope, y por eso el mensaje habla de ellos. */
  const conImagenGrande = () => {
    const project: any = createDiagram(DIAGRAMA_BASE);
    project.doc.pages[0].nodes.push({
      id: 99, shape: "image", x: 500, y: 500, w: 400, h: 300, label: "", order: 9,
      color: "#6a9fb5", fill: null, border: "solid", lblPos: "center",
      textBg: null, textColor: null, font: null, bold: false, pulse: false,
      img: "data:image/png;base64," + ruido(40_000),
    });
    return project;
  };

  it("devuelve null en vez de una URL de 60.000 caracteres", () => {
    assert.equal(buildOpenLink(conImagenGrande(), {}), null);
  });

  it("y la tool lo explica, sin dejar de devolver el JSON", async () => {
    const res = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: conImagenGrande(), operations: [{ op: "rename_page", name: "Con foto" }] },
    });
    const [resumen] = textBlocks(res);
    assert.ok(!resumen.includes("#d="), "emitió un enlace que no debería caber");
    assert.match(resumen, /no cabe en un enlace/i);
    assert.match(resumen, /image/, "no dice cuál es la causa habitual");
    assert.equal(documentOf(res).doc.pages[0].name, "Con foto", "el diagrama sí salió");
  });
});

/* ===================== Integración con las tools ===================== */

describe("el enlace en la respuesta de las tools", () => {
  const CON_ENLACE = ["create_diagram", "edit_diagram", "create_from_template"];

  it("las tres tools que devuelven documento traen enlace en el resumen", async () => {
    const base = await h.client.callTool({ name: "create_diagram", arguments: DIAGRAMA_BASE });
    const doc = documentOf(base);

    const respuestas: Record<string, unknown> = {
      create_diagram: base,
      edit_diagram: await h.client.callTool({
        name: "edit_diagram",
        arguments: { document: doc, operations: [{ op: "rename_page", name: "Editado" }] },
      }),
      create_from_template: await h.client.callTool({
        name: "create_from_template",
        arguments: { templateId: "event_driven_pipeline" },
      }),
    };

    for (const name of CON_ENLACE) {
      const bloques = textBlocks(respuestas[name]);
      assert.equal(bloques.length, 2, `${name}: content[] dejó de ser [resumen, json]`);
      assert.match(bloques[0], /#d=[A-Za-z0-9\-_]+$/m, `${name}: el resumen no trae enlace`);
    }
  });

  it("el enlace de edit_diagram lleva el documento YA editado", async () => {
    const base = documentOf(await h.client.callTool({ name: "create_diagram", arguments: DIAGRAMA_BASE }));
    const res = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: base, operations: [{ op: "rename_page", name: "Después" }] },
    });
    const url = /https?:\/\/\S+#d=[A-Za-z0-9\-_]+/.exec(textBlocks(res)[0])![0];
    const { doc } = leerEnlace(url);
    assert.equal((doc as any).doc.pages[0].name, "Después");
  });

  /** export_diagram devuelve un SVG, no un documento. Meterle un enlace sería
   *  ruido en la tool que además ya va justa de tamaño. */
  it("export_diagram no trae enlace", async () => {
    const doc = documentOf(await h.client.callTool({ name: "create_diagram", arguments: DIAGRAMA_BASE }));
    const res = await h.client.callTool({ name: "export_diagram", arguments: { document: doc } });
    assert.ok(!textBlocks(res)[0].includes("#d="));
  });
});

/* ===================== Firma del generador ===================== */

describe("meta.generator", () => {
  it("lo que se CREA aquí queda firmado", async () => {
    const doc = documentOf(await h.client.callTool({ name: "create_diagram", arguments: DIAGRAMA_BASE }));
    assert.deepEqual(doc.meta, { generator: "fluyo-mcp" });

    const tpl = documentOf(await h.client.callTool({
      name: "create_from_template", arguments: { templateId: "event_driven_pipeline" },
    }));
    assert.deepEqual(tpl.meta, { generator: "fluyo-mcp" });
  });

  /** Editar no es crear. Un documento que llega sin marca sale sin marca: lo
   *  hizo otro y esta herramienta solo lo tocó. */
  it("un documento ajeno NO se firma al editarlo", async () => {
    const ajeno = loadFixtures()[0].doc;
    const res = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: ajeno, operations: [{ op: "rename_page", name: "Tocado" }] },
    });
    assert.equal("meta" in documentOf(res), false);
  });

  /** Pero si venía firmado, la marca sobrevive: es el `.passthrough()` de los
   *  schemas haciendo su trabajo, y es lo que permite que un create + edit
   *  siga contando como diagrama nacido aquí. */
  it("y si venía firmado, la marca sobrevive a edit_diagram", async () => {
    const doc = documentOf(await h.client.callTool({ name: "create_diagram", arguments: DIAGRAMA_BASE }));
    const res = await h.client.callTool({
      name: "edit_diagram",
      arguments: { document: doc, operations: [{ op: "rename_page", name: "Editado" }] },
    });
    assert.deepEqual(documentOf(res).meta, { generator: "fluyo-mcp" });
  });
});

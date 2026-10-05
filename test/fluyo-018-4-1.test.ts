/**
 * FLUYO-018.4.1 — Hotfix: el kernel compartido lee documentos que ya contienen nodos `image`.
 *
 * Causa: safe-svg.js (normalizeDocumentImage) usa atob, btoa, TextEncoder y TextDecoder, que el navegador trae y el `vm`
 * vacío no. Un documento con un nodo image acababa en readable:false / invalid_document. Se arregla en la frontera del vm
 * (src/kernel.ts), no en el kernel; MCP sigue sin poder crear imágenes.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { KERNEL_FILES, KERNEL_ID } from "../src/generated/kernel-sources.js";
import { revisionOf } from "../src/revision.js";
import { documentOf, isToolError, packageRoot, startHarness, type Harness } from "./helpers.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const story = (): any => JSON.parse(readFileSync(join(packageRoot(), "test", "fixtures", "stories", "fluyo-017-1-cliente-kafka-comercio.fluyo.json"), "utf8"));

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString("base64");
const PNG = "data:image/png;base64," + b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = "data:image/jpeg;base64," + b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF = "data:image/gif;base64," + b64([...Buffer.from("GIF89a"), 1, 0, 1, 0]);
const WEBP = "data:image/webp;base64," + b64([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
const SVG_SRC = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/><text x="1" y="9">ñandú</text></svg>';
const SVG_B64 = "data:image/svg+xml;base64," + Buffer.from(SVG_SRC, "utf8").toString("base64");
const SVG_RAW = "data:image/svg+xml;utf8," + encodeURIComponent(SVG_SRC);

/** Documento con historias (fixture de 017.1) al que se le añade un nodo image, como los que ya existen en archivos reales. */
const withImage = (img: string): any => {
  const d = story();
  const p = d.doc.pages[0];
  p.nodes.push({ id: p.nextId, label: "", shape: "image", x: 900, y: 40, w: 120, h: 80, order: p.nodes.length, color: "#38bdf8", img });
  p.nextId += 1;
  return d;
};

const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const NO_LEAK = /TypeError|ReferenceError|is not defined|Cannot read|\n\s+at\s|node:internal|\.ts:\d+|\.js:\d+:\d+|vm\./;
const THROWS = (expr: string): string => `(function(){try{${expr};return 'no'}catch(e){return 'throws'}})()`;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });

describe("018.4.1 — globals web en la frontera del vm", () => {
  const k = createKernel();

  it("atob, btoa, TextEncoder y TextDecoder existen dentro del kernel", () => {
    assert.deepEqual(k.call("[typeof atob, typeof btoa, typeof TextEncoder, typeof TextDecoder]"), ["function", "function", "function", "function"]);
  });

  it("atob / btoa: ida y vuelta, Latin-1 y error ante entrada inválida", () => {
    assert.equal(k.call("atob(__a)", "aGk="), "hi");
    assert.equal(k.call("btoa(__a)", "hi"), "aGk=");
    assert.equal(k.call("btoa(__a)", "\xff\x00\x89"), "/wCJ");
    assert.equal(k.call("atob(__a).charCodeAt(0)", "/wCJ"), 255);
    assert.equal(k.call(THROWS("atob('***')")), "throws");
    assert.equal(k.call(THROWS("btoa('ñ€')")), "throws", "btoa solo acepta Latin-1, como en el navegador");
  });

  it("TextEncoder: UTF-8, Uint8Array del propio contexto, encoding", () => {
    assert.deepEqual(k.call("Array.from(new TextEncoder().encode(__a))", "ñ€"), [195, 177, 226, 130, 172]);
    assert.equal(k.call("new TextEncoder().encode('a') instanceof Uint8Array"), true);
    assert.equal(k.call("new TextEncoder().encoding"), "utf-8");
    assert.deepEqual(k.call("Array.from(new TextEncoder().encode())"), []);
  });

  it("TextDecoder: UTF-8, subarray/ArrayBuffer, fatal y etiquetas no soportadas", () => {
    assert.equal(k.call("new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(__a))", [195, 177, 226, 130, 172]), "ñ€");
    assert.equal(k.call("new TextDecoder().decode(Uint8Array.from(__a).subarray(2))", [0, 0, 104, 105]), "hi");
    assert.equal(k.call("new TextDecoder().decode(Uint8Array.from(__a).buffer)", [104, 105]), "hi");
    assert.equal(k.call("new TextDecoder().decode()"), "");
    assert.equal(k.call("new TextDecoder('utf-8',{fatal:true}).fatal"), true);
    assert.equal(k.call(THROWS("new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from([0xff,0xfe]))")), "throws");
    assert.equal(k.call("new TextDecoder().decode(Uint8Array.from([0xff]))"), "�", "sin fatal sustituye");
    assert.equal(k.call("(function(){try{new TextDecoder('latin1');return 'no'}catch(e){return e instanceof RangeError}})()"), true);
  });

  it("los wrappers son del contexto: no filtran constructores ni objetos del host", () => {
    for (const g of ["atob", "btoa"]) assert.equal(k.call(`${g}.constructor === (function(){}).constructor`), true, g);
    for (const g of ["TextEncoder", "TextDecoder"]) assert.equal(k.call(`${g}.constructor === (function(){}).constructor`), true, g);
    assert.equal(k.call("typeof process + typeof require + typeof Buffer"), "undefinedundefinedundefined");
  });

  it("el estado no se comparte entre contextos y el hotfix no toca el KERNEL_ID", () => {
    assert.equal(createKernel().call("typeof globalThis.__x"), "undefined");
    assert.equal(createKernel().kernelId, KERNEL_ID);
  });

  it("normalizeDocumentImage del kernel funciona con cada formato (usa los cuatro globals)", () => {
    for (const uri of [PNG, JPEG, GIF, WEBP]) assert.equal(k.call("normalizeDocumentImage(__a)", uri), uri);
    for (const uri of [SVG_B64, SVG_RAW]) {
      const out = k.call<string>("normalizeDocumentImage(__a)", uri);
      assert.match(out, /^data:image\/svg\+xml;base64,/);
      const svg = Buffer.from(out.split(",")[1], "base64").toString("utf8");
      assert.match(svg, /<rect/);
      assert.match(svg, /ñandú/, "UTF-8 intacto tras decode/encode");
    }
  });

  it("una imagen inválida sigue siendo un error del documento, no un fallo del entorno", () => {
    for (const bad of ["data:image/png;base64,AAAA", "data:image/png;base64,@@@@", "data:image/svg+xml;base64,/wCJ", "data:text/html;base64,aGk=", "https://x/y.png"])
      assert.throws(() => k.call("normalizeDocumentImage(__a)", bad), (e: any) => !/is not defined/.test(String(e?.message)), bad);
  });

  it("REGRESIÓN: el kernel no usa globals de navegador que el vm no provea", () => {
    // Si una sync futura del kernel empieza a usar otro global web, esto lo detecta antes que producción.
    const WEB = ["atob", "btoa", "TextEncoder", "TextDecoder", "structuredClone", "URL", "URLSearchParams", "Blob", "fetch", "crypto", "performance", "setTimeout", "queueMicrotask", "navigator"];
    const probe = createKernel();
    const missing: string[] = [];
    for (const g of WEB) {
      const used = KERNEL_FILES.some(f => new RegExp(`(?<![\\w.$])${g}(?![\\w$])`).test(f.source));
      if (used && probe.call(`typeof ${g}`) === "undefined") missing.push(g);
    }
    assert.deepEqual(missing, [], "global usado por el kernel y ausente en el vm: añadirlo en installWebGlobals (src/kernel.ts)");
  });
});

describe("018.4.1 — documentos con nodos image por las tools MCP", () => {
  for (const [name, img] of [["png", PNG], ["jpeg", JPEG], ["gif", GIF], ["webp", WEBP], ["svg base64", SVG_B64], ["svg utf8", SVG_RAW]] as const) {
    it(`describe_document lee un documento con imagen ${name}`, async () => {
      const r = await call("describe_document", { document: withImage(img) });
      assert.ok(!isToolError(r), JSON.stringify(r));
      const d = documentOf(r);
      assert.equal(d.readable, true);
      assert.equal(d.valid, true);
      assert.equal(d.errorCount, 0);
      assert.equal(d.kernelId, KERNEL_ID);
    });
  }

  it("describe_document: una imagen inválida sigue dando invalid_document", async () => {
    const d = documentOf(await call("describe_document", { document: withImage("data:image/png;base64,AAAA") }));
    assert.equal(d.readable, false);
    assert.equal(d.errors[0].code, "invalid_document");
  });

  it("run_story sobre un documento con image da el mismo resultado que sin image", async () => {
    const a = documentOf(await call("run_story", { document: story(), storyId: 1 }));
    const b = documentOf(await call("run_story", { document: withImage(SVG_B64), storyId: 1 }));
    assert.notEqual(b.readable, false, JSON.stringify(b).slice(0, 300));
    const imageId = withImage(SVG_B64).doc.pages[0].nodes.at(-1).id;
    // El nodo image es un elemento más del documento (aparece en finalAvailability); todo lo demás debe ser idéntico.
    const strip = (x: any) => { const c = clone(x); delete c.revision; delete c.resultRevision; c.finalAvailability = c.finalAvailability.filter((n: any) => n.id !== imageId); return c; };
    assert.ok(b.finalAvailability.some((n: any) => n.id === imageId), "el nodo image forma parte del documento");
    assert.deepEqual(strip(b), strip(a));
  });

  it("author_document dryRun funciona sobre un documento con image y la conserva", async () => {
    const doc = withImage(SVG_B64);
    const op = { op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 10, y: 10, label: "Nuevo" } };
    const r = await call("author_document", { document: doc, baseRevision: rev(doc), operations: [op], dryRun: true });
    assert.ok(!isToolError(r), JSON.stringify(r).slice(0, 400));
    assert.doesNotMatch(JSON.stringify(r), NO_LEAK);
    const out = documentOf(r);
    assert.equal(out.dryRun, true);
    const doc2 = out.document ?? out.resultDocument;
    if (doc2) {
      const img = doc2.doc.pages[0].nodes.find((n: any) => n.shape === "image");
      assert.equal(Buffer.from(img.img.split(",")[1], "base64").toString("utf8").includes("ñandú"), true);
    }
  });

  it("author_document (sin dryRun) conserva el nodo image; crear image por MCP sigue prohibido", async () => {
    const doc = withImage(PNG);
    const op = { op: "create_node", scope: "page", pageIndex: 0, spec: { shape: "rect", x: 1, y: 1 } };
    const out = authorDocument({ document: doc, baseRevision: rev(doc), operations: [op] }) as any;
    assert.equal(out.document.doc.pages[0].nodes.filter((n: any) => n.shape === "image").length, 1);
    const bad = await call("author_document", { document: doc, baseRevision: rev(doc), operations: [{ ...op, spec: { shape: "image", x: 1, y: 1 } }] }).then(isToolError, () => true);
    assert.equal(bad, true);
  });

  it("documento SIN image: comportamiento idéntico y kernelId sin cambios", async () => {
    const d = documentOf(await call("describe_document", { document: story() }));
    assert.equal(d.readable, true);
    assert.equal(d.kernelId, KERNEL_ID);
    assert.equal(KERNEL_ID, "90e70a270b0fe350e87fcc58ce067d48e3ce9b5c49ae0ebc1ada0ff6e0ca7a16", "el hotfix no toca el kernel sincronizado");
  });
});

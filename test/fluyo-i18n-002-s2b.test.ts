/**
 * FLUYO-I18N-002 S2b — el MCP con el kernel que lleva el proveedor de texto opcional (story-playback.js) y el formateador opcional
 * K1 (model.js; decisión 283). El MCP no pasa ninguno: su salida sigue siendo en español, byte a byte la de antes.
 *
 *   T1. El kernel del MCP no conoce ninguna interfaz: FluyoI18n no existe en su vm y las funciones sin proveedor dicen español.
 *   T2. El MCP no pasa proveedor ni formateador: ni sentence/outcomes/run (stories.ts) ni create_story/duplicate_story (authoring).
 *   T3. De extremo a extremo: author_document sin nombre siembra «Historia N» y «… copia» (con su recorte a 120); run_story dice lo de
 *       siempre («Elemento sin nombre», NARRATED_NOTE).
 *   T4. kernel-sources.ts es el kernel de fluyo/ (sha256 por archivo y KERNEL_ID), con model.js y story-playback.js nuevos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import { authorDocument } from "../src/authoring.js";
import { createKernel } from "../src/kernel.js";
import { KERNEL_FILES, KERNEL_ID } from "../src/generated/kernel-sources.js";
import { revisionOf } from "../src/revision.js";
import { packageRoot } from "./helpers.js";

const FLUYO = resolve(packageRoot(), process.env.FLUYO_PATH ?? join("..", "fluyo"));
const sinFluyo = !existsSync(join(FLUYO, "js", "story-playback.js")) && process.env.REQUIRE_FLUYO !== "1" ? "fluyo/ no está al lado" : false;
const rev = (doc: unknown): string => revisionOf(createKernel(), doc) as string;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("T1 · el kernel del MCP no conoce ninguna interfaz", () => {
  it("sin FluyoI18n, y sin proveedor dice el español de siempre", () => {
    const k = createKernel();
    assert.equal(k.call("typeof FluyoI18n"), "undefined");
    assert.equal(k.call("typeof FLUYO_LOCALES"), "undefined");
    assert.deepEqual(k.call("FluyoStory.errorMessages([{code:'missing_node'},{code:'x'}])"), [
      "Un evento apunta a un elemento que ya no existe.", "No se pudo reproducir. Revisa la historia y consulta los detalles técnicos."]);
    assert.equal(k.call("FluyoStory.summary(1)"), "1 evento no pudo realizarse");
    assert.equal(k.call("FluyoStory.summary(3)"), "3 eventos no pudieron realizarse");
    assert.equal(k.call("FluyoStory.describe('finished',{name:'x',steps:[]},{logEvents:[],cursorVirtual:0},()=>'',()=>null).caption"), "Reproducción terminada");
    assert.equal(k.call("defaultScenarioName(blankPage('p'))"), "Historia 1");
    assert.equal(k.call("(function(){const pg=blankPage('p');createScenario(pg,'Compra');return copyScenarioName(pg,'Compra');})()"), "Compra copia");
    assert.equal(k.call("(function(){const pg=blankPage('p');createScenario(pg,'Compra');createScenario(pg,'Compra copia');return copyScenarioName(pg,'Compra');})()"), "Compra copia 2");
  });

  it("un proveedor SÍ se respeta (lo usan el editor, Present y el Viewer): la salida del MCP es la que no lo pasa", () => {
    const k = createKernel();
    assert.equal(k.call("FluyoStory.summary(2, (key, es, p) => key + ':' + p.count)"), "story.failedCount:2");
    assert.equal(k.call("defaultScenarioName(blankPage('p'), {story: n => 'Story ' + n})"), "Story 1");
  });
});

describe("T2 · el MCP no pasa proveedor ni formateador", () => {
  it("ni stories.ts ni authoring.ts, ni story-authoring.js, los usan", () => {
    const src = readFileSync(join(packageRoot(), "src", "stories.ts"), "utf8") + "\n" + readFileSync(join(packageRoot(), "src", "authoring.ts"), "utf8");
    assert.doesNotMatch(src, /FluyoI18n|FLUYO_LOCALES|seed\.story|textOf|fmt\b/);
    for (const m of src.matchAll(/FluyoStory\.sentence\(([^)]*\([^)]*\)[^)]*)\)/g)) assert.equal(m[1].split(",").length, 3, "sentence(pg, s, et): sin proveedor: " + m[0]);
    const authoring = KERNEL_FILES.find(f => f.name === "story-authoring.js")!.source;
    assert.match(authoring, /defaultScenarioName\(pg\)/);
    assert.match(authoring, /duplicateScenario\(pg, src\.id\)/);
    assert.doesNotMatch(authoring, /FluyoI18n|defaultScenarioName\(pg,|duplicateScenario\(pg, src\.id,/);
  });
});

describe("T3 · de extremo a extremo, el MCP sigue en español", () => {
  const base = () => ({ version: 5, app: "fluyo", settings: {}, doc: { theme: "dark", customBg: "", eventTypes: [], nextEventTypeId: 1, cur: 0,
    pages: [{ name: "Página 1", nodes: [{ id: 1, shape: "rect", x: 100, y: 100, w: 160, h: 60, label: "", color: "#5b8db5", order: 1 }], edges: [], nextId: 2, behaviors: [], scenarios: [], nextScenarioId: 1 }] } });
  const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, ...extra });

  it("create_story sin nombre → «Historia 1», «Historia 2»; duplicate_story → «… copia», «… copia 2»; el recorte a 120", () => {
    const doc = base();
    const r = authorDocument({ document: doc, baseRevision: rev(doc), operations: [S("create_story", {}), S("create_story", {}), S("duplicate_story", { storyId: 1 }), S("duplicate_story", { storyId: 1 })] }) as any;
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.document.doc.pages[0].scenarios.map((s: any) => s.name), ["Historia 1", "Historia 1 copia 2", "Historia 1 copia", "Historia 2"]);
    const long = "x".repeat(120);
    const r2 = authorDocument({ document: doc, baseRevision: rev(doc), operations: [S("create_story", { name: long }), S("duplicate_story", { storyId: 1 })] }) as any;
    assert.equal(r2.ok, true, JSON.stringify(r2.errors));
    assert.equal(r2.document.doc.pages[0].scenarios[1].name, "x".repeat(110) + " copia");
  });
});

describe("T4 · kernel-sources.ts es el kernel de fluyo/", { skip: sinFluyo }, () => {
  it("sha256 de cada archivo y KERNEL_ID", () => {
    const own = KERNEL_FILES.map(f => [f.name, sha(readFileSync(join(FLUYO, "js", f.name), "utf8").replace(/\r\n/g, "\n"))] as const);
    for (const f of KERNEL_FILES) assert.equal(f.sha256, own.find(([n]) => n === f.name)![1], f.name);
    assert.equal(KERNEL_ID, sha(own.map(([n, h]) => `${n}:${h}`).join("\n")));
    const sp = KERNEL_FILES.find(f => f.name === "story-playback.js")!.source;
    assert.match(sp, /function errorMessages\(errors, text\)/);
    assert.match(KERNEL_FILES.find(f => f.name === "model.js")!.source, /function defaultScenarioName\(pg,fmt\)/);
    assert.ok(readdirSync(join(FLUYO, "js")).includes("i18n.js"), "fluyo/ trae la interfaz; el kernel del MCP no");
  });
});

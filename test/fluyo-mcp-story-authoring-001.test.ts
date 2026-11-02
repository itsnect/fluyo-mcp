/**
 * FLUYO-MCP-STORY-AUTHORING-001 · S1, contrato fiable para escribir una Historia (.ai/tasks/FLUYO-MCP-STORY-AUTHORING-001*.md en fluyo).
 *
 *   T1. Catálogo: 15 tools, ninguna operación nueva, `detail` solo en las tres que lo usan, ≤ 57 000 B.
 *   T2. Desenlace (G2): la regla es la del producto; MCP == FluyoStoryClock en todo el corpus, en run_story, describe y author (también dryRun).
 *   T3. Fallo: DOWN antes del envío falla; en el mismo momento no; un message tampoco. Trace idéntico a «Falla aquí».
 *   T4. STORY_OUTCOME_CHANGED (G3): visible, con antes y después, ok:true, y solo cuando de verdad cambia una Historia no editada.
 *   T5. Enlace de una persona (G1): lectura sin revisión; las escrituras siguen versionadas; lo truncado o corrupto se rechaza.
 *   T6. Errores de schema (G4): estructurados, cortos y sin valores de la entrada.
 *   T7. Candidatos en TARGET_NOT_FOUND / TARGET_INCOMPATIBLE.
 *   T8. detail:"summary" (G5): compatible, menor y suficiente para escribir sin más lecturas.
 *   T9. Escenarios A–E y formato intacto.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../src/server.js";
import { createKernel } from "../src/kernel.js";
import { KERNEL_FILES } from "../src/generated/kernel-sources.js";
import { FIXTURES_DIR, loadFixtures, textBlocks } from "./helpers.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FLUYO = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));

type R = { content: Array<{ type: string; text: string }>; isError?: boolean };
let client: Client, close: () => Promise<void>;
before(async () => {
  const server = buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "story-authoring-001", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  close = async () => { await client.close(); await server.close(); };
});
after(async () => { await close(); });

const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<R>;
const data = (r: R) => JSON.parse(textBlocks(r)[1]);
const OTHER_REV = "sha256:" + "0".repeat(64);

const S = (op: string, extra: Record<string, unknown> = {}) => ({ op, scope: "story", pageIndex: 0, ...extra });
const REQ = { op: "create_event_type", scope: "eventType", ref: "req", name: "Request", primitive: "FLOW", sentence: "{source} asks {target}" };
const RES = { op: "create_event_type", scope: "eventType", ref: "res", name: "Response", primitive: "FLOW", sentence: "{source} answers {target}" };
const DOWN = { op: "create_event_type", scope: "eventType", ref: "down", name: "Outage", primitive: "SET_AVAILABILITY", availability: "DOWN", sentence: "{target} stops responding" };
const SUCCESS = [
  REQ, RES, S("create_story", { ref: "s", name: "Successful purchase" }),
  S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "req" }, target: { edgeId: 4 }, message: "The store asks Payment to charge", ref: "m1" }),
  S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "req" }, target: { edgeId: 5 }, message: "Payment asks the bank to authorise", waitsForArrivalOf: [{ ref: "m1" }], ref: "m2" }),
  S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "res" }, target: { edgeId: 5, reverse: true }, message: "The bank authorises", waitsForArrivalOf: [{ ref: "m2" }] }),
];

/** Store → Payment → Bank: documento, revisión y enlace, sin Historias (ids 1, 2, 3; conexiones 4 y 5). */
async function system() {
  const r = await call("create_diagram", { pageName: "Checkout", theme: "dark", nodes: [{ key: "s", label: "Store", shape: "rect" }, { key: "p", label: "Payment", shape: "rect" }, { key: "b", label: "Bank", shape: "rect" }], edges: [{ from: "s", to: "p" }, { from: "p", to: "b" }] });
  const summary = textBlocks(r)[0];
  return { doc: JSON.parse(textBlocks(r)[1]), revision: /revision (sha256:[0-9a-f]{64})/.exec(summary)![1], link: /https:\S*#d=[A-Za-z0-9_-]+/.exec(summary)![0] };
}
async function author(s: { doc?: unknown; link?: string; revision: string }, operations: unknown[], extra: Record<string, unknown> = {}) {
  return data(await call("author_document", { document: s.link ?? s.doc, baseRevision: s.revision, operations, ...extra }));
}
/** El sistema con la Historia de éxito (id 1), como enlace y como documento. */
async function withSuccess() {
  const a = await author(await system(), SUCCESS);
  return { doc: a.document, revision: a.resultRevision as string, link: a.editorUrl as string };
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/* ═══════════════ T1 ═══════════════ */

describe("T1 · catálogo", () => {
  it("sigue habiendo 15 tools, las mismas, y ninguna operación para fallar, narrar o bifurcar", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name), ["create_diagram", "export_diagram", "list_icons", "list_colors", "list_anims", "list_fonts", "list_templates", "create_from_template", "describe_document", "run_story", "author_document", "propose_layout", "set_theme", "reorder_nodes", "duplicate_node"]);
    const ops = ((tools.find(t => t.name === "author_document")!.inputSchema as any).properties.operations.items.oneOf as any[]).map(v => v.properties.op.const as string);
    assert.equal(ops.length, 29);
    for (const prohibida of ["fail_step", "set_story_failure", "create_failure_story", "create_variant", "branch_story", "set_outcome", "create_story_from_prompt", "add_steps"])
      assert.ok(!ops.includes(prohibida), prohibida);
  });

  it("`detail` solo en describe_document, run_story y author_document, opcional y full por defecto", async () => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      const p = (t.inputSchema as any).properties?.detail;
      if (["describe_document", "run_story", "author_document"].includes(t.name)) {
        assert.deepEqual([p.enum, p.default], [["full", "summary"], "full"], t.name);
        assert.ok(!((t.inputSchema as any).required ?? []).includes("detail"), t.name);
      } else {
        assert.equal(p, undefined, t.name);
      }
    }
  });

  it("≤ 57 000 B: no se llena el margen con prosa (guarda 63 000)", async () => {
    const bytes = Buffer.byteLength(JSON.stringify(await client.listTools()));
    assert.ok(bytes <= 57_000, `tools/list = ${bytes} B`);
  });

  it("las descriptions dicen la receta del fallo, el alcance de la disponibilidad inicial y la regla del idioma", async () => {
    const { tools } = await client.listTools();
    const d = tools.find(t => t.name === "author_document")!.description!;
    assert.match(d, /FALLO REAL: evento SET_AVAILABILITY DOWN sobre el destino, ANTES del envío/);
    assert.match(d, /En el MISMO momento no falla y un message nunca causa un fallo/);
    assert.match(d, /set_initial_availability afecta a TODAS las Historias de la página/);
    assert.match(d, /LANGUAGE: names and messages in the language of the user's request, not of this catalog/);
    assert.match(d, /No traduzcas los elementos que ya tiene el documento/);
    /* También donde se escribe el texto: un modelo pequeño no siempre vuelve a la description. */
    const ops = (tools.find(t => t.name === "author_document")!.inputSchema as any).properties.operations.items.oneOf as any[];
    const field = (op: string, f: string) => ops.find(v => v.properties.op.const === op).properties[f].description as string;
    for (const [op, f] of [["create_story", "name"], ["add_step", "message"], ["create_event_type", "name"], ["create_event_type", "sentence"]])
      assert.match(field(op, f), /In the language of the user's request/, `${op}.${f}`);
    assert.match(tools.find(t => t.name === "describe_document")!.description!, /ENLACE DE UNA PERSONA: pásalo sin baseRevision/);
  });
});

/* ═══════════════ T2 ═══════════════ */

describe("T2 · desenlace (G2): la regla del producto, una sola", () => {
  const corpus = (): Array<{ name: string; doc: any }> => {
    const docs = loadFixtures().map(f => ({ name: f.name, doc: f.doc as any }));
    docs.push({ name: "rag", doc: JSON.parse(readFileSync(join(FIXTURES_DIR, "fluyo-step-message-001-rag.json"), "utf8")) });
    const examples = join(FLUYO, "ejemplos", "data", "compra-online.fluyo.json");
    if (existsSync(examples)) docs.push({ name: "compra-online", doc: JSON.parse(readFileSync(examples, "utf8")) });
    return docs;
  };
  /** Lo que dice la UI: FluyoStoryClock.outcomeOf + outcomeText, las funciones reales de editor, Present y Viewer. */
  const uiView = (doc: unknown) => createKernel().call<Array<any>>(`(function(){ const d = projectFromProjectData(__a).doc; doc = d;
    return d.pages.flatMap((pg, pageIndex) => pg.scenarios.map(sc => { const o = FluyoStoryClock.outcomeOf(pg, sc); return {pageIndex, storyId: sc.id, o, text: FluyoStoryClock.outcomeText(o)}; })); })()`, doc);
  const asText = (o: any) => (o.status === "no_failures" ? "Sin fallos" : o.status === "failed" ? `Falla en el paso ${o.moment}` : "");

  it("story-clock.js se ejecuta verbatim: es el archivo del producto, sin copia ni porte", () => {
    const f = KERNEL_FILES.find(x => x.name === "story-clock.js")!;
    assert.ok(f, "story-clock.js está en el kernel");
    const src = join(FLUYO, "js", "story-clock.js");
    if (existsSync(src)) assert.equal(f.source, readFileSync(src, "utf8").replace(/\r\n/g, "\n"));
    for (const own of ["stories.ts", "authoring.ts"]) {
      const code = readFileSync(join(ROOT, "src", own), "utf8");
      assert.doesNotMatch(code, /send_failed/, `${own} no decide qué es un fallo`);
      assert.doesNotMatch(code, /Sin fallos|Falla en el paso|No failures/, `${own} no trae el texto de la UI`);
    }
  });

  it("MCP == UI en todo el corpus: run_story, describe (full y summary) y sin texto como fuente de verdad", async () => {
    let failed = 0, ok = 0;
    for (const { name, doc } of corpus()) {
      const ui = uiView(doc);
      const full = data(await call("describe_document", { document: doc }));
      const summary = data(await call("describe_document", { document: doc, detail: "summary" }));
      for (const u of ui) {
        const run = data(await call("run_story", { document: doc, pageIndex: u.pageIndex, storyId: u.storyId }));
        const inFull = full.pages[u.pageIndex].stories.find((s: any) => s.storyId === u.storyId);
        const inSummary = summary.pages[u.pageIndex].stories.find((s: any) => s.storyId === u.storyId);
        assert.deepEqual(inFull.outcome, run.storyOutcome, `${name} ${u.storyId}`);
        assert.deepEqual(inSummary.outcome, run.storyOutcome, `${name} ${u.storyId}`);
        if (!u.o) { assert.equal(run.storyOutcome.status, "empty", `${name} ${u.storyId}`); continue; }
        assert.equal(asText(run.storyOutcome), u.text, `${name} ${u.storyId}`);
        if (u.o.ok) ok++;
        else {
          failed++;
          assert.deepEqual([run.storyOutcome.moment, run.storyOutcome.stepId], [u.o.moment, u.o.stepId], `${name} ${u.storyId}`);
          assert.equal(run.steps.find((s: any) => s.stepId === u.o.stepId).outcome.reason, run.storyOutcome.reason);
          assert.equal(run.steps.find((s: any) => s.stepId === u.o.stepId).moment, u.o.moment - 1, "steps[].moment empieza en 0, outcome.moment en 1");
        }
      }
    }
    assert.ok(ok >= 3, `corpus con éxitos: ${ok}`);
    if (existsSync(join(FLUYO, "ejemplos", "data"))) assert.ok(failed >= 1, `corpus con fallos: ${failed}`);
  });

  it("Historia vacía y no ejecutable tienen su propio estado, nunca «sin fallos»", async () => {
    const s = await system();
    const a = await author(s, [S("create_story", { ref: "e", name: "Empty" })]);
    assert.deepEqual(a.stories, [{ pageIndex: 0, storyId: 1, name: "Empty", stepCount: 0, momentCount: 0, outcome: { status: "empty" } }]);
    assert.deepEqual(data(await call("run_story", { document: a.document, storyId: 1 })).storyOutcome, { status: "empty" });
    const broken = clone((await withSuccess()).doc);
    broken.doc.pages[0].scenarios[0].steps[0].edgeId = 999;
    const d = data(await call("describe_document", { document: broken }));
    assert.deepEqual(d.pages[0].stories[0].outcome, { status: "not_executable" });
    const r = data(await call("run_story", { document: broken, storyId: 1 }));
    assert.deepEqual([r.executed, r.storyOutcome], [false, { status: "not_executable" }]);
    /* El motor sí la ejecuta (la conexión existe), pero la integridad la rechaza por el evento: tampoco tiene desenlace. */
    const noEvent = clone((await withSuccess()).doc);
    noEvent.doc.pages[0].scenarios[0].steps[0].eventTypeId = 999;
    assert.deepEqual(data(await call("describe_document", { document: noEvent })).pages[0].stories[0].outcome, { status: "not_executable" });
    assert.deepEqual(data(await call("describe_document", { document: noEvent, detail: "summary" })).pages[0].stories[0].outcome, { status: "not_executable" });
  });

  it("author_document da el desenlace de lo que tocó, también con dryRun, y con source_down y reverse el motivo es el del recorrido", async () => {
    const s = await system();
    const ops = [...SUCCESS, DOWN, S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "down" }, target: { nodeId: 3 }, placement: undefined }),
      S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "res" }, target: { edgeId: 5, reverse: true } })];
    const clean = JSON.parse(JSON.stringify(ops));
    for (const a of [await author(s, clean), await author(s, clean, { dryRun: true })]) {
      assert.deepEqual(a.stories, [{ pageIndex: 0, storyId: 1, name: "Successful purchase", stepCount: 5, momentCount: 5,
        outcome: { status: "failed", moment: 5, stepId: 5, reason: "source_down", reasonNode: { id: 3, label: "Bank" } } }]);
    }
  });
});

/* ═══════════════ T3 ═══════════════ */

describe("T3 · el fallo es el del motor", () => {
  const AFTER = [DOWN, S("create_story", { ref: "f", name: "The bank stops responding" })];
  const send = (edgeId: number, extra = {}) => S("add_step", { storyId: { ref: "f" }, eventTypeId: 1, target: { edgeId }, ...extra });
  const fall = (extra = {}) => S("add_step", { storyId: { ref: "f" }, eventTypeId: { ref: "down" }, target: { nodeId: 3 }, ...extra });

  it("DOWN en un momento ANTERIOR al envío: failed, target_down, en el paso correcto", async () => {
    const s = await withSuccess();
    const a = await author(s, [...AFTER, send(4), fall(), send(5)]);
    assert.deepEqual(a.stories[0].outcome, { status: "failed", moment: 3, stepId: 3, reason: "target_down", reasonNode: { id: 3, label: "Bank" } });
    const run = data(await call("run_story", { document: a.editorUrl, baseRevision: a.resultRevision, storyId: 2 }));
    assert.deepEqual(run.storyOutcome, a.stories[0].outcome);
    assert.equal(run.trace.filter((e: any) => e.type === "send_failed").length, 1);
  });

  it("DOWN en el MISMO momento, detrás del envío: no falla, y el desenlace lo dice", async () => {
    const s = await withSuccess();
    const a = await author(s, [...AFTER, send(5, { ref: "x" }), fall({ placement: { sameMomentAs: { ref: "x" } } })]);
    assert.deepEqual(a.stories[0].outcome, { status: "no_failures" });
  });

  it("un message que habla de un fallo no produce un fallo", async () => {
    const s = await withSuccess();
    const a = await author(s, [S("create_story", { ref: "f", name: "Text only" }), send(5, { message: "The bank does not respond: timeout!" })]);
    assert.deepEqual(a.stories[0].outcome, { status: "no_failures" });
  });

  it("Trace idéntico a «Falla aquí» (la receta real de editor-scenarios.js, con las funciones del kernel)", async () => {
    const editor = join(FLUYO, "js", "editor-scenarios.js");
    if (existsSync(editor)) {
      /* Si la receta del editor cambia, esta comparación deja de valer: que falle aquí, no en silencio. */
      const code = readFileSync(editor, "utf8").replace(/\r\n/g, "\n");
      assert.match(code, /down = createStep\(sc, \{ action: "SET_STATE", nodeId: target, state: "DOWN", at: scStepDefaultTime\(sc\) \}\)/);
      assert.match(code, /moved = storyboardMoveStep\(sc\.steps, down\.id, \{ kind: "gap", index: gap \}\)/);
    }
    const s = await withSuccess();
    const ui = createKernel().call<any>(`(function(){
      const n = projectFromProjectData(__a); const d = n.doc; doc = d;
      const pg = d.pages[0], sc = pg.scenarios[0], step = sc.steps.find(x => x.id === 2);
      const target = traversalEnds(pg.edges.find(e => e.id === step.edgeId), step.reverse === true).target;
      const gap = storyboardGroups(sc.steps).findIndex(g => g.steps.some(x => x.id === step.id));
      const down = createStep(sc, {action: "SET_STATE", nodeId: target, state: "DOWN", at: defaultStepTime(sc, DEFAULT_STEP_DELAY_MS)});
      const moved = storyboardMoveStep(sc.steps, down.id, {kind: "gap", index: gap});
      if(moved && moved.changed) sc.steps = moved.steps;
      return projectToSerializable(d, n.settings);
    })()`, s.doc);
    const viaMcp = await author(s, [DOWN, S("add_step", { storyId: 1, eventTypeId: { ref: "down" }, target: { nodeId: 3 }, ref: "dn" }), S("move_step", { storyId: 1, stepId: { ref: "dn" }, to: { gapIndex: 1 } })]);
    const a = data(await call("run_story", { document: ui, storyId: 1 }));
    const b = data(await call("run_story", { document: viaMcp.document, storyId: 1 }));
    assert.equal(a.traceDigest, b.traceDigest);
    assert.deepEqual(a.storyOutcome, b.storyOutcome);
    assert.equal(a.storyOutcome.status, "failed");
    /* El MCP lee y edita el paso de la UI, sin evento. */
    const d = data(await call("describe_document", { document: ui }));
    const edit = await author({ doc: ui, revision: d.revision }, [S("set_step_message", { storyId: 1, stepId: b.steps.find((x: any) => x.action === "SET_STATE").stepId, message: "The bank goes silent" })]);
    assert.equal(edit.ok, true);
  });
});

/* ═══════════════ T4 ═══════════════ */

describe("T4 · STORY_OUTCOME_CHANGED (G3)", () => {
  const INITIAL = { op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: 3, state: "DOWN" };
  const changed = (a: any) => (a.warnings ?? []).filter((w: any) => w.code === "STORY_OUTCOME_CHANGED");

  it("set_initial_availability en otra Historia: ok:true, aviso con antes y después; touchedStories vacío; también con dryRun", async () => {
    const s = await withSuccess();
    for (const extra of [{}, { dryRun: true }]) {
      const r = await call("author_document", { document: s.link, baseRevision: s.revision, operations: [INITIAL], ...extra });
      const a = data(r);
      assert.equal(r.isError, undefined);
      assert.deepEqual([a.ok, a.touchedStories, a.stories], [true, [], []]);
      assert.deepEqual(changed(a), [{
        code: "STORY_OUTCOME_CHANGED", pageIndex: 0, storyId: 1, name: "Successful purchase", directlyEdited: false,
        before: { status: "no_failures" },
        after: { status: "failed", moment: 2, stepId: 2, reason: "target_down", reasonNode: { id: 3, label: "Bank" } },
        message: "El lote no editó la Historia 1, pero su desenlace cambió.",
      }]);
      assert.match(textBlocks(r)[0], /Aviso: 1 Historia\(s\) que el lote no editó cambiaron de desenlace/);
    }
  });

  it("deshacerlo también avisa: el desenlace vuelve a cambiar", async () => {
    const s = await withSuccess();
    const down = await author(s, [INITIAL]);
    const up = await author({ link: down.editorUrl, revision: down.resultRevision }, [{ ...INITIAL, state: "UP" }]);
    assert.deepEqual([changed(up)[0].before.status, changed(up)[0].after.status], ["failed", "no_failures"]);
  });

  it("sin cambio de desenlace, sin aviso: crear otra Historia, renombrar el nodo caído, tema o eventos nuevos", async () => {
    const s = await withSuccess();
    const b = await author(s, [DOWN, S("create_story", { ref: "f", name: "Other" }), S("add_step", { storyId: { ref: "f" }, eventTypeId: { ref: "down" }, target: { nodeId: 3 } })]);
    assert.equal(b.warnings, undefined);
    const failing = await author(s, [INITIAL]);
    const renamed = await author({ link: failing.editorUrl, revision: failing.resultRevision }, [{ op: "update_node", scope: "page", pageIndex: 0, node: { id: 3 }, spec: { label: "Banco" } }, { op: "set_theme", scope: "document", theme: "claro" }]);
    assert.equal(renamed.warnings, undefined, "que cambie la etiqueta no cambia el desenlace");
  });

  it("la Historia editada en el mismo lote no es «otra»: va en stories, no en el aviso", async () => {
    const s = await withSuccess();
    const a = await author(s, [INITIAL, S("set_step_message", { storyId: 1, stepId: 1, message: "Edited" })]);
    assert.deepEqual(changed(a), []);
    assert.equal(a.stories[0].outcome.status, "failed");
  });

  it("con delete_page, el aviso usa el índice final de la página", async () => {
    const s = await withSuccess();
    const two = clone(s.doc);
    two.doc.pages.unshift({ ...clone(two.doc.pages[0]), name: "Before", scenarios: [], nextScenarioId: 1 });
    const d = data(await call("describe_document", { document: two, includeSteps: false }));
    const a = await author({ doc: two, revision: d.revision }, [{ op: "delete_page", scope: "document", pageIndex: 0, expectedName: "Before" }, { ...INITIAL, pageIndex: 1 }]);
    assert.deepEqual(a.pageMap, [{ from: 0, to: null }, { from: 1, to: 0 }]);
    assert.deepEqual(changed(a).map((w: any) => [w.pageIndex, w.storyId]), [[0, 1]]);
  });

  it("convive con ARRIVAL_DEPENDENCY_INACTIVE y cada frase cuenta lo suyo", async () => {
    const s = await withSuccess();
    const r = await call("author_document", { document: s.link, baseRevision: s.revision, operations: [INITIAL, S("set_wait", { storyId: 1, stepId: 2, waitMs: 0 })] });
    const a = data(r);
    assert.deepEqual(a.warnings.map((w: any) => w.code), ["ARRIVAL_DEPENDENCY_INACTIVE"]);
    assert.match(textBlocks(r)[0], /Aviso: 1 dependencia\(s\) de llegada sin efecto/);
    assert.doesNotMatch(textBlocks(r)[0], /cambiaron de desenlace/);
  });

  it("detail:summary conserva el aviso: es lo último que puede perderse", async () => {
    const s = await withSuccess();
    assert.equal(changed(await author(s, [INITIAL], { detail: "summary" })).length, 1);
  });
});

/* ═══════════════ T5 ═══════════════ */

describe("T5 · enlace de una persona (G1): lectura sí, escritura versionada", () => {
  it("describe_document lo lee sin revisión y da la canónica; author_document con esa revisión funciona", async () => {
    const s = await withSuccess();
    const d = data(await call("describe_document", { document: s.link }));
    assert.deepEqual([d.revision, d.linkRevisionUnverified, d.pages[0].stories[0].name], [s.revision, true, "Successful purchase"]);
    const a = await author({ link: s.link, revision: d.revision }, [S("rename_story", { storyId: 1, name: "Reviewed" })]);
    assert.equal(a.ok, true);
    assert.equal(data(await call("describe_document", { document: a.editorUrl, baseRevision: a.resultRevision })).linkRevisionUnverified, undefined, "con revisión está verificado");
  });

  it("también en summary, y sin enlace nada cambia", async () => {
    const s = await withSuccess();
    const d = data(await call("describe_document", { document: s.link, detail: "summary" }));
    assert.deepEqual([d.revision, d.linkRevisionUnverified], [s.revision, true]);
    assert.equal(data(await call("describe_document", { document: s.doc })).linkRevisionUnverified, undefined);
  });

  it("INVARIANTE: ninguna otra tool lo acepta sin revisión; ninguna escritura sale de un enlace sin ella", async () => {
    const s = await withSuccess();
    const r = await call("run_story", { document: s.link, storyId: 1 });
    assert.match(textBlocks(r)[0], /^Error: LINK_REVISION_REQUIRED: /);
    assert.match(textBlocks(await call("export_diagram", { document: s.link }))[0], /^Error: LINK_REVISION_REQUIRED: /);
    assert.equal(data(await call("propose_layout", { document: s.link })).errors[0].code, "LINK_REVISION_REQUIRED");
    for (const [tool, args] of [["author_document", { operations: [S("rename_story", { storyId: 1, name: "x" })] }], ["set_theme", { theme: "claro" }]] as const) {
      const w = await call(tool, { document: s.link, ...args });
      assert.equal(w.isError, true, tool);
      assert.equal(data(w).errors[0].path, "baseRevision", `${tool}: la revisión la exige el schema`);
      assert.doesNotMatch(JSON.stringify(w), /"resultRevision"|editorUrl/);
    }
  });

  it("revisión posterior incorrecta al mutar: LINK_REVISION_MISMATCH, sin documento y sin revisar por su cuenta", async () => {
    const s = await withSuccess();
    const a = await author({ link: s.link, revision: OTHER_REV }, [S("rename_story", { storyId: 1, name: "x" })]);
    assert.deepEqual([a.ok, a.errors[0].code, a.document, a.actualRevision], [false, "LINK_REVISION_MISMATCH", undefined, undefined]);
    assert.match(a.errors[0].message, /describe_document sin baseRevision te da su revision/);
    /* El documento cambió entre la lectura y la escritura: la revisión de antes ya no sirve. */
    const moved = await author(s, [S("rename_story", { storyId: 1, name: "Moved" })]);
    const late = await author({ link: moved.editorUrl, revision: s.revision }, [S("rename_story", { storyId: 1, name: "Late" })]);
    assert.deepEqual([late.ok, late.errors[0].code], [false, "LINK_REVISION_MISMATCH"]);
    const lateObject = await author({ doc: moved.document ?? (await author(s, [S("rename_story", { storyId: 1, name: "Moved" })])).document, revision: s.revision }, [S("rename_story", { storyId: 1, name: "Late" })]);
    assert.deepEqual([lateObject.ok, lateObject.errors[0].code, lateObject.errors[0].actual], [false, "REVISION_MISMATCH", moved.resultRevision]);
  });

  const payload = (link: string) => link.slice(link.indexOf("#d=") + 3);
  it("truncado, corrupto o mal codificado: se rechaza con motivo; nunca se reconstruye", async () => {
    const s = await withSuccess();
    const p = payload(s.link), base = s.link.slice(0, s.link.indexOf("#d=") + 3);
    const cases: Array<[string, string, RegExp]> = [
      ["truncado", base + p.slice(0, Math.floor(p.length * 0.9)), /DOCUMENT_LINK_UNREADABLE \((decode|base64)\)/],
      ["sin carga", base, /DOCUMENT_LINK_UNREADABLE \(format\)/],
      ["con espacios", `${base}${p.slice(0, 20)} ${p.slice(20)}`, /DOCUMENT_LINK_UNREADABLE \(format\)/],
      ["otra versión", base + Buffer.from([7, 1, 2, 3]).toString("base64url"), /DOCUMENT_LINK_UNREADABLE \(version\)/],
      ["no es JSON", base + Buffer.concat([Buffer.from([0]), Buffer.from("not json")]).toString("base64url"), /DOCUMENT_LINK_UNREADABLE \(json\)/],
      ["no es un documento", base + Buffer.concat([Buffer.from([0]), Buffer.from('{"hello":"world"}')]).toString("base64url"), /DOCUMENT_LINK_UNREADABLE \(not_a_document\)/],
      ["sin #d=", "https://fluyo.space/", /DOCUMENT_LINK_UNREADABLE \(format\)/],
    ];
    for (const [name, document, re] of cases) {
      const r = await call("describe_document", { document });
      assert.equal(r.isError, true, name);
      assert.match(textBlocks(r)[0], re, name);
      assert.equal(textBlocks(r).length, 1, `${name}: sin documento`);
    }
  });

  it("corrupción de un carácter: se rechaza o, si decodifica a un documento válido, va marcada y su revisión dice qué documento es", async () => {
    const s = await withSuccess();
    const p = payload(s.link), base = s.link.slice(0, s.link.indexOf("#d=") + 3);
    let rejected = 0, different = 0;
    for (let i = 8; i < p.length - 1; i += 37) {
      const c = p[i] === "A" ? "B" : "A";
      const r = await call("describe_document", { document: base + p.slice(0, i) + c + p.slice(i + 1) });
      if (r.isError) { rejected++; continue; }
      const d = data(r);
      assert.equal(d.linkRevisionUnverified, true);
      /* La revisión es la del documento normalizado: si coincide con la original, es el mismo documento; si no, escribir sobre el enlace bueno se rechaza. */
      if (d.revision !== s.revision) {
        different++;
        const a = await author({ link: s.link, revision: d.revision }, [S("rename_story", { storyId: 1, name: "x" })]);
        assert.equal(a.errors?.[0]?.code, "LINK_REVISION_MISMATCH", `carácter ${i}`);
      }
    }
    assert.ok(rejected > different, `rechazados ${rejected}, otro documento ${different}`);
  });

  it("enlace de Compartir (/s/): se lee y avisa de que es una instantánea", async () => {
    const s = await withSuccess();
    const d = data(await call("describe_document", { document: s.link.replace("fluyo.space/#", "fluyo.space/s/#") }));
    assert.deepEqual([d.linkKind, d.linkRevisionUnverified], ["viewer", true]);
    assert.match(d.linkNote, /instantánea/);
    assert.equal(data(await call("describe_document", { document: s.link })).linkKind, undefined);
  });
});

/* ═══════════════ T6 ═══════════════ */

describe("T6 · errores de schema (G4)", () => {
  const CASES: Array<[string, (b: any) => any, any]> = [
    ["tipo en una unión: id como texto", b => ({ ...b, operations: [S("add_step", { storyId: 1, eventTypeId: 1, target: { nodeId: "SECRET-VALUE" } })] }),
      { path: "operations[0].target.nodeId", operationIndex: 0, operation: "add_step", issue: "invalid_type", expected: "number | object", received: "string" }],
    ["campo que no existe", b => ({ ...b, operations: [S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 4 }, outcome: "failed" })] }),
      { path: "operations[0]", operationIndex: 0, operation: "add_step", issue: "unrecognized_keys", keys: ["outcome"] }],
    ["mensaje demasiado largo", b => ({ ...b, operations: [S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 4 }, message: "x".repeat(121) })] }),
      { path: "operations[0].message", operationIndex: 0, operation: "add_step", issue: "too_big", expected: "<= 120" }],
    ["operación inventada", b => ({ ...b, operations: [{ op: "fail_step", scope: "story" }] }),
      { path: "operations[0].op", operationIndex: 0, operation: "fail_step", issue: "invalid_discriminator" }],
    ["falta un campo", b => ({ ...b, operations: undefined }),
      { path: "operations", issue: "invalid_type", expected: "array", received: "undefined" }],
  ];
  for (const [name, args, expected] of CASES) {
    it(name, async () => {
      const s = await withSuccess();
      const r = await call("author_document", args({ document: s.link, baseRevision: s.revision }));
      assert.equal(r.isError, true);
      assert.match(textBlocks(r)[0], /^MCP error -32602: Input validation error \(SCHEMA_INVALID\) en author_document: /);
      const j = data(r);
      assert.deepEqual([j.ok, j.valid], [false, false]);
      const e = j.errors[0];
      assert.equal(e.code, "SCHEMA_INVALID");
      for (const [k, v] of Object.entries(expected)) assert.deepEqual(e[k], v, k);
      assert.equal(typeof e.message, "string");
      assert.ok(JSON.stringify(r).length < (name.startsWith("operación") ? 1400 : 800), `${JSON.stringify(r).length} B`);
      assert.doesNotMatch(JSON.stringify(r), /SECRET-VALUE/, "no repite valores de la entrada");
    });
  }

  it("la operación inventada lista las válidas, y solo esas", async () => {
    const s = await withSuccess();
    const e = data(await call("author_document", { document: s.link, baseRevision: s.revision, operations: [{ op: "x", scope: "story" }] })).errors[0];
    assert.match(e.expected, /create_story \| rename_story/);
    assert.equal(e.operation, "x");
  });

  it("también en las demás tools; un error del dominio no cambia", async () => {
    const r = await call("run_story", { document: {}, storyId: "uno" });
    assert.deepEqual([data(r).errors[0].code, data(r).errors[0].path], ["SCHEMA_INVALID", "storyId"]);
    const s = await withSuccess();
    const e = await author(s, [S("rename_story", { storyId: 99, name: "x" })]);
    assert.equal(e.errors[0].code, "STORY_NOT_FOUND");
  });

  it("varias a la vez: como mucho 5 y dice cuántas más", async () => {
    const s = await withSuccess();
    const operations = Array.from({ length: 8 }, () => S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 4 }, message: "x".repeat(121) }));
    const j = data(await call("author_document", { document: s.link, baseRevision: s.revision, operations }));
    assert.deepEqual([j.errors.length, j.moreErrors, j.errors[4].operationIndex], [5, 3, 4]);
  });
});

/* ═══════════════ T7 ═══════════════ */

describe("T7 · candidatos", () => {
  const NOTE = { op: "create_event_type", scope: "eventType", ref: "n", name: "Note", primitive: "OCCURRENCE", sentence: "{target}" };
  it("TARGET_NOT_FOUND: los objetivos válidos de esa clase en la página", async () => {
    const s = await withSuccess();
    const node = (await author(s, [NOTE, S("add_step", { storyId: 1, eventTypeId: { ref: "n" }, target: { nodeId: 999 } })])).errors[0];
    assert.deepEqual([node.code, node.candidates], ["TARGET_NOT_FOUND", { nodes: [{ id: 1, label: "Store" }, { id: 2, label: "Payment" }, { id: 3, label: "Bank" }] }]);
    const edge = (await author(s, [S("add_step", { storyId: 1, eventTypeId: 1, target: { edgeId: 999 } })])).errors[0];
    assert.deepEqual([edge.code, edge.candidates], ["TARGET_NOT_FOUND", { connections: [{ id: 4, from: 1, to: 2 }, { id: 5, from: 2, to: 3 }] }]);
    const pair = (await author(s, [S("add_step", { storyId: 1, eventTypeId: 1, target: { from: 1, to: 3 } })])).errors[0];
    assert.deepEqual([pair.code, pair.candidates.connections.length], ["TARGET_NOT_FOUND", 2]);
  });

  it("TARGET_INCOMPATIBLE se comprueba antes que la existencia y da lo que el evento necesita", async () => {
    const s = await withSuccess();
    const wrong = (await author(s, [S("add_step", { storyId: 1, eventTypeId: 1, target: { nodeId: 999 } })])).errors[0];
    assert.equal(wrong.code, "TARGET_INCOMPATIBLE");
    assert.deepEqual(wrong.candidates, { connections: [{ id: 4, from: 1, to: 2 }, { id: 5, from: 2, to: 3 }] });
    const other = (await author(s, [NOTE, S("add_step", { storyId: 1, eventTypeId: { ref: "n" }, target: { edgeId: 4 } })])).errors[0];
    assert.deepEqual(other.candidates.nodes.map((n: any) => n.id), [1, 2, 3]);
  });

  it("con muchos, se acota y lo dice", async () => {
    const big = await call("create_diagram", { nodes: Array.from({ length: 35 }, (_, i) => ({ key: "n" + i, label: "N" + i, shape: "rect" })) });
    const summary = textBlocks(big)[0];
    const s = { doc: JSON.parse(textBlocks(big)[1]), revision: /revision (sha256:[0-9a-f]{64})/.exec(summary)![1] };
    const e = (await author(s, [NOTE, S("create_story", { ref: "s" }), S("add_step", { storyId: { ref: "s" }, eventTypeId: { ref: "n" }, target: { nodeId: 999 } })])).errors[0];
    assert.deepEqual([e.candidates.nodes.length, e.candidatesTruncated], [30, true]);
  });
});

/* ═══════════════ T8 ═══════════════ */

describe("T8 · detail:summary (G5)", () => {
  it("full es el defecto y el modo detallado no pierde nada", async () => {
    const s = await withSuccess();
    const d = await call("describe_document", { document: s.doc });
    assert.equal(JSON.stringify(await call("describe_document", { document: s.doc, detail: "full" })), JSON.stringify(d));
    const j = data(d);
    for (const k of ["capabilities", "unmodeled", "pages", "eventTypes", "revision", "kernelId"]) assert.ok(k in j, k);
    for (const k of ["x", "y", "w", "h", "z", "shape"]) assert.ok(k in j.pages[0].nodes[0], k);
    assert.ok(j.pages[0].stories[0].moments.length);
    const r = await call("run_story", { document: s.doc, storyId: 1 });
    assert.equal(JSON.stringify(await call("run_story", { document: s.doc, storyId: 1, detail: "full" })), JSON.stringify(r));
    for (const k of ["trace", "unmodeled", "steps", "traceDigest", "finalAvailability"]) assert.ok(k in data(r), k);
    const a = await author(s, [S("rename_story", { storyId: 1, name: "x" })]);
    for (const k of ["changes", "refs", "touchedStories", "unmodeled", "document", "editorUrl"]) assert.ok(k in a, k);
  });

  it("describe: lo necesario para escribir, sin coordenadas, pasos ni capabilities, y con `unmodeled`", async () => {
    const s = await withSuccess();
    const j = data(await call("describe_document", { document: s.doc, detail: "summary" }));
    assert.deepEqual(Object.keys(j), ["readable", "revision", "valid", "errorCount", "errors", "currentPageIndex", "eventTypes", "pages", "unmodeled"]);
    assert.deepEqual(j.pages[0].nodes, [{ id: 1, label: "Store" }, { id: 2, label: "Payment" }, { id: 3, label: "Bank" }]);
    assert.deepEqual(j.pages[0].connections, [{ id: 4, from: 1, to: 2 }, { id: 5, from: 2, to: 3 }]);
    assert.deepEqual(j.eventTypes, [{ id: 1, name: "Request", primitive: "FLOW" }, { id: 2, name: "Response", primitive: "FLOW" }]);
    assert.deepEqual(j.pages[0].stories, [{ storyId: 1, name: "Successful purchase", stepCount: 3, outcome: { status: "no_failures" } }]);
  });

  it("describe: el estado inicial y la disponibilidad de un evento siguen ahí; una etiqueta de varias líneas sale en una", async () => {
    const s = await withSuccess();
    const a = await author(s, [DOWN, { op: "set_initial_availability", scope: "page", pageIndex: 0, nodeId: 3, state: "DOWN" }, { op: "update_node", scope: "page", pageIndex: 0, node: { id: 1 }, spec: { label: "Store\nfront" } }]);
    const j = data(await call("describe_document", { document: a.document, detail: "summary" }));
    assert.deepEqual(j.pages[0].nodes[2], { id: 3, label: "Bank", availability: "DOWN" });
    assert.equal(j.pages[0].nodes[0].label, "Store / front");
    assert.deepEqual(j.eventTypes[2], { id: 3, name: "Outage", primitive: "SET_AVAILABILITY", availability: "DOWN" });
  });

  it("documento ilegible: la misma respuesta en los dos modos", async () => {
    const bad = { version: 99, app: "fluyo", doc: { pages: [] }, settings: {} };
    assert.equal(JSON.stringify(await call("describe_document", { document: bad, detail: "summary" })), JSON.stringify(await call("describe_document", { document: bad })));
  });

  it("run_story: sin trace ni unmodeled; el resto idéntico", async () => {
    const s = await withSuccess();
    const { trace, unmodeled, ...rest } = data(await call("run_story", { document: s.doc, storyId: 1 }));
    assert.ok(trace.length && unmodeled.length);
    assert.deepEqual(data(await call("run_story", { document: s.doc, storyId: 1, detail: "summary" })), rest);
  });

  it("author_document: sin changes ni unmodeled; refs, storyRefs, stories y enlace siguen; un rechazo no cambia", async () => {
    const s = await system();
    const { changes, unmodeled, document, ...rest } = await author(s, SUCCESS);
    assert.ok(changes.length && unmodeled.length && document);
    assert.deepEqual(await author(s, SUCCESS, { detail: "summary" }).then(({ document: _d, ...x }: any) => x), rest);
    const bad = [S("rename_story", { storyId: 99, name: "x" })];
    assert.deepEqual(await author(s, bad, { detail: "summary" }), await author(s, bad));
  });

  it("storyRefs: los ids de Historias, pasos y eventos creados con ref; refs no cambia y lo borrado en el lote no sale", async () => {
    const s = await system();
    const a = await author(s, [...SUCCESS, S("create_story", { ref: "gone", name: "Gone" }), S("delete_story", { storyId: { ref: "gone" } })], { detail: "summary" });
    assert.deepEqual(a.refs, []);
    assert.deepEqual(a.storyRefs, [
      { ref: "req", type: "eventType", id: 1 }, { ref: "res", type: "eventType", id: 2 }, { ref: "s", type: "story", pageIndex: 0, id: 1 },
      { ref: "m1", type: "step", pageIndex: 0, storyId: 1, id: 1 }, { ref: "m2", type: "step", pageIndex: 0, storyId: 1, id: 2 },
    ]);
    const plain = await author(await withSuccess(), [S("rename_story", { storyId: 1, name: "x" })]);
    assert.equal("storyRefs" in plain, false, "solo si hay");
  });

  it("menos bytes con la misma capacidad: el agente escribe sin más lecturas, y el coste baja de forma material", async () => {
    const s = await withSuccess();
    const size = (r: R) => Buffer.byteLength(textBlocks(r).join(""));
    const full = size(await call("describe_document", { document: s.link, baseRevision: s.revision }));
    const small = size(await call("describe_document", { document: s.link, baseRevision: s.revision, detail: "summary" }));
    assert.ok(small < full * 0.6, `describe ${small} / ${full}`);
    const a = await call("author_document", { document: s.link, baseRevision: s.revision, operations: SUCCESS.slice(2), returnDocument: false });
    const b = await call("author_document", { document: s.link, baseRevision: s.revision, operations: SUCCESS.slice(2).map(o => JSON.parse(JSON.stringify(o).replaceAll('{"ref":"req"}', "1").replaceAll('{"ref":"res"}', "2"))), returnDocument: false, detail: "summary" });
    assert.ok(a.isError);   // las refs de eventos no se crearon: rechazo
    assert.equal(b.isError, undefined);
    const c = await call("author_document", { document: s.link, baseRevision: s.revision, operations: SUCCESS.slice(2).map(o => JSON.parse(JSON.stringify(o).replaceAll('{"ref":"req"}', "1").replaceAll('{"ref":"res"}', "2"))), returnDocument: false });
    assert.ok(size(b) < size(c) * 0.8, `author ${size(b)} / ${size(c)}`);
  });
});

/* ═══════════════ T9 ═══════════════ */

describe("T9 · escenarios y formato", () => {
  it("el documento no gana ninguna clave: ni outcome, ni warnings, ni parentesco; version 5 y motor 2", async () => {
    const a = await author(await withSuccess(), [DOWN, S("create_story", { ref: "f", name: "Fail" }), S("add_step", { storyId: { ref: "f" }, eventTypeId: { ref: "down" }, target: { nodeId: 3 } })]);
    assert.doesNotMatch(JSON.stringify(a.document), /"outcome"|"storyOutcome"|"variantOf"|"parentStory"|"linkKind"/);
    assert.equal(a.document.version, 5);
    assert.ok(a.document.doc.pages[0].scenarios.every((s: any) => s.engineVersion === 2));
    assert.deepEqual(Object.keys(a.document.doc.pages[0].scenarios[0]).sort(), ["arrivalDependencies", "engineVersion", "id", "name", "nextStepId", "steps"]);
  });

  it("D: crear no toca las Historias que ya había, byte a byte y por Trace", async () => {
    const s = await withSuccess();
    const before = data(await call("run_story", { document: s.doc, storyId: 1 }));
    const a = await author(s, [S("create_story", { ref: "n", name: "New" }), S("add_step", { storyId: { ref: "n" }, eventTypeId: 1, target: { edgeId: 4 } })]);
    assert.equal(JSON.stringify(a.document.doc.pages[0].scenarios[0]), JSON.stringify(s.doc.doc.pages[0].scenarios[0]));
    assert.equal(JSON.stringify(a.document.doc.eventTypes), JSON.stringify(s.doc.doc.eventTypes));
    assert.equal(data(await call("run_story", { document: a.document, storyId: 1 })).traceDigest, before.traceDigest);
    assert.equal(a.warnings, undefined);
  });

  it("variante por composición: misma página, prefijo común, sin campo nuevo, original intacta", async () => {
    const s = await withSuccess();
    const a = await author(s, [S("duplicate_story", { storyId: 1, ref: "v", name: "Another way" }), S("remove_step", { storyId: { ref: "v" }, stepId: 3 }), S("add_step", { storyId: { ref: "v" }, eventTypeId: 2, target: { edgeId: 4, reverse: true } })]);
    const [orig, copy] = a.document.doc.pages[0].scenarios;
    assert.equal(JSON.stringify(orig), JSON.stringify(s.doc.doc.pages[0].scenarios[0]));
    assert.equal(JSON.stringify(copy.steps.slice(0, 2)), JSON.stringify(orig.steps.slice(0, 2)));
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(orig).sort());
  });

  it("E: un documento guardado por la UI, con un paso sin evento, se lee, se ejecuta y se edita; lo demás vuelve igual", async () => {
    const s = await withSuccess();
    const ui = clone(s.doc);
    const sc = ui.doc.pages[0].scenarios[0];
    sc.steps.splice(1, 0, { id: 4, action: "SET_STATE", nodeId: 3, state: "DOWN", at: 500, message: "Bank no responde" });
    sc.nextStepId = 5;
    const d = data(await call("describe_document", { document: ui }));
    assert.equal(d.valid, true);
    assert.equal(d.pages[0].stories[0].outcome.status, "failed");
    const a = await author({ doc: ui, revision: d.revision }, [S("set_step_message", { storyId: 1, stepId: 4, message: "The bank goes silent" })]);
    assert.equal(a.document.doc.pages[0].scenarios[0].steps[1].message, "The bank goes silent");
    assert.equal(a.document.doc.pages[0].scenarios[0].steps[1].eventTypeId, undefined);
    assert.equal(JSON.stringify(a.document.doc.pages[0].nodes), JSON.stringify(ui.doc.pages[0].nodes));
  });
});

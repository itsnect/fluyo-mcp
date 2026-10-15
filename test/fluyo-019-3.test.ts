/**
 * FLUYO-019.3 — `settings.skin` en el MCP: modelo, schema, create_diagram y la piel «construido» en export_diagram.
 *
 * La normalización canónica es la de Fluyo (`settingsFromProjectData` de fluyo/js/model.js, resincronizado en el kernel):
 *   · "built" se conserva; ausente, "flat" o cualquier otro valor/tipo = plano y SIN clave; idempotente.
 *   · Un documento sin la clave no la adquiere al pasar por el MCP (ni `skin:"flat"` ni nada).
 * El schema del documento (FluyoSettingsSchema, export_diagram) DOCUMENTA la lista cerrada pero NO rechaza: un valor fuera de
 * lista se lee como ausente, igual que lo abre el editor. create_diagram acepta "flat" (= ausencia, mismo documento y misma
 * revisión) y "built"; un valor fuera de lista tampoco produce un rechazo nuevo.
 * export_diagram: con "built", la piel portada (src/skin.ts) contra los goldens de fluyo —capas por pieza y tema
 * (fluyo-019-1-skin.json), regla de color (fluyo-019-3-colores.json) y las líneas de la piel del SVG del editor real
 * (fluyo-019-2-skin-svg.json)—; con cualquier otro valor, el SVG plano de siempre, byte a byte. La paridad con el skin.js
 * real sobre el corpus la mide visual-regression.test.ts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { createDiagram, createDiagramResult, parseDocument } from "../src/diagram.js";
import { createKernel } from "../src/kernel.js";
import { normalizeWith, revisionOf } from "../src/revision.js";
import { SKIN_VALUES, projectSkin, type FluyoPage } from "../src/model.js";
import { pageEdgeGeometry, pageToSVG } from "../src/svg.js";
import { SKIN_DEPTH, skinColor, skinEdgeLanding, skinExtent, skinNode, skinPaintOrder, skinTones, type SkinNodeInput } from "../src/skin.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES_DIR, documentOf, isToolError, loadFixtures, startHarness, textBlocks, textOf, type Harness } from "./helpers.js";

/* La batería de 019.2 (fluyo/test/fluyo-019-2.test.cjs), más los casos de settings que no son objeto. */
const VALUES: Array<[string, Record<string, unknown>]> = [
  ["ausente", {}],
  ["built", { skin: "built" }],
  ["flat", { skin: "flat" }],
  ["BUILT", { skin: "BUILT" }],
  ["número", { skin: 1 }],
  ["null", { skin: null }],
  ["objeto", { skin: {} }],
  ["vacío", { skin: "" }],
];
const J = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rect = (id: number, x: number) => ({ id, shape: "rect", x, y: 200, w: 160, h: 70, label: "N" + id, color: "#6a9fb5" });
const docWith = (settings: Record<string, unknown>) => ({
  version: 5, app: "fluyo", settings: { ...settings },
  doc: { theme: "crema", customBg: "", eventTypes: [], nextEventTypeId: 1, cur: 0,
    pages: [{ name: "P", nodes: [rect(1, 200), rect(2, 600)], edges: [{ id: 3, from: 1, to: 2, route: "ortho" }], nextId: 4, behaviors: [], scenarios: [], nextScenarioId: 1 }] },
});

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });
const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });

describe("FLUYO-019.3 · settings.skin: normalización canónica (la del kernel de Fluyo)", () => {
  it("el kernel resincronizado trae la lista cerrada y la lectura canónica de 019.2; las de TypeScript son idénticas valor a valor", () => {
    const k = createKernel();
    assert.deepEqual(k.call<string[]>("SKIN_VALUES"), [...SKIN_VALUES]);
    for (const [name, st] of [...VALUES, ["settings null", null], ["settings ausente", undefined]] as Array<[string, unknown]>)
      assert.equal(projectSkin(st as any), k.call<string>("projectSkin(__a)", st ?? null), name);
    assert.equal(k.call<boolean>("'skin' in DEFAULT_SETTINGS"), false, "DEFAULT_SETTINGS sin skin");
  });

  it("normalizar: solo \"built\" deja clave; todo lo demás, sin clave; idempotente y con la misma revisión que la ausencia", () => {
    const k = createKernel();
    const revAbsent = revisionOf(k, docWith({}));
    for (const [name, st] of VALUES) {
      const once = normalizeWith(k, docWith(st)) as any;
      assert.ok(once, name + ": legible");
      if (name === "built") assert.equal(once.settings.skin, "built");
      else {
        assert.equal("skin" in once.settings, false, name + ": sin clave");
        assert.equal(revisionOf(k, docWith(st)), revAbsent, name + ": misma revisión que la ausencia");
      }
      assert.deepEqual(normalizeWith(k, once), once, name + ": idempotente");
    }
  });

  it("el corpus (8 ejemplos + regresión visual + historias) no adquiere skin al normalizarse", () => {
    const k = createKernel();
    const reg = join(FIXTURES_DIR, "regresion-visual");
    const fx = [...loadFixtures(), ...readdirSync(reg).filter(f => f.endsWith(".fluyo.json")).map(name => ({ name, doc: JSON.parse(readFileSync(join(reg, name), "utf8")) }))];
    assert.ok(fx.length >= 11, String(fx.length));
    for (const f of fx) {
      const doc = f.doc as any;
      assert.equal(doc.settings && "skin" in doc.settings, false, f.name + ": el fixture no la trae");
      const n = normalizeWith(k, J(doc)) as any;
      assert.ok(n, f.name);
      assert.equal("skin" in n.settings, false, f.name + ": tampoco tras el kernel");
    }
  });
});

describe("FLUYO-019.3 · export_diagram: el schema no rechaza ningún valor que hoy se acepta", () => {
  it("parseDocument acepta toda la batería; fuera de lista se lee como ausente", () => {
    for (const [name, st] of VALUES) {
      const p = parseDocument(docWith(st));
      assert.equal(projectSkin(p.settings), name === "built" ? "built" : "flat", name);
      if (name !== "built" && name !== "flat") assert.equal(p.settings.skin, undefined, name + ": fuera de lista = ausente");
    }
  });

  it("los valores planos (ausente, flat, BUILT, 1, null, {}, \"\") exportan el SVG de siempre, byte a byte; built pinta la piel", async () => {
    const svgOf = (r: unknown) => textBlocks(r)[textBlocks(r).length - 1];
    const base = svgOf(await call("export_diagram", { document: docWith({}) }));
    assert.ok(base.startsWith("<?xml"), base.slice(0, 120));
    for (const [name, st] of VALUES) {
      const r = await call("export_diagram", { document: docWith(st) });
      assert.ok(!isToolError(r), name + ": " + textOf(r).slice(0, 200));
      if (name !== "built") assert.equal(svgOf(r), base, name);
      else assert.notEqual(svgOf(r), base, "built pinta la piel");
    }
    assert.ok(!/skin-clip-/.test(base));
  });
});

describe("FLUYO-019.3 · create_diagram con skin", () => {
  const input = (extra: Record<string, unknown> = {}) => ({ nodes: [{ key: "a", shape: "rect", label: "A" }, { key: "b", shape: "rect", label: "B" }], edges: [{ from: "a", to: "b" }], ...extra });

  it("\"flat\" = ausencia: sin clave, mismo documento y misma revisión; \"built\" se conserva", () => {
    const absent = createDiagramResult(input() as any), flat = createDiagramResult(input({ skin: "flat" }) as any), built = createDiagramResult(input({ skin: "built" }) as any);
    assert.ok(absent.ok && flat.ok && built.ok, JSON.stringify([absent, flat, built]).slice(0, 400));
    if (!absent.ok || !flat.ok || !built.ok) return;
    assert.equal("skin" in absent.project.settings, false);
    assert.equal("skin" in flat.project.settings, false, "flat no deja clave");
    assert.deepEqual(flat.project, absent.project);
    assert.equal(flat.revision, absent.revision);
    assert.equal(built.project.settings.skin, "built");
    const { skin: _s, ...rest } = built.project.settings as any;
    assert.deepEqual(rest, absent.project.settings, "skin es lo único que cambia en settings");
    assert.deepEqual(built.project.doc, absent.project.doc, "la piel no toca el documento");
  });

  it("por el protocolo MCP: tools/list publica el enum flat|built; un valor fuera de lista no produce un rechazo nuevo (se lee como plano)", async () => {
    const tools = (await h.client.listTools()).tools;
    const cd = tools.find(t => t.name === "create_diagram") as any;
    assert.deepEqual(cd.inputSchema.properties.skin.enum, ["flat", "built"]);
    for (const [skin, want] of [["built", "built"], ["flat", undefined], ["BUILT", undefined], [7, undefined]] as Array<[unknown, string | undefined]>) {
      const r = await call("create_diagram", input({ skin }));
      assert.ok(!isToolError(r), JSON.stringify(skin) + ": " + textOf(r).slice(0, 300));
      const settings = documentOf(r).settings;
      assert.equal(settings.skin, want, JSON.stringify(skin));
      if (want === undefined) assert.equal("skin" in settings, false, JSON.stringify(skin) + ": sin clave");
    }
  });

  it("createDiagram (directo, sin zod) con un valor fuera de lista tampoco rechaza: el kernel lo normaliza a plano", () => {
    const p = createDiagram(input({ skin: "BUILT" }) as any);
    assert.equal("skin" in p.settings, false);
  });
});

/* ───────────────────────── el port de la piel (src/skin.ts + svg.ts) ───────────────────────── */
const fixture = (f: string): any => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8"));
const G1 = fixture("fluyo-019-1-skin.json"), GC = fixture("fluyo-019-3-colores.json"), GS = fixture("fluyo-019-2-skin-svg.json");
const THEME_BG: Record<string, string> = { dark: "#161616", crema: "#f4eee1", claro: "#ffffff" };

/** La MISMA extracción que fluyo/test/fluyo-019-2.test.cjs (skinSvgLines): capas, clips, trazos sin dash, puntas y anillos. */
export function skinSvgLines(svg: string): string[] {
  return svg.split("\n").map(l => l.trim()).filter(l =>
    /^<clipPath id="skin-clip-/.test(l) ||
    /^<path d="[^"]*" fill="[^"]*"( stroke="[^"]*" stroke-width="[^"]*")?( stroke-dasharray="[^"]*")? stroke-linejoin="round"( clip-path="url\(#skin-clip-[^)]*\)")?\/>$/.test(l) ||
    /^<path d="[^"]*" fill="[^"]*"\/>$/.test(l) ||
    /^<path d="[^"]*" fill="[^"]*" stroke="[^"]*" stroke-width="1\.5"\/>$/.test(l));
}

describe("FLUYO-019.3 · port de skin.js contra los goldens de fluyo", () => {
  it("golden 019.1: skinNode por pieza y tema (dark, crema, claro), fondo personalizado, skinExtent y skinEdgeLanding", () => {
    for (const theme of ["dark", "crema", "claro"]) for (const n of G1.nodes)
      assert.deepEqual(J(skinNode(n, theme, THEME_BG[theme])), G1.themes[theme][n.id], `${theme} / ${n.shape} #${n.id}`);
    assert.deepEqual(J(skinNode(G1.nodes.find((n: any) => n.id === 1), "crema", "#123456")), G1.themes.customBg);
    for (const n of G1.nodes) assert.deepEqual(J(skinExtent(n)), G1.extent[n.id], "extent " + n.shape);
    const routes: Record<string, Array<{ x: number; y: number }>> = {
      n3: [{ x: 100, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 100 }], e3: [{ x: 0, y: 100 }, { x: 50, y: 100 }, { x: 50, y: 200 }, { x: 120, y: 200 }],
      n2: [{ x: 100, y: 0 }, { x: 100, y: 100 }], diag: [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 100 }] };
    const keys = Object.keys(G1.landing);
    assert.ok(keys.length >= 12, String(keys.length));
    for (const k of keys) { const [route, side] = k.split("/"); assert.deepEqual(skinEdgeLanding(routes[route], side), G1.landing[k], k); }
  });

  it("golden de color 019.3: skinColor, skinTones y skinNode (#rgb, #rrggbb, #rrggbbaa compuesto, ilegibles → PALETTE[0])", () => {
    assert.equal(GC.palette0, "#6a9fb5");
    for (const c of GC.skinColor) assert.equal(skinColor(c.c, c.bg), c.out, `skinColor(${JSON.stringify(c.c)}, ${c.bg})`);
    for (const c of GC.tones) assert.deepEqual(J(skinTones(c.c, c.theme, c.bg)), c.out, `skinTones(${JSON.stringify(c.c)}, ${c.theme}, ${c.bg})`);
    for (const c of GC.nodes) assert.deepEqual(J(skinNode(c.n, c.theme, c.bg)), c.out, `skinNode ${c.n.shape} ${c.n.color}/${c.n.fill} ${c.theme}/${c.bg}`);
    assert.ok(GC.skinColor.length > 100 && GC.tones.length > 100 && GC.nodes.length === 45);
    assert.equal(skinColor("#6a9fb5cc", "#f4eee1"), "#86afbe", "valor escrito a mano");
  });

  it("los fixtures compartidos son byte a byte los de fluyo (si está al lado)", () => {
    const fl = join(FIXTURES_DIR, "..", "..", "..", "fluyo", "test", "fixtures");
    let n = 0;
    for (const f of ["fluyo-019-1-skin.json", "fluyo-019-2-skin.fluyo.json", "fluyo-019-2-skin-svg.json", "fluyo-019-3-colores.json"]) {
      let other: string; try { other = readFileSync(join(fl, f), "utf8"); } catch { continue; }
      assert.equal(readFileSync(join(FIXTURES_DIR, f), "utf8").replace(/\r\n/g, "\n"), other.replace(/\r\n/g, "\n"), f); n++;
    }
    assert.ok(n === 0 || n === 4, "o ninguno (sin fluyo/) o los cuatro: " + n);
  });
});

describe("FLUYO-019.3 · export_diagram con skin:\"built\"", () => {
  const doc019 = () => fixture("fluyo-019-2-skin.fluyo.json");
  const svgOf = (r: unknown) => textBlocks(r)[textBlocks(r).length - 1];
  const flatOpts = (d: any) => ({ globalFont: d.settings.font ?? null });

  it("las líneas de la piel del SVG son EXACTAMENTE las del exportador del editor (golden 019.2, skinSvgLines)", async () => {
    const d = doc019();
    assert.equal(d.settings.skin, "built"); assert.equal(GS.theme, d.doc.theme);
    const r = await call("export_diagram", { document: d });
    assert.ok(!isToolError(r), textOf(r).slice(0, 300));
    const lines = skinSvgLines(svgOf(r));
    assert.equal(lines.length, GS.lines.length, `líneas: ${lines.length} vs ${GS.lines.length}`);
    assert.deepEqual(lines, GS.lines);
  });

  it("sin la clave (o con \"flat\" o un valor fuera de lista): sin piel, el mismo SVG que pageToSVG plano", async () => {
    const d = doc019(); delete d.settings.skin;
    const a = svgOf(await call("export_diagram", { document: d }));
    for (const skin of ["flat", "BUILT", 1]) { d.settings.skin = skin; assert.equal(svgOf(await call("export_diagram", { document: d })), a, String(skin)); }
    assert.ok(!/skin-clip-/.test(a) && !/stroke-width="1" stroke-linejoin="round"/.test(a), "ninguna capa de piel");
    const page = parseDocument(d).doc.pages[0];
    assert.equal(a, pageToSVG(page, d.doc.theme, flatOpts(d)), "= pageToSVG sin opciones de piel");
    for (const skin of [null, undefined, "flat", "BUILT", ""]) assert.equal(pageToSVG(page, d.doc.theme, { ...flatOpts(d), skin, customBg: "#123456" }), a, String(skin));
  });

  it("con la piel no cambian rutas, anclas ni etiquetas: los <text> y sus cajas son los mismos (solo la voz del rótulo)", () => {
    const d = doc019(), page = parseDocument(d).doc.pages[0] as FluyoPage;
    const flat = pageToSVG(page, d.doc.theme, flatOpts(d));
    const built = pageToSVG(page, d.doc.theme, { ...flatOpts(d), skin: "built" });
    const texts = (svg: string) => svg.split("\n").filter(l => l.startsWith("<text") || (l.startsWith("<rect") && !l.includes(" stroke="))).map(l => l.replace(/ font-family="[^"]*"/, "").replace(/ font-weight="500"/, "")).sort();
    assert.deepEqual(texts(built), texts(flat), "mismos rótulos (posición, tamaño, texto) y mismas cajas de etiqueta");
    assert.ok(built.includes('font-family="&apos;IBM Plex Mono&apos;') && built.includes('font-weight="500"'), "la voz de la piel: Plex Mono 500");
    /* la geometría de las rutas es la de siempre (pageEdgeGeometry no conoce la piel) y el aterrizaje solo mueve el final */
    const geo = pageEdgeGeometry(page);
    for (const e of page.edges) {
      const pts = geo.get(e.id)!;
      for (const side of ["n", "e", "s", "w"]) {
        const l = skinEdgeLanding(pts, side);
        assert.equal(l.length, pts.length);
        for (let i = 0; i < pts.length - 2; i++) assert.deepEqual(l[i], pts[i], `e${e.id}/${side}: vértice ${i} intacto`);
        const z = pts[pts.length - 1], lz = l[l.length - 1];
        assert.ok(Math.hypot(lz.x - z.x, lz.y - z.y) <= Math.hypot(SKIN_DEPTH / 2, SKIN_DEPTH / 2) + 1e-9, `e${e.id}/${side}: la punta se mueve como mucho d/2`);
      }
    }
  });

  it("estructura: nodos en el orden de pintor, un clip por cilindro, un anillo por conexión sin startArrow; las formas planas no cambian", () => {
    const d = doc019(), page = parseDocument(d).doc.pages[0] as FluyoPage;
    const built = pageToSVG(page, d.doc.theme, { ...flatOpts(d), skin: "built" });
    const order = [...built.matchAll(/<g id="node-(\d+)">/g)].map(m => +m[1]);
    assert.deepEqual(order, skinPaintOrder(page.nodes).map(n => n.id));
    assert.equal((built.match(/<clipPath id="skin-clip-/g) || []).length, page.nodes.filter(n => n.shape === "cylinder").length);
    const rings = built.split("\n").filter(l => /^<path d="[^"]*" fill="[^"]*" stroke="[^"]*" stroke-width="1\.5"\/>$/.test(l)).length;
    assert.equal(rings, page.edges.filter(e => !e.startArrow).length);
    const flat = pageToSVG(page, d.doc.theme, flatOpts(d));
    const g = (svg: string, id: number) => { const i = svg.indexOf(`<g id="node-${id}">`); return svg.slice(i, svg.indexOf("</g>", i)); };
    const planos = page.nodes.filter(n => !skinNode(n as SkinNodeInput, d.doc.theme, THEME_BG[d.doc.theme]));
    assert.ok(planos.length >= 2, "el fixture tiene hex y text");
    for (const n of planos) assert.equal(g(built, n.id), g(flat, n.id), `${n.shape} #${n.id} sin cambios`);
  });

  it("anillo de salida: solo sin startArrow; con startArrow el origen lleva la punta, no el anillo (como export.js)", () => {
    const d = doc019(), page = parseDocument(d).doc.pages[0] as FluyoPage;
    const ring = /^<path d="[^"]*" fill="[^"]*" stroke="[^"]*" stroke-width="1\.5"\/>$/;
    const count = (pg: FluyoPage) => pageToSVG(pg, d.doc.theme, { ...flatOpts(d), skin: "built" }).split("\n").filter(l => ring.test(l)).length;
    assert.equal(count(page), page.edges.length, "el fixture no trae startArrow: un anillo por conexión");
    const conInicio = { ...page, edges: page.edges.map((e, i) => (i < 3 ? { ...e, startArrow: true } : e)) } as FluyoPage;
    assert.equal(count(conInicio), page.edges.length - 3, "tres conexiones con startArrow: tres anillos menos");
  });

  it("temas, fondo propio y #rrggbbaa: la piel sigue al documento y nunca lanza", async () => {
    for (const theme of ["dark", "crema", "claro"]) for (const customBg of ["", "#123456", "#ffffff80"]) {
      const d = doc019(); d.doc.theme = theme; d.doc.customBg = customBg;
      d.doc.pages[0].nodes[0].color = "#6a9fb5cc"; d.doc.pages[0].nodes[1].fill = "#ffffff80";
      const r = await call("export_diagram", { document: d });
      assert.ok(!isToolError(r), `${theme}/${customBg}: ${textOf(r).slice(0, 200)}`);
      const svg = svgOf(r), base = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(customBg) ? customBg : THEME_BG[theme];
      for (const n of d.doc.pages[0].nodes) {
        const sk = skinNode(n, theme, customBg || THEME_BG[theme]);
        if (sk) for (const L of sk.layers) if (L.fill) assert.ok(svg.includes(`fill="${L.fill}"`), `${theme}/${customBg}: #${n.id} ${L.k}`);
      }
      assert.equal(skinTones("#6a9fb5cc", theme, customBg || THEME_BG[theme]).bg, base);
      assert.ok(!/fill="#[0-9a-f]{8}"( stroke="[^"]*" stroke-width="1")? stroke-linejoin/i.test(svg), "la piel no lleva colores con alfa");
    }
  });
});

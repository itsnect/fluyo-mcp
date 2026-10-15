/**
 * FLUYO-019.3 — mutaciones adversariales de la piel «construido» (settings.skin) en el MCP.
 *
 *   node scripts/mutate-019-3.ts            (ONLY=<regex> para una o varias)
 *
 * Igual que mutate-018-27.ts: SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «app» (se
 * cambia fluyo/js/skin.js de la copia: la paridad con el skin.js real tiene que verlo) y «mcp» (src/skin.ts, src/svg.ts,
 * src/server.ts, src/model.ts, src/diagram.ts). Cada mutación debe hacer fallar test/fluyo-019-3.test.ts o
 * visual-regression.test.ts. Una que sobrevive es un test débil: código de salida 1.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLUYO = resolve(MCP, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const NL = "\n", CRLF = "\r\n";

type Edit = [from: string, to: string];
interface Mutation { name: string; side: "app" | "mcp"; file: string; edits: Edit[] }
const A = (name: string, file: string, ...edits: Edit[]): Mutation => ({ name, side: "app", file, edits });
const M = (name: string, file: string, ...edits: Edit[]): Mutation => ({ name, side: "mcp", file, edits });

const APP = "js/skin.js", SKIN = "src/skin.ts", SVG = "src/svg.ts", SERVER = "src/server.ts", MODEL = "src/model.ts", DIAGRAM = "src/diagram.ts";

const MUTATIONS: Mutation[] = [
  /* ── la app cambia y el MCP no: divergencia MCP/Fluyo que la paridad (skin.js real en vm) tiene que ver */
  A("divergencia: la app usa otra profundidad", APP, ["const SKIN_DEPTH=8;", "const SKIN_DEPTH=9;"]),
  A("divergencia: la app cambia un tono", APP, ["  light:{top:.10, front:.22, side:.40, line:.45, contact:.22},", "  light:{top:.12, front:.22, side:.40, line:.45, contact:.22},"]),
  A("divergencia: la app invierte el orden de pintor", APP, ["  return nodes.slice().sort((a,b)=>(a.y-b.y)||(b.x-a.x));", "  return nodes.slice().sort((a,b)=>(b.y-a.y)||(b.x-a.x));"]),
  A("divergencia: la app posa también en s/w", APP, ['  if(out.length<3 || (toSide!=="n" && toSide!=="e")) return out;', "  if(out.length<3) return out;"]),
  A("divergencia: la app descarta el alfa", APP, ['  return m? skinMix(base, "#"+m[1], parseInt(m[2],16)/255) : null;', '  return m? "#"+m[1].toLowerCase() : null;']),
  A("divergencia: la app vuelve a DEFAULT_NODE_COLOR", APP, ["  const col=skinColor(color, base) || PALETTE[0].c;", "  const col=skinColor(color, base) || DEFAULT_NODE_COLOR;"]),
  /* ── el MCP cambia y la app no */
  M("export_diagram vuelve a exportar siempre plano (no lee settings.skin)", SERVER, ["        skin: projectSkin(project.settings),", "        skin: null,"]),
  M("pageToSVG ignora la opción skin", SVG, ["  const skinBg = skinActive(skin, 1) ? (customBg || THEMES[theme].bg) : null;", "  const skinBg = null as string | null;"]),
  M("pageToSVG pinta la piel también en plano", SVG, ["  const skinBg = skinActive(skin, 1) ? (customBg || THEMES[theme].bg) : null;", "  const skinBg = skin !== undefined ? (customBg || THEMES[theme].bg) : null;"]),
  M("la piel ignora el fondo personalizado", SVG, ["  const skinBg = skinActive(skin, 1) ? (customBg || THEMES[theme].bg) : null;", "  const skinBg = skinActive(skin, 1) ? THEMES[theme].bg : null;"]),
  M("profundidad distinta", SKIN, ["export const SKIN_DEPTH = 8;", "export const SKIN_DEPTH = 9;"]),
  M("tonos invertidos (tapa ↔ lateral)", SKIN, ["  return { top: skinMix(base, col, K.top), front: skinMix(base, col, K.front), side: skinMix(base, col, K.side),", "  return { top: skinMix(base, col, K.side), front: skinMix(base, col, K.front), side: skinMix(base, col, K.top),"]),
  M("orden de capas del bloque (lateral antes que tapa)", SKIN, ['  layers.push({ k: "top", segs: skinPoly(f.top), fill: T.top, stroke: T.line, sw: 1 });\n  layers.push({ k: "side", segs: skinPoly(f.side), fill: T.side, stroke: T.line, sw: 1 });\n  layers.push({ k: "front"',
    '  layers.push({ k: "side", segs: skinPoly(f.side), fill: T.side, stroke: T.line, sw: 1 });\n  layers.push({ k: "top", segs: skinPoly(f.top), fill: T.top, stroke: T.line, sw: 1 });\n  layers.push({ k: "front"']),
  M("clip ausente en la banda del cilindro", SVG, ["    if (L.clip) {", "    if (L.clip && L.k !== \"band\") {"]),
  M("aterrizaje también en s/w", SKIN, ['  if (out.length < 3 || (toSide !== "n" && toSide !== "e")) return out;', "  if (out.length < 3) return out;"]),
  M("sin orden de pintor", SVG, ["  const nodos = (skinBg !== null ? skinPaintOrder(page.nodes) : page.nodes).map(", "  const nodos = page.nodes.map("]),
  M("sin anillo de salida", SVG, ["  if (skinBg !== null && !e.startArrow) {", "  if (skinBg !== null && !e.startArrow && e.id < 0) {"]),
  M("anillo también con startArrow", SVG, ["  if (skinBg !== null && !e.startArrow) {", "  if (skinBg !== null) {"]),
  M("respaldo DEFAULT_NODE_COLOR en vez de PALETTE[0]", SKIN, ["  const col = skinColor(color, base) || PALETTE[0].hex;", '  const col = skinColor(color, base) || "#857F6C";']),
  M("#rrggbbaa descarta el alfa", SKIN, ['  return m ? skinMix(base, "#" + m[1], parseInt(m[2], 16) / 255) : null;', '  return m ? "#" + m[1].toLowerCase() : null;']),
  M("la voz del rótulo no cambia con la piel", SVG, ["    const fo = skinLabelFont(n, globalFont);", "    const fo = null;"]),
  M("skin:\"flat\" en create_diagram se rechaza (compara valor a valor)", DIAGRAM, ["  k === \"skin\" ? projectSkin({ skin: normalized }) === projectSkin({ skin: wanted }) : normalized === wanted;", "  normalized === wanted;"]),
  M("schema estricto: un skin fuera de lista se rechaza", MODEL, ["  .optional()\n  .catch(undefined)\n", "  .optional()\n"]),
  M("projectSkin laxo (cualquier valor verdadero = construido)", MODEL, ['  return settings && settings.skin === "built" ? "built" : "flat";', '  return settings && settings.skin ? "built" : "flat";']),
];

function copyInto(src: string, dest: string, entries: string[]) {
  for (const e of entries) {
    const from = join(src, e);
    if (existsSync(from)) { mkdirSync(dirname(join(dest, e)), { recursive: true }); cpSync(from, join(dest, e), { recursive: true }); }
  }
}
function layout(root: string) {
  const fl = join(root, "fluyo"), mc = join(root, "fluyo-mcp");
  copyInto(FLUYO, fl, ["js", "css", "test/fixtures", "ejemplos/data"]);
  copyInto(MCP, mc, ["src", "test", "scripts", "package.json", "tsconfig.json", "tsconfig.test.json"]);
  symlinkSync(join(MCP, "node_modules"), join(mc, "node_modules"), "junction");
  return { fl, mc };
}
function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function patch(path: string, edits: Edit[]): string | null {
  const raw = readFileSync(path, "utf8"), crlf = raw.includes(CRLF);
  let text = raw.replaceAll(CRLF, NL);
  for (const [from, to] of edits) {
    if (!text.includes(from)) return from.slice(0, 70);
    text = text.replace(from, () => to);
  }
  writeFileSync(path, crlf ? text.replaceAll(NL, CRLF) : text);
  return null;
}
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-019-3.test.js", "dist-test/test/visual-regression.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut193-"));
let survivors = 0, obsolete = 0;
const t0 = Date.now();
try {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
  const list = MUTATIONS.filter(m => !only || only.test(m.name));
  const base = layout(join(tmp, "base"));
  const build = run(base.mc, TSC);
  if (build.code !== 0) { console.error("tsc falló en la copia sin mutar:\n" + build.out.slice(-1500)); process.exit(2); }
  const sane = run(base.mc, SUITE, { REQUIRE_FLUYO: "1" });
  if (sane.code !== 0) {
    console.error("La copia sin mutar NO pasa la suite:\n" + sane.out.split("\n").filter(l => /^\s*not ok /.test(l)).join("\n"));
    process.exit(2);
  }
  console.log(`copia sin mutar: suite OK (0/${list.length} mutaciones aplicadas)`);
  rmSync(join(tmp, "base"), { recursive: true, force: true });

  list.forEach((m, i) => {
    const { fl, mc } = layout(join(tmp, `m${i}`));
    const missing = patch(join(m.side === "app" ? fl : mc, m.file), m.edits);
    if (missing !== null) { console.log(`  ✘ OBSOLETA   ${m.name} — el patrón ya no existe: «${missing}»`); obsolete++; return; }
    const b = run(mc, TSC);
    if (b.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — la mutación no compila: ${b.out.slice(0, 300)}`); obsolete++; return; }
    const r = run(mc, SUITE, { REQUIRE_FLUYO: "1" });
    const killed = r.code !== 0, n = (r.out.match(/^\s*not ok /gm) ?? []).length;
    console.log(`${killed ? "  ✔ detectada " : "  ✘ SOBREVIVE "} ${m.name}${killed ? `  (${n} tests fallan)` : ""}`);
    if (!killed) survivors++;
    rmSync(join(tmp, `m${i}`), { recursive: true, force: true });
  });
  const bad = survivors + obsolete;
  console.log((bad ? `\nFLUYO-019.3 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-019.3 mutaciones: ${list.length}/${list.length} detectadas`) + ` · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

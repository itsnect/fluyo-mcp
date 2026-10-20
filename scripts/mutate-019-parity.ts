/**
 * FLUYO-019-MCP-PARITY — mutaciones adversariales del port de 019.4a (aterrizaje por silueta, decisión 213) y de D6 (capas con
 * la piel, decisión 212) en el MCP.
 *
 *   node scripts/mutate-019-parity.ts
 *
 * Igual que mutate-019-5.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «app»
 * (se cambia fluyo/js/skin.js o geometry.js de la copia: la paridad en vm tiene que verlo) y «mcp» (src/skin.ts, src/svg.ts).
 * Cada mutación debe hacer fallar fluyo-019-mcp-parity.test.ts, fluyo-019-3.test.ts o visual-regression.test.ts. Una que
 * sobrevive es un test débil: código de salida 1.
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

const SKIN = "src/skin.ts", SVG = "src/svg.ts";
const MOVE = "  z.x += u.x * t; z.y += u.y * t;";
const CALL = "  if (skinBg !== null) pts = skinEdgeLanding(pts, B);";
const LAYERS = "  const lay = skinBg !== null ? containmentPaintOrder(page.nodes, skinPaintOrder) : { containers: [] as FluyoNode[], leaves: page.nodes };";
const DEFS = "  if (contenedores.length) { if (defs) parts.push(defs); parts.push(...contenedores, ...conexiones); }";

const MUTATIONS: Mutation[] = [
  /* ── el MCP cambia y la app no */
  M("aterrizaje: el SVG no aterriza", SVG, [CALL, "  if (skinBg !== null) pts = skinEdgeLanding(pts, null);"]),
  M("aterrizaje: la punta solo retrocede media silueta", SKIN, [MOVE, "  z.x += u.x * t / 2; z.y += u.y * t / 2;"]),
  M("aterrizaje: el penúltimo acompaña (vuelve la inclinación de F2)", SKIN, [MOVE, "  z.x += u.x * t; z.y += u.y * t; p.x += SKIN_DEPTH / 2;"]),
  M("aterrizaje: sin la guarda «llega desde dentro»", SKIN, ["  if (Math.abs(p.x - a.x) < a.w / 2 - SKIN_EPS && Math.abs(p.y - a.y) < a.h / 2 - SKIN_EPS) return out;   /* llega desde dentro */\n", ""]),
  M("aterrizaje: sin la guarda t* > L − 1", SKIN, ["  if (t <= 1e-6 || t > L - 1) return out;", "  if (t <= 1e-6) return out;"]),
  M("aterrizaje: desplazamiento fijo también sin silueta (vuelve F3)", SKIN, ["  if (t <= 1e-6 || t > L - 1) return out;", "  if (t <= 1e-6) t = SKIN_DEPTH / 2;\n  if (t > L - 1) return out;"]),
  M("aterrizaje: el recorte (clip) de una capa no se aplica", SKIN, ["  if (!layer.clip) return a;", "  if (!layer.clip || a) return a;"]),
  M("aterrizaje: un arco acepta los cortes de su mitad opuesta", SKIN, ["d = mod(o.ccw ? o.a0 - th : th - o.a0);", "d = mod(o.ccw ? th - o.a0 : o.a0 - th);"]),
  M("aterrizaje: la silueta incluye las capas abiertas (la línea de contacto)", SKIN, ['  return sk.layers.filter(L => L.fill && L.segs.length && L.segs[L.segs.length - 1].op === "Z")', "  return sk.layers.filter(L => L.segs.length)"]),
  M("D6: sin capas (vuelven las conexiones bajo todos los nodos)", SVG, [LAYERS, "  const lay = skinBg !== null ? { containers: [] as FluyoNode[], leaves: skinPaintOrder(page.nodes) } : { containers: [] as FluyoNode[], leaves: page.nodes };"]),
  M("D6: capas también en plano", SVG, [LAYERS, "  const lay = containmentPaintOrder(page.nodes, skinBg !== null ? skinPaintOrder : ns => ns.slice());"]),
  M("D6: padre = el contenedor mayor", SVG, ["      if (!best || o.w * o.h < best.w * best.h ||", "      if (!best || o.w * o.h > best.w * best.h ||"]),
  M("D6: hojas en orden de documento", SVG, ["  return { containers, leaves: order(nodes.filter(n => !isCont.has(n))) };", "  return { containers, leaves: nodes.filter(n => !isCont.has(n)) };"]),
  M("D6: contenedor también con un nodo de igual área", SVG, ["  for (const m of nodes) if (m !== n && m.w * m.h < a &&", "  for (const m of nodes) if (m !== n && m.w * m.h <= a &&"]),
  M("D6: el <defs> después de los contenedores", SVG, [DEFS, "  if (contenedores.length) { parts.push(...contenedores, ...conexiones); if (defs) parts.push(defs); }"]),
  /* ── la app cambia y el MCP no: divergencia MCP/editor (paridad en vm con el skin.js y el geometry.js reales) */
  A("divergencia: la app retrocede media silueta", "js/skin.js", ["  z.x+=u.x*t; z.y+=u.y*t;", "  z.x+=u.x*t/2; z.y+=u.y*t/2;"]),
  A("divergencia: la app pinta los hermanos en orden de documento", "js/geometry.js", ["  const walk=c=>{ containers.push(c); for(const k of order(conts.filter(k=>parent.get(k)===c))) walk(k); };", "  const walk=c=>{ containers.push(c); for(const k of conts.filter(k=>parent.get(k)===c)) walk(k); };"]),
];

function copyInto(src: string, dest: string, entries: string[]) {
  for (const e of entries) {
    const from = join(src, e);
    if (existsSync(from)) { mkdirSync(dirname(join(dest, e)), { recursive: true }); cpSync(from, join(dest, e), { recursive: true }); }
  }
}
function layout(root: string) {
  const fl = join(root, "fluyo"), mc = join(root, "fluyo-mcp");
  copyInto(FLUYO, fl, ["js", "css", "test/fixtures"]);
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-019-mcp-parity.test.js", "dist-test/test/fluyo-019-3.test.js", "dist-test/test/visual-regression.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mutpar-"));
let survivors = 0, obsolete = 0;
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
  console.log(bad ? `\nFLUYO-019-MCP-PARITY mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-019-MCP-PARITY mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

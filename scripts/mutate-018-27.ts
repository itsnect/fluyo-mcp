/**
 * FLUYO-018.27 — mutaciones adversariales del tamaño de las puntas (`arrowSize`) en el MCP.
 *
 *   node scripts/mutate-018-27.ts
 *
 * Igual que mutate-018-16.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones
 * «app» (se cambia fluyo/js/geometry.js de la copia: la paridad tiene que verlo) y «mcp» (src/svg.ts, src/authoring.ts,
 * src/model.ts). Cada mutación debe hacer fallar test/fluyo-018-27.test.ts o visual-regression.test.ts. Una que sobrevive es
 * un test débil: código de salida 1.
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

const GEO = "js/geometry.js", SVG = "src/svg.ts", AUTH = "src/authoring.ts", MODEL = "src/model.ts";

const MUTATIONS: Mutation[] = [
  /* ── la app cambia y el MCP no: divergencia MCP/editor */
  A("divergencia: la app ignora arrowSize", GEO, ["const n=line.length, size=edgeArrowSize(e), cut=", "const n=line.length, size=1, cut="]),
  A("divergencia: la app escala solo el ancho", GEO, ["const s=size||1, len=EDGE_HEAD_LEN*s, half=EDGE_HEAD_HALF*s, k=(EDGE_HEAD_LEN-EDGE_HEAD_NOTCH)*s;", "const s=size||1, len=EDGE_HEAD_LEN, half=EDGE_HEAD_HALF*s, k=(EDGE_HEAD_LEN-EDGE_HEAD_NOTCH);"]),
  A("divergencia: la app acota en [1, 3]", GEO, ["const ARROW_SIZE_MIN=1, ARROW_SIZE_MAX=2;", "const ARROW_SIZE_MIN=1, ARROW_SIZE_MAX=3;"]),
  /* ── el MCP cambia y la app no */
  M("export_diagram: ignora arrowSize", SVG, ["const n = line.length, size = edgeArrowSize(e), cut =", "const n = line.length, size = 1, cut ="]),
  M("export_diagram: la escala se invierte", SVG, ["return Number.isFinite(k) ? Math.min(ARROW_SIZE_MAX, Math.max(ARROW_SIZE_MIN, k)) : 1;", "return Number.isFinite(k) ? 1 / Math.min(ARROW_SIZE_MAX, Math.max(ARROW_SIZE_MIN, k)) : 1;"]),
  M("export_diagram: solo escala el largo", SVG, ["const s = size || 1, len = EDGE_HEAD_LEN * s, half = EDGE_HEAD_HALF * s, k = (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH) * s;", "const s = size || 1, len = EDGE_HEAD_LEN * s, half = EDGE_HEAD_HALF, k = (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH) * s;"]),
  M("export_diagram: solo escala el ancho", SVG, ["const s = size || 1, len = EDGE_HEAD_LEN * s, half = EDGE_HEAD_HALF * s, k = (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH) * s;", "const s = size || 1, len = EDGE_HEAD_LEN, half = EDGE_HEAD_HALF * s, k = EDGE_HEAD_LEN - EDGE_HEAD_NOTCH;"]),
  M("export_diagram: la punta se aleja del ancla con el tamaño", SVG, ["      const z = pts[n - 1], tip = { x: z.x - u.x * EDGE_GAP, y: z.y - u.y * EDGE_GAP };\n      out.heads.push(edgeHeadSegs(tip, u, size));", "      const z = pts[n - 1], tip = { x: z.x - u.x * EDGE_GAP * size, y: z.y - u.y * EDGE_GAP * size };\n      out.heads.push(edgeHeadSegs(tip, u, size));"]),
  M("export_diagram: la línea no se recorta hasta la muesca", SVG, ["cut = EDGE_GAP + (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH) * size;", "cut = EDGE_GAP + (EDGE_HEAD_LEN - EDGE_HEAD_NOTCH);"]),
  M("export_diagram: la punta del inicio ignora el tamaño", SVG, ["      out.heads.push(edgeHeadSegs(tip, u, size));\n      trim(0, 1, cut);", "      out.heads.push(edgeHeadSegs(tip, u, 1));\n      trim(0, 1, cut);"]),
  M("author_document: create/update_connection rechazan arrowSize (fuera de ConnectionSpec)", AUTH, ["    arrowSize: z.number().nullable().optional().describe(", "    arrowSizeX: z.number().nullable().optional().describe("]),
  M("create_diagram: edges[] no acepta arrowSize", MODEL, ["  arrowSize: z.number().min(1).max(2).optional().describe(", "  arrowSizeX: z.number().min(1).max(2).optional().describe("]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-018-27.test.js", "dist-test/test/visual-regression.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut27-"));
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
  console.log(bad ? `\nFLUYO-018.27 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.27 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

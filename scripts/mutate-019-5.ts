/**
 * FLUYO-019.5 — mutaciones adversariales del tinte de un color de nodo (colorTint) en el MCP.
 *
 *   node scripts/mutate-019-5.ts
 *
 * Igual que mutate-018-27.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones
 * «app» (se cambia fluyo/js/geometry.js de la copia: la paridad tiene que verlo) y «mcp» (src/svg.ts). Cada mutación debe hacer
 * fallar test/fluyo-019-5.test.ts o visual-regression.test.ts. Una que sobrevive es un test débil: código de salida 1.
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

const GEO = "js/geometry.js", SVG = "src/svg.ts";
const ALPHA_APP = "  const a=s.length===8? Math.round(k*parseInt(s.slice(6),16)/255*1e4)/1e4 : k;";
const ALPHA_MCP = "  const a = s.length === 8 ? Math.round(k * parseInt(s.slice(6), 16) / 255 * 1e4) / 1e4 : k;";

const MUTATIONS: Mutation[] = [
  /* ── la app cambia y el MCP no: divergencia MCP/editor */
  A("divergencia: la app descarta el alfa", GEO, [ALPHA_APP, "  const a=k;"]),
  A("divergencia: la app no expande #rgb", GEO, ['  let s=m[1]; if(s.length===3) s=s.split("").map(ch=>ch+ch).join("");', "  let s=m[1];"]),
  A("divergencia: la app no ignora los espacios", GEO, ["/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())", "/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)"]),
  /* ── el MCP cambia y la app no */
  M("export_diagram: descarta el alfa", SVG, [ALPHA_MCP, "  const a = k;"]),
  M("export_diagram: alfa sin los 4 decimales", SVG, [ALPHA_MCP, "  const a = s.length === 8 ? k * parseInt(s.slice(6), 16) / 255 : k;"]),
  M("export_diagram: alfa invertido", SVG, [ALPHA_MCP, "  const a = s.length === 8 ? Math.round(k * (255 - parseInt(s.slice(6), 16)) / 255 * 1e4) / 1e4 : k;"]),
  M("export_diagram: #rrggbb cambia de string", SVG, [ALPHA_MCP, "  const a = s.length === 8 ? Math.round(k * parseInt(s.slice(6), 16) / 255 * 1e4) / 1e4 : +k.toFixed(1);"]),
  M("export_diagram: #rgb sin expandir", SVG, ['  let s = m[1]; if (s.length === 3) s = s.split("").map(ch => ch + ch).join("");', "  let s = m[1];"]),
  M("export_diagram: los espacios ya no se ignoran", SVG, ["/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())", "/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)"]),
  M("export_diagram: respaldo distinto de PALETTE[0]", SVG, ["  return colorTint(hex, k) ?? (colorTint(PALETTE[0].hex, k) as string);", "  return colorTint(hex, k) ?? (colorTint(PALETTE[1].hex, k) as string);"]),
  M("export_diagram: svgFillColor vuelve al parseInt de 6 dígitos", SVG, ["  return colorTint(hex, k) ?? (colorTint(PALETTE[0].hex, k) as string);", "  const v = parseInt(hex.slice(1), 16);\n  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${k})`;"]),
  M("export_diagram: el panel de code vuelve a solo #rrggbb", SVG, ['  return colorTint(color, theme === "crema" ? 0.16 : 0.18);   // FLUYO-019.5: la misma regla que el relleno automático',
    '  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;\n  return colorTint(color, theme === "crema" ? 0.16 : 0.18);']),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-019-5.test.js", "dist-test/test/visual-regression.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut195-"));
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
  console.log(bad ? `\nFLUYO-019.5 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-019.5 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

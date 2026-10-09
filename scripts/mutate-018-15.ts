/**
 * FLUYO-018.15 — mutaciones adversariales del color con el que nace un nodo y de su compatibilidad.
 *
 *   node scripts/mutate-018-15.ts
 *
 * Igual que mutate-018-9.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-15.test.ts (+ tools, 018-9). Una que sobrevive es un test débil: código de salida 1.
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
interface Mutation { name: string; side: "kernel" | "mcp"; file: string; edits: Edit[] }
const K = (name: string, file: string, ...edits: Edit[]): Mutation => ({ name, side: "kernel", file, edits });
const M = (name: string, file: string, ...edits: Edit[]): Mutation => ({ name, side: "mcp", file, edits });

const CONFIG = "js/config.js", MODEL = "js/model.js", SVG = "src/svg.ts", KSRC = "src/generated/kernel-sources.ts";

const MUTATIONS: Mutation[] = [
  /* ── kernel (se regenera con el sync-kernel real) */
  K("vuelve #6a9fb5 como color con el que nace un nodo", CONFIG, ['const DEFAULT_NODE_COLOR="#857F6C";', 'const DEFAULT_NODE_COLOR="#6a9fb5";']),
  K("createNodeIn vuelve a PALETTE[0]", MODEL, ["color:DEFAULT_NODE_COLOR, fill:null", "color:PALETTE[0].c, fill:null"]),
  K("migración accidental: un nodo sin color se lee con el default nuevo", MODEL, ["  if(n.color==null) n.color=PALETTE[0].c;", "  if(n.color==null) n.color=DEFAULT_NODE_COLOR;"]),
  K("migración accidental: #6a9fb5 explícito se repinta", MODEL, ["  if(n.color==null) n.color=PALETTE[0].c;", "  if(n.color==null || n.color===\"#6a9fb5\") n.color=DEFAULT_NODE_COLOR;"]),
  K("«Servicio» cambia de valor en la paleta", CONFIG, ['  {c:"#6a9fb5", n:"Servicio"},', '  {c:"#857F6C", n:"Servicio"},']),
  /* ── MCP: divergencia con el editor */
  M("export_diagram pinta el default nuevo como «Servicio»", SVG, ["  const stroke = escapeXML(n.color);", "  const stroke = escapeXML(n.color === \"#857F6C\" ? \"#6a9fb5\" : n.color);"]),
  M("export_diagram: el texto de un nodo `text` deja de usar su color", SVG, ['  const fill = n.textColor || (n.shape === "text" || n.shape === "anim" ? n.color : T.text);', "  const fill = n.textColor || T.text;"]),
  M("kernel del MCP sin sincronizar (model.js anterior a 018.15)", KSRC, ["color:DEFAULT_NODE_COLOR, fill:null", "color:PALETTE[0].c, fill:null"]),
];

/* ── infraestructura (la de mutate-018-9.ts) */
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-018-15.test.js", "dist-test/test/tools.test.js", "dist-test/test/fluyo-018-9.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut15-"));
let survivors = 0, obsolete = 0;
try {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
  const list = MUTATIONS.filter(m => !only || only.test(m.name));
  const base = layout(join(tmp, "base"));
  const sync = run(base.mc, ["scripts/sync-kernel.ts"], { FLUYO_PATH: base.fl });
  if (sync.code !== 0) { console.error("sync-kernel falló en la copia sin mutar:\n" + sync.out.slice(-1500)); process.exit(2); }
  const build = run(base.mc, TSC);
  if (build.code !== 0) { console.error("tsc falló en la copia sin mutar:\n" + build.out.slice(-1500)); process.exit(2); }
  const sane = run(base.mc, SUITE);
  if (sane.code !== 0) {
    console.error("La copia sin mutar NO pasa la suite:\n" + sane.out.split("\n").filter(l => /^\s*not ok /.test(l)).join("\n"));
    process.exit(2);
  }
  console.log(`copia sin mutar: suite OK (0/${list.length} mutaciones aplicadas)`);
  rmSync(join(tmp, "base"), { recursive: true, force: true });

  list.forEach((m, i) => {
    const { fl, mc } = layout(join(tmp, `m${i}`));
    if (m.side === "kernel" || m.file === KSRC) {
      const s0 = run(mc, ["scripts/sync-kernel.ts"], { FLUYO_PATH: fl });
      if (s0.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — sync-kernel: ${s0.out.slice(-300)}`); obsolete++; return; }
    }
    const missing = patch(join(m.side === "kernel" ? fl : mc, m.file), m.edits);
    if (missing !== null) { console.log(`  ✘ OBSOLETA   ${m.name} — el patrón ya no existe: «${missing}»`); obsolete++; return; }
    if (m.side === "kernel") {
      const s = run(mc, ["scripts/sync-kernel.ts"], { FLUYO_PATH: fl });
      if (s.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — sync-kernel: ${s.out.slice(-300)}`); obsolete++; return; }
    }
    const b = run(mc, TSC);
    if (b.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — la mutación no compila: ${b.out.slice(0, 300)}`); obsolete++; return; }
    const r = run(mc, SUITE);
    const killed = r.code !== 0, n = (r.out.match(/^\s*not ok /gm) ?? []).length;
    console.log(`${killed ? "  ✔ detectada " : "  ✘ SOBREVIVE "} ${m.name}${killed ? `  (${n} tests fallan)` : ""}`);
    if (!killed) survivors++;
    rmSync(join(tmp, `m${i}`), { recursive: true, force: true });
  });
  const bad = survivors + obsolete;
  console.log(bad ? `\nFLUYO-018.15 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.15 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * FLUYO-MCP-CATALOG-COMPACTION-001 — mutaciones adversariales de las definiciones compartidas de tools/list.
 *
 *   node scripts/mutate-mcp-catalog-compaction-001.ts
 *
 * Igual que mutate-mcp-token-efficiency-003.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica cada
 * mutación a src/ y exige que falle test/fluyo-mcp-catalog-compaction-001.test.ts o tools.test.ts. Una que sobrevive es un test débil:
 * código de salida 1.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NL = "\n", CRLF = "\r\n";

type Edit = [from: string, to: string];
interface Mutation { name: string; file: string; edits: Edit[] }
const M = (name: string, file: string, ...edits: Edit[]): Mutation => ({ name, file, edits });

const SERVER = "src/server.ts", AUTH = "src/authoring.ts";
const ID = (id: string): Edit => [`.meta({ id: "${id}" })`, ""];
const WAIT_TAIL = 'en vez de calcular la espera."';
const PUBLISH = "return { ...r, tools: r.tools.map(t => ({ ...t, inputSchema: withoutSafeIntBounds(t.inputSchema) })) };";
const LOOP = "for (const [k, v] of Object.entries(o)) {";

const MUTATIONS: Mutation[] = [
  M("M1 IdOrRef se expande otra vez (35 copias)", AUTH, ID("IdOrRef")),
  M("M2 Wait se expande otra vez", AUTH, ID("Wait")),
  M("M3 Target se expande otra vez", AUTH, ID("Target")),
  M("M4 Presentation se expande otra vez", AUTH, ID("Presentation")),
  M("M5 Endpoint se expande otra vez", AUTH, ID("Endpoint")),
  M("M6 una definición con otro nombre", AUTH, ['.meta({ id: "IdOrRef" })', '.meta({ id: "Id" })']),
  M("M7 SHARED_DEFINITIONS olvida una", AUTH,
    ["export const SHARED_DEFINITIONS = { IdOrRef, Wait, Target, Presentation, Endpoint };", "export const SHARED_DEFINITIONS = { IdOrRef, Wait, Target, Presentation };"]),
  M("M8 el catálogo publicado pierde las definitions", SERVER,
    [PUBLISH, "return { ...r, tools: r.tools.map(t => { const { definitions, ...s } = withoutSafeIntBounds(t.inputSchema) as Record<string, unknown>; return { ...t, inputSchema: s }; }) };"]),
  M("M9 un $ref con hermanos (sin el allOf de draft-07)", SERVER,
    [LOOP, `${LOOP}\n    if (k === "allOf" && Array.isArray(v) && v.length === 1 && (v[0] as { $ref?: string })?.$ref) { out.$ref = (v[0] as { $ref: string }).$ref; continue; }`]),
  M("M10 una definición publicada distinta de la expandida (sin su description)", SERVER,
    [PUBLISH, "return { ...r, tools: r.tools.map(t => { const s = withoutSafeIntBounds(t.inputSchema) as any; if (s.definitions?.Wait) delete s.definitions.Wait.description; return { ...t, inputSchema: s }; }) };"]),
  M("M11 la guarda de 63 000: Wait con 1,4 KB más de texto", AUTH, [WAIT_TAIL, `${WAIT_TAIL} + " ·".repeat(700)`]),
];

function layout(root: string) {
  const mc = join(root, "fluyo-mcp");
  for (const e of ["src", "test", "scripts", "package.json", "tsconfig.json", "tsconfig.test.json", "README.md"]) {
    const from = join(MCP, e);
    if (existsSync(from)) { mkdirSync(dirname(join(mc, e)), { recursive: true }); cpSync(from, join(mc, e), { recursive: true }); }
  }
  symlinkSync(join(MCP, "node_modules"), join(mc, "node_modules"), "junction");
  return mc;
}
function run(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 300_000 });
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-catalog-compaction-001.test.js", "dist-test/test/tools.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-cc001-"));
let survivors = 0, obsolete = 0;
try {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
  const list = MUTATIONS.filter(m => !only || only.test(m.name));
  const base = layout(join(tmp, "base"));
  const build = run(base, TSC);
  if (build.code !== 0) { console.error("tsc falló en la copia sin mutar:\n" + build.out.slice(-1500)); process.exit(2); }
  const sane = run(base, SUITE);
  if (sane.code !== 0) {
    console.error("La copia sin mutar NO pasa la suite:\n" + sane.out.split("\n").filter(l => /^\s*not ok /.test(l)).join("\n"));
    process.exit(2);
  }
  console.log(`copia sin mutar: suite OK (0/${list.length} mutaciones aplicadas)`);
  rmSync(join(tmp, "base"), { recursive: true, force: true });

  list.forEach((m, i) => {
    const mc = layout(join(tmp, `m${i}`));
    const missing = patch(join(mc, m.file), m.edits);
    if (missing !== null) { console.log(`  ✘ OBSOLETA   ${m.name} — el patrón ya no existe: «${missing}»`); obsolete++; return; }
    const b = run(mc, TSC);
    if (b.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — la mutación no compila: ${b.out.slice(0, 300)}`); obsolete++; return; }
    const r = run(mc, SUITE);
    const killed = r.code !== 0, n = (r.out.match(/^\s*not ok /gm) ?? []).length;
    console.log(`${killed ? "  ✔ detectada " : "  ✘ SOBREVIVE "} ${m.name}${killed ? `  (${n} tests fallan)` : ""}`);
    if (!killed) survivors++;
    rmSync(join(tmp, `m${i}`), { recursive: true, force: true });
  });
  const bad = survivors + obsolete;
  console.log(bad ? `\nMCP-CATALOG-COMPACTION-001 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nMCP-CATALOG-COMPACTION-001 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

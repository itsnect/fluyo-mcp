/**
 * FLUYO-MCP-DESCRIPTIONS-001 — mutaciones adversariales de la compactación de descriptions (variante V3R-ops).
 *
 *   node scripts/mutate-mcp-descriptions-001.ts
 *
 * Igual que mutate-mcp-token-efficiency-004.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica cada
 * mutación a src/ y exige que falle test/fluyo-mcp-descriptions-001.test.ts o tools.test.ts. Una que sobrevive es un test débil:
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

const SERVER = "src/server.ts", AUTH = "src/authoring.ts", MODEL = "src/model.ts";
const CLAVE = `      "CLAVE: baseRevision = la revisión de ESTE documento ('revision' de create_* o de describe_document, o el resultRevision de la autoría anterior); si no coincide, REVISION_MISMATCH con la real en 'actual'. " +\n`;
const SENTIDO = '      "SENTIDO: target {edgeId|ref, reverse:true} recorre la conexión de to a from: la respuesta va por la MISMA conexión, no dibujes la inversa. " +\n';
const LAST_RULE = `      "duplicate_node copia también las conexiones ENTRE los elementos; 'ref' nombra la copia. " +\n`;
const FIRST = '      "Aplica un LOTE ATÓMICO (todo o nada) de operaciones sobre una COPIA del documento; el original no cambia. " +\n';
const OPS_STORY = "set_wait, set_step_message, set_arrival_dependencies, set_observed_flow (alcance 'story'); ";
const ANIMS = '"En un SVG estático se ve su fotograma de referencia."';

const MUTATIONS: Mutation[] = [
  M("M1 cambia un default del schema (create_diagram.autoLayout)", MODEL, ["autoLayout: z.boolean().default(true),", "autoLayout: z.boolean().default(false),"]),
  M("M2 cambia una cota del schema (waitsForArrivalOf.max)", AUTH, ["  .array(IdOrRef)\n  .max(1000)\n", "  .array(IdOrRef)\n  .max(999)\n"]),
  M("M3 una propiedad nueva en el schema (create_diagram)", MODEL, ["autoLayout: z.boolean().default(true),", "autoLayout: z.boolean().default(true),\n  verbose: z.boolean().optional(),"]),
  M("M4 baseRevision vuelve al final de la description", SERVER, [CLAVE, ""], [LAST_RULE, LAST_RULE + CLAVE]),
  M("M5 el SENTIDO (reverse) baja al final de las reglas", SERVER, [SENTIDO, ""], [LAST_RULE, LAST_RULE + SENTIDO]),
  M("M6 la lista de operaciones vuelve al principio", SERVER,
    [FIRST, FIRST + '      "Operaciones: create_story, rename_story, duplicate_story, delete_story, add_step, remove_step, move_step, duplicate_step, retarget_step, set_wait, set_step_message, set_arrival_dependencies, set_observed_flow (alcance \'story\'); set_initial_availability, create_node, create_connection, update_node, update_connection, delete_node, delete_connection, reorder_nodes, duplicate_node (alcance \'page\'). " +\n']),
  M("M7 a la lista le falta una operación (set_observed_flow)", SERVER, [OPS_STORY, "set_wait, set_step_message, set_arrival_dependencies (alcance 'story'); "]),
  M("M8 una operación en el grupo de alcance equivocado (set_theme en 'page')", SERVER,
    ["reorder_nodes, duplicate_node (alcance 'page'); create_page, rename_page, delete_page, set_theme (alcance 'document')", "reorder_nodes, duplicate_node, set_theme (alcance 'page'); create_page, rename_page, delete_page (alcance 'document')"]),
  M("M9 desaparece «waitMs 0 = el mismo momento»", SERVER, ["; waitMs 0 = el mismo momento que el anterior.", "."]),
  M("M10 vuelve un id de tarea a una description", AUTH, ['.describe("Tamaño de las puntas: 1 (el de siempre)', '.describe("FLUYO-018.27: tamaño de las puntas: 1 (el de siempre)']),
  M("M11 el catálogo crece (+400 B en list_anims)", SERVER, [ANIMS, `${ANIMS} + " ·".repeat(200)`]),
  M("M12 desaparece el PATRÓN de waitsForArrivalOf", SERVER, ['"PATRÓN: todo paso', '"Patrón omitido. Todo paso']),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-descriptions-001.test.js", "dist-test/test/tools.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-desc001-"));
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
  console.log(bad ? `\nMCP-DESCRIPTIONS-001 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nMCP-DESCRIPTIONS-001 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * SCENARIOS-SEMANTICS-001 FASE 5 (D9) — mutaciones adversariales de la semántica de las conexiones y de la ruta observada en el MCP.
 *
 *   node scripts/mutate-scenarios-semantics-5.ts            (ONLY=<regex> para correr unas pocas)
 *
 * Como mutate-mcp-step-reverse-001.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica cada mutación y
 * exige que falle test/fluyo-scenarios-semantics-5.test.ts. Muta el lado del MCP (zod de kind y set_observed_flow, describe_document,
 * el port de las marcas en svg.ts, las descripciones) y la copia del kernel (src/generated/kernel-sources.ts: la operación y los
 * avisos). Una que sobrevive es un test débil: código de salida 1.
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
interface Mutation { name: string; file: string; edits: Edit[] }
const M = (name: string, file: string, ...edits: Edit[]): Mutation => ({ name, file, edits });

const AUTH = "src/authoring.ts", MODEL = "src/model.ts", STORIES = "src/stories.ts", SVG = "src/svg.ts", SERVER = "src/server.ts", KERNEL = "src/generated/kernel-sources.ts";

const MUTATIONS: Mutation[] = [
  /* ── 1. zod: kind y set_observed_flow */
  M("schema: ConnectionSpec sin kind (vuelve el rechazo)", AUTH, ["    kind: ConnectionKind.optional(),\n", ""]),
  M("schema: kind admite GENERIC", AUTH, ['  .enum(["FLOWS_TO", "REQUIRES"])\n  .nullable()', '  .enum(["FLOWS_TO", "REQUIRES", "GENERIC"])\n  .nullable()']),
  M("schema: kind sin null (no se puede quitar)", AUTH, ['  .enum(["FLOWS_TO", "REQUIRES"])\n  .nullable()', '  .enum(["FLOWS_TO", "REQUIRES"])']),
  M("schema: EdgeSpec de create_diagram vuelve a quitar kind (B3)", MODEL, ['  kind: z.enum(["FLOWS_TO", "REQUIRES"]).nullable().optional().describe(', '  kindX: z.enum(["FLOWS_TO", "REQUIRES"]).nullable().optional().describe(']),
  M("schema: set_observed_flow no existe", AUTH, ['op: z.literal("set_observed_flow"),', 'op: z.literal("set_observed_flow_x"),']),
  M("schema: set_observed_flow sin null (no vuelve a la automática)", AUTH, ["    source: IdOrRef.nullable(),\n    target: IdOrRef.nullable(),", "    source: IdOrRef,\n    target: IdOrRef,"]),
  M("deriva: el evento admite UNKNOWN", AUTH, ['availability: z.enum(["UP", "DOWN"]).optional()', 'availability: z.enum(["UP", "DOWN", "UNKNOWN"]).optional()']),
  M("deriva: set_initial_availability solo UP", AUTH, ['state: z.enum(["UP", "DOWN"]) }),', 'state: z.enum(["UP"]) }),']),
  /* ── 2. describe_document */
  M("describe: sin connectionKind", STORIES, ['          ...(e.kind !== "GENERIC" ? { connectionKind: e.kind } : {}),\n', ""]),
  M("describe: connectionKind con el nombre de target.kind", STORIES, ["? { connectionKind: e.kind } :", "? { kind: e.kind } :"]),
  M("describe: connectionKind también en la genérica", STORIES, ['...(e.kind !== "GENERIC" ? { connectionKind', '...(true ? { connectionKind']),
  M("describe: sin observedFlow", STORIES, ["            ...(sc.observedFlow\n              ? {", "            ...(sc.observedFlow && sc.stepCount < 0\n              ? {"]),
  M("describe: observedFlow con from/to (no source/target)", STORIES, ["{ observedFlow: { source: sc.observedFlow.from, target: sc.observedFlow.to,", "{ observedFlow: { from: sc.observedFlow.from, to: sc.observedFlow.to,"]),
  M("describe: sin warnings", STORIES, ["...(validation.warnings?.length ? { warnings:", "...(validation.warnings?.length && validation.errors.length < 0 ? { warnings:"]),
  M("describe: warnings siempre (también vacío)", STORIES, ["...(validation.warnings?.length ? { warnings: validation.warnings.slice(0, MAX_ERRORS_IN_DESCRIPTION) } : {}),", "warnings: (validation.warnings ?? []).slice(0, MAX_ERRORS_IN_DESCRIPTION),"]),
  M("describe: el modelo no lee kind", STORIES, ["waypoints: (e.waypoints || []).map(w => ({x: w.x, y: w.y})), kind: edgeKind(e)})),", "waypoints: (e.waypoints || []).map(w => ({x: w.x, y: w.y})), kind: \"GENERIC\"})),"]),
  /* ── 3. export_diagram (svg.ts) */
  M("svg: sin marcas", SVG, ["  if (sem) parts.push(...semanticMarksToSVG(sem, lineCol, escapeXML(bg)));\n", ""]),
  M("svg: sin N3 (dos anillos en el Requisito con la piel)", SVG, ["if (skinBg !== null && !e.startArrow && !(sem && sem.ring)) {", "if (skinBg !== null && !e.startArrow) {"]),
  M("svg: el anillo ignora el fondo propio del documento", SVG, ["skinBg, customBg || THEMES[theme].bg));", "skinBg, THEMES[theme].bg));"]),
  M("svg: cuñas de otro tamaño (deriva del port)", SVG, ["SEM_CHEVRON = 4.2,", "SEM_CHEVRON = 4,"]),
  M("svg: anillo a 12 px (deriva del port)", SVG, ["SEM_RING_OFFSET = 10;", "SEM_RING_OFFSET = 12;"]),
  M("svg: el Flujo corto también lleva cuñas", SVG, ["if (best < SEM_CHEVRON_MIN_SEG || !a || !b) return { kind, chevrons: [] };", "if (!a || !b) return { kind, chevrons: [] };"]),
  M("svg: un kind desconocido se lee como Flujo", SVG, ['return k === "FLOWS_TO" || k === "REQUIRES" ? k : EDGE_KIND_GENERIC;', 'return k === "REQUIRES" ? k : k === undefined || k === "GENERIC" ? EDGE_KIND_GENERIC : "FLOWS_TO";']),
  M("svg: las marcas con el discontinuo del usuario", SVG, ['const st = `stroke="${lineCol}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;', 'const st = `stroke="${lineCol}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 7"`;']),
  /* ── 4. copia del kernel (una sincronización que perdiera la operación o los avisos) */
  M("kernel: set_observed_flow guarda los extremos al revés", KERNEL, ["flow = {from:source, to:target};", "flow = {from:target, to:source};"]),
  M("kernel: set_observed_flow fuera de OPERATION_SCOPE", KERNEL, [String.raw`set_arrival_dependencies:\"story\", set_observed_flow:\"story\",`, String.raw`set_arrival_dependencies:\"story\",`]),
  M("kernel: validateProject sin avisos", KERNEL, ["if(warnings.length) out.warnings = warnings;", ""]),
  M("kernel: GENERIC también avisa (W3)", KERNEL, ["&& e.kind!==EDGE_KIND_GENERIC)", ")"]),
  /* ── 5. lo que lee el agente */
  M("server: author_document no anuncia set_observed_flow", SERVER, ["set_arrival_dependencies, set_observed_flow (alcance 'story')", "set_arrival_dependencies (alcance 'story')"]),
  M("server: describe_document no anuncia connectionKind", SERVER, ['"Si los hay: connectionKind, observedFlow y warnings. "', '"Si los hay: observedFlow y warnings. "']),
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
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 300_000, env: { ...process.env, FLUYO_PATH: FLUYO } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function patch(path: string, edits: Edit[]): string | null {
  const raw = readFileSync(path, "utf8"), crlf = raw.includes(CRLF);
  let text = raw.replaceAll(CRLF, NL);
  for (const [from, to] of edits) {
    const at = text.indexOf(from);
    if (at < 0) return from.slice(0, 70);
    if (text.indexOf(from, at + 1) >= 0) return `(no es único) ${from.slice(0, 60)}`;
    text = text.replace(from, () => to);
  }
  writeFileSync(path, crlf ? text.replaceAll(NL, CRLF) : text);
  return null;
}
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-scenarios-semantics-5.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-ss5-"));
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
  console.log(bad ? `\nSCENARIOS-SEMANTICS-001 FASE 5 (MCP) mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nSCENARIOS-SEMANTICS-001 FASE 5 (MCP) mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

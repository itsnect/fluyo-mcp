/**
 * FLUYO-MCP-STEP-REVERSE-001 — mutaciones adversariales del soporte `reverse` en el MCP.
 *
 *   node scripts/mutate-mcp-step-reverse-001.ts            (ONLY=<regex> para correr unas pocas)
 *
 * Igual que mutate-mcp-token-efficiency-002.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica
 * cada mutación y exige que falle test/fluyo-mcp-step-reverse-001.test.ts. Muta el lado del MCP (schema de target, proyección
 * de describe_document/run_story, descripciones y README) y también la copia del kernel (src/generated/kernel-sources.ts): si
 * una rama crítica del contrato se perdiera en una sincronización, el test del MCP tiene que caer. Una que sobrevive es un test
 * débil: código de salida 1.
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

const AUTH = "src/authoring.ts", STORIES = "src/stories.ts", SERVER = "src/server.ts", KERNEL = "src/generated/kernel-sources.ts", README = "README.md";

const MUTATIONS: Mutation[] = [
  /* ── 1. Schema de target */
  M("schema: {edgeId} sin reverse", AUTH, ["z.strictObject({ edgeId: IdOrRef, reverse: Reverse }),", "z.strictObject({ edgeId: IdOrRef }),"]),
  M("schema: {ref} sin reverse", AUTH, ["z.strictObject({ ref: Ref.shape.ref, reverse: Reverse }),", "Ref,"]),
  M("schema: {from,to} acepta reverse", AUTH, ["z.strictObject({ from: IdOrRef, to: IdOrRef }),", "z.strictObject({ from: IdOrRef, to: IdOrRef, reverse: Reverse }),"]),
  M("schema: {nodeId} acepta reverse", AUTH, ["z.strictObject({ nodeId: IdOrRef }),", "z.strictObject({ nodeId: IdOrRef, reverse: Reverse }),"]),
  M("schema: reverse no booleano aceptado", AUTH, ["const Reverse = z.boolean().optional();", "const Reverse = z.union([z.boolean(), z.string(), z.number(), z.null()]).optional();"]),
  M("schema: reverse obligatorio", AUTH, ["const Reverse = z.boolean().optional();", "const Reverse = z.boolean();"]),
  M("schema: la descripción de target no cuenta el sentido", AUTH, ['"reverse:true (solo conexión) la recorre de to a from.', '"']),
  /* ── 2. describe_document */
  M("describe: el paso pierde reverse", STORIES, ["reverse: s.reverse === true || undefined, ends:", "reverse: undefined, ends:"]),
  M("describe/run: extremos sin el sentido (label de la conexión)", STORIES, ["return e ? traversalEnds(e, s.reverse) : undefined;", "return e ? traversalEnds(e, undefined) : undefined;"]),
  M("target: reverse:false en todos los SEND (documentos antiguos cambian)", STORIES, ["...(s.reverse ? { reverse: true as const } : {}),", "reverse: s.reverse === true,"]),
  M("target: label con from/to de la conexión", STORIES, ["label: e && s.ends ? `${label.get(s.ends.source) ?? \"?\"} → ${label.get(s.ends.target) ?? \"?\"}` : \"?\",", "label: e ? `${label.get(e.from) ?? \"?\"} → ${label.get(e.to) ?? \"?\"}` : \"?\","]),
  M("target: reverse va detrás de label", STORIES, ["      ...(s.reverse ? { reverse: true as const } : {}),\n      label:", "      label:"], [" : \"?\",\n    };\n  }\n  return { kind: \"element\"", " : \"?\",\n      ...(s.reverse ? { reverse: true as const } : {}),\n    };\n  }\n  return { kind: \"element\""]),
  /* ── 3. run_story */
  M("run_story: el target pierde reverse", STORIES, ["target: stepTarget({ edgeId, nodeId, reverse, ends: ends.get(stepId) }, edge, label),", "target: stepTarget({ edgeId, nodeId, ends: ends.get(stepId) }, edge, label),"]),
  M("run_story: sin extremos del recorrido", STORIES, ["target: stepTarget({ edgeId, nodeId, reverse, ends: ends.get(stepId) }, edge, label),", "target: stepTarget({ edgeId, nodeId, reverse, ends: undefined }, edge, label),"]),
  /* ── 4. Descripciones publicadas y README */
  M("author_document no publica el SENTIDO", SERVER, ['      "SENTIDO: target {edgeId|ref, reverse:true} recorre la conexión de to a from: la respuesta va por la MISMA conexión, no dibujes la inversa. " +\n', ""]),
  M("describe_document no publica target.reverse", SERVER, ['      "Un paso con target.reverse:true recorre su conexión de to a from (label y frase en ese sentido). " +\n', ""]),
  M("run_story no publica target.reverse", SERVER, ['      "Un paso con target.reverse:true recorre su conexión de to a from (frase, reasonNode y Trace). " +\n', ""]),
  M("README: el paso 3 guardado sin reverse", README, ['{"id":3,"at":1000,"action":"SEND","edgeId":5,"eventTypeId":2,"reverse":true}', '{"id":3,"at":1000,"action":"SEND","edgeId":5,"eventTypeId":2}']),
  M("README: motivo del ejemplo con la regla vieja (target_down)", README, ['"outcome":{"status":"not_completed","reason":"source_down","reasonNode":{"id":3,"label":"DB"}}}', '"outcome":{"status":"not_completed","reason":"target_down","reasonNode":{"id":3,"label":"DB"}}}']),
  M("README: label del ejemplo en el sentido de la conexión", README, ['"reverse":true,"label":"DB → API"}', '"reverse":true,"label":"API → DB"}']),
  M("README: dice que reverse:false se guarda", README, ["`reverse:false` es el sentido normal y **no se guarda**", "`reverse:false` es el sentido normal y se guarda"]),
  /* ── 5. Copia del kernel (lo que traería una sincronización mala) */
  M("kernel: {from,to} sin la inversa", KERNEL, ["if(back.length) return {id:back[0].id, reverse:true};", "if(false) return {id:back[0].id, reverse:true};"]),
  M("kernel: la inversa gana a la directa", KERNEL, ["const hits = pg.edges.filter(e=>e.from===from && e.to===to);", "const hits = pg.edges.some(e=>e.from===to && e.to===from) ? [] : pg.edges.filter(e=>e.from===from && e.to===to);"]),
  M("kernel: {edgeId, reverse} ignora reverse", KERNEL, ["return {id:edgeId, reverse:reverse===true};", "return {id:edgeId, reverse:false};"]),
  M("kernel: {ref, reverse} ignora reverse", KERNEL, ["return {id, reverse:reverse===true};", "return {id, reverse:false};"]),
  M("kernel: el motor no intercambia los extremos", KERNEL, ["const sourceState = states.get(reverse ? edge.to : edge.from);", "const sourceState = states.get(edge.from);"], ["const targetState = states.get(reverse ? edge.from : edge.to);", "const targetState = states.get(edge.to);"]),
  M("kernel: Trace sin la marca reverse", KERNEL, ["const dir = reverse ? {reverse:true} : {};", "const dir = {};"]),
  M("kernel: la carga no quita reverse:false", KERNEL, ["step.reverse===false) delete step.reverse;", "step.reverse===false) void 0;"]),
  M("kernel: outcomes pierde reverse", KERNEL, ["if(step.reverse===true) out.reverse = true;", "void 0;"]),
  M("kernel: reasonNodeId de la conexión, no del recorrido", KERNEL, ["const t = traversalEnds(e, end.reverse);", "const t = traversalEnds(e, undefined);"]),
  M("kernel: la frase ignora el sentido", KERNEL, ["t = traversalEnds(e, step.reverse);", "t = traversalEnds(e, undefined);"]),
  M("kernel: retargetStep no fija el sentido", KERNEL, ["if(reverse===true) step.reverse=true; else delete step.reverse;", "delete step.reverse;"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-step-reverse-001.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-rev001-"));
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
  console.log(bad ? `\nMCP-STEP-REVERSE-001 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nMCP-STEP-REVERSE-001 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

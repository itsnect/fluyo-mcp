/**
 * FLUYO-MCP-STEP-MESSAGE-001 — mutaciones adversariales del soporte `message` en el MCP.
 *
 *   node scripts/mutate-mcp-step-message-001.ts            (ONLY=<regex> para correr unas pocas)
 *
 * Igual que mutate-mcp-step-reverse-001.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica cada
 * mutación y exige que falle test/fluyo-mcp-step-message-001.test.ts. Muta el lado del MCP (schema V10, descriptions, proyección
 * de describe_document/run_story) y también la copia del kernel (src/generated/kernel-sources.ts, con las comillas escapadas): si
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

const AUTH = "src/authoring.ts", STORIES = "src/stories.ts", SERVER = "src/server.ts", KERNEL = "src/generated/kernel-sources.ts";
/* PRODUCT-NARRATION-001 (fluyo, decisión 258): message vale también en FLOW; las mutaciones que vigilaban el veto vigilan ahora que no vuelva. */
const ADD_MESSAGE = '    message: StepMessage.describe("Frase de ESTE paso (cualquier evento, también FLOW): al reproducir es el título de su momento y, en un elemento, su globo. El evento y su frase no cambian. No cambia tiempos ni Trace.").optional(),\n';
const SET_OP = '  z.strictObject({ op: z.literal("set_step_message"), scope: story, ...stepRef, message: StepMessage.nullable().describe("null lo quita.") }),\n';

const MUTATIONS: Mutation[] = [
  /* ── 1. Schema publicado (V10) */
  M("schema: add_step sin message (message perdido)", AUTH, [ADD_MESSAGE, ""]),
  M("schema: message sin tope de 120", AUTH, ["const StepMessage = z.string().min(1).max(120);", "const StepMessage = z.string().min(1);"]),
  M("schema: message admite \"\"", AUTH, ["const StepMessage = z.string().min(1).max(120);", "const StepMessage = z.string().max(120);"]),
  M("schema: set_step_message sin null", AUTH, ["message: StepMessage.nullable().describe(\"null lo quita.\")", "message: StepMessage.describe(\"null lo quita.\")"]),
  M("schema: set_step_message no existe", AUTH, [SET_OP, ""]),
  M("schema: set_step_message sin $ref (stepRef expandido)", AUTH, ["scope: story, ...stepRef, message: StepMessage.nullable()", "scope: story, pageIndex: PageIndex, storyId: z.union([Id, Ref]), stepId: z.union([Id, Ref]), message: StepMessage.nullable()"]),
  M("schema: la description de message no dice «también FLOW»", AUTH, ["(cualquier evento, también FLOW)", "(cualquier evento)"]),
  /* ── 2. Descriptions de las tools */
  M("author_document: set_step_message fuera de la lista", SERVER, ["set_wait, set_step_message, set_arrival_dependencies", "set_wait, set_arrival_dependencies"]),
  M("describe_document no dice que da message", SERVER, ["objetivo, frase y message (la frase propia del paso, si la tiene),", "objetivo y frase,"]),
  M("run_story no dice que da message", SERVER, ["la frase de cada paso (y su message si lo tiene).", "la frase de cada paso."]),
  /* ── 3. describe_document */
  M("describe: el modelo pierde message", STORIES, ["sentence: FluyoStory.sentence(pg, s, eventTypeById(s.eventTypeId)), message: s.message}))}))", "sentence: FluyoStory.sentence(pg, s, eventTypeById(s.eventTypeId))}))}))"]),
  M("describe: message siempre (null en los documentos antiguos)", STORIES, ["                        ...(s.message !== undefined ? { message: s.message } : {}),", "                        message: s.message ?? null,"]),
  M("describe: message delante de sentence", STORIES, ["                        sentence: s.sentence,\n                        // FLUYO-MCP-STEP-MESSAGE-001 / PRODUCT-NARRATION-001: la frase propia del paso (de cualquier evento), solo si la tiene.\n                        ...(s.message !== undefined ? { message: s.message } : {}),", "                        ...(s.message !== undefined ? { message: s.message } : {}),\n                        sentence: s.sentence,"]),
  /* ── 4. run_story */
  M("run_story: el modelo pierde message", STORIES, ["message: s.message, ends: sendEnds(pg, s)})),", "ends: sendEnds(pg, s)})),"]),
  M("run_story: message siempre (null en los pasos sin él)", STORIES, ["      ...(message.get(stepId) !== undefined ? { message: message.get(stepId) } : {}),", "      message: message.get(stepId) ?? null,"]),
  M("run_story: message = la frase", STORIES, ["const message = new Map(model.ordered.map(s => [s.id, s.message]));", "const message = new Map(model.ordered.map(s => [s.id, s.sentence]));"]),
  /* ── 5. Copia del kernel (lo que traería una sincronización mala) */
  M("kernel: message rechazado en un SEND (vuelve el veto)", KERNEL, [String.raw`if(!stepMessageValid(step.message)) throw projectDataError();`, String.raw`if(step.action===\"SEND\" || !stepMessageValid(step.message)) throw projectDataError();`]),
  M("kernel: \"\" y solo espacios son un mensaje", KERNEL, [String.raw`typeof v===\"string\" && v.trim().length>0 &&`, String.raw`typeof v===\"string\" &&`]),
  M("kernel: sin tope de 120", KERNEL, ["&& v.length<=STEP_MESSAGE_MAX_LEN; }", "; }"]),
  M("kernel: el motor no filtra message (documento no ejecutable)", KERNEL, [String.raw` && k!==\"message\");`, ");"]),
  M("kernel: add_step ignora message", KERNEL, ["const message = op.message===undefined ? undefined : messageOf(op.message);", "const message = undefined;"]),
  M("kernel: add_step rechaza message en FLOW (vuelve el veto)", KERNEL, ["const message = op.message===undefined ? undefined : messageOf(op.message);", String.raw`if(spec.action===\"SEND\" && op.message!==undefined) throw reject(\"INVALID_OPERATION\", \"x\", {field:\"message\"}); const message = op.message===undefined ? undefined : messageOf(op.message);`]),
  M("kernel: set_step_message(null) no quita", KERNEL, ["if(message===null) delete step.message;", "if(message===null) void 0;"]),
  M("kernel: set_step_message rechaza un SEND (vuelve el veto)", KERNEL, ["const to = op.message===null ? null : messageOf(op.message);", String.raw`if(st.action===\"SEND\") throw reject(\"INVALID_OPERATION\", \"x\", {field:\"message\"}); const to = op.message===null ? null : messageOf(op.message);`]),
  M("kernel: set_step_message changed siempre true", KERNEL, ["changed:from!==to", "changed:true"]),
  M("kernel: duplicateStep pierde message", KERNEL, ["const copy=createStep(sc,{...rest});", "const {message:_m,...noMsg}=rest; const copy=createStep(sc,{...noMsg});"]),
  M("kernel: retargetStep borra message", KERNEL, [String.raw`    step.nodeId=targetId;\n  }`, String.raw`    step.nodeId=targetId;\n    delete step.message;\n  }`]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-step-message-001.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-msg001-"));
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
  console.log(bad ? `\nMCP-STEP-MESSAGE-001 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nMCP-STEP-MESSAGE-001 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

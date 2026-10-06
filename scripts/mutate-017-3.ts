/**
 * FLUYO-017.3 — batería de mutaciones adversariales del lado MCP (EventTypes + authoring).
 *
 *   node scripts/mutate-017-3.ts
 *
 * Trabaja SIEMPRE sobre copias en un directorio temporal (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`); nunca toca el árbol.
 * Dos clases de mutación:
 *   · «kernel»: se cambia un archivo de fluyo/js de la copia y se regenera el kernel de la copia de MCP con el
 *     `sync-kernel` real (así se prueba exactamente lo que ejecuta MCP, no una edición a mano del archivo generado);
 *   · «mcp»: se cambia un archivo de src/ de MCP.
 * Cada mutación debe hacer fallar la suite de 017.x (npm run build:test + node --test dist-test/test/fluyo-017-*.test.js).
 * Una mutación que sobrevive es un test débil o una regla sin cubrir: la batería termina con código 1.
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

const AUTH = "js/story-authoring.js", MODEL = "js/model.js";
const MUTATIONS: Mutation[] = [
  /* ── eliminar las validaciones del editor */
  K("eliminar la validación EVENT_TYPE_LOCKED (el rechazo pierde su código)", AUTH,
    ["throw blockedByUse(ctx, et, candidate, \"EVENT_TYPE_LOCKED\", e.field);", "throw e;"]),
  K("eliminar la validación REFERENCED_ENTITY (borrar un usado cae a un error genérico)", AUTH,
    ["if(FluyoIntegrity.eventTypeImpact(snapshotOf(ctx), et.id, null).wouldInvalidate) throw blockedByUse(ctx, et, null, \"REFERENCED_ENTITY\");", ""],
    ["catch(e){ if(e && e.code===\"event_type_in_use\") throw blockedByUse(ctx, et, null, \"REFERENCED_ENTITY\"); throw e; }", "catch(e){ throw e; }"]),
  K("permitir cambiar la primitiva de un EventType usado", MODEL,
    ["changes.primitive!==et.primitive && used)", "changes.primitive!==et.primitive && false)"]),
  K("permitir cambiar la disponibilidad de un EventType usado", MODEL,
    ["et.primitive===\"SET_AVAILABILITY\" && changes.availability!==et.availability && used)", "et.primitive===\"SET_AVAILABILITY\" && changes.availability!==et.availability && false)"]),
  /* Quitar SÓLO la comprobación del dominio no es observable por MCP (FluyoIntegrity.eventTypeImpact sigue rechazando): esa capa la cubre
     la mutación D5 de fluyo/test/fluyo-017-3-mutations.cjs. Aquí se quitan las tres capas a la vez. */
  K("permitir borrar un EventType usado: ni impacto ni dominio ni validación final", AUTH,
    ["if(FluyoIntegrity.eventTypeImpact(snapshotOf(ctx), et.id, null).wouldInvalidate) throw blockedByUse(ctx, et, null, \"REFERENCED_ENTITY\");", ""],
    ["catch(e){ if(e && e.code===\"event_type_in_use\") throw blockedByUse(ctx, et, null, \"REFERENCED_ENTITY\"); throw e; }", "catch(e){ if(e && e.code===\"event_type_in_use\"){ d_force(ctx, et.id); } else throw e; }"],
    ["  function apply(project, operations){", "  function d_force(ctx, id){ ctx.d.eventTypes = ctx.d.eventTypes.filter(e=>e.id!==id); }\n  function apply(project, operations){"],
    ["    if(regress.length) return failure(explainRemovals(ctx, regress, d));", ""],
    ["    if(bad.length) return failure(bad);", ""]),
  K("aceptar una referencia {ref} inexistente", AUTH,
    ["if(!r) throw reject(\"UNKNOWN_REF\"", "if(!r) return {id:v.ref}; if(!r) throw reject(\"UNKNOWN_REF\""]),
  K("aceptar un eventTypeId inexistente (el paso apunta a un evento que no existe)", AUTH,
    ["if(!et) throw reject(\"EVENT_TYPE_NOT_FOUND\", `No existe el evento (EventType) eventTypeId=${id}.", "if(!et) return {id, name:\"?\", primitive:\"OCCURRENCE\", sentenceTemplate:\"\", visual:{kind:\"token\",value:\"\"}}; if(!et) throw reject(\"EVENT_TYPE_NOT_FOUND\", `No existe el evento (EventType) eventTypeId=${id}."]),
  K("saltarse la validación final del estado (integridad y ejecutabilidad)", AUTH,
    ["    if(regress.length) return failure(explainRemovals(ctx, regress, d));", ""],
    ["    if(bad.length) return failure(bad);", ""]),
  K("un error a mitad del lote devuelve el documento a medias (no atómico)", AUTH,
    ["if(e && e.authoring) return failure([Object.assign({code:e.code, message:e.message, operationIndex:i, operation:isRecord(op)?op.op:undefined}, e.extra)]);",
     "if(e && e.authoring) return {ok:true, project:projectToSerializable(d, norm.settings), changes, touched:[...ctx.touched.values()], validation:{valid:true, preexistingErrors:0}};"]),
  K("update_event_type parcialmente aplicable (aplica el nombre antes de validar el resto)", AUTH,
    ["      const before = clone(et);\n      const primitive = op.primitive===undefined ? et.primitive : primitiveOf(op.primitive);",
     "      const before = clone(et);\n      if(op.name!==undefined) et.name = op.name;\n      const primitive = op.primitive===undefined ? et.primitive : primitiveOf(op.primitive);"],
    ["    for(let i=0; i<operations.length; i++){", "    const keep = ctx; for(let i=0; i<operations.length; i++){"],
    ["if(e && e.authoring) return failure(", "if(e && e.authoring && e.code===\"EVENT_TYPE_LOCKED\") return {ok:true, project:projectToSerializable(d, norm.settings), changes, touched:[...ctx.touched.values()], validation:{valid:true, preexistingErrors:0}}; if(e && e.authoring) return failure("]),
  K("add_step puede escribir action, state o at (campos admitidos y honrados)", AUTH,
    ["add_step:[\"storyId\",\"eventTypeId\",\"target\",\"waitMs\",\"placement\",\"ref\"]", "add_step:[\"storyId\",\"eventTypeId\",\"target\",\"waitMs\",\"placement\",\"ref\",\"action\",\"state\",\"at\"]"],
    ["step = createStep(sc, stepDefinitionForEvent(et, targetId, defaultStepTime(sc, wait)));", "step = createStep(sc, Object.assign(stepDefinitionForEvent(et, targetId, defaultStepTime(sc, wait)), op.at!==undefined ? {at:op.at} : {}, op.action!==undefined ? {action:op.action} : {}, op.state!==undefined ? {state:op.state} : {}));"]),
  K("la acción del Step ya no se deriva del EventType (siempre SEND)", MODEL,
    ["const def={at, eventTypeId:et.id, action:spec.action};\n  if(spec.action===\"SEND\") def.edgeId=target; else def.nodeId=target;", "const def={at, eventTypeId:et.id, action:\"SEND\"};\n  if(spec.action===\"SEND\") def.edgeId=target; else def.nodeId=target;"]),
  K("la acción SET_STATE ya no toma el estado del EventType", MODEL,
    ["if(action===\"SET_STATE\") spec.state=et.availability;", "if(action===\"SET_STATE\") spec.state=\"UP\";"]),
  K("un EventType nuevo sin símbolo ya no usa el defecto del modal", MODEL,
    ["const DEFAULT_EVENT_SYMBOL=\"●\";", "const DEFAULT_EVENT_SYMBOL=\"o\";"]),
  K("el paso añadido al final no avanza el tiempo (la espera por defecto desaparece)", MODEL,
    ["return sc && sc.steps.length ? Math.max(...sc.steps.map(s=>s.at))+delay : 0;", "return sc && sc.steps.length ? Math.max(...sc.steps.map(s=>s.at)) : 0;"]),
  K("el rechazo no identifica los Steps afectados (affectedSteps vacío)", AUTH,
    ["return {affectedStories:stories, affectedSteps:steps};", "return {affectedStories:stories, affectedSteps:[]};"]),
  K("el rechazo no identifica las Historias afectadas (ni por integridad ni por el respaldo del dominio)", AUTH,
    ["}, field ? {field} : {}, uses));", "}, field ? {field} : {}, {affectedSteps:uses.affectedSteps}));"]),
  K("el rechazo REFERENCED_ENTITY no nombra el EventType", AUTH,
    ["Object.assign({entity:{kind:\"eventType\", id:et.id, name:et.name}, integrityCodes", "Object.assign({entity:undefined, integrityCodes"]),

  /* ── MCP: concurrencia, copia, respuesta, describe */
  M("saltarse baseRevision", "src/authoring.ts",
    ["if (actual !== input.baseRevision) {", "if (false) {"]),
  M("REVISION_MISMATCH sin la revisión real (actualRevision)", "src/authoring.ts",
    ["    ...(actualRevision ? { actualRevision } : {}),\n", ""]),
  M("un rechazo devuelve el documento original", "src/authoring.ts",
    ["    errors,\n    note:", "    document: input.document,\n    errors,\n    note:"]),
  M("modificar el documento original en vez de la copia (dryRun escribe en la entrada)", "src/authoring.ts",
    ["  const resultRevision = revisionOfProject(result.project);", "  if (input.dryRun) Object.assign(input.document as object, result.project as object);\n  const resultRevision = revisionOfProject(result.project);"]),
  M("dryRun devuelve el documento", "src/authoring.ts",
    ["...(input.dryRun ? {} : { document: result.project }),", "document: result.project,"]),
  M("el resultado no valida: se devuelve el proyecto sin pasar por la revisión (resultRevision de la base)", "src/authoring.ts",
    ["const resultRevision = revisionOfProject(result.project);", "const resultRevision = input.baseRevision;"]),
  M("describe: ignora el filtro pageIndex en usedIn", "src/stories.ts",
    ["u.pageIndex === input.pageIndex)", "true)"]),
  M("describe: no trunca etiquetas largas", "src/stories.ts",
    ["return s.length > MAX_LABEL ?", "return false ?"]),
  M("describe: usedBy deja de contar", "src/stories.ts",
    ["usedBy: et.usedBy,", "usedBy: 0,"]),
  M("describe: usedIn omite los pasos", "src/stories.ts",
    ["stepIds: u.stepIds.slice(0, MAX_USAGE_STEPS),", "stepIds: [],"]),
  M("estado compartido entre llamadas: un único contexto del kernel", "src/kernel.ts",
    ["export function createKernel(): Kernel {\n  const context = vm.createContext({});\n  installWebGlobals(context);\n  for (const file of KERNEL_FILES) {\n    vm.runInContext(file.source, context, { filename: `kernel/${file.name}`, timeout: EVAL_TIMEOUT_MS });\n  }",
     "let SHARED: ReturnType<typeof vm.createContext> | undefined;\nexport function createKernel(): Kernel {\n  const fresh = !SHARED;\n  const context = (SHARED ??= vm.createContext({}));\n  if (fresh) installWebGlobals(context);\n  if (fresh) for (const file of KERNEL_FILES) {\n    vm.runInContext(file.source, context, { filename: `kernel/${file.name}`, timeout: EVAL_TIMEOUT_MS });\n  }"]),
  M("el schema de MCP admite un campo extra (force) en delete_event_type", "src/authoring.ts",
    ["z.strictObject({ op: z.literal(\"delete_event_type\"), scope: eventType, eventTypeId: IdOrRef }),", "z.strictObject({ op: z.literal(\"delete_event_type\"), scope: eventType, eventTypeId: IdOrRef, force: z.boolean().optional() }),"]),
];

/* ── infraestructura */
function copyInto(src: string, dest: string, entries: string[]) {
  for (const e of entries) {
    const from = join(src, e);
    if (existsSync(from)) { mkdirSync(dirname(join(dest, e)), { recursive: true }); cpSync(from, join(dest, e), { recursive: true }); }
  }
}
function layout(root: string) {
  const fl = join(root, "fluyo"), mc = join(root, "fluyo-mcp");
  copyInto(FLUYO, fl, ["js", "test/fixtures"]);
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-017-1.test.js", "dist-test/test/fluyo-017-1-qa.test.js", "dist-test/test/fluyo-017-2.test.js", "dist-test/test/fluyo-017-3.test.js", "dist-test/test/fluyo-017-3-qa.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-"));
let survivors = 0, obsolete = 0;
try {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
  const list = MUTATIONS.filter(m => !only || only.test(m.name));
  // Control: sin mutar, la copia pasa (y el kernel regenerado es el del repo).
  const base = layout(join(tmp, "base"));
  const sync = run(base.mc, ["scripts/sync-kernel.ts"], { FLUYO_PATH: base.fl });
  if (sync.code !== 0) { console.error("sync-kernel falló en la copia sin mutar:\n" + sync.out.slice(-1500)); process.exit(2); }
  const build = run(base.mc, TSC);
  if (build.code !== 0) { console.error("tsc falló en la copia sin mutar:\n" + build.out.slice(-1500)); process.exit(2); }
  const sane = run(base.mc, SUITE);
  if (sane.code !== 0) {
    if (process.env.MUT_LOG) writeFileSync(process.env.MUT_LOG, sane.out);
    console.error("La copia sin mutar NO pasa la suite:\n" + sane.out.split("\n").filter(l => /^\s*not ok /.test(l)).join("\n"));
    process.exit(2);
  }
  console.log(`copia sin mutar: suite OK (0/${list.length} mutaciones aplicadas)`);
  rmSync(join(tmp, "base"), { recursive: true, force: true });

  list.forEach((m, i) => {
    const { fl, mc } = layout(join(tmp, `m${i}`));
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
  console.log(bad ? `\nFLUYO-017.3 mutaciones MCP: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-017.3 mutaciones MCP: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

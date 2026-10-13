/**
 * FLUYO-018.22 — mutaciones adversariales de las dependencias de llegada en el MCP.
 *
 *   node scripts/mutate-018-22.ts            (ONLY=<regex> para una sola)
 *
 * Igual que mutate-018-9.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia —story-authoring.js o la regla de model.js— y se regenera el kernel de la copia con el sync-kernel
 * real; el test de paridad lee la MISMA copia de fluyo/js) y «mcp» (se cambia src/ de MCP). Cada mutación debe hacer fallar
 * test/fluyo-018-22.test.ts o fluyo-017-2.test.ts. Una que sobrevive es un test débil: código de salida 1.
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

const MODEL = "js/model.js", AUTH = "js/story-authoring.js", STORIES = "src/stories.ts", AUTHTS = "src/authoring.ts";
const ADD_DEPS = "      if(waits.length) setArrivalDependencies(sc, withArrivalWaits(sc, step.id, waits));";
const SET_DEPS = "      setArrivalDependencies(sc, withArrivalWaits(sc, st.id, ids));";

const MUTATIONS: Mutation[] = [
  /* ── las 10 pedidas */
  K("add_step ignora waitsForArrivalOf", AUTH, [ADD_DEPS, ""]),
  K("add_step guarda la dependencia dentro del Step", AUTH, [ADD_DEPS, "      if(waits.length) Object.assign(step, {waitsForArrivalOf:waits});"]),
  K("acepta un SEND inexistente", AUTH, ['reason = !send ? "send_missing" :', 'reason = !send ? null :']),
  K("acepta un objetivo que no es SEND", AUTH, ['send.action!=="SEND" ? "not_send" :', 'send.action!=="SEND" ? null :']),
  K("acepta un objetivo futuro", AUTH, ['arrivalReaches(sc, sendId, step.id) ? "cycle" : "not_earlier";', 'arrivalReaches(sc, sendId, step.id) ? "cycle" : null;']),
  K("remove_step deja referencias huérfanas", AUTH, ["      setArrivalDependencies(sc, pruneArrivalDependencies(sc));\n", ""]),
  K("duplicate_story desplaza los ids de las dependencias de la copia", AUTH,
    ["      if(op.name!==undefined) copy.name = nameOf(op.name);", "      if(op.name!==undefined) copy.name = nameOf(op.name);\n      if(copy.arrivalDependencies) copy.arrivalDependencies = copy.arrivalDependencies.map(d=>({stepId:d.stepId, waitsForArrivalOf:d.waitsForArrivalOf.map(x=>x+1)}));"]),
  K("duplicate_step redirige al duplicado las dependencias que esperaban al original", AUTH,
    ["      setArrivalDependencies(sc, copyArrivalWaits(sc, st.id, copy.id));", "      if(sc.arrivalDependencies) setArrivalDependencies(sc, sc.arrivalDependencies.map(d=>({stepId:d.stepId, waitsForArrivalOf:d.waitsForArrivalOf.map(x=>x===st.id ? copy.id : x)})));"]),
  K("set_arrival_dependencies añade en vez de reemplazar", AUTH, [SET_DEPS, "      setArrivalDependencies(sc, withArrivalWaits(sc, st.id, from.concat(ids)));"]),
  K("limpiar ([]) no elimina la relación", AUTH, [SET_DEPS, "      if(ids.length) setArrivalDependencies(sc, withArrivalWaits(sc, st.id, ids));"]),
  /* ── validación restante */
  K("acepta depender de sí mismo (sin razón propia)", AUTH, ['      else if(sendId===step.id) reason = "self";\n', ""]),
  K("no explica el ciclo", AUTH, ['arrivalReaches(sc, sendId, step.id) ? "cycle" : "not_earlier";', '"not_earlier";']),
  K("acepta un {ref} de un paso de OTRA Historia", AUTH, ['      if(r.storyId!==undefined && (r.storyId!==sc.id || r.pageIndex!==op.pageIndex)) reason = "other_story";\n      else if', "      if"]),
  K("add_step con [] crea una entrada vacía", AUTH, [ADD_DEPS, "      if(op.waitsForArrivalOf!==undefined) sc.arrivalDependencies = (sc.arrivalDependencies || []).concat([{stepId:step.id, waitsForArrivalOf:waits}]);"]),
  /* ── la regla compartida (model.js: editor y MCP) */
  K("regla: admite un envío del MISMO momento", MODEL, ['storyboardOrderedSteps(steps).filter(s=>s.action==="SEND" && s.at<step.at)', 'storyboardOrderedSteps(steps).filter(s=>s.action==="SEND" && s.at<=step.at)']),
  K("duplicar un paso copia también lo almacenado que no aplica (018.21)", MODEL, ["const map=arrivalRawMap(scenario), valid=arrivalStepWaits(scenario, fromId);", "const map=arrivalRawMap(scenario), valid=(arrivalRawMap(scenario).get(fromId) || []).slice();"]),
  K("prune no quita lo que apunta a un envío eliminado", MODEL, ["map.set(stepId, sends.filter(id=>ids.has(id)));", "map.set(stepId, sends);"]),
  K("move_step: no se avisa de la dependencia que deja de aplicar", AUTH, ["      warnings.length ? {warnings} : {},", "      {},"]),
  /* ── MCP: contrato de lectura y respuesta */
  M("describe_document no expone waitsForArrivalOf del paso", STORIES, ["                        ...(waits.get(s.id)?.length ? { waitsForArrivalOf: waits.get(s.id) } : {}),\n", ""]),
  M("describe_document no expone waitsFor del momento (atómico)", STORIES, ["                    ...(momentWaits.length ? { waitsFor: momentWaits } : {}),\n", ""]),
  M("describe_document mezcla lo inactivo con lo almacenado", STORIES, ["            ...(sc.arrival.ignored.length ? { inactiveArrivalDependencies: sc.arrival.ignored } : {}),\n", ""]),
  M("author_document pierde los warnings", AUTHTS, ["{ warnings: result.warnings }", "{ warnings: result.warnings.slice(0, 0) }"]),
  M("el schema MCP no publica set_arrival_dependencies", AUTHTS, ['    op: z.literal("set_arrival_dependencies"),', '    op: z.literal("set_arrival_dependencies_"),']),
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
  copyInto(FLUYO, fl, ["js", "test/fixtures", "index.html", "s"]);
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-018-22.test.js", "dist-test/test/fluyo-017-2.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut22-"));
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
  const sane = run(base.mc, SUITE, { REQUIRE_FLUYO: "1" });
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
    const r = run(mc, SUITE, { REQUIRE_FLUYO: "1" });
    const killed = r.code !== 0, n = (r.out.match(/^\s*not ok /gm) ?? []).length;
    console.log(`${killed ? "  ✔ detectada " : "  ✘ SOBREVIVE "} ${m.name}${killed ? `  (${n} tests fallan)` : ""}`);
    if (!killed) survivors++;
    rmSync(join(tmp, `m${i}`), { recursive: true, force: true });
  });
  const bad = survivors + obsolete;
  console.log(bad ? `\nFLUYO-018.22 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.22 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

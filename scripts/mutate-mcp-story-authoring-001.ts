/**
 * FLUYO-MCP-STORY-AUTHORING-001 · S1 — mutaciones adversariales del contrato de autoría fiable.
 *
 *   node scripts/mutate-mcp-story-authoring-001.ts
 *
 * Igual que mutate-mcp-token-efficiency-004.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica cada mutación
 * a src/ y exige que falle test/fluyo-mcp-story-authoring-001.test.ts. Una que sobrevive es un test débil: código de salida 1.
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

const SERVER = "src/server.ts", AUTH = "src/authoring.ts", STORIES = "src/stories.ts", LINK = "src/link-input.ts", ERRORS = "src/schema-errors.ts", MODEL = "src/model.ts";

const MUTATIONS: Mutation[] = [
  /* G2: el desenlace */
  M("M1 el desenlace ignora el fallo", STORIES, ['if(o.ok) return {status: "no_failures"};', 'return {status: "no_failures"};']),
  M("M2 moment empieza en 0, no como la UI", STORIES, ["moment: o.moment, stepId: o.stepId", "moment: o.moment - 1, stepId: o.stepId"]),
  M("M3 Historia vacía como «sin fallos»", STORIES, ['if(!sc.steps.length) return {status: "empty"};', 'if(!sc.steps.length) return {status: "no_failures"};']),
  M("M4 sin el motivo del fallo", STORIES, ["reason: s.reason, reasonNode:", "reasonNode:"]),
  M("M5 una Historia que la integridad rechaza conserva su desenlace", STORIES,
    ['outcome: executable.get(`${pageIndex}:${sc.id}`) ? presentOutcome(sc.outcome) : ({ status: "not_executable" } as const),', "outcome: presentOutcome(sc.outcome),"]),
  M("M6 run_story sin storyOutcome", STORIES, ["storyOutcome: presentOutcome(model.storyOutcome as StoryOutcome),\n", ""]),
  M("M7 author_document sin stories", AUTH, ["stories: touchedStories.flatMap(t => facts.filter(s => s.pageIndex === t.pageIndex && s.storyId === t.storyId)).map(s => ({ ...s, outcome: presentOutcome(s.outcome) })),", "stories: [] as StoryFacts[],"]),
  M("M8 story-clock.js fuera del kernel (segunda regla o ninguna)", "scripts/sync-kernel.ts", ['"story-clock.js",', ""]),
  /* G3: el aviso */
  M("M9 sin aviso", AUTH, ["const warnings = [...(result.warnings ?? []), ...sideEffects];", "const warnings = [...(result.warnings ?? [])];"]),
  M("M10 avisa también de la Historia editada", AUTH, ["if (pageIndex === null || edited.has(`${pageIndex}:${b.storyId}`)) return [];", "if (pageIndex === null) return [];"]),
  M("M11 el cambio de etiqueta cuenta como cambio de desenlace", AUTH, ["const outcomeKey = (o: StoryOutcome): string => (o.status === \"failed\" ? `failed:${o.moment}:${o.stepId}:${o.reason ?? \"\"}:${o.reasonNode?.id ?? \"\"}` : o.status);", "const outcomeKey = (o: StoryOutcome): string => JSON.stringify(o);"]),
  M("M12 el aviso se compara consigo mismo (no ve el cambio)", AUTH, ["outcomeWarnings(storyFacts(kernel, base), facts,", "outcomeWarnings(facts, facts,"]),
  M("M13 con delete_page, índices del lote en el aviso", AUTH, ["const pageIndex = pageMap ? pageMap.find(p => p.from === b.pageIndex)?.to ?? null : b.pageIndex;\n    if (pageIndex === null || edited", "const pageIndex = b.pageIndex as number | null;\n    if (pageIndex === null || edited"]),
  M("M14 el aviso se vuelve un rechazo", AUTH, ["const warnings = [...(result.warnings ?? []), ...sideEffects];", 'if (sideEffects.length) return rejected(sideEffects);\n  const warnings = [...(result.warnings ?? []), ...sideEffects];']),
  M("M15 summary pierde el aviso", AUTH, ["const { changes: _changes, unmodeled: _unmodeled, ...rest } = r;\n  return rest;", 'const { changes: _changes, unmodeled: _unmodeled, ...rest } = r;\n  if ("warnings" in rest) delete (rest as Record<string, unknown>).warnings;\n  return rest;']),
  M("M16 el resumen de texto no dice que otra Historia cambió", AUTH, ['(warningCount("STORY_OUTCOME_CHANGED") ? `Aviso: ${warningCount("STORY_OUTCOME_CHANGED")} Historia(s) que el lote no editó cambiaron de desenlace (ver warnings). ` : "") +\n', ""]),
  /* G1: el enlace de una persona */
  M("M17 INVARIANTE: author_document acepta un enlace sin revisión", LINK, ['if (baseRevision === undefined) return { ok: false, error: { code: "LINK_REVISION_REQUIRED", message: LINK_REVISION_REQUIRED_MESSAGE } };\n  const normalized = normalizeWith(createKernel(), decoded.value);\n  if (normalized === null || revisionOfProject(normalized) !== baseRevision) {',
    'const normalized = normalizeWith(createKernel(), decoded.value);\n  if (normalized === null || (baseRevision !== undefined && revisionOfProject(normalized) !== baseRevision)) {']),
  M("M18 run_story también lee sin revisión", SERVER, ["const result = runStory({ document: readDocument(document, baseRevision), pageIndex, storyId });", 'const result = runStory({ document: typeof document === "string" && baseRevision === undefined ? (resolveLinkForRead(document) as { document: unknown }).document : readDocument(document, baseRevision), pageIndex, storyId });']),
  M("M19 baseRevision opcional en author_document", SERVER,
    ['baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).describe("La revisión de este documento (create_*, resultRevision anterior o describe_document)."),\n      operations:', 'baseRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional().describe("La revisión de este documento (create_*, resultRevision anterior o describe_document)."),\n      operations:'],
    ["const result = authorDocument({ document, baseRevision, operations, dryRun, returnDocument });", "const result = authorDocument({ document, baseRevision: baseRevision as string, operations, dryRun, returnDocument });"]),
  M("M20 lo que no es un documento se da por bueno", LINK, ['if (normalized === null) return { ok: false, error: unreadable("not_a_document", "lo que lleva no es un documento de Fluyo") };\n  return { ok: true, document: DocumentObjectSchema.parse(normalized) };', "return { ok: true, document: decoded.value };"]),
  M("M21 no marca que la revisión está sin verificar", SERVER, ["...(baseRevision === undefined ? { linkRevisionUnverified: true as const } : {}),\n", ""]),
  M("M22 sin aviso de instantánea en /s/", LINK, ["/\\/s\\/?#d=/.test(link)", "false"]),
  /* G4: errores de schema */
  M("M23 errores de schema sin estructurar", SERVER, ["withStructuredSchemaError(await call(request, extra), request.params?.arguments)", "await call(request, extra)"]),
  M("M24 unión: elige la primera rama, no la que explica el error", ERRORS, ["const best = [...branches].sort((a, b) => misses(a) - misses(b) || depth(b) - depth(a) || a.length - b.length)[0];", "const best = branches[0];"]),
  M("M25 sin tope de errores", ERRORS, ["leaves.slice(0, MAX_ERRORS).map", "leaves.map"]),
  M("M26 el 1.er bloque pierde el prefijo de siempre", ERRORS, ["`MCP error -32602: Input validation error (SCHEMA_INVALID) en ${m[1]}: ", "`SCHEMA_INVALID en ${m[1]}: "]),
  M("M27 sin candidatos", AUTH, ['rejected(withCandidates(result.errors ?? [{ code: "INVALID_OPERATION", message: "El lote no se pudo aplicar." }], input.operations, base))', 'rejected(result.errors ?? [{ code: "INVALID_OPERATION", message: "El lote no se pudo aplicar." }])']),
  M("M28 candidatos de la clase contraria", AUTH, ['const wantsNode = e.code === "TARGET_NOT_FOUND" ? gaveNode : !gaveNode;', 'const wantsNode = e.code === "TARGET_NOT_FOUND" ? !gaveNode : gaveNode;']),
  M("M29 candidatos sin tope", AUTH, ["list.slice(0, MAX_CANDIDATES)", "list"]),
  /* G5: summary */
  M("M30 full por defecto pasa a summary", MODEL, ['z.enum(["full", "summary"]).default("full")', 'z.enum(["full", "summary"]).default("summary")']),
  M("M31 describe summary pierde los ids de conexión", STORIES, ["connections: p.connections.map(e => ({ id: e.id, from: e.from,", "connections: p.connections.map(e => ({ from: e.from,"]),
  M("M32 describe summary pierde la disponibilidad inicial", STORIES, ['...(n.availability !== "UP" ? { availability: n.availability } : {}) })),\n      connections', "})),\n      connections"]),
  M("M33 describe summary pierde unmodeled", STORIES, ["    unmodeled: d.unmodeled,\n  };\n}\n\n/* ===================== run_story", "  };\n}\n\n/* ===================== run_story"]),
  M("M34 run summary conserva el Trace", SERVER, ['json(detail === "summary" ? summaryOfRun(result) : result)', "json(result)"]),
  M("M35 author summary conserva changes", SERVER, ['json(detail === "summary" ? summaryOfAuthoring(result) : result)', "json(result)"]),
  M("M36 storyRefs incluye lo borrado en el lote", AUTH, ["return facts.some(s => s.pageIndex === pageIndex && s.storyId === id) ? [{ ref, type: \"story\", pageIndex, id }] : [];", 'return [{ ref, type: "story", pageIndex, id }];']),
  M("M37 storyRefs dentro de refs (cambia lo que ya se leía)", AUTH, ["refs: result.refs ?? [],\n", "refs: [...(result.refs ?? []), ...createdStoryRefs],\n"]),
  /* Descriptions */
  M("M38 sin la receta del fallo", SERVER, ['"FALLO REAL: evento SET_AVAILABILITY DOWN sobre el destino, ANTES del envío: este queda not_completed y outcome failed (moment = el paso N de la app). En el MISMO momento no falla y un message nunca causa un fallo. " +\n', ""]),
  M("M39 sin la regla del idioma", SERVER, [`"LANGUAGE: names and messages in the language of the user's request, not of this catalog. " +\n`, ""]),
  M("M40 el campo del mensaje no recuerda el idioma", AUTH, [`StepMessage.describe("In the language of the user's request. Frase de ESTE paso`, 'StepMessage.describe("Frase de ESTE paso']),
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
function run(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
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
const FLUYO = { FLUYO_PATH: process.env.FLUYO_PATH ? resolve(process.env.FLUYO_PATH) : resolve(MCP, "..", "fluyo") };
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-story-authoring-001.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];
const SYNC = [join("scripts", "sync-kernel.ts")];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-sa001-"));
let survivors = 0, obsolete = 0;
try {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
  const list = MUTATIONS.filter(m => !only || only.test(m.name));
  const base = layout(join(tmp, "base"));
  const build = run(base, TSC);
  if (build.code !== 0) { console.error("tsc falló en la copia sin mutar:\n" + build.out.slice(-1500)); process.exit(2); }
  const sane = run(base, SUITE, FLUYO);
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
    /* Sacar un archivo del kernel se mide regenerando el kernel, como lo haría quien lo cambie. */
    if (m.file === "scripts/sync-kernel.ts") {
      const s = run(mc, SYNC, FLUYO);
      if (s.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — sync-kernel falló: ${s.out.slice(0, 300)}`); obsolete++; return; }
    }
    const b = run(mc, TSC);
    if (b.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — la mutación no compila: ${b.out.slice(0, 300)}`); obsolete++; return; }
    const r = run(mc, SUITE, FLUYO);
    const killed = r.code !== 0, n = (r.out.match(/^\s*not ok /gm) ?? []).length;
    console.log(`${killed ? "  ✔ detectada " : "  ✘ SOBREVIVE "} ${m.name}${killed ? `  (${n} tests fallan)` : ""}`);
    if (!killed) survivors++;
    rmSync(join(tmp, `m${i}`), { recursive: true, force: true });
  });
  const bad = survivors + obsolete;
  console.log(bad ? `\nSTORY-AUTHORING-001 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nSTORY-AUTHORING-001 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

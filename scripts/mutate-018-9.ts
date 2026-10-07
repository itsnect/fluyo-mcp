/**
 * FLUYO-018.9 — batería de mutaciones adversariales: create_diagram / create_from_template por el dominio y el arreglo de createNodeIn
 * (campos de `code`).
 *
 *   node scripts/mutate-018-9.ts
 *
 * Igual que mutate-018-7c.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-9.test.ts (+ link, tools, 018-6). Una que sobrevive es un test débil: código de salida 1.
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

const MODEL = "js/model.js", AUTH = "js/story-authoring.js", DIAGRAM = "src/diagram.ts", SCHEMA = "src/schema.ts", MODELTS = "src/model.ts";
const OK_RETURN = "  return { ok: true, project: project as FluyoProject, revision: revisionOfProject(project) };";

const MUTATIONS: Mutation[] = [
  /* ── kernel (se regenera con el sync-kernel real) */
  K("createNodeIn vuelve a completar code DESPUÉS del spec (pierde keywords sin lang)", MODEL,
    ["    shape===\"code\"? {lang:DEFAULT_LANG, keywords:null, kwBg:null, kwColor:null} : {}), spec, [\"ref\",\"id\"]);", "    {}), spec, [\"ref\",\"id\"]);\n  if(shape===\"code\" && !(\"lang\" in n)) Object.assign(n,{lang:DEFAULT_LANG, keywords:null, kwBg:null, kwColor:null});"]),
  K("createNodeIn no completa kwBg/kwColor si llega lang", MODEL,
    ["    shape===\"code\"? {lang:DEFAULT_LANG, keywords:null, kwBg:null, kwColor:null} : {}), spec, [\"ref\",\"id\"]);", "    {}), spec, [\"ref\",\"id\"]);\n  if(shape===\"code\") for(const [k,v] of [[\"lang\",DEFAULT_LANG],[\"keywords\",null]]) if(!(k in n)) n[k]=v;"]),
  K("auto-lazo aceptado por el dominio", MODEL, ["  if(source===target && source!==undefined) throw projectDataError(\"self_loop\",\"target\");\n", ""]),
  K("límites de autoría ignorados", AUTH, ["    if(over.length) return failure(over);", "    if(false) return failure(over);"]),
  K("HEX laxo otra vez (#rgba, #rrggb…)", AUTH, ["  const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;", "  const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;"]),
  /* ── MCP: vuelta a la fábrica propia */
  M("documento v3 (salida de la fábrica antigua)", DIAGRAM, [OK_RETURN, "  (project as any).version = 3;\n" + OK_RETURN]),
  M("reintroduce meta.generator", DIAGRAM, [OK_RETURN, "  (project as any).meta = { generator: \"fluyo-mcp\" };\n" + OK_RETURN]),
  M("defaults propios: etiqueta «Nodo» para todo (también code)", DIAGRAM, ["    const spec = withHexColors({ ...rest, x:", "    const spec = withHexColors({ label: \"Nodo\", ...rest, x:"]),
  M("campos legacy en las conexiones (fs, lineColor, dotColor a null)", DIAGRAM, ["? { ...rest, dotsGlobal: false } : rest, EDGE_COLOR_FIELDS);", "? { fs: null, lineColor: null, dotColor: null, ...rest, dotsGlobal: false } : { fs: null, lineColor: null, dotColor: null, ...rest }, EDGE_COLOR_FIELDS);"]),
  M("campo legacy fs:null en los nodos", DIAGRAM, ["    const spec = withHexColors({ ...rest, x:", "    const spec = withHexColors({ fs: null, ...rest, x:"]),
  M("elimina keywords de la entrada", DIAGRAM, ["    const { key, ...rest } = n;", "    const { key, keywords: _kw, ...rest } = n as typeof n & { keywords?: unknown };"]),
  M("dots propio sin dotsGlobal:false", DIAGRAM, ["rest.dots !== undefined && rest.dotsGlobal === undefined ? { ...rest, dotsGlobal: false } : rest", "rest"]),
  /* ── MCP: colores */
  M("pierde la traducción de nombres de color", DIAGRAM, ["out[f] = colorNameToHex(out[f]);", "out[f] = out[f];"]),
  M("solo traduce «color» (no fill/textBg/textColor/kwBg/kwColor)", DIAGRAM, ["const NODE_COLOR_FIELDS = [\"color\", \"fill\", \"textBg\", \"textColor\", \"kwBg\", \"kwColor\"];", "const NODE_COLOR_FIELDS = [\"color\"];"]),
  M("no traduce los colores de conexión", DIAGRAM, ["const EDGE_COLOR_FIELDS = [\"lineColor\", \"dotColor\"];", "const EDGE_COLOR_FIELDS: string[] = [];"]),
  M("un color desconocido cae en silencio al color por defecto", SCHEMA, ["  return typeof value === \"string\" ? paletteHexOf(value) ?? value : value;", "  return typeof value === \"string\" ? paletteHexOf(value) ?? (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$/.test(value) ? value : PALETTE[0].hex) : value;"]),
  /* ── MCP: reglas y límites saltados o recortados en silencio */
  M("nombre de página recortado a 80 en silencio", DIAGRAM, ["name: input.pageName }", "name: input.pageName.slice(0, 80) || \"Página 1\" }"]),
  M("customBg inválido descartado en silencio", DIAGRAM, ["...(input.customBg !== undefined ? { customBg: input.customBg } : {})", "...(input.customBg !== undefined && /^(#[0-9a-fA-F]{3,8})?$/.test(input.customBg) ? { customBg: input.customBg } : {})"]),
  M("ajustes que el editor cambiaría se aceptan (font desconocida → Georgia)", DIAGRAM, [".find(k => normalized[k] !== wanted[k]);", ".find(k => false && normalized[k] !== wanted[k]);"]),
  M("rangos antiguos de speed en el schema", MODELTS, ["  speed: z.number().min(0.2).max(2).optional()", "  speed: z.number().min(0.05).max(5).optional()"]),
  M("defaults de ajustes duplicados y distintos (speed 1)", DIAGRAM, ["  for (const k of SETTING_KEYS) if (input[k] !== undefined) wanted[k] = input[k];", "  for (const k of SETTING_KEYS) if (input[k] !== undefined) wanted[k] = input[k];\n  wanted.speed ??= 1;"]),
  M("keys repetidas aceptadas (la última gana)", DIAGRAM, ["    if (seen.has(n.key)) return {", "    if (false) return {"]),
  /* ── MCP: determinismo y forma canónica */
  M("revisión no determinista", DIAGRAM, [OK_RETURN, "  return { ok: true, project: project as FluyoProject, revision: revisionOfProject({ project, t: Math.random() }) };"]),
  M("orden de settings no canónico (el de la entrada)", DIAGRAM, ["settingsFromProjectData(Object.assign({}, settings, __a))", "settingsFromProjectData(__a)"]),
  M("ajustes sin la normalización de la carga del editor", DIAGRAM, ["settingsFromProjectData(Object.assign({}, settings, __a))", "Object.assign({}, settings, __a)"]),
  /* ── MCP: lotes y errores */
  M("lotes sin encadenar ids (refs entre lotes)", DIAGRAM, ["(here.has(k) ? { ref: k } : { id: idByKey.get(k) })", "({ ref: k })"]),
  M("errores con el índice interno, sin la ruta de la entrada", DIAGRAM, ["  const { operationIndex: _internal, ...rest } = e;", "  const rest = { ...e };"], ["...(where ? { input: where } : {}),", ""]),
  /* ── MCP: create_from_template fuera de la ruta común */
  M("plantilla sin auto-layout (posiciones propias)", DIAGRAM, ["theme: args.theme ?? suggestedTheme, nodes, edges });", "theme: args.theme ?? suggestedTheme, nodes, edges, autoLayout: false });"]),
  M("plantilla pierde sus colores (salta la traducción)", DIAGRAM, ["theme: args.theme ?? suggestedTheme, nodes, edges });", "theme: args.theme ?? suggestedTheme, nodes: nodes.map(n => ({ ...n, color: undefined })), edges });"]),
  M("plantilla ignora pageName/theme del llamante", DIAGRAM, ["pageName: args.pageName ?? suggestedPageName, theme: args.theme ?? suggestedTheme,", "pageName: suggestedPageName, theme: suggestedTheme,"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-018-9.test.js", "dist-test/test/link.test.js", "dist-test/test/tools.test.js", "dist-test/test/fluyo-018-6.test.js"];
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
  console.log(bad ? `\nFLUYO-018.9 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.9 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * FLUYO-018.6 — batería de mutaciones adversariales del lado MCP (fill:"none", colores de conexión y propose_layout).
 *
 *   node scripts/mutate-018-6.ts
 *
 * Igual que mutate-018-5.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-6.test.ts (+ 018-5, 018-3, 018-2, 017-2). Una que sobrevive es un test débil: código de salida 1.
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

const AUTH = "js/story-authoring.js", PL = "src/propose-layout.ts", LAYOUT = "src/layout.ts", SERVER = "src/server.ts";
const FILL_NONE = 'if(k==="fill" && v==="none") continue;';
const EDGE_MSG = '`«${k}» debe ser un color HEX (#rgb, #rrggbb o #rrggbbaa) o null';
const EDGE_CHECK = 'if(typeof v!=="string" || !HEX_COLOR.test(v)) throw invalidField(k, ' + EDGE_MSG;

const MUTATIONS: Mutation[] = [
  /* ── fill:"none" (kernel) */
  K("fill:\"none\" vuelve a rechazarse", AUTH, [FILL_NONE, "if(false) continue;"]),
  K("«none» se acepta en cualquier campo de color", AUTH, [FILL_NONE, 'if(v==="none") continue;']),
  K("«none» se acepta sin distinguir mayúsculas ni espacios", AUTH, [FILL_NONE, 'if(k==="fill" && typeof v==="string" && v.trim().toLowerCase()==="none") continue;']),
  K("fill acepta cualquier cadena", AUTH, [FILL_NONE, 'if(k==="fill" && typeof v==="string") continue;']),
  /* ── colores de conexión (kernel) */
  K("create_connection no valida los colores", AUTH, ["      edgeInputRules(spec);\n", ""]),
  K("update_connection no valida los colores", AUTH, ["      edgeInputRules(patch);\n", ""]),
  K("lineColor no se valida", AUTH, ['const EDGE_COLOR_FIELDS = ["lineColor","dotColor"];', 'const EDGE_COLOR_FIELDS = ["dotColor"];']),
  K("dotColor no se valida", AUTH, ['const EDGE_COLOR_FIELDS = ["lineColor","dotColor"];', 'const EDGE_COLOR_FIELDS = ["lineColor"];']),
  K("null se rechaza como color de conexión", AUTH, ["      if(v===undefined || v===null) continue;\n      " + EDGE_CHECK, "      if(v===undefined) continue;\n      " + EDGE_CHECK]),
  K("los colores de conexión son retroactivos", AUTH, ["      const v = spec[k];\n      if(v===undefined || v===null) continue;", '      const v = spec[k]===undefined ? "#" : spec[k];\n      if(v===undefined || v===null) continue;']),
  K("el error de color de conexión pierde el campo", AUTH, ["throw invalidField(k, " + EDGE_MSG, 'throw invalidField("lineColor", ' + EDGE_MSG]),
  K("los colores de conexión admiten nombres", AUTH, [EDGE_CHECK, 'if(typeof v!=="string") throw invalidField(k, ' + EDGE_MSG]),
  K("los colores de nodo dejan de validarse", AUTH, ['const NODE_COLOR_FIELDS = ["color","fill","textBg","textColor","kwBg","kwColor"];', "const NODE_COLOR_FIELDS = [];"]),
  /* ── propose_layout (mcp) */
  M("propose_layout no está registrada con su nombre", SERVER, ['"propose_layout",\n  {', '"propose_layouts",\n  {']),
  M("propose_layout deja de declararse de solo lectura", SERVER, ['title: "Proponer posiciones (auto-layout) para una página de un documento Fluyo",\n    annotations: TOOL_PURA,', 'title: "Proponer posiciones (auto-layout) para una página de un documento Fluyo",\n    annotations: { ...TOOL_PURA, readOnlyHint: false },']),
  M("propose_layout devuelve un documento (rompe el solo lectura)", PL, ["    finalRevision: currentRevision,", "    finalRevision: currentRevision, document: current,"]),
  M("propose_layout no es determinista", PL, ["      batches: batches.length,", "      batches: batches.length, nonce: Math.random(),"]),
  M("clearWaypoints se ignora (siempre se conservan)", PL, ["  if (clearWaypoints) {\n    for (const e of stale)", "  if (false) {\n    for (const e of stale)"]),
  M("clearWaypoints se ignora (siempre se limpian)", PL, ["  if (clearWaypoints) {\n    for (const e of stale)", "  if (true) {\n    for (const e of stale)"]),
  M("se limpian los waypoints de conexiones cuyos extremos no se mueven", PL, ["    for (const e of stale) ops.push(", "    for (const e of withWaypoints) ops.push("]),
  M("se emiten operaciones para nodos que no cambian", PL, ["const ops: Op[] = rows.filter(r => r.moved).map(", "const ops: Op[] = rows.map("]),
  M("moved siempre true", PL, ["moved: p.x !== n.x || p.y !== n.y,", "moved: true,"]),
  M("update_node con y = x", PL, ["spec: { x: r.x, y: r.y }", "spec: { x: r.x, y: r.x }"]),
  M("los lotes no encadenan el baseRevision", PL, ["batches.push({ baseRevision: currentRevision, resultRevision", "batches.push({ baseRevision: revision, resultRevision"]),
  M("los lotes superan el tope de operaciones", PL, ['const maxOps = kernel.call<number>("FluyoAuthoring.MAX_OPERATIONS");', 'const maxOps = kernel.call<number>("FluyoAuthoring.MAX_OPERATIONS") + 1;']),
  M("se recortan las coordenadas en silencio (sin LAYOUT_EXCEEDS_LIMITS)", PL, ["  if (over.length) {", "  if (false) {"]),
  M("LAYOUT_EXCEEDS_LIMITS pierde el límite", PL, ["        limitValue: limits.coordMax,\n", ""]),
  M("LAYOUT_EXCEEDS_LIMITS cambia de código", PL, ['code: "LAYOUT_EXCEEDS_LIMITS",', 'code: "LIMIT_EXCEEDED",']),
  M("el límite de coordenadas es de 1e6 (no el del kernel)", PL, ["Math.abs(r[f]) > limits.coordMax", "Math.abs(r[f]) > 1_000_000"]),
  M("pageIndex por defecto ignora la página actual", PL, ["input.pageIndex === undefined ? (base.doc.cur ?? 0) : input.pageIndex", "input.pageIndex === undefined ? 0 : input.pageIndex"]),
  M("PAGE_NOT_FOUND no comprueba el límite superior", PL, [" || pageIndex < 0 || pageIndex >= pages.length)", " || pageIndex < 0)"]),
  M("PAGE_NOT_FOUND acepta decimales", PL, ["!Number.isInteger(pageIndex) || pageIndex < 0", "pageIndex < 0"]),
  M("baseRevision no se comprueba", PL, ["input.baseRevision !== undefined && input.baseRevision !== revision", "false"]),
  M("la revisión se calcula sobre el documento sin normalizar", PL, ["const revision = revisionOfProject(base);", "const revision = revisionOfProject(input.document);"]),
  M("propose_layout aplica su propuesta sobre la página equivocada", PL, ["const page = pages[pageIndex];", "const page = pages[0];"]),
  M("layoutPage ignora las etiquetas de conexión", LAYOUT, ["page.edges.map(e => ({ from: e.from, to: e.to, label: e.label, fs: e.fs, bold: e.bold }))", "page.edges.map(e => ({ from: e.from, to: e.to }))"]),
  M("layoutPage intercambia ancho y alto", LAYOUT, ["page.nodes.map(n => ({ key: n.id, w: n.w, h: n.h })),\n    page.edges", "page.nodes.map(n => ({ key: n.id, w: n.h, h: n.w })),\n    page.edges"]),
  M("la descripción de list_colors deja de aclarar el HEX", SERVER, ["author_document NO acepta nombres", "author_document acepta nombres"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-017-2.test.js", "dist-test/test/fluyo-018-2.test.js", "dist-test/test/fluyo-018-3.test.js", "dist-test/test/fluyo-018-6.test.js", "dist-test/test/fluyo-018-5.test.js"];
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
  console.log(bad ? `\nFLUYO-018.6 mutaciones MCP: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.6 mutaciones MCP: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * FLUYO-018.7c — batería de mutaciones adversariales del lado MCP (delete_page: expectedName, índices estables del lote, pageMap, regla
 * de cur, schema y descripción de author_document).
 *
 *   node scripts/mutate-018-7c.ts
 *
 * Igual que mutate-018-7a.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-7c.test.ts (+ 018-7a, 018-5). Una que sobrevive es un test débil: código de salida 1.
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

const AUTH = "js/story-authoring.js", MODEL = "js/model.js", SERVER = "src/server.ts", AUTHORING = "src/authoring.ts";

const MUTATIONS: Mutation[] = [
  /* ── kernel (se regenera con el sync-kernel real) */
  K("expectedName se ignora", AUTH, ["      if(pg.name!==op.expectedName)\n", "      if(false)\n"]),
  K("expectedName es opcional", AUTH, ['if(op.expectedName===undefined) throw reject("INVALID_FIELD"', 'if(false) throw reject("INVALID_FIELD"'], ['if(typeof op.expectedName!=="string") throw', 'if(op.expectedName!==undefined && typeof op.expectedName!=="string") throw']),
  K("expectedName sin distinguir mayúsculas ni espacios", AUTH, ["      if(pg.name!==op.expectedName)\n", "      if(pg.name.trim().toLowerCase()!==String(op.expectedName).trim().toLowerCase())\n"]),
  K("una página eliminada en el lote no es PAGE_DELETED", AUTH, ['    if(del) throw reject("PAGE_DELETED"', '    if(false) throw reject("PAGE_DELETED"']),
  K("sin hueco: los índices del lote se desplazan", AUTH, ["      ctx.pages[op.pageIndex] = null;", "      ctx.pages.splice(op.pageIndex, 1);"]),
  K("los índices de página se resuelven en el documento vivo (P-B)", AUTH, ["    const pg = ctx.pages[op.pageIndex];\n    if(!pg) throw reject(\"PAGE_NOT_FOUND\"", "    const pg = ctx.d.pages[op.pageIndex];\n    if(!pg) throw reject(\"PAGE_NOT_FOUND\""]),
  K("sin pageMap", AUTH, ["ctx.deletedPages.size ? {pageMap:", "false ? {pageMap:"]),
  K("refs en índices del lote", AUTH, ["      .map(c=>Object.assign({}, c, {pageIndex:liveIndexOf(ctx, c.pageIndex)}));", "      .map(c=>c);"]),
  K("touchedStories en índices del lote", AUTH, ["const touched = [...ctx.touched.values()].map(t=>Object.assign({}, t, {pageIndex:liveIndexOf(ctx, t.pageIndex)}));", "const touched = [...ctx.touched.values()];"]),
  K("cur de changes[] en índices del documento", AUTH, ["cur:{from:curFrom, to:batchIndexOf(ctx, ctx.d.cur)}", "cur:{from:curFrom, to:ctx.d.cur}"]),
  K("delete_page borra por índice del lote en el documento", AUTH, ["r = deletePageIn(ctx.d, liveIndexOf(ctx, op.pageIndex));", "r = deletePageIn(ctx.d, op.pageIndex);"]),
  K("delete_page no informa de las Historias", AUTH, ["affects:{stories:im.stories.map(", "affects:{stories:[].map("]),
  K("delete_page declara otro alcance", AUTH, ['delete_page:"document"', 'delete_page:"page"']),
  K("borrar una anterior no desplaza cur (F2)", MODEL, ["  if(pageIndex<c) return c-1;\n", ""]),
  K("al borrar la activa pasa a la anterior", MODEL, ["  return Math.min(pageIndex, length-2);", "  return Math.max(pageIndex-1, 0);"]),
  K("se puede borrar la única página", MODEL, ['  if(d.pages.length<=1) throw projectDataError("last_page","pageIndex");\n', ""]),
  K("borrar una página elimina los EventTypes que deja sin uso", MODEL, ["  d.cur=pageCurAfterRemoval(from, pageIndex, length);\n  return {pageIndex, page, impact,", "  d.cur=pageCurAfterRemoval(from, pageIndex, length);\n  d.eventTypes=d.eventTypes.filter(et=>!impact.eventTypesFreed.includes(et.id));\n  return {pageIndex, page, impact,"]),
  K("borrar una página elimina los EventTypes que usa aunque otra página los use", MODEL, ["  const [page]=d.pages.splice(pageIndex,1);", "  const [page]=d.pages.splice(pageIndex,1); d.eventTypes=d.eventTypes.filter(et=>!(page.scenarios||[]).some(sc=>(sc.steps||[]).some(st=>st.eventTypeId===et.id)));"]),
  K("eventTypesFreed cuenta EventTypes que ya estaban sin uso", MODEL, ["[...here].filter(id=>", "[...new Set([...here, ...(d.eventTypes||[]).map(et=>et.id)])].filter(id=>"]),
  K("«EventTypes liberados» ignora su uso en otras páginas", MODEL, ["[...here].filter(id=>!elsewhere.has(id) && ", "[...here].filter(id=>"]),
  /* ── MCP */
  M("expectedName opcional en el schema", AUTHORING, ["    expectedName: z.string().describe(", "    expectedName: z.string().optional().describe("]),
  M("delete_page no está en el schema de author_document", AUTHORING, ['    op: z.literal("delete_page"),', '    op: z.literal("delete_pages"),']),
  M("delete_page declara alcance page en el schema", AUTHORING, ["    scope: documentScope,\n    pageIndex: PageIndex,\n    expectedName", "    scope: page,\n    pageIndex: PageIndex,\n    expectedName"]),
  M("la respuesta no trae pageMap", AUTHORING, ["    ...(result.pageMap ? { pageMap: result.pageMap } : {}),\n", ""]),
  M("la respuesta trae pageMap siempre", AUTHORING, ["    ...(result.pageMap ? { pageMap: result.pageMap } : {}),", "    pageMap: result.pageMap ?? [],"]),
  M("el resumen no menciona las páginas eliminadas", AUTHORING, ["(pagesDeleted ? `${pagesDeleted} página(s) eliminada(s): los índices de página del documento nuevo están en pageMap. ` : \"\")", "\"\""]),
  M("la descripción no documenta delete_page", SERVER, ['      "delete_page {pageIndex, expectedName}: expectedName = nombre ACTUAL exacto', '      "expectedName = nombre ACTUAL exacto']),
  M("la descripción no documenta índices estables ni pageMap", SERVER, ['      "Dentro del lote los pageIndex NO se desplazan (los del inicio + los creados al final); usar una página eliminada es PAGE_DELETED. La respuesta trae pageMap [{from,to}] (to null = eliminada): refs y touchedStories ya usan los índices finales. " +\n', ""]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-018-7c.test.js", "dist-test/test/fluyo-018-7a.test.js", "dist-test/test/fluyo-018-5.test.js"];
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
  console.log(bad ? `\nFLUYO-018.7c mutaciones MCP: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.7c mutaciones MCP: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

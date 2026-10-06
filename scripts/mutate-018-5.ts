/**
 * FLUYO-018.5 — batería de mutaciones adversariales del lado MCP (páginas, reglas de entrada, límites y contrato publicado de author_document).
 *
 *   node scripts/mutate-018-5.ts
 *
 * Igual que mutate-017-3.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-5.test.ts (+ 018-3, 018-2, 017-2). Una que sobrevive es un test débil: código de salida 1.
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

const AUTH = "js/story-authoring.js", MODEL = "js/model.js", TS = "src/authoring.ts", STORIES = "src/stories.ts", SERVER = "src/server.ts", MODELTS = "src/model.ts";

const MUTATIONS: Mutation[] = [
  /* ── dominio de páginas (kernel) */
  K("createPageIn inserta al principio", MODEL,
    ["  d.pages.push(page);\n  return {pageIndex:d.pages.length-1, page};", "  d.pages.unshift(page);\n  return {pageIndex:0, page};"]),
  K("createPageIn cambia la página activa", MODEL,
    ["  d.pages.push(page);\n  return {pageIndex:d.pages.length-1, page};", "  d.pages.push(page); d.cur=d.pages.length-1;\n  return {pageIndex:d.pages.length-1, page};"]),
  K("createPageIn devuelve un pageIndex equivocado", MODEL, ["return {pageIndex:d.pages.length-1, page};", "return {pageIndex:d.pages.length, page};"]),
  K("el nombre por defecto no es «Página N+1»", MODEL, ["\"Página \"+(d.pages.length+1) : pageNameOf(name)", "\"Página \"+d.pages.length : pageNameOf(name)"]),
  K("el nombre no tiene tope de longitud", MODEL, ["!name.trim() || name.length>PAGE_NAME_MAX)", "!name.trim())"]),
  K("un nombre de solo espacios se acepta", MODEL, ["|| !name.trim() || name.length>PAGE_NAME_MAX)", "|| name.length>PAGE_NAME_MAX)"]),
  K("renamePageIn renombra otra página", MODEL, ["page=d.pages[pageIndex], from=page.name;", "page=d.pages[0], from=page.name;"]),
  K("renamePageIn acepta un índice fuera de rango", MODEL, [" || pageIndex<0 || pageIndex>=d.pages.length) throw projectDataError(\"page_not_found\"", " || pageIndex<0) throw projectDataError(\"page_not_found\""]),
  /* ── authoring: páginas (kernel) */
  K("create_page se declara de alcance «page»", AUTH, ["create_page:\"document\", rename_page:\"document\",", "create_page:\"page\", rename_page:\"document\","]),
  K("create_page ignora el nombre", AUTH, ["r = createPageIn(ctx.d, op.name);", "r = createPageIn(ctx.d);"]),
  K("rename_page renombra siempre la página 0", AUTH, ["r = renamePageIn(ctx.d, op.pageIndex, op.name);", "r = renamePageIn(ctx.d, 0, op.name);"]),
  K("create_page no informa del pageIndex creado", AUTH, ["return {entityKind:\"page\", entityId:r.pageIndex, pageIndex:r.pageIndex, created:true,", "return {entityKind:\"page\", entityId:0, pageIndex:0, created:true,"]),
  /* ── reglas de entrada (kernel) */
  K("el color HEX acepta cualquier longitud", AUTH, ["const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;", "const HEX_COLOR = /^#[0-9a-fA-F]+$/;"]),
  K("el icono no se busca en el catálogo", AUTH, ["if(typeof spec[k]!==\"string\" || !projectOwn(catalog, spec[k]))", "if(typeof spec[k]!==\"string\")"]),
  K("el catálogo se busca con `in` (acepta «constructor»)", AUTH, ["!projectOwn(catalog, spec[k])", "!(spec[k] in catalog)"]),
  K("la forma icon no exige icon", AUTH, ["if(shape===\"icon\" && spec.icon===undefined) throw", "if(false) throw"]),
  K("la forma anim no exige anim", AUTH, ["if(shape===\"anim\" && spec.anim===undefined) throw", "if(false) throw"]),
  K("update_node no aplica las reglas de entrada", AUTH, ["      nodeInputRules(patch, patch.shape===undefined && rec ? rec.shape : patch.shape, false);\n", ""]),
  /* ── límites (kernel) */
  K("coordMax = 100001", AUTH, ["coordMax:100000,", "coordMax:100001,"]),
  K("maxNodesPerPage = 301", AUTH, ["maxNodesPerPage:300,", "maxNodesPerPage:301,"]),
  K("maxConnectionsPerPage = 601", AUTH, ["maxConnectionsPerPage:600}", "maxConnectionsPerPage:601}"]),
  K("el conteo rechaza también el límite exacto", AUTH, ["if(n>LIMITS[limitName] && n>b)", "if(n>=LIMITS[limitName] && n>b)"]),
  K("el conteo es retroactivo (documentos antiguos que ya excedían)", AUTH, ["if(n>LIMITS[limitName] && n>b)", "if(n>LIMITS[limitName])"]),
  K("x,y se comprueban aunque el lote no los escriba (retroactivo)", AUTH, ["for(const f of [\"x\",\"y\"]) if(w.fields.has(f) && Math.abs", "for(const f of [\"x\",\"y\"]) if(true && Math.abs"]),
  K("los límites no se evalúan", AUTH, ["    if(over.length) return failure(over);", "    if(false) return failure(over);"]),
  K("el rechazo no dice el valor actual", AUTH, ["{code:\"LIMIT_EXCEEDED\", limitName, limit, actual, field,", "{code:\"LIMIT_EXCEEDED\", limitName, limit, field,"]),
  K("los límites se evalúan por operación y no sobre el estado final", AUTH,
    ["      watch(ctx, op, op.pageIndex, \"node\", n.id, [\"x\",\"y\",\"w\",\"h\"]);", "      watch(ctx, op, op.pageIndex, \"node\", n.id, [\"x\",\"y\",\"w\",\"h\"]); { const o=limitErrors(ctx, ctx.d); if(o.length) throw reject(\"LIMIT_EXCEEDED\", o[0].message, {}); }"]),
  /* ── MCP: schema, describe, descripciones */
  M("el schema no publica create_page", TS, ["  z.strictObject({ op: z.literal(\"create_page\"), scope: documentScope,", "  z.strictObject({ op: z.literal(\"create_pagex\"), scope: documentScope,"]),
  M("el schema de create_page admite nombres de más de 80 caracteres", TS, ["name: z.string().min(1).max(80).optional().describe(\"1 a 80", "name: z.string().min(1).max(500).optional().describe(\"1 a 80"]),
  M("el schema de create_node vuelve a rechazar border none", TS, ["    border: AuthoringBorderSchema.optional(),\n    lblPos: LabelPosSchema.optional(),\n    textBg: Text(40).nullable().optional(),\n    textColor: Text(40).nullable().optional(),\n    font: Text(120).nullable().optional(),\n    bold: z.boolean().optional(),\n    pulse: z.boolean().optional(),\n    order: z.number().optional(),\n    fs: z.number().nullable().optional(),\n    icon:", "    border: z.enum([\"solid\", \"dashed\", \"dotted\"]).optional(),\n    lblPos: LabelPosSchema.optional(),\n    textBg: Text(40).nullable().optional(),\n    textColor: Text(40).nullable().optional(),\n    font: Text(120).nullable().optional(),\n    bold: z.boolean().optional(),\n    pulse: z.boolean().optional(),\n    order: z.number().optional(),\n    fs: z.number().nullable().optional(),\n    icon:"]),
  M("describe_document no publica los límites de autoría", STORIES, ["maxNodesPerPage: FluyoAuthoring.LIMITS.maxNodesPerPage, maxConnectionsPerPage: FluyoAuthoring.LIMITS.maxConnectionsPerPage,", ""]),
  M("describe_document no publica el scope document", STORIES, ["authoringScopes: [\"story\", \"page\", \"eventType\", \"document\"],", "authoringScopes: [\"story\", \"page\", \"eventType\"],"]),
  M("describe_document publica coordMax distinto del kernel", STORIES, ["coordMax: FluyoAuthoring.LIMITS.coordMax,", "coordMax: 50000,"]),
  M("author_document pierde la comprobación de baseRevision", TS, ["if (actual !== input.baseRevision) {", "if (false) {"]),
  M("el dryRun devuelve documento", TS, ["...(input.dryRun ? {} : { document: result.project }),", "document: result.project,"]),
  M("edit_diagram deja de figurar como legacy", SERVER, ["LEGACY: se mantiene sin cambios por compatibilidad.", "Se mantiene sin cambios por compatibilidad."]),
  M("el BorderSchema legacy se modifica (edit_diagram admitiría none)", MODELTS, ["export const BorderSchema = z.enum([\"solid\", \"dashed\", \"dotted\"]);", "export const BorderSchema = z.enum([\"solid\", \"dashed\", \"dotted\", \"none\"]);"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-017-2.test.js", "dist-test/test/fluyo-018-2.test.js", "dist-test/test/fluyo-018-3.test.js", "dist-test/test/fluyo-018-5.test.js"];
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
  console.log(bad ? `\nFLUYO-018.5 mutaciones MCP: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.5 mutaciones MCP: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * FLUYO-018.2 — batería de mutaciones adversariales del lado MCP (create_node / create_connection en author_document).
 *
 *   node scripts/mutate-018-2.ts
 *
 * Igual que mutate-017-3.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-2.test.ts (+ 017-2). Una que sobrevive es un test débil: código de salida 1.
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

const AUTH = "js/story-authoring.js", MODEL = "js/model.js", TS = "src/authoring.ts";
const MUTATIONS: Mutation[] = [
  /* ── refs del lote */
  K("ignorar `ref` (no se registra ni se devuelve)", AUTH,
    ["    if(op.ref===undefined) return Object.assign({}, spec);\n", "    if(true) return Object.assign({}, spec);\n"]),
  K("permitir refs duplicadas (la repetida sobrescribe)", MODEL,
    ["context.refs.has(spec.ref)) throw", "false) throw"]),
  K("resolver una ref de la página 1 en la página 0 (refs sin acotar por página)", AUTH,
    ["ctx.diagramRefs[kind].get(pageIndex);", "ctx.diagramRefs[kind].get(0);"],
    ["ctx.diagramRefs[kind].set(pageIndex, byPage);", "ctx.diagramRefs[kind].set(0, byPage);"]),
  K("no permitir refs creadas antes en el mismo lote", AUTH,
    ["const id = pageRefs(ctx, kind, op.pageIndex).get(v.ref);", "const id = undefined;"]),
  K("omitir createConnectionIn (la conexión se arma a mano en el kernel)", AUTH,
    ["try{ e = createConnectionIn(pg, spec, {refs:pageRefs(ctx, \"edges\", op.pageIndex)}); }",
     "try{ e = {id:reserveStructureIds(pg), from:spec.source, to:spec.target, fromSide:null, toSide:null, route:\"straight\", waypoints:[], label:\"\", font:null, bold:false, animated:true, dashed:false, startArrow:false, endArrow:true, flowDir:\"normal\"}; pg.edges.push(e); }"]),
  K("omitir createNodeIn (el nodo se arma a mano en el kernel)", AUTH,
    ["try{ n = createNodeIn(pg, spec, {refs:pageRefs(ctx, \"nodes\", op.pageIndex)}); }",
     "try{ n = {id:reserveStructureIds(pg), shape:spec.shape, x:spec.x, y:spec.y, w:160, h:70, label:spec.label||\"\"}; pg.nodes.push(n); }"]),
  K("permitir self-loop", MODEL,
    ["  if(source===target && source!==undefined) throw projectDataError(\"self_loop\",\"target\");", ""]),
  K("permitir IDs duplicados", MODEL,
    ["  if(structureIdInUse(pg,spec.id)) throw projectDataError(\"duplicate_structure_id\",\"id\");", ""]),
  K("no hacer rollback: un error a mitad del lote devuelve el documento a medias", AUTH,
    ["if(e && e.authoring) return failure([Object.assign({code:e.code, message:e.message, operationIndex:i, operation:isRecord(op)?op.op:undefined}, e.extra)]);",
     "if(e && e.authoring) return {ok:true, project:projectToSerializable(d, norm.settings), changes, refs:ctx.created, touched:[...ctx.touched.values()], validation:{valid:true, preexistingErrors:0}};"]),
  K("el kernel calcula la geometría de la conexión (lados fijos)", AUTH,
    ["const spec = Object.assign(withRef(op, op.spec===undefined ? {} : diagramSpec(op)), {source, target});",
     "const spec = Object.assign({fromSide:\"e\", toSide:\"w\"}, withRef(op, op.spec===undefined ? {} : diagramSpec(op)), {source, target});"]),
  K("la ref se persiste en el nodo", MODEL,
    ["pg.nodes.length }, spec, [\"ref\",\"id\"]);", "pg.nodes.length }, spec, [\"id\"]);"]),

  /* ── MCP (TypeScript) */
  M("ignorar baseRevision", TS,
    ["if (actual !== input.baseRevision) {", "if (false) {"]),
  M("modificar el documento original (la entrada recibe el resultado)", TS,
    ["  const resultRevision = revisionOfProject(result.project);", "  Object.assign(input.document as object, result.project as object);\n  const resultRevision = revisionOfProject(result.project);"]),
  M("omitir resultRevision (se devuelve la de la base)", TS,
    ["const resultRevision = revisionOfProject(result.project);", "const resultRevision = input.baseRevision;"]),
  M("devolver el documento durante dryRun", TS,
    ["...(input.dryRun ? {} : { document: result.project }),", "document: result.project,"]),
  M("devolver un documento al rechazar un lote", TS,
    ["    errors,\n    note:", "    document: input.document,\n    errors,\n    note:"]),
  M("MCP crea conexiones directamente desde TS (añade una arista por cada create_connection)", TS,
    ["  const resultRevision = revisionOfProject(result.project);",
     "  for (const op of input.operations as any[]) if (op?.op === \"create_connection\") (result.project as any).doc.pages[op.pageIndex].edges.push({ id: 999, from: 1, to: 1 });\n  const resultRevision = revisionOfProject(result.project);"]),
  M("MCP calcula geometría (fija los lados de toda conexión nueva)", TS,
    ["  const resultRevision = revisionOfProject(result.project);",
     "  for (const pg of (result.project as any).doc.pages) for (const e of pg.edges) if (e.fromSide === null) e.fromSide = \"e\";\n  const resultRevision = revisionOfProject(result.project);"]),
  M("MCP no devuelve las refs", TS,
    ["    refs: result.refs ?? [],\n", "    refs: [],\n"]),
  M("el schema admite ref dentro de spec (se mezclaría con la de la operación)", TS,
    ["    shape: CreatableShapeSchema.describe(", "    ref: z.string().optional(),\n    shape: CreatableShapeSchema.describe("]),
  M("el schema de create_node admite un campo extra", TS,
    ["z.strictObject({ op: z.literal(\"create_node\"), scope: page, pageIndex: PageIndex, spec: NodeSpec,", "z.strictObject({ op: z.literal(\"create_node\"), scope: page, pageIndex: PageIndex, force: z.boolean().optional(), spec: NodeSpec,"]),
  M("el schema permite specs gigantes (sin tope en label)", TS,
    ["    label: Text(500).optional(),\n    color:", "    label: z.string().optional(),\n    color:"]),
  M("el schema permite crear 'image' (sin bytes de imagen)", TS,
    ["    shape: CreatableShapeSchema.describe(", "    shape: ShapeSchema.describe("],
    ["import { CreatableShapeSchema,", "import { ShapeSchema, CreatableShapeSchema,"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-017-2.test.js", "dist-test/test/fluyo-018-2.test.js"];
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
  console.log(bad ? `\nFLUYO-018.2 mutaciones MCP: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.2 mutaciones MCP: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

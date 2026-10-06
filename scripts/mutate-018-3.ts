/**
 * FLUYO-018.3 — batería de mutaciones adversariales del lado MCP (update_node / update_connection / delete_node / delete_connection en author_document).
 *
 *   node scripts/mutate-018-3.ts
 *
 * Igual que mutate-017-3.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-3.test.ts (+ 018-2, 017-2). Una que sobrevive es un test débil: código de salida 1.
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

const AUTH = "js/story-authoring.js", MODEL = "js/model.js", TS = "src/authoring.ts", STORIES = "src/stories.ts";
const MUTATIONS: Mutation[] = [
  /* ── B2 y validación final (kernel) */
  K("B2 saltado: se devuelve el documento aunque deje una Historia inválida", AUTH,
    ["if(regress.length) return failure(explainRemovals(ctx, regress, d));", "if(false) return failure(explainRemovals(ctx, regress, d));"]),
  K("el nodo eliminado no se atribuye (REFERENCED_ENTITY pierde la entidad)", AUTH,
    ["ctx.deleted.push({kind:\"node\", pageIndex:op.pageIndex, id, label:r.node.label,", "ctx.deleted.concat({kind:\"node\", pageIndex:op.pageIndex, id, label:r.node.label,"]),
  K("se salta la validación del estado final", AUTH,
    ["const regress = after.errors.filter(e=>!known.has(FluyoIntegrity.errorKey(e)));", "const regress = [];"]),
  /* ── objeto equivocado, campos, geometría (kernel) */
  K("update_node actualiza otro nodo", AUTH,
    ["try{ n = updateNodeIn(pg, id, patch); }", "try{ n = updateNodeIn(pg, pg.nodes[0].id, patch); }"]),
  K("update_connection ignora source", AUTH,
    ["if(op.source!==undefined) extra.source = ", "if(false) extra.source = "]),
  K("update_connection ignora target", AUTH,
    ["if(op.target!==undefined) extra.target = ", "if(false) extra.target = "]),
  K("permitir self-loop en el retarget", MODEL,
    ["    if(from===to) throw projectDataError(\"self_loop\",\"target\");", ""]),
  K("perder los waypoints al editar una conexión", MODEL,
    ["for(const k of fields) e[connectionKey(k)]=cand[connectionKey(k)];\n  return e;", "for(const k of fields) e[connectionKey(k)]=cand[connectionKey(k)];\n  if(!fields.includes(\"waypoints\")) e.waypoints=[];\n  return e;"]),
  K("el retarget limpia los waypoints (geometría inventada)", MODEL,
    ["for(const k of fields) e[connectionKey(k)]=cand[connectionKey(k)];\n  return e;", "for(const k of fields) e[connectionKey(k)]=cand[connectionKey(k)];\n  if(fields.includes(\"source\")||fields.includes(\"target\")) e.waypoints=[];\n  return e;"]),
  K("aceptar campos desconocidos en el parche", MODEL,
    ["  authoringSpec(patch,allowed);\n  const fields=Object.keys(patch)", "  const fields=Object.keys(patch)"]),
  K("delete_node deja las conexiones del nodo", MODEL,
    ["  pg.edges=pg.edges.filter(e=>e.from!==id && e.to!==id);\n", ""]),
  K("delete_node deja el Behavior huérfano", MODEL,
    ["  if(!keep && pg.behaviors) pg.behaviors=pg.behaviors.filter(b=>b.nodeId!==id);\n", ""]),
  K("el id se puede modificar", MODEL,
    ["const NODE_UPDATE_KEYS=new Set([\"x\",", "const NODE_UPDATE_KEYS=new Set([\"id\",\"x\","]),
  K("las refs de update/delete no se acotan por página", AUTH,
    ["const id = pageRefs(ctx, kind, op.pageIndex).get(v.ref);", "const id = pageRefs(ctx, kind, 0).get(v.ref);"]),
  K("el destino {ref} de un Step no se admite", AUTH,
    ["if(target.ref!==undefined){", "if(false){"]),
  K("no hacer rollback: un error a mitad del lote devuelve el documento a medias", AUTH,
    ["if(e && e.authoring) return failure([Object.assign({code:e.code, message:e.message, operationIndex:i, operation:isRecord(op)?op.op:undefined}, e.extra)]);",
     "if(e && e.authoring) return {ok:true, project:projectToSerializable(d, norm.settings), changes, refs:ctx.created, touched:[...ctx.touched.values()], validation:{valid:true, preexistingErrors:0}};"]),

  /* ── MCP (TypeScript) */
  M("ignorar baseRevision", TS,
    ["if (actual !== input.baseRevision) {", "if (false) {"]),
  M("modificar el documento original (la entrada recibe el resultado)", TS,
    ["  const resultRevision = revisionOfProject(result.project);", "  Object.assign(input.document as object, result.project as object);\n  const resultRevision = revisionOfProject(result.project);"]),
  M("omitir resultRevision (se devuelve la de la base)", TS,
    ["const resultRevision = revisionOfProject(result.project);", "const resultRevision = input.baseRevision;"]),
  M("devolver el documento durante dryRun", TS,
    ["...(input.dryRun ? {} : { document: result.project }),", "document: result.project,"]),
  M("devolver un documento al rechazar un lote (B2)", TS,
    ["    errors,\n    note:", "    document: input.document,\n    errors,\n    note:"]),
  M("MCP mueve el nodo por su cuenta (suma 1 a x tras el kernel)", TS,
    ["  const resultRevision = revisionOfProject(result.project);",
     "  for (const op of input.operations as any[]) if (op?.op === \"update_node\") { const n = (result.project as any).doc.pages[op.pageIndex].nodes.find((x: any) => x.id === op.node?.id); if (n) n.x += 1; }\n  const resultRevision = revisionOfProject(result.project);"]),
  M("MCP calcula geometría (fija los lados de toda conexión sin lado)", TS,
    ["  const resultRevision = revisionOfProject(result.project);",
     "  for (const pg of (result.project as any).doc.pages) for (const e of pg.edges) if (e.fromSide === null) e.fromSide = \"e\";\n  const resultRevision = revisionOfProject(result.project);"]),
  M("MCP no devuelve las refs", TS,
    ["    refs: result.refs ?? [],\n", "    refs: [],\n"]),
  M("el parche de nodo no es estricto (descarta campos desconocidos en silencio)", TS,
    ["const NodePatch = z\n  .strictObject({", "const NodePatch = z\n  .object({"]),
  M("el parche de nodo permite cambiar a 'image'", TS,
    ["    shape: EditableShapeSchema.optional()", "    shape: ShapeSchema.optional()"],
    ["import { CreatableShapeSchema,", "import { ShapeSchema, CreatableShapeSchema,"]),
  M("delete_node acepta un id desnudo (sin {id}/{ref})", TS,
    ["node: Endpoint.describe(\"Elimina el elemento,", "node: IdOrRef.describe(\"Elimina el elemento,"]),
  M("update_node declara el alcance «story»", TS,
    ["z.strictObject({ op: z.literal(\"update_node\"), scope: page,", "z.strictObject({ op: z.literal(\"update_node\"), scope: story,"]),
  M("el destino de un paso no admite {ref}", TS,
    ["    z.strictObject({ from: IdOrRef, to: IdOrRef }),\n    Ref,\n", "    z.strictObject({ from: IdOrRef, to: IdOrRef }),\n"]),
  M("set_initial_availability no admite {ref}", TS,
    ["nodeId: IdOrRef, state:", "nodeId: Id, state:"]),
  M("update_connection permite modificar el id en spec", TS,
    ["const ConnectionPatch = ConnectionSpec.omit({ id: true }).describe(", "const ConnectionPatch = ConnectionSpec.describe("]),
  M("el resumen no cuenta lo eliminado", TS,
    [" + part(\"deleted\", \"eliminados\")", ""]),
  M("describe_document no da la geometría de los nodos", STORIES,
    ["          x: n.x,\n          y: n.y,\n          w: n.w,\n          h: n.h,\n", ""]),
  M("describe_document calcula mal los bounds", STORIES,
    ["minX: Math.min(...nodes.map(n => n.x - n.w / 2)),", "minX: Math.min(...nodes.map(n => n.x)),"]),
  M("describe_document omite los waypoints", STORIES,
    ["          ...(e.waypoints.length ? { waypoints: e.waypoints } : {}),\n", ""]),
  M("describe_document omite la ruta y los lados", STORIES,
    ["          route: e.route,\n          ...(e.fromSide ? { fromSide: e.fromSide } : {}),\n          ...(e.toSide ? { toSide: e.toSide } : {}),\n", ""]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-017-2.test.js", "dist-test/test/fluyo-018-2.test.js", "dist-test/test/fluyo-018-3.test.js"];
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
  console.log(bad ? `\nFLUYO-018.3 mutaciones MCP: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.3 mutaciones MCP: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

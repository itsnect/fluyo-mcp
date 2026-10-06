/**
 * FLUYO-018.7a — batería de mutaciones adversariales del lado MCP (set_theme, reorder_nodes, duplicate_node, describe_document).
 *
 *   node scripts/mutate-018-7a.ts
 *
 * Igual que mutate-018-6.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-7a.test.ts (+ 018-5, 018-3, 017-1-qa). Una que sobrevive es un test débil: código de salida 1.
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

const AUTH = "js/story-authoring.js", MODEL = "js/model.js", SERVER = "src/server.ts", AUTHORING = "src/authoring.ts", STORIES = "src/stories.ts";

const MUTATIONS: Mutation[] = [
  /* ── kernel (se regenera con el sync-kernel real) */
  K("customBg no HEX se acepta en autoría", AUTH, ['if(v!==undefined && v!==null && v!=="" && !(typeof v==="string" && HEX_COLOR.test(v)))', "if(false)"]),
  K("set_theme siempre cambia (changed true)", MODEL, ["return {changed:from.theme!==to.theme || from.customBg!==to.customBg,", "return {changed:true,"]),
  K("forward y backward intercambiados", MODEL, ['if(placement==="forward"){', 'if(placement==="backward"){']),
  K("reordenar siempre informa cambio", MODEL, ["const changed=to.some((id,i)=>id!==from[i]);", "const changed=true;"]),
  K("«al frente» ordena por id", MODEL, ["return ns.filter(id=>!set.has(id)).concat(ns.filter(id=>set.has(id)));", "return ns.filter(id=>!set.has(id)).concat(ns.filter(id=>set.has(id)).sort((a,b)=>a-b));"]),
  K("reordenar toca order", MODEL, ["pg.nodes.splice(0,pg.nodes.length,...to.map(id=>byId.get(id)));", "pg.nodes.splice(0,pg.nodes.length,...to.map(id=>byId.get(id))); pg.nodes.forEach((n,i)=>{ n.order=i; });"]),
  K("los Behaviors no se copian", MODEL, ["if(projectOwn(map,b.nodeId)){ pg.behaviors.push", "if(false){ pg.behaviors.push"]),
  K("los waypoints no se desplazan al duplicar", MODEL, ["(c.waypoints||[]).forEach(w=>{ w.x+=dx; w.y+=dy; });", ""]),
  K("los ids de las copias siguen el orden de la lista", MODEL, ["const nodes=pg.nodes.filter(n=>set.has(n.id));", "const nodes=ids.map(id=>pg.nodes.find(n=>n.id===id));"]),
  K("se copian conexiones que salen del conjunto", MODEL, ["pg.edges.filter(e=>set.has(e.from) && set.has(e.to))", "pg.edges.filter(e=>set.has(e.from) || set.has(e.to))"], ["(snapshot.edges||[]).filter(e=>inSet.has(e.from) && inSet.has(e.to))", "(snapshot.edges||[]).filter(e=>inSet.has(e.from) || inSet.has(e.to))"]),
  K("el desplazamiento por defecto es 0", MODEL, ["const dx=offset && offset.dx!==undefined ? offset.dx : GRID,", "const dx=offset && offset.dx!==undefined ? offset.dx : 0,"]),
  K("las refs de las copias no se registran", AUTH, ['pageRefs(ctx, "nodes", op.pageIndex).set(cr.ref, n.id); ctx.created.push', "ctx.created.push"]),
  K("el tope de nodos no cuenta las copias", AUTH, ["      ctx.countOps[op.pageIndex] = Object.assign(ctx.countOps[op.pageIndex] || {}, {nodes:ctx.opIndex});\n      const withWaypoints", "      const withWaypoints"]),
  K("coordMax no se comprueba en las copias", AUTH, ['watch(ctx, op, op.pageIndex, "node", n.id, ["x","y"]);\n        createdList.push', "createdList.push"]),
  K("duplicate_node declara otro alcance", AUTH, ['duplicate_node:"page"', 'duplicate_node:"story"']),
  /* ── MCP */
  M("set_theme no está registrada con su nombre", SERVER, ['"set_theme",\n  {', '"set_themes",\n  {']),
  M("reorder_nodes no está registrada con su nombre", SERVER, ['"reorder_nodes",\n  {', '"reorder_nodess",\n  {']),
  M("duplicate_node no está registrada con su nombre", SERVER, ['"duplicate_node",\n  {', '"duplicate_nodes",\n  {']),
  M("set_theme deja de declararse pura", SERVER, ['title: "Cambiar el tema y el fondo de un documento Fluyo",\n    annotations: TOOL_PURA,', 'title: "Cambiar el tema y el fondo de un documento Fluyo",\n    annotations: { ...TOOL_PURA, readOnlyHint: false },']),
  M("set_theme descarta customBg", SERVER, ["...(customBg !== undefined ? { customBg } : {}) })", "})"]),
  M("reorder_nodes ignora «to»", SERVER, ['{ op: "reorder_nodes", scope: "page", pageIndex, nodes, to })', '{ op: "reorder_nodes", scope: "page", pageIndex, nodes, to: "front" })']),
  M("duplicate_node descarta offset", SERVER, ["...(offset !== undefined ? { offset } : {}),\n", ""]),
  M("duplicate_node descarta connections", SERVER, ["...(connections !== undefined ? { connections } : {}), ", ""]),
  M("duplicate_node solo duplica el primero", SERVER, ["nodes: nodes.map(n => ({ source: { id: n.id } })),", "nodes: nodes.slice(0, 1).map(n => ({ source: { id: n.id } })),"]),
  M("las tools de una operación ignoran dryRun", AUTHORING, ["dryRun: input.dryRun });\n}", "dryRun: false });\n}"]),
  M("las tools de una operación ignoran baseRevision", AUTHORING, ["return authorDocument({ document: input.document, baseRevision: input.baseRevision,", "return authorDocument({ document: input.document, baseRevision: revisionOfProject(normalizeWith(createKernel(), input.document)) as string,"]),
  M("el schema de offset desaparece de las tools", AUTHORING, ["  offset: z.strictObject({ x: z.number(), y: z.number() }).optional()", "  offset: z.number().optional()"]),
  M("las operaciones de author_document no incluyen reorder_nodes", AUTHORING, ['  z.strictObject({ op: z.literal("reorder_nodes"),', '  z.strictObject({ op: z.literal("reorder_nodes_"),']),
  M("describe_document no publica z", STORIES, ["nodes: pg.nodes.map((n, z) => ({\n          id: n.id,\n          z,", "nodes: pg.nodes.map((n, z) => ({\n          id: n.id,"]),
  M("describe_document no publica el tema", STORIES, ["    theme: model.theme,\n    customBg: model.customBg,\n", ""]),
  M("describe_document publica temas escritos a mano", STORIES, ["      themes: model.themes,", '      themes: ["dark", "claro"],']),
  M("describe_document oculta customBg", STORIES, ['customBg: d.customBg || "",', 'customBg: "",']),
  M("z empieza en 1", STORIES, ["          z,\n", "          z: z + 1,\n"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-018-7a.test.js", "dist-test/test/fluyo-018-5.test.js", "dist-test/test/fluyo-018-3.test.js", "dist-test/test/fluyo-017-1-qa.test.js"];
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
  console.log(bad ? `\nFLUYO-018.7a mutaciones MCP: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.7a mutaciones MCP: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

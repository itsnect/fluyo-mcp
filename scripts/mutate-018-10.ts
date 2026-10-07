/**
 * FLUYO-018.10 — batería de mutaciones adversariales: retirada de edit_diagram (15 tools), editorUrl de author_document
 * (D1: el enlace #d= pertenece al resultado de la autoría; propose_layout sigue siendo de solo lectura).
 *
 *   node scripts/mutate-018-10.ts
 *
 * Igual que mutate-018-7c.ts: trabaja SIEMPRE sobre copias temporales (`<tmp>/fluyo` y `<tmp>/fluyo-mcp`), con mutaciones «kernel»
 * (se cambia fluyo/js de la copia y se regenera el kernel de la copia con el sync-kernel real) y «mcp» (se cambia src/ de MCP).
 * Cada mutación debe hacer fallar test/fluyo-018-10.test.ts (+ tools, link, http, 018-5, 018-6). Una que sobrevive es un test débil: código de salida 1.
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

const SERVER = "src/server.ts", DIAGRAM = "src/diagram.ts", MODELTS = "src/model.ts", SCHEMA = "src/schema.ts", AUTHORING = "src/authoring.ts",
  LINK = "src/link.ts", PROPOSE = "src/propose-layout.ts", VERIFY = "scripts/verify-deploy.sh";
const EXPORT_MARK = "/* ===================== export_diagram ===================== */";

const MUTATIONS: Mutation[] = [
  /* ── la tool retirada vuelve, entera o a medias */
  M("vuelve la tool edit_diagram al contrato", SERVER, [EXPORT_MARK,
    "server.registerTool(\"edit_diagram\", { title: \"Editar diagrama Fluyo\", annotations: TOOL_PURA, description: \"LEGACY: edita un documento.\", inputSchema: { document: DocumentInputSchema } },\n  async ({ document }) => ok(JSON.stringify(parseDocument(document))));\n\n" + EXPORT_MARK]),
  M("queda un handler legacy exportado aunque la tool no esté registrada", DIAGRAM, ["/* ===================== create_diagram / create_from_template (FLUYO-018.9)",
    "export function editDiagram(input: { document: unknown }): FluyoProject { return parseDocument(input.document); }\n\n/* ===================== create_diagram / create_from_template (FLUYO-018.9)"]),
  M("vuelve el schema de operaciones legacy", MODELTS, ["export const CreateDiagramInputShape = {", "export const OperationSchema = z.discriminatedUnion(\"op\", [z.object({ op: z.literal(\"relayout\") })]);\n\nexport const CreateDiagramInputShape = {"]),
  M("vuelve un helper legacy muerto (resolveColor)", SCHEMA, ["export function colorNameToHex", "export function resolveColor(v: string): string { return paletteHexOf(v) ?? v; }\n\nexport function colorNameToHex"]),
  M("una descripción remite al relayout retirado", SERVER, ["(el de create_diagram) dónde colocar", "(el de create_diagram y edit_diagram.relayout) dónde colocar"]),
  /* ── contrato y recuento */
  M("una tool de más en tools/list", SERVER, [EXPORT_MARK, "server.registerTool(\"list_icons_v2\", { title: \"Íconos (copia)\", annotations: TOOL_PURA, description: \"Copia de list_icons que no debería existir en el contrato.\", inputSchema: {} }, async () => ok(\"x\"));\n\n" + EXPORT_MARK]),
  M("una tool del contrato desaparece (duplicate_node)", SERVER, ["  \"duplicate_node\",\n  {", "  \"duplicate_nodes\",\n  {"]),
  M("verify-deploy.sh vuelve a esperar edit_diagram", VERIFY, ["      \"export_diagram\", \"list_anims\", \"list_colors\", \"list_fonts\",", "      \"edit_diagram\", \"export_diagram\", \"list_anims\", \"list_colors\", \"list_fonts\","]),
  M("verify-deploy.sh anuncia 16 tools", VERIFY, ["&& pass \"las 15 tools del contrato", "&& pass \"las 16 tools del contrato"], ["|| fail \"las 15 tools del contrato", "|| fail \"las 16 tools del contrato"]),
  /* ── se pierde una capacidad que ahora pertenece a author_document */
  M("author_document pierde update_connection", AUTHORING, ["    op: z.literal(\"update_connection\"),", "    op: z.literal(\"update_connection_v0\"),"]),
  M("author_document pierde delete_page", AUTHORING, ["    op: z.literal(\"delete_page\"),", "    op: z.literal(\"delete_page_v0\"),"]),
  /* ── el enlace al resultado (D1) */
  M("author_document sin editorUrl", AUTHORING, ["link.ok ? { editorUrl: link.url } :", "link.ok ? { editorUrl: undefined as unknown as string } :"]),
  M("editorUrl apunta al documento de ENTRADA", AUTHORING, ["input.dryRun ? null : openLink(result.project);", "input.dryRun ? null : openLink(input.document);"]),
  M("editorUrl también en dryRun", AUTHORING, ["input.dryRun ? null : openLink(result.project);", "openLink(result.project);"]),
  M("el resumen de author_document sin enlace", AUTHORING, ["`\\n${openLinkLine({ ok: true, url: r.editorUrl }, \"Ábrelo en Fluyo\")}` : \"\")", "\"\" : \"\")"]),
  M("otra codificación #d= (v0 JSON sin comprimir)", LINK, ["const carga = Buffer.concat([Buffer.from([1]), deflateRawSync(json, { level: 9 })]);", "const carga = Buffer.concat([Buffer.from([0]), json]);"]),
  M("enlace truncado cuando no cabe", LINK, ["  if (url.length <= MAX_LINK_CHARS) return { ok: true, url };", "  return { ok: true, url: url.slice(0, MAX_LINK_CHARS) };"]),
  M("la descripción de author_document no documenta editorUrl", SERVER, ["'resultRevision' y 'editorUrl': el enlace fluyo.space/#d=… que abre el documento resultante en Fluyo (dáselo al usuario; si no cabe, editorUrlError LINK_TOO_LARGE)", "'resultRevision'"]),
  /* ── propose_layout (el sustituto de relayout) */
  M("propose_layout se vuelve mutante (devuelve documento)", PROPOSE, ["    readOnly: true as const,", "    readOnly: true as const,\n    document: input.document,"]),
  M("propose_layout propone posiciones de otro motor", PROPOSE, ["return { id: n.id, x: p.x, y: p.y,", "return { id: n.id, x: p.x + 10, y: p.y,"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-018-10.test.js", "dist-test/test/tools.test.js", "dist-test/test/link.test.js", "dist-test/test/http.test.js", "dist-test/test/fluyo-018-5.test.js", "dist-test/test/fluyo-018-6.test.js"];
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
  console.log(bad ? `\nFLUYO-018.10 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nFLUYO-018.10 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

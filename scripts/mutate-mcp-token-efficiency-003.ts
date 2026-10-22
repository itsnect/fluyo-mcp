/**
 * FLUYO-MCP-TOKEN-EFFICIENCY-003 — mutaciones adversariales del enlace #d= como `document`.
 *
 *   node scripts/mutate-mcp-token-efficiency-003.ts
 *
 * Igual que mutate-mcp-token-efficiency-002.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica cada
 * mutación a src/ y exige que falle test/fluyo-mcp-token-efficiency-003.test.ts o tools.test.ts. Una que sobrevive es un test débil:
 * código de salida 1.
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

const LINK = "src/link-input.ts", SERVER = "src/server.ts", AUTH = "src/authoring.ts", MODEL = "src/model.ts";
const MISMATCH = 'return { ok: false, error: { code: "LINK_REVISION_MISMATCH", message: LINK_REVISION_MISMATCH_MESSAGE } };';
const RE = "const LINK_RE = /^[^#\\s]*#d=([A-Za-z0-9_-]+)$/;";

const MUTATIONS: Mutation[] = [
  M("M1 no se comprueba la revisión de un enlace", LINK,
    ["if (normalized === null || revisionOfProject(normalized) !== baseRevision) {", "if (normalized === null) {"]),
  M("M2 un enlace sin baseRevision se acepta", LINK,
    ['if (baseRevision === undefined) return { ok: false, error: { code: "LINK_REVISION_REQUIRED", message: LINK_REVISION_REQUIRED_MESSAGE } };',
      "if (baseRevision === undefined) return { ok: true, document: decoded.value };"]),
  M("M3 se entrega el documento decodificado en bruto, no el normalizado", LINK,
    ["return { ok: true, document: DocumentObjectSchema.parse(normalized) };", "return { ok: true, document: DocumentObjectSchema.parse(decoded.value) };"]),
  M("M4 no pasa por el schema de objeto (orden de claves)", LINK,
    ["return { ok: true, document: DocumentObjectSchema.parse(normalized) };", "return { ok: true, document: normalized };"]),
  M("M5 base64 no canónico (sin la ida y vuelta)", LINK,
    ['if (bytes.length === 0 || bytes.toString("base64url") !== payload) {', "if (bytes.length === 0) {"]),
  M("M6 se recortan los espacios del enlace", LINK, ["const m = LINK_RE.exec(link);", "const m = LINK_RE.exec(link.trim());"]),
  M("M7 sin tope de descompresión", LINK, ["inflateRawSync(body, { maxOutputLength: LINK_MAX_BYTES })", "inflateRawSync(body)"]),
  M("M8 cualquier versión se lee como deflate", LINK, ["if (version === 1) {", "if (version !== 0) {"]),
  M("M9 LINK_REVISION_MISMATCH trae 'actual'", LINK,
    [MISMATCH, 'return { ok: false, error: { code: "LINK_REVISION_MISMATCH", message: LINK_REVISION_MISMATCH_MESSAGE, actual: normalized === null ? null : revisionOfProject(normalized) } as LinkError };']),
  M("M10 el enlace usa REVISION_MISMATCH", LINK,
    ['| { code: "LINK_REVISION_MISMATCH"; message: string };', '| { code: "LINK_REVISION_MISMATCH" | "REVISION_MISMATCH"; message: string };'],
    [MISMATCH, 'return { ok: false, error: { code: "REVISION_MISMATCH", message: LINK_REVISION_MISMATCH_MESSAGE } };']),
  M("M11 un rechazo de enlace devuelve documento", AUTH,
    ["if (!resolved.ok) return rejected([resolved.error]);", "if (!resolved.ok) return { ...rejected([resolved.error]), document: input.document };"]),
  M("M12 duplicate_node sin la unión (solo objeto)", SERVER,
    ["import { CreateDiagramInputShape, DocumentInputSchema, ReturnDocumentSchema, ThemeSchema, projectSkin } from \"./model.js\";",
      "import { CreateDiagramInputShape, DocumentInputSchema, DocumentObjectSchema, ReturnDocumentSchema, ThemeSchema, projectSkin } from \"./model.js\";"],
    ["inputSchema: { ...SingleBase, pageIndex: z.number().int().min(0), nodes: NodeIds, ...DuplicateFields },",
      "inputSchema: { ...SingleBase, document: DocumentObjectSchema, pageIndex: z.number().int().min(0), nodes: NodeIds, ...DuplicateFields },"]),
  M("M13 describe_document ignora baseRevision con un objeto", SERVER,
    ["describeDocument({ document: readDocument(document, baseRevision), pageIndex, includeSteps })",
      "describeDocument({ document: readDocument(document, typeof document === \"string\" ? baseRevision : undefined), pageIndex, includeSteps })"]),
  M("M14 se exige el prefijo https://fluyo.space/", LINK, [RE, "const LINK_RE = /^https:\\/\\/fluyo\\.space\\/#d=([A-Za-z0-9_-]+)$/;"]),
  M("M15 una description de 2 KB en document", MODEL,
    ['copiado EXACTO; con enlace, baseRevision obligatorio."', 'copiado EXACTO; con enlace, baseRevision obligatorio." + " ·".repeat(1024)']),
  M("M16 el regex admite caracteres tras la carga", LINK, [RE, "const LINK_RE = /^[^#\\s]*#d=([A-Za-z0-9_-]+)/;"]),
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
function run(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 300_000 });
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-token-efficiency-003.test.js", "dist-test/test/tools.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-te003-"));
let survivors = 0, obsolete = 0;
try {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
  const list = MUTATIONS.filter(m => !only || only.test(m.name));
  const base = layout(join(tmp, "base"));
  const build = run(base, TSC);
  if (build.code !== 0) { console.error("tsc falló en la copia sin mutar:\n" + build.out.slice(-1500)); process.exit(2); }
  const sane = run(base, SUITE);
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
    const b = run(mc, TSC);
    if (b.code !== 0) { console.log(`  ✘ ERROR      ${m.name} — la mutación no compila: ${b.out.slice(0, 300)}`); obsolete++; return; }
    const r = run(mc, SUITE);
    const killed = r.code !== 0, n = (r.out.match(/^\s*not ok /gm) ?? []).length;
    console.log(`${killed ? "  ✔ detectada " : "  ✘ SOBREVIVE "} ${m.name}${killed ? `  (${n} tests fallan)` : ""}`);
    if (!killed) survivors++;
    rmSync(join(tmp, `m${i}`), { recursive: true, force: true });
  });
  const bad = survivors + obsolete;
  console.log(bad ? `\nMCP-TOKEN-EFFICIENCY-003 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nMCP-TOKEN-EFFICIENCY-003 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

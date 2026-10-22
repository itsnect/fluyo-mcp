/**
 * FLUYO-MCP-TOKEN-EFFICIENCY-004 — mutaciones adversariales de `returnDocument:false` (author_document y create_diagram).
 *
 *   node scripts/mutate-mcp-token-efficiency-004.ts
 *
 * Igual que mutate-mcp-token-efficiency-003.ts: trabaja SIEMPRE sobre una copia temporal de fluyo-mcp (no toca fluyo), aplica cada
 * mutación a src/ y exige que falle test/fluyo-mcp-token-efficiency-004.test.ts o tools.test.ts. Una que sobrevive es un test débil:
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

const SERVER = "src/server.ts", AUTH = "src/authoring.ts", MODEL = "src/model.ts";
const OMIT = "...(input.dryRun || (input.returnDocument === false && link?.ok) ? {} : { document: result.project }),";
const CREATE_ONLY_SUMMARY = "if (r.ok && !returnDocument && openLink(r.project).ok) {";
const PHRASE = '"document" in r ? "Documento nuevo en el 2.º bloque." : "Sin documento (returnDocument:false): sigue con editorUrl y resultRevision."';
const DESCRIPTION = '"false: sin documento; sigue con el enlace y la revisión."';
const AUTHOR_HANDLER = "const result = authorDocument({ document, baseRevision, operations, dryRun, returnDocument });";

const MUTATIONS: Mutation[] = [
  M("M1 se omite el documento aunque no haya enlace (LINK_TOO_LARGE)", AUTH,
    [OMIT, "...(input.dryRun || input.returnDocument === false ? {} : { document: result.project }),"]),
  M("M2 el defecto pasa a false", MODEL, [`z.boolean().default(true).describe(${DESCRIPTION})`, `z.boolean().default(false).describe(${DESCRIPTION})`]),
  M("M3 create_diagram ignora el flag", SERVER,
    ["return createdOrRejected(createDiagramResult(input), returnDocument);", "return createdOrRejected(createDiagramResult(input));"]),
  M("M4 al omitir el documento también se pierde editorUrl", AUTH,
    ["...(link === null ? {} : link.ok ? { editorUrl: link.url }", "...(link === null || input.returnDocument === false ? {} : link.ok ? { editorUrl: link.url }"]),
  M("M5 un rechazo con false deja de ser isError", SERVER,
    [AUTHOR_HANDLER, AUTHOR_HANDLER.replace("const result", "const result0") + " const result = returnDocument === false && !result0.ok ? { ...result0, ok: true as const } as any : result0;"]),
  M("M6 con dryRun y false sale el enlace", AUTH,
    ["const link: OpenLink | null = input.dryRun ? null : openLink(result.project);",
      "const link: OpenLink | null = input.dryRun && input.returnDocument !== false ? null : openLink(result.project);"]),
  M("M7 el flag se publica también en las tools de una operación", SERVER,
    ['dryRun: z.boolean().default(false).describe("Solo validar: sin documento."),\n};',
      'dryRun: z.boolean().default(false).describe("Solo validar: sin documento."),\n  returnDocument: ReturnDocumentSchema,\n};']),
  M("M8 el resumen no dice que se omitió", AUTH, [PHRASE, '"Documento nuevo en el 2.º bloque."']),
  M("M9 create_diagram sin la línea de «sin documento»", SERVER,
    ["\\nSin documento (returnDocument:false): sigue con el enlace y la revision.`);", "`);"]),
  M("M10 create_diagram omite el documento aunque no haya enlace", SERVER, [CREATE_ONLY_SUMMARY, "if (r.ok && !returnDocument) {"]),
  M("M11 una description larga (catálogo)", MODEL, [DESCRIPTION, `${DESCRIPTION} + " ·".repeat(300)`]),
  M("M12 el flag se publica en create_from_template", SERVER,
    ['labelOverrides: z.record(z.string(), z.string()).default({}).describe("Ej: {\\"gateway\\": \\"Ingress\\", \\"db\\": \\"Cloud SQL\\"}"),',
      'labelOverrides: z.record(z.string(), z.string()).default({}).describe("Ej: {\\"gateway\\": \\"Ingress\\", \\"db\\": \\"Cloud SQL\\"}"),\n      returnDocument: ReturnDocumentSchema,']),
  M("M13 sin defecto publicado (opcional a secas)", MODEL, [`z.boolean().default(true).describe(${DESCRIPTION})`, `z.boolean().optional().describe(${DESCRIPTION})`]),
  M("M14 solo se omite si la ENTRADA es un enlace (la variante C descartada)", AUTH,
    [OMIT, "...(input.dryRun || (input.returnDocument === false && link?.ok && typeof input.document === \"string\") ? {} : { document: result.project }),"]),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-token-efficiency-004.test.js", "dist-test/test/tools.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-te004-"));
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
  console.log(bad ? `\nMCP-TOKEN-EFFICIENCY-004 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nMCP-TOKEN-EFFICIENCY-004 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

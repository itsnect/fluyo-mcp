/**
 * FLUYO-MCP-TOKEN-EFFICIENCY-002 — mutaciones adversariales del tramo seguro de ahorro de tokens.
 *
 *   node scripts/mutate-mcp-token-efficiency-002.ts
 *
 * Igual que mutate-019-5.ts pero solo del lado del MCP (no toca fluyo): trabaja SIEMPRE sobre una copia temporal de fluyo-mcp,
 * aplica cada mutación a src/ o al README y exige que falle test/fluyo-mcp-token-efficiency-002.test.ts, fluyo-018-10.test.ts o
 * link.test.ts. Una que sobrevive es un test débil: código de salida 1.
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

const SERVER = "src/server.ts", DIAGRAM = "src/diagram.ts", AUTH = "src/authoring.ts", REV = "src/revision.ts", LAYOUT = "src/propose-layout.ts";
const OLD_MISMATCH = '"baseRevision no coincide con el documento recibido: el documento cambió o no es el que describiste. Vuelve a leerlo con describe_document."';
const STRIP = '    if (o.type === "integer" && ((k === "minimum" && v === -SAFE) || (k === "maximum" && v === SAFE))) continue;';

const MUTATIONS: Mutation[] = [
  /* ── 1. JSON compacto */
  M("el 2.º bloque vuelve a ir con sangría", SERVER, ["const json = (value: unknown): string => JSON.stringify(value);", "const json = (value: unknown): string => JSON.stringify(value, null, 2);"]),
  /* ── 2. create_*: revision e ids */
  M("create_*: la revisión del resumen va truncada", SERVER, ["`revision ${revision} (baseRevision para author_document).`", "`revision ${revision.slice(0, 19)}… (baseRevision para author_document).`"]),
  M("create_*: sin ids por key", SERVER, ['(nodes ? `\\nIds por key: ${nodes}.` : "")', '""']),
  M("create_*: ids de aristas en otro orden", DIAGRAM, ["edges: created.map(e => e.id) }", "edges: created.map(e => e.id).reverse() }"]),
  M("create_*: todas las keys con el id del primer nodo", DIAGRAM, ["id: idByKey.get(n.key) as number", "id: idByKey.get(input.nodes[0].key) as number"]),
  M("create_*: la descripción publicada ya no lo anuncia", SERVER, [`"El resumen trae su 'revision' (el baseRevision de author_document: no hace falta describe_document) y los ids asignados (key→id; aristas en el orden de edges). " +\n`, ""]),
  /* ── 3. editorUrl una vez */
  M("author_document: la URL vuelve al resumen", AUTH, ['"\\nEnlace para abrirlo en Fluyo (dáselo al usuario): editorUrl, en el 2.º bloque."', "`\\nÁbrelo en Fluyo: ${r.editorUrl}`"]),
  M("author_document: editorUrl desaparece del JSON", AUTH, ["link.ok ? { editorUrl: link.url }", "link.ok ? {}"]),
  /* ── 4. REVISION_MISMATCH */
  M("REVISION_MISMATCH: vuelve el texto de siempre (releer siempre)", REV, ["export const REVISION_MISMATCH_MESSAGE =", `export const REVISION_MISMATCH_MESSAGE = ${OLD_MISMATCH};
export const _ANTES =`]),
  M("propose_layout: su propio texto viejo", LAYOUT, ["message: REVISION_MISMATCH_MESSAGE,", `message: ${OLD_MISMATCH},`]),
  /* ── 5. schema publicado */
  M("tools/list vuelve a publicar los topes de entero seguro", SERVER, ["return withCompactToolSchemas(buildServerAsSdkPublishes());", "return buildServerAsSdkPublishes();"]),
  M("se quitan también los topes propios", SERVER, [STRIP, '    if (o.type === "integer" && (k === "minimum" || k === "maximum")) continue;']),
  M("solo se quitan los máximos", SERVER, [STRIP, '    if (o.type === "integer" && k === "maximum" && v === SAFE) continue;']),
  M("la limpieza no baja a los nodos anidados", SERVER, ["    out[k] = withoutSafeIntBounds(v);", "    out[k] = v;"]),
  M("la limpieza ignora el tipo (también number)", SERVER, [STRIP, '    if (((k === "minimum" && v === -SAFE) || (k === "maximum" && v === SAFE))) continue;']),
  /* ── 6. textos */
  M("README: vuelve a 47 íconos", "README.md", ["Las 72 claves de ícono", "Las 47 claves de ícono"]),
  M("README: vuelve «no hay autoría de Historias»", "README.md", ["La autoría de Historias (crear, duplicar, editar pasos) es de `author_document` (sección siguiente).", "No hay autoría de Historias (crear/duplicar/editar pasos) todavía."]),
  M("HTTP: vuelve «el ícono se repite por nodo»", "src/http.ts", ['"  · Los íconos y GIFs de catálogo no son la causa: cada uno distinto va una sola vez " +', '"  · Cada nodo shape:\\"icon\\" inserta su SVG completo, y se repite por nodo. " +']),
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
const SUITE = ["--test", "--test-concurrency=1", "dist-test/test/fluyo-mcp-token-efficiency-002.test.js", "dist-test/test/fluyo-018-10.test.js", "dist-test/test/link.test.js"];
const TSC = [join("node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.test.json"];

const tmp = mkdtempSync(join(tmpdir(), "fluyo-mcp-mut-te002-"));
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
  console.log(bad ? `\nMCP-TOKEN-EFFICIENCY-002 mutaciones: ${survivors} sin detectar, ${obsolete} obsoletas/erróneas` : `\nMCP-TOKEN-EFFICIENCY-002 mutaciones: ${list.length}/${list.length} detectadas`);
  process.exitCode = bad ? 1 : 0;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

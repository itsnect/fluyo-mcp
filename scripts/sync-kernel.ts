/**
 * KERNEL — copia VERBATIM los scripts de dominio de Fluyo a src/generated/kernel-sources.ts
 *
 *   node scripts/sync-kernel.ts            regenera el archivo
 *   node scripts/sync-kernel.ts --check    falla si la copia se desvió de fluyo/js
 *
 * Qué es el kernel: los scripts CLÁSICOS de fluyo/js que el editor ya comparte con Present
 * y el Viewer —modelo de documento, motor de Scenarios, receta única de reproducción— más la
 * autoridad de integridad (FLUYO-017.1). MCP no los porta a TypeScript: los ejecuta, tal cual,
 * en un contexto `vm` aislado por llamada (src/kernel.ts). Un segundo engine es justo lo que
 * este mecanismo existe para impedir.
 *
 * Por qué cadenas en un .ts y no archivos sueltos: `tsc` compila src/ a dist/ y la imagen de
 * Docker sólo copia dist/. Un módulo generado viaja solo, igual que src/generated/config.ts.
 * El contenido es el del archivo de Fluyo carácter a carácter (sólo CRLF→LF, que JavaScript
 * ya trata como equivalente); cada archivo lleva su sha256 y el conjunto da el `KERNEL_ID`,
 * que MCP devuelve en cada resultado para poder reproducirlo.
 *
 * Mismo patrón que scripts/sync-config.ts: `--check` sin fluyo/ al lado avisa y sale con 0
 * (el archivo generado está commiteado); con los dos repos, la deriva es un fallo.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHECK_MODE = process.argv.includes("--check");

/** Orden de carga: cada script usa globales de los anteriores. */
const KERNEL_SCRIPTS = [
  "config.js",
  "safe-svg.js",
  "model.js",
  "scenario-engine.js",
  "scenario-playback.js",
  "story-playback.js",
  "document-integrity.js",
  "story-authoring.js",
] as const;

function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("No se encontró package.json.");
    dir = parent;
  }
  return dir;
}

const ROOT = packageRoot();
const FLUYO_PATH = resolve(ROOT, process.env.FLUYO_PATH ?? join("..", "fluyo"));
const JS_DIR = join(FLUYO_PATH, "js");
const OUT_FILE = join(ROOT, "src", "generated", "kernel-sources.ts");

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function fluyoRevision(): string {
  try {
    const sha = execFileSync("git", ["-C", FLUYO_PATH, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || "desconocida";
  } catch {
    return "desconocida";
  }
}

function emit(): string {
  const files = KERNEL_SCRIPTS.map(name => {
    const source = readFileSync(join(JS_DIR, name), "utf8").replace(/\r\n/g, "\n");
    return { name, sha256: sha256(source), source };
  });
  const kernelId = sha256(files.map(f => `${f.name}:${f.sha256}`).join("\n"));

  const L: string[] = [];
  const w = (s = "") => L.push(s);
  w("/**");
  w(" * GENERADO por scripts/sync-kernel.ts — NO EDITAR A MANO.");
  w(" *");
  w(" * Copia verbatim de fluyo/js/{" + KERNEL_SCRIPTS.join(", ") + "}.");
  w(` * Sincronizado desde la revisión ${fluyoRevision()} de fluyo/.`);
  w(" * Para refrescarlo:  npm run sync:kernel   ·   Para comprobarlo:  npm run check:kernel");
  w(" */");
  w();
  w("export interface KernelFile {");
  w("  name: string;");
  w("  sha256: string;");
  w("  source: string;");
  w("}");
  w();
  w("/** Orden de carga. */");
  w("export const KERNEL_FILES: readonly KernelFile[] = [");
  for (const f of files) {
    w("  {");
    w(`    name: ${JSON.stringify(f.name)},`);
    w(`    sha256: ${JSON.stringify(f.sha256)},`);
    w(`    source: ${JSON.stringify(f.source)},`);
    w("  },");
  }
  w("];");
  w();
  w("/** Identidad del conjunto: sha256 de «nombre:hash» de cada archivo, en orden. */");
  w(`export const KERNEL_ID = ${JSON.stringify(kernelId)};`);
  w();
  return L.join("\n");
}

function main() {
  const missing = KERNEL_SCRIPTS.filter(n => !existsSync(join(JS_DIR, n)));
  if (missing.length) {
    const msg =
      `No se encontró el kernel de Fluyo en ${JS_DIR}` +
      (existsSync(JS_DIR) ? ` (faltan: ${missing.join(", ")}).` : ".") +
      `\nClona itsnect/fluyo junto a este repo, o define FLUYO_PATH.`;
    if (CHECK_MODE) {
      console.warn(`⚠  check:kernel omitido. ${msg}`);
      process.exit(0);
    }
    console.error(`✖  ${msg}`);
    process.exit(1);
  }

  const generated = emit();

  if (CHECK_MODE) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
    // La revisión de fluyo/ cambia con cada commit suyo aunque el kernel no se haya tocado.
    const strip = (s: string) => s.replace(/^ \* Sincronizado desde la revisión .*$/m, "").replace(/\r\n/g, "\n");
    if (strip(current) === strip(generated)) {
      console.log("✔  src/generated/kernel-sources.ts es idéntico a fluyo/js.");
      process.exit(0);
    }
    console.error(
      "✖  src/generated/kernel-sources.ts NO coincide con fluyo/js.\n\n" +
        "   El dominio de Fluyo cambió y la copia de este servidor no se ha enterado. Ejecuta:\n\n" +
        "       npm run sync:kernel\n\n" +
        "   ...revisa el diff y commitea el archivo regenerado."
    );
    process.exit(1);
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, generated, "utf8");
  console.log(`✔  Escrito src/generated/kernel-sources.ts desde ${FLUYO_PATH}`);
  for (const n of KERNEL_SCRIPTS) console.log(`     ${n}`);
}

main();

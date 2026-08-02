/**
 * Refresca test/fixtures/ desde los ejemplos que publica Fluyo.
 *
 *   node scripts/sync-fixtures.ts
 *
 * Las fixtures del test de contrato son copias de fluyo/ejemplos/data/*.fluyo.json.
 * Están commiteadas para que el test corra sin Fluyo al lado, pero eso las deja
 * expuestas a envejecer — que es exactamente la clase de fallo que el contrato
 * existe para atrapar. Este script las vuelve a copiar.
 *
 * Si tras refrescarlas el contrato falla, el fallo es real: el formato creció y el
 * servidor todavía no lo soporta.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const SRC_DIR = join(FLUYO_PATH, "ejemplos", "data");
const DST_DIR = join(ROOT, "test", "fixtures");

if (!existsSync(SRC_DIR)) {
  console.error(
    `✖  No se encontraron los ejemplos en ${SRC_DIR}.\n` +
      `   Clona itsnect/fluyo junto a este repo, o define FLUYO_PATH.`
  );
  process.exit(1);
}

const files = readdirSync(SRC_DIR).filter(f => f.endsWith(".fluyo.json")).sort();
if (!files.length) {
  console.error(`✖  ${SRC_DIR} no contiene ningún .fluyo.json.`);
  process.exit(1);
}

mkdirSync(DST_DIR, { recursive: true });
let cambiados = 0;
for (const f of files) {
  const src = join(SRC_DIR, f);
  const dst = join(DST_DIR, f);
  const antes = existsSync(dst) ? readFileSync(dst, "utf8") : null;
  copyFileSync(src, dst);
  const despues = readFileSync(dst, "utf8");
  const estado = antes === null ? "nuevo" : antes === despues ? "sin cambios" : "actualizado";
  if (estado !== "sin cambios") cambiados++;
  console.log(`  ${estado.padEnd(12)} ${f}`);
}

console.log(
  `\n✔  ${files.length} fixture(s) sincronizadas desde ${SRC_DIR}` +
    (cambiados ? `, ${cambiados} con cambios. Ejecuta \`npm test\`.` : ".")
);

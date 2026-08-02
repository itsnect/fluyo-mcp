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

/** Los documentos alimentan el test de contrato; los previews son los SVG que
 *  generó el exportador de la propia app y sirven de referencia al renderer. */
const CONJUNTOS: Array<{ etiqueta: string; src: string; dst: string; ext: string }> = [
  {
    etiqueta: "documentos",
    src: join(FLUYO_PATH, "ejemplos", "data"),
    dst: join(ROOT, "test", "fixtures"),
    ext: ".fluyo.json",
  },
  {
    etiqueta: "previews SVG",
    src: join(FLUYO_PATH, "ejemplos", "previews"),
    dst: join(ROOT, "test", "fixtures", "previews"),
    ext: ".svg",
  },
];

let total = 0;
let cambiados = 0;

for (const { etiqueta, src, dst, ext } of CONJUNTOS) {
  if (!existsSync(src)) {
    console.error(
      `✖  No se encontró ${src}.\n   Clona itsnect/fluyo junto a este repo, o define FLUYO_PATH.`
    );
    process.exit(1);
  }
  const files = readdirSync(src).filter(f => f.endsWith(ext)).sort();
  if (!files.length) {
    console.error(`✖  ${src} no contiene ningún ${ext}.`);
    process.exit(1);
  }

  console.log(`\n${etiqueta} (${src}):`);
  mkdirSync(dst, { recursive: true });
  for (const f of files) {
    const antes = existsSync(join(dst, f)) ? readFileSync(join(dst, f), "utf8") : null;
    copyFileSync(join(src, f), join(dst, f));
    const despues = readFileSync(join(dst, f), "utf8");
    const estado = antes === null ? "nuevo" : antes === despues ? "sin cambios" : "actualizado";
    if (estado !== "sin cambios") cambiados++;
    total++;
    console.log(`  ${estado.padEnd(12)} ${f}`);
  }
}

console.log(
  `\n✔  ${total} fixture(s) sincronizadas` +
    (cambiados ? `, ${cambiados} con cambios. Ejecuta \`npm test\`.` : ".")
);

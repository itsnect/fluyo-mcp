/**
 * CODEGEN — extrae las constantes del motor de Fluyo a src/generated/config.ts
 *
 *   node scripts/sync-config.ts            regenera el archivo
 *   node scripts/sync-config.ts --check    falla si el archivo está desactualizado
 *
 * Por qué existe: las constantes del formato (paleta, iconos, temas, tamaños) vivían
 * copiadas a mano en src/schema.ts. Fluyo añadió 7 colores, 18 iconos, 8 GIFs y 11
 * tipografías, y la copia se quedó atrás sin que nada avisara. Este script convierte
 * esa copia manual en una derivación mecánica.
 *
 * Cómo lee Fluyo: `js/config.js` NO es un módulo — declara globals para cargarse con
 * <script>. No se puede importar. Se evalúa con `vm` en un contexto vacío y se leen
 * los bindings a través de una línea de extracción que se le añade al final. El
 * archivo no toca el DOM en su nivel superior, así que evaluarlo fuera del navegador
 * es seguro (`getImg` usa `Image`, pero solo se declara, no se llama).
 *
 * DEFAULT_SIZES es la excepción: no está en config.js sino dentro de `newNode()`, en
 * js/state.js, que sí toca el DOM al cargarse. De ahí se extrae con un patrón sobre
 * el texto. Si el patrón deja de encajar, el script falla en vez de emitir tamaños
 * incompletos: quedarse callado es justo el fallo que este script viene a evitar.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const CHECK_MODE = process.argv.includes("--check");

/* ===================== Rutas ===================== */

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
const CONFIG_JS = join(FLUYO_PATH, "js", "config.js");
const STATE_JS = join(FLUYO_PATH, "js", "state.js");
const OUT_FILE = join(ROOT, "src", "generated", "config.ts");

/* ===================== Formas que toma Fluyo ===================== */

interface FluyoPaletteEntry { c: string; n: string; }
interface FluyoIconDef { g: string; n: string; svg: string; }
interface FluyoAnimDef { n: string; svg: string; }
interface FluyoFontDef { n: string; f: string; }

interface Extracted {
  W: number;
  H: number;
  GRID: number;
  PALETTE: FluyoPaletteEntry[];
  THEMES: Record<string, Record<string, string>>;
  DIR: Record<string, { x: number; y: number }>;
  SIDES: string[];
  FONTS: FluyoFontDef[];
  DEFAULT_FONT: string;
  ICONS: Record<string, FluyoIconDef>;
  ANIMS: Record<string, FluyoAnimDef>;
}

/* ===================== Lectura ===================== */

/** Evalúa js/config.js en un contexto vacío. Los `const` de nivel superior no se
 *  cuelgan del objeto de contexto, así que se añade una línea que los publica. */
function readConfigJs(): Extracted {
  const source =
    readFileSync(CONFIG_JS, "utf8") +
    "\n;globalThis.__fluyo = { W, H, GRID, PALETTE, THEMES, DIR, SIDES, FONTS, DEFAULT_FONT, ICONS, ANIMS };\n";

  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: CONFIG_JS, timeout: 10_000 });

  const out = sandbox.__fluyo as Extracted | undefined;
  if (!out) throw new Error(`No se pudo extraer nada de ${CONFIG_JS}.`);

  for (const [name, value] of Object.entries(out)) {
    if (value === undefined) throw new Error(`${CONFIG_JS} ya no define '${name}'.`);
  }
  if (!out.PALETTE.length) throw new Error("PALETTE quedó vacía.");
  if (!Object.keys(out.ICONS).length) throw new Error("ICONS quedó vacío.");
  if (!Object.keys(out.ANIMS).length) throw new Error("ANIMS quedó vacío.");
  if (!out.FONTS.length) throw new Error("FONTS quedó vacía.");
  return out;
}

/** DEFAULT_SIZES vive dentro de newNode() en js/state.js, que no se puede evaluar
 *  fuera del navegador. Se extrae del texto, y si el patrón no encaja se falla. */
function readDefaultSizes(): Array<[string, [number, number]]> {
  const source = readFileSync(STATE_JS, "utf8");
  const block = source.match(/const\s+sizes\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!block) {
    throw new Error(
      `No se encontró el literal 'const sizes={...}' en ${STATE_JS}.\n` +
        `newNode() habrá cambiado de forma. Revisa js/state.js y actualiza el patrón ` +
        `de scripts/sync-config.ts — no se emiten tamaños a medias.`
    );
  }
  const entries: Array<[string, [number, number]]> = [];
  for (const m of block[1].matchAll(/(\w+)\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/g)) {
    entries.push([m[1], [Number(m[2]), Number(m[3])]]);
  }
  if (entries.length < 5) {
    throw new Error(`Solo se extrajeron ${entries.length} tamaños de ${STATE_JS}; se esperaban todas las formas.`);
  }
  return entries;
}

/** Solo informativo, para que el commit del codegen diga de qué versión salió. */
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

/* ===================== Emisión ===================== */

const q = (v: string) => JSON.stringify(v);

function emit(cfg: Extracted, sizes: Array<[string, [number, number]]>): string {
  const themeNames = Object.keys(cfg.THEMES);
  const shapeNames = sizes.map(([k]) => k);
  const iconGroups = [...new Set(Object.values(cfg.ICONS).map(i => i.g))];
  const themeFields = [...new Set(Object.values(cfg.THEMES).flatMap(t => Object.keys(t)))];

  const L: string[] = [];
  const w = (s = "") => L.push(s);

  w("/* ════════════════════════════════════════════════════════════════════════");
  w("   ARCHIVO GENERADO — NO EDITAR A MANO");
  w("");
  w("   Lo produce `npm run sync:config` a partir del motor de Fluyo:");
  w("     js/config.js  → paleta, temas, iconos, GIFs, tipografías, canvas, direcciones");
  w("     js/state.js   → tamaños por defecto de cada forma (dentro de newNode)");
  w("");
  w("   Cualquier cambio que hagas aquí lo pisa la próxima sincronización. Si algo");
  w("   está mal, arréglalo en Fluyo o en scripts/sync-config.ts.");
  w("");
  w("   `npm run check:config` falla si este archivo no coincide con Fluyo.");
  w(`   Sincronizado desde la revisión ${fluyoRevision()} de fluyo/.`);
  w("   ════════════════════════════════════════════════════════════════════════ */");
  w();

  w("/* ===================== Lienzo ===================== */");
  w();
  w(`export const CANVAS = { W: ${cfg.W}, H: ${cfg.H}, GRID: ${cfg.GRID} } as const;`);
  w();

  w("/* ===================== Formas ===================== */");
  w();
  w(`export const SHAPE_NAMES = [${shapeNames.map(q).join(", ")}] as const;`);
  w("export type Shape = (typeof SHAPE_NAMES)[number];");
  w();
  w("/** Ancho y alto con los que Fluyo crea cada forma (js/state.js, newNode). */");
  w("export const DEFAULT_SIZES: Record<Shape, readonly [number, number]> = {");
  for (const [k, [dw, dh]] of sizes) w(`  ${k}: [${dw}, ${dh}],`);
  w("};");
  w();

  w("/* ===================== Paleta semántica ===================== */");
  w();
  w("export interface PaletteEntry {");
  w("  /** Nombre visible, tal como aparece en el selector de color de la app. */");
  w("  name: string;");
  w("  hex: string;");
  w("}");
  w();
  w("export const PALETTE: readonly PaletteEntry[] = [");
  for (const p of cfg.PALETTE) w(`  { name: ${q(p.n)}, hex: ${q(p.c)} },`);
  w("];");
  w();

  w("/* ===================== Temas ===================== */");
  w();
  w(`export const THEME_NAMES = [${themeNames.map(q).join(", ")}] as const;`);
  w("export type ThemeName = (typeof THEME_NAMES)[number];");
  w();
  w("export interface ThemeDef {");
  for (const f of themeFields) w(`  ${f}: string;`);
  w("}");
  w();
  w("export const THEMES: Record<ThemeName, ThemeDef> = {");
  for (const [name, def] of Object.entries(cfg.THEMES)) {
    const fields = themeFields.map(f => `${f}: ${q(def[f] ?? "")}`).join(", ");
    w(`  ${name}: { ${fields} },`);
  }
  w("};");
  w();

  w("/* ===================== Anclas ===================== */");
  w();
  w(`export const SIDES = [${cfg.SIDES.map(q).join(", ")}] as const;`);
  w("export type Side = (typeof SIDES)[number];");
  w();
  w("export const DIR: Record<Side, { x: number; y: number }> = {");
  for (const [k, v] of Object.entries(cfg.DIR)) w(`  ${k}: { x: ${v.x}, y: ${v.y} },`);
  w("};");
  w();

  w("/* ===================== Tipografías ===================== */");
  w();
  w("export interface FontDef {");
  w("  /** Nombre corto para el usuario (p. ej. \"Georgia\"). */");
  w("  name: string;");
  w("  /** Valor real de font-family, que es lo que se guarda en el documento. */");
  w("  family: string;");
  w("}");
  w();
  w("export const FONTS: readonly FontDef[] = [");
  for (const f of cfg.FONTS) w(`  { name: ${q(f.n)}, family: ${q(f.f)} },`);
  w("];");
  w();
  w(`export const DEFAULT_FONT = ${q(cfg.DEFAULT_FONT)};`);
  w();

  w("/* ===================== Iconos ===================== */");
  w();
  w(`export const ICON_GROUPS = [${iconGroups.map(q).join(", ")}] as const;`);
  w("export type IconGroup = (typeof ICON_GROUPS)[number];");
  w();
  w("export interface IconDef {");
  w("  group: IconGroup;");
  w("  label: string;");
  w("  /** SVG completo. Se sirve como data URI, igual que en la app. */");
  w("  svg: string;");
  w("}");
  w();
  w("export const ICONS: Record<string, IconDef> = {");
  for (const [key, def] of Object.entries(cfg.ICONS)) {
    w(`  ${JSON.stringify(key)}: { group: ${q(def.g)}, label: ${q(def.n)}, svg: ${q(def.svg)} },`);
  }
  w("};");
  w();

  w("/* ===================== GIFs animados ===================== */");
  w();
  w("export interface AnimDef {");
  w("  label: string;");
  w("  /** Vista previa estática. En el lienzo la app los dibuja por fotograma. */");
  w("  svg: string;");
  w("}");
  w();
  w("export const ANIMS: Record<string, AnimDef> = {");
  for (const [key, def] of Object.entries(cfg.ANIMS)) {
    w(`  ${JSON.stringify(key)}: { label: ${q(def.n)}, svg: ${q(def.svg)} },`);
  }
  w("};");
  w();

  return L.join("\n");
}

/* ===================== Main ===================== */

function summary(cfg: Extracted, sizes: Array<[string, [number, number]]>): string {
  const groups = new Map<string, number>();
  for (const i of Object.values(cfg.ICONS)) groups.set(i.g, (groups.get(i.g) ?? 0) + 1);
  const desglose = [...groups.entries()].map(([g, n]) => `${g} ${n}`).join(" · ");
  return [
    `  formas    ${sizes.length}  (${sizes.map(([k]) => k).join(", ")})`,
    `  paleta    ${cfg.PALETTE.length}`,
    `  temas     ${Object.keys(cfg.THEMES).length}`,
    `  iconos    ${Object.keys(cfg.ICONS).length}  (${desglose})`,
    `  GIFs      ${Object.keys(cfg.ANIMS).length}`,
    `  fuentes   ${cfg.FONTS.length}`,
  ].join("\n");
}

function main() {
  if (!existsSync(CONFIG_JS)) {
    const msg =
      `No se encontró Fluyo en ${FLUYO_PATH}.\n` +
      `Clona itsnect/fluyo junto a este repo, o define FLUYO_PATH.`;
    if (CHECK_MODE) {
      // En un clon que solo tiene fluyo-mcp esto es lo normal, no un fallo: el
      // archivo generado está commiteado y el build funciona sin Fluyo al lado.
      console.warn(`⚠  check:config omitido. ${msg}`);
      process.exit(0);
    }
    console.error(`✖  ${msg}`);
    process.exit(1);
  }

  const cfg = readConfigJs();
  const sizes = readDefaultSizes();
  const generated = emit(cfg, sizes);

  if (CHECK_MODE) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
    // Se comparan las líneas sin la de procedencia: la revisión de fluyo/ cambia
    // con cada commit suyo aunque config.js no se haya tocado.
    const strip = (s: string) => s.replace(/^\s*Sincronizado desde la revisión .*$/m, "").replace(/\r\n/g, "\n");
    if (strip(current) === strip(generated)) {
      console.log("✔  src/generated/config.ts está sincronizado con fluyo/.");
      process.exit(0);
    }
    console.error(
      "✖  src/generated/config.ts NO coincide con fluyo/js/config.js.\n\n" +
        "   El motor de Fluyo cambió y el servidor no se ha enterado. Ejecuta:\n\n" +
        "       npm run sync:config\n\n" +
        "   ...revisa el diff y commitea el archivo regenerado.\n\n" +
        "   Estado actual en fluyo/:\n" +
        summary(cfg, sizes)
    );
    process.exit(1);
  }

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, generated, "utf8");
  console.log(`✔  Escrito src/generated/config.ts desde ${FLUYO_PATH}\n${summary(cfg, sizes)}`);
}

main();

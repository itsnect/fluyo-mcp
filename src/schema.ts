/**
 * Constantes del formato Fluyo y helpers que las usan.
 *
 * Las constantes NO se escriben aquí. Salen de `src/generated/config.ts`, que produce
 * `npm run sync:config` leyendo directamente `fluyo/js/config.js` y `fluyo/js/state.js`.
 * Este módulo solo las reexporta y añade los helpers que dependen de ellas.
 *
 * Antes estaban copiadas a mano en este archivo, con un comentario pidiendo mantenerlas
 * sincronizadas. No funcionó: Fluyo añadió 7 colores, 18 iconos, 8 GIFs y 11 tipografías
 * y esta copia se quedó atrás durante doce días sin que nada avisara. Ver CONTRIBUTING.md.
 */

export {
  ANIMS,
  CANVAS,
  DEFAULT_FONT,
  DEFAULT_SIZES,
  DIR,
  FONTS,
  ICON_GROUPS,
  ICONS,
  PALETTE,
  SHAPE_NAMES,
  SIDES,
  THEME_NAMES,
  THEMES,
} from "./generated/config.js";

export type {
  AnimDef,
  FontDef,
  IconDef,
  IconGroup,
  PaletteEntry,
  Shape,
  Side,
  ThemeDef,
  ThemeName,
} from "./generated/config.js";

import { ANIMS, ICONS, PALETTE } from "./generated/config.js";

/* ===================== Data URIs ===================== */

/** Igual que hace la app: el SVG del ícono se sirve como data URI inline. */
export function iconDataUri(key: string): string {
  const def = ICONS[key];
  if (!def) throw new Error(`Ícono desconocido: "${key}". Usa list_icons para ver los válidos.`);
  return "data:image/svg+xml;utf8," + encodeURIComponent(def.svg);
}

/** Vista previa estática de un GIF animado. En el lienzo la app lo dibuja por
 *  fotograma; en un SVG exportado solo cabe el fotograma de referencia, que es
 *  exactamente lo que hace el exportador de la app. */
export function animDataUri(key: string): string {
  const def = ANIMS[key];
  if (!def) throw new Error(`GIF animado desconocido: "${key}". Usa list_anims para ver los válidos.`);
  return "data:image/svg+xml;utf8," + encodeURIComponent(def.svg);
}

/* ===================== Colores ===================== */

/** "Éxito" y "Exito" deben resolver al mismo color: el modelo no siempre acentúa. */
function normalizeColorName(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

/**
 * Acepta un hex (`#6a9fb5`) o un nombre semántico de la paleta de Fluyo, sin
 * distinguir mayúsculas ni acentos. Cualquier otra cosa es un error con la lista
 * completa de alternativas: el modelo tiene que poder recuperarse sin adivinar.
 */
export function resolveColor(input: string | undefined, fallback = PALETTE[0].hex): string {
  if (!input) return fallback;
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  const target = normalizeColorName(trimmed);
  const byName = PALETTE.find(p => normalizeColorName(p.name) === target);
  if (byName) return byName.hex;
  throw new Error(
    `Color "${input}" no reconocido. Usa un hex (#6a9fb5) o uno de: ${PALETTE.map(p => p.name).join(", ")}.`
  );
}

/**
 * Traducción de los fallos de validación a frases que un modelo pueda accionar.
 *
 * `FluyoProjectSchema.parse()` lanza un ZodError cuyo `.message` es el array de
 * issues serializado en JSON. Eso llegaba tal cual al modelo: un volcado de rutas
 * y códigos del que no se puede sacar ni qué pasó ni cómo arreglarlo. Los errores
 * escritos a mano del resto del servidor ("Ícono desconocido: X. Usa list_icons")
 * son el estándar al que se acerca este módulo.
 */

import { SHAPE_NAMES, THEME_NAMES } from "./generated/config.js";

export interface ValidationIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly code?: string;
}

const MAX_ISSUES_LISTADOS = 5;

/** Recupera el valor que hay en el documento en la ruta de un issue, para poder
 *  nombrarlo en el mensaje: "la forma «anim»" dice mucho más que "shape inválido". */
function valueAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.map(p => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "") || "(raíz)";
}

function distinctValuesAt(document: unknown, issues: readonly ValidationIssue[], leaf: string): string[] {
  const out = new Set<string>();
  for (const i of issues) {
    if (i.path[i.path.length - 1] !== leaf) continue;
    const v = valueAtPath(document, i.path);
    if (typeof v === "string") out.add(v);
  }
  return [...out];
}

/**
 * Convierte los issues de un documento rechazado en un mensaje accionable.
 *
 * Los casos especiales no son cosmética: cuando Fluyo estrena una forma y este
 * servidor todavía no la conoce, el usuario necesita saber que el arreglo es
 * actualizar el servidor, no tocar su diagrama.
 */
export function describeDocumentIssues(document: unknown, issues: readonly ValidationIssue[]): string {
  // Formato v1: la app lo migra al abrir, este servidor no.
  if (document && typeof document === "object" && !("doc" in document) && "state" in document) {
    return (
      "El documento está en el formato v1 de Fluyo (clave 'state'), que este servidor no lee. " +
      "Ábrelo en Fluyo y vuelve a guardarlo con Ctrl+S: la app lo migra a v3 al abrirlo."
    );
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return (
      "El campo 'document' debe ser el objeto JSON completo de un .fluyo.json " +
      "(con las claves 'doc' y 'settings'), no un texto ni una lista."
    );
  }

  if (!("doc" in document)) {
    return (
      "El documento no parece un .fluyo.json: le falta la clave 'doc'. " +
      "Pásale el objeto completo que devuelve create_diagram, o el contenido de un archivo .fluyo.json."
    );
  }

  const formasRaras = distinctValuesAt(document, issues, "shape");
  if (formasRaras.length) {
    const plural = formasRaras.length > 1;
    return (
      `El documento usa ${plural ? "las formas" : "la forma"} ` +
      `${formasRaras.map(f => `"${f}"`).join(", ")}, que esta versión del servidor no reconoce. ` +
      `Formas soportadas: ${SHAPE_NAMES.join(", ")}. ` +
      "Suele significar que Fluyo estrenó una forma y fluyo-mcp se quedó atrás: actualiza el servidor " +
      "a la última versión (o ejecuta `npm run sync:config` si trabajas desde el repo). " +
      "El diagrama no tiene nada malo."
    );
  }

  const temasRaros = distinctValuesAt(document, issues, "theme");
  if (temasRaros.length) {
    return (
      `El documento usa el tema ${temasRaros.map(t => `"${t}"`).join(", ")}, que este servidor no reconoce. ` +
      `Temas soportados: ${THEME_NAMES.join(", ")}. ` +
      "Si Fluyo añadió un tema nuevo, actualiza fluyo-mcp."
    );
  }

  const listados = issues.slice(0, MAX_ISSUES_LISTADOS).map(i => `  · ${formatPath(i.path)}: ${i.message}`);
  const resto = issues.length - listados.length;
  return (
    "El documento no tiene la forma de un .fluyo.json válido:\n" +
    listados.join("\n") +
    (resto > 0 ? `\n  · …y ${resto} problema(s) más.` : "") +
    "\nSi lo editaste a mano, ábrelo en Fluyo y vuelve a guardarlo para normalizarlo."
  );
}

/** El documento que produce el propio servidor se revalida antes de devolverlo. Si
 *  eso falla no es culpa de la entrada: es un bug aquí dentro, y conviene que el
 *  mensaje lo diga en vez de culpar al usuario. */
export function describeInternalIssues(issues: readonly ValidationIssue[]): string {
  const listados = issues.slice(0, MAX_ISSUES_LISTADOS).map(i => `  · ${formatPath(i.path)}: ${i.message}`);
  return (
    "Error interno de fluyo-mcp: el documento resultante no pasó su propia validación.\n" +
    listados.join("\n") +
    "\nEs un fallo del servidor, no del diagrama. Por favor repórtalo en " +
    "https://github.com/itsnect/fluyo-mcp/issues con la operación que lo provocó."
  );
}

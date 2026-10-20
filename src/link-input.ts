import { inflateRawSync } from "node:zlib";

import { createKernel } from "./kernel.js";
import { DocumentObjectSchema } from "./model.js";
import { normalizeWith, revisionOfProject } from "./revision.js";

/**
 * MCP-TOKEN-EFFICIENCY-003 — el enlace `#d=` como `document`.
 *
 * El agente ya tiene el enlace en cada paso (resumen de create_*, `editorUrl` de la autoría). Pasarlo en vez de volver a emitir el
 * .fluyo.json recorta lo que más cuesta de una sesión: el documento era ~91 % de lo emitido, y el enlace es 4–9 veces más corto.
 *
 * LECTURA: la de `fluyo/js/link-codec.js` (el formato lo define el lector de la app, no este repo):
 *   base64url CANÓNICO ( [1 byte de versión] + [carga] ):  1 → deflate-raw · 0 → JSON en UTF-8 · otro → no se lee.
 *   Tope de lo descomprimido: el DEEP_LINK_MAX_BYTES de la app (2 MiB). Un enlace viene de donde sea: sin tope, 20 KB piden 20 MB.
 *
 * COPIA INEXACTA: un error de un carácter en el enlace da, sin revisión, un JSON válido y DISTINTO en el 4–6 % de los casos (medido). Por
 * eso un enlace exige SIEMPRE `baseRevision`, y la tool recibe el documento NORMALIZADO por el kernel —el que tiene esa revisión—: si se
 * acepta, es exactamente ese documento (salvo colisión de sha256). Lo que la normalización repara (un valor de presentación inválido
 * que vuelve al defecto) llega reparado, igual que si el documento de esa revisión se hubiera pasado como JSON.
 *
 * Pasa por el mismo schema de objeto que aplica Zod a un `document` objeto: con una copia exacta, cada respuesta es idéntica byte a
 * byte a la de pasar el JSON (el orden de las claves también).
 */

/** Tope de bytes descomprimidos: DEEP_LINK_MAX_BYTES de fluyo/js/link-codec.js. */
export const LINK_MAX_BYTES = 2 * 1024 * 1024;

/** Cualquier prefijo sin '#' ni espacios (fluyo.space, un self-host, o nada) + `#d=` + la carga. Nada se recorta: un espacio o un salto
 *  de línea es una copia inexacta. */
const LINK_RE = /^[^#\s]*#d=([A-Za-z0-9_-]+)$/;

export type LinkReason = "format" | "base64" | "version" | "decode" | "too_large" | "json";

export type LinkError =
  | { code: "DOCUMENT_LINK_UNREADABLE"; reason: LinkReason; message: string }
  | { code: "LINK_REVISION_REQUIRED"; message: string }
  | { code: "LINK_REVISION_MISMATCH"; message: string };

const RETRY = "Cópialo EXACTO de editorUrl o del resumen de create_* (sin espacios ni saltos de línea), o pasa el JSON del documento.";

const unreadable = (reason: LinkReason, why: string): LinkError => ({
  code: "DOCUMENT_LINK_UNREADABLE",
  reason,
  message: `El enlace #d= no se puede leer: ${why}. ${RETRY}`,
});

export const LINK_REVISION_REQUIRED_MESSAGE =
  "Un enlace #d= como document necesita baseRevision: pasa la revision o el resultRevision de la respuesta que te dio el enlace.";

/** Sin 'actual', a propósito: con un enlace, que no coincida es casi siempre una copia inexacta, y reintentar con la revisión de lo
 *  copiado aceptaría la corrupción (el texto de REVISION_MISMATCH invita justo a eso). */
export const LINK_REVISION_MISMATCH_MESSAGE =
  "El enlace no corresponde a baseRevision: casi siempre es una copia inexacta del enlace. " +
  "Cópialo de nuevo EXACTO de la última respuesta o pasa el JSON. No reintentes con otra revisión.";

/** Decodifica la carga de un enlace a su valor JSON, como el lector de la app. */
export function decodeLink(link: string): { ok: true; value: unknown } | { ok: false; error: LinkError } {
  const m = LINK_RE.exec(link);
  if (!m) return { ok: false, error: unreadable("format", "no tiene la forma <url>#d=<carga base64url>") };
  const payload = m[1];
  const bytes = Buffer.from(payload, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== payload) {
    return { ok: false, error: unreadable("base64", "la carga no es base64url canónico (¿cortada o con algún carácter de más?)") };
  }
  const version = bytes[0], body = bytes.subarray(1);
  let text: string;
  if (version === 1) {
    try {
      text = inflateRawSync(body, { maxOutputLength: LINK_MAX_BYTES }).toString("utf8");
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
        return { ok: false, error: unreadable("too_large", `descomprimido supera ${LINK_MAX_BYTES} bytes`) };
      }
      return { ok: false, error: unreadable("decode", "la carga no se puede descomprimir") };
    }
  } else if (version === 0) {
    if (body.length > LINK_MAX_BYTES) return { ok: false, error: unreadable("too_large", `supera ${LINK_MAX_BYTES} bytes`) };
    text = body.toString("utf8");
  } else {
    return { ok: false, error: unreadable("version", `versión de enlace ${version} desconocida`) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: unreadable("json", "lo descomprimido no es JSON") };
  }
}

/**
 * El `document` que ve la tool. Un objeto pasa tal cual (el camino de siempre, sin un byte de diferencia). Un enlace se decodifica,
 * exige `baseRevision`, se normaliza con el kernel y solo se acepta si su revisión es esa; entonces la tool recibe el documento
 * normalizado, por el mismo schema de objeto que un `document` objeto.
 */
export function resolveDocument(document: unknown, baseRevision: string | undefined): { ok: true; document: unknown } | { ok: false; error: LinkError } {
  if (typeof document !== "string") return { ok: true, document };
  const decoded = decodeLink(document);
  if (!decoded.ok) return decoded;
  if (baseRevision === undefined) return { ok: false, error: { code: "LINK_REVISION_REQUIRED", message: LINK_REVISION_REQUIRED_MESSAGE } };
  const normalized = normalizeWith(createKernel(), decoded.value);
  if (normalized === null || revisionOfProject(normalized) !== baseRevision) {
    return { ok: false, error: { code: "LINK_REVISION_MISMATCH", message: LINK_REVISION_MISMATCH_MESSAGE } };
  }
  return { ok: true, document: DocumentObjectSchema.parse(normalized) };
}

/** El error como texto, para las tools que devuelven `Error: …` (export_diagram, describe_document, run_story). */
export function linkErrorText(e: LinkError): string {
  return `${e.code}${"reason" in e ? ` (${e.reason})` : ""}: ${e.message}`;
}

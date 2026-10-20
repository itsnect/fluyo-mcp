import { sha256Hex, type Kernel } from "./kernel.js";

/** JSON canónico: claves ordenadas, sin timestamps ni nada del proceso. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter(k => o[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Revisión de un proyecto YA normalizado (formato de guardado del editor). */
export const revisionOfProject = (project: unknown): string => `sha256:${sha256Hex(canonicalJson(project))}`;

/** Normaliza con el kernel (misma frontera de entrada que el editor). null si el documento no es legible. */
export function normalizeWith(kernel: Kernel, document: unknown): unknown | null {
  const r = kernel.call<{ ok: boolean; project?: unknown }>("FluyoAuthoring.normalizedProject(__a)", document);
  return r.ok ? r.project : null;
}

/** La revisión de un documento: la de su forma normalizada, así que no depende de cómo se serializó. */
export function revisionOf(kernel: Kernel, document: unknown): string | null {
  const p = normalizeWith(kernel, document);
  return p === null ? null : revisionOfProject(p);
}

/** Texto de REVISION_MISMATCH (author_document, propose_layout). MCP-TOKEN-EFFICIENCY-002: el error ya trae la revisión real
 *  ('actual'), así que el caso habitual —reenviar el documento de la respuesta anterior con el baseRevision de antes— se arregla sin
 *  releer el documento. Solo si 'actual' no es la revisión que el agente tiene de esa respuesta hay que volver a describe_document. */
export const REVISION_MISMATCH_MESSAGE =
  "baseRevision no coincide: la revisión real de este documento va en 'actual'. " +
  "Si es el documento que devolvió tu última llamada y 'actual' es su revision/resultRevision, reintenta con baseRevision = 'actual' (sin describe_document); " +
  "si no, el documento cambió: reléelo con describe_document.";

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


import { createHash } from "node:crypto";
import vm from "node:vm";

import { KERNEL_FILES, KERNEL_ID } from "./generated/kernel-sources.js";

/**
 * El kernel de Fluyo (modelo de documento, motor de Scenarios, receta única de reproducción e
 * integridad) ejecutándose tal cual en un contexto `vm` NUEVO por llamada.
 *
 * Aquí no hay reglas de dominio: sólo se carga el código que generó scripts/sync-kernel.ts y se
 * le pasa/recibe JSON. Cada llamada a una tool crea su contexto (≈1 ms, 130 KB), así que el
 * estado global que usa model.js (`doc`) nunca se comparte entre peticiones ni entre documentos.
 *
 * Los datos cruzan el borde como JSON: ni objetos del host dentro del kernel ni objetos del
 * kernel fuera. Las expresiones que se evalúan son constantes de este código fuente, nunca
 * texto del cliente.
 */

/** Tiempo máximo de una evaluación. El motor tiene sus propios topes (1.000 Steps / 2.000 eventos). */
const EVAL_TIMEOUT_MS = 5_000;

export interface Kernel {
  /** Evalúa `expression` dentro del kernel con `__a` = `arg` (JSON) y devuelve su resultado como JSON. */
  call<T = unknown>(expression: string, arg?: unknown): T;
  /** Hash del conjunto de archivos del kernel (ver KERNEL_ID). */
  readonly kernelId: string;
}

export function createKernel(): Kernel {
  const context = vm.createContext({});
  for (const file of KERNEL_FILES) {
    vm.runInContext(file.source, context, { filename: `kernel/${file.name}`, timeout: EVAL_TIMEOUT_MS });
  }
  return {
    kernelId: KERNEL_ID,
    call<T>(expression: string, arg?: unknown): T {
      (context as Record<string, unknown>).__in = JSON.stringify(arg === undefined ? null : arg);
      const out = vm.runInContext(
        `JSON.stringify((function(){ const __a = JSON.parse(__in); return (${expression}); })())`,
        context,
        { filename: "kernel/call", timeout: EVAL_TIMEOUT_MS }
      ) as string | undefined;
      return (out === undefined ? undefined : JSON.parse(out)) as T;
    },
  };
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

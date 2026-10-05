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

/**
 * Globals de plataforma web que el kernel da por existentes (los trae todo navegador) y un `vm` vacío no.
 * safe-svg.js los usa para validar y reconstruir los nodos `image` (data URI base64 / SVG): atob, btoa,
 * TextEncoder y TextDecoder. Sin ellos, cualquier documento con un nodo image acababa en invalid_document.
 *
 * No es lógica de Fluyo: son las primitivas de Node envueltas. Los wrappers se crean DENTRO del contexto
 * (su `constructor` es del contexto, no del host) y solo ven las funciones del host por clausura, así el
 * código del kernel no recibe ningún objeto del host. Solo cruzan strings y bytes.
 */
const WEB_GLOBALS_SOURCE = `(function(h){
  "use strict";
  const toBytes=v=>ArrayBuffer.isView(v)?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):
    v instanceof ArrayBuffer?new Uint8Array(v):new Uint8Array(0);
  const def=(name,value)=>Object.defineProperty(globalThis,name,{value,writable:true,configurable:true,enumerable:false});
  def("atob",function atob(data){return h.atob(String(data));});
  def("btoa",function btoa(data){return h.btoa(String(data));});
  def("TextEncoder",class TextEncoder{
    get encoding(){return "utf-8";}
    encode(input=""){return Uint8Array.from(h.encode(String(input)));}
  });
  def("TextDecoder",class TextDecoder{
    #fatal;
    constructor(label="utf-8",options){
      if(!/^(utf-?8|unicode-1-1-utf-8)$/i.test(String(label).trim())) throw new RangeError("TextDecoder: solo utf-8");
      this.#fatal=!!(options&&options.fatal);
    }
    get encoding(){return "utf-8";}
    get fatal(){return this.#fatal;}
    decode(input){return h.decode(toBytes(input),this.#fatal);}
  });
})`;

function installWebGlobals(context: vm.Context): void {
  const install = vm.runInContext(WEB_GLOBALS_SOURCE, context, { filename: "kernel/web-globals", timeout: EVAL_TIMEOUT_MS }) as (h: object) => void;
  install({
    atob: (s: string): string => atob(s),
    btoa: (s: string): string => btoa(s),
    encode: (s: string): Uint8Array => new TextEncoder().encode(s),
    decode: (bytes: Uint8Array, fatal: boolean): string => new TextDecoder("utf-8", { fatal }).decode(bytes),
  });
}

export interface Kernel {
  /** Evalúa `expression` dentro del kernel con `__a` = `arg` (JSON) y devuelve su resultado como JSON. */
  call<T = unknown>(expression: string, arg?: unknown): T;
  /** Hash del conjunto de archivos del kernel (ver KERNEL_ID). */
  readonly kernelId: string;
}

export function createKernel(): Kernel {
  const context = vm.createContext({});
  installWebGlobals(context);
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

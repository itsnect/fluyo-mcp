/**
 * REGLA DURA: en `fluyo/` los scripts son CLÁSICOS, nunca módulos ES.
 *
 * No es preferencia de estilo. `file://` es un caso de uso soportado y anunciado
 * —fluyo/README.md:58 promete que «cargan perfectamente desde file://» y
 * CONTRIBUTING.md lo repite—, y medido en Chrome desde un origen `file:` real:
 *
 *     <script src> clásico (estático o inyectado)  →  funciona
 *     fetch()                                      →  bloqueado
 *     <script type="module"> / import              →  BLOQUEADO por CORS
 *
 * Un solo `import` de nivel superior en un js/*.js obliga al navegador a cargarlo
 * como módulo y rompe la app entera al abrirla con doble clic, sin más aviso que
 * un error de CORS en consola. Es un fallo que no se ve en desarrollo, porque en
 * desarrollo se sirve por HTTP.
 *
 * Y condiciona lo que viene: el catálogo de iconos de proveedor va a cargarse por
 * paquetes a demanda, y esos paquetes tienen que ser scripts clásicos inyectados
 * dinámicamente por esta misma razón (INFORME-ICONOS-MARCA.md §6.1).
 *
 * Este test vive en fluyo-mcp y no en fluyo/ porque fluyo/ no tiene runner —esa es
 * justamente su restricción— y aquí ya hay CI que carga el repo de al lado. Si
 * fluyo/ no está clonado al lado, la suite se salta; con REQUIRE_FLUYO=1, que es
 * como corre el job `drift`, la ausencia es fallo duro.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { packageRoot } from "./helpers.js";

const FLUYO_PATH = resolve(packageRoot(), process.env.FLUYO_PATH ?? join("..", "fluyo"));
const JS_DIR = join(FLUYO_PATH, "js");
const hayApp = existsSync(JS_DIR);
const EXIGE_APP = process.env.REQUIRE_FLUYO === "1";

/** Quita comentarios y literales de cadena antes de buscar. Sin esto, el propio
 *  comentario que explica la regla dispararía el test, y también lo haría una
 *  cadena que contenga la palabra `import` —que las hay: los mensajes de la app
 *  hablan de «importar» un diagrama—. */
function codigoDesnudo(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

function archivosJs(): string[] {
  return readdirSync(JS_DIR).filter(f => f.endsWith(".js")).sort();
}

describe("fluyo/ no puede usar módulos ES (rompería file://)", () => {
  it("el repo de la app está disponible para comprobarlo", () => {
    assert.ok(
      hayApp || !EXIGE_APP,
      `REQUIRE_FLUYO=1 pero no se encontró ${JS_DIR}. Esta comprobación es la que impide que alguien rompa la carga desde file://; si se salta, no protege nada.`
    );
  });

  it("hay archivos que comprobar", { skip: hayApp ? false : "sin fluyo/ al lado" }, () => {
    assert.ok(archivosJs().length >= 8, `Se esperaban al menos 8 js/*.js en ${JS_DIR}, hay ${archivosJs().length}. ¿Cambió la estructura del repo?`);
  });

  /* `import(...)` dinámico se permite explícitamente y por eso el patrón exige que
     tras `import` NO venga un paréntesis: un import dinámico no convierte el
     archivo en módulo y devuelve una promesa que se puede manejar. Lo que rompe
     file:// es el import/export ESTÁTICO, que sí obliga a `type="module"`. */
  const PROHIBIDO: Array<[string, RegExp]> = [
    ["un import estático", /(^|[;{}\s])import\s+(?![(.])/],
    ["un import estático sin espacio (import{...})", /(^|[;{}\s])import\s*\{/],
    ["un export", /(^|[;{}\s])export\s*(\{|\*|default\b|const\b|let\b|var\b|function\b|class\b)/],
    ["import.meta", /\bimport\s*\.\s*meta\b/],
  ];

  for (const archivo of hayApp ? archivosJs() : []) {
    it(`js/${archivo} es un script clásico`, () => {
      const desnudo = codigoDesnudo(readFileSync(join(JS_DIR, archivo), "utf8"));
      for (const [que, re] of PROHIBIDO) {
        const m = desnudo.match(re);
        assert.ok(
          !m,
          `js/${archivo} contiene ${que} ("${(m?.[0] ?? "").trim()}").\n\n` +
            `  Los scripts de fluyo/ tienen que ser CLÁSICOS. Un módulo ES lo bloquea el\n` +
            `  navegador en file:// por CORS, y file:// es un caso de uso soportado y\n` +
            `  anunciado en README.md:58 y en CONTRIBUTING.md.\n\n` +
            `  Si necesitas cargar código a demanda, inyecta un <script src> clásico:\n` +
            `  eso SÍ funciona desde file:// (medido). Ver INFORME-ICONOS-MARCA.md §6.1.`
        );
      }
    });
  }

  it("index.html no declara ningún <script type=\"module\">", { skip: hayApp ? false : "sin fluyo/ al lado" }, () => {
    const html = readFileSync(join(FLUYO_PATH, "index.html"), "utf8");
    const m = html.match(/<script[^>]*\btype\s*=\s*["']module["']/i);
    assert.ok(
      !m,
      `index.html declara un <script type="module">. El navegador lo bloquea en file:// por CORS ` +
        `y la app deja de abrirse con doble clic. Usa un <script src> clásico.`
    );
  });

  it("el service worker tampoco: importScripts es clásico, import no", { skip: hayApp ? false : "sin fluyo/ al lado" }, () => {
    const desnudo = codigoDesnudo(readFileSync(join(FLUYO_PATH, "sw.js"), "utf8"));
    assert.ok(
      !/(^|[;{}\s])(import|export)\s+(?![(.])/.test(desnudo),
      `sw.js usa import/export estático. Un service worker de tipo módulo no lo soportan todos los navegadores ` +
        `y rompe el registro; usa importScripts() si algún día hace falta trocearlo.`
    );
  });
});

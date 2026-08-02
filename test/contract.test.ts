/**
 * TEST DE CONTRATO — fluyo-mcp ↔ formato .fluyo.json
 *
 * Carga los cinco ejemplos REALES que Fluyo publica (copiados en test/fixtures/,
 * ver el README de esa carpeta) y verifica tres propiedades sobre cada uno:
 *
 *   a) el schema los acepta                    — no se rechaza lo que la app produce
 *   b) round-trip sin pérdida (deep-equal)     — no se descarta ni se inventa ninguna clave
 *   c) export_diagram produce SVG              — el renderer entiende todo lo que hay dentro
 *
 * (b) es el que importa. Un `z.object()` de Zod descarta las claves desconocidas en
 * silencio, así que sin esta comprobación el servidor puede "funcionar" mientras
 * borra el estilo del diagrama del usuario en cada llamada. Este test es la razón
 * por la que ese fallo no puede volver a colarse.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { FluyoProjectSchema } from "../src/model.js";
import {
  collectDiffs,
  isToolError,
  loadFixtures,
  startHarness,
  summarizeDiffs,
  summarizeZodIssues,
  textOf,
  type Harness,
} from "./helpers.js";

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h?.close(); });

const fixtures = loadFixtures();

describe("contrato con el formato .fluyo.json que produce la app", () => {
  it("hay cinco ejemplos reales cargados", () => {
    assert.equal(fixtures.length, 5, "se esperaban los 5 ejemplos de fluyo/ejemplos/data");
  });

  for (const fx of fixtures) {
    describe(fx.name, () => {
      it("a) FluyoProjectSchema lo acepta", () => {
        const res = FluyoProjectSchema.safeParse(fx.doc);
        assert.ok(
          res.success,
          res.success ? "" : `el schema RECHAZA un documento real de Fluyo:\n${summarizeZodIssues(res.error.issues)}\n`
        );
      });

      it("b) round-trip sin pérdida (deep-equal, campo por campo)", () => {
        const res = FluyoProjectSchema.safeParse(fx.doc);
        if (!res.success) {
          assert.fail(
            `no se puede comprobar el round-trip porque el schema rechaza el documento:\n${summarizeZodIssues(res.error.issues)}\n`
          );
        }
        const diffs = collectDiffs(fx.doc, res.data);
        assert.equal(
          diffs.length,
          0,
          `el round-trip NO es lossless — ${diffs.length} diferencia(s):\n${summarizeDiffs(diffs)}\n`
        );
        // Red de seguridad por si collectDiffs se dejara algún caso.
        assert.deepStrictEqual(res.data, fx.doc);
      });

      it("c) export_diagram produce SVG", async () => {
        const result = await h.client.callTool({ name: "export_diagram", arguments: { document: fx.doc } });
        const text = textOf(result);
        assert.ok(!isToolError(result), `export_diagram devolvió error:\n    ${text}\n`);
        assert.match(text, /<svg[\s>]/, "la respuesta no contiene un elemento <svg>");
        assert.match(text, /<\/svg>/, "el SVG no está cerrado");
      });
    });
  }
});

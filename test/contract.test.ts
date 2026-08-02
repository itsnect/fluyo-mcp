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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { FluyoProjectSchema } from "../src/model.js";
import { buildServer } from "../src/server.js";

/* ===================== Localizar las fixtures ===================== */

/** Sube desde este archivo hasta el package.json. Funciona igual corriendo desde
 *  `src/` con un loader de TS que desde `dist-test/`, que es donde cae compilado. */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("No se encontró package.json subiendo desde el test.");
    dir = parent;
  }
  return dir;
}

const FIXTURES_DIR = join(packageRoot(), "test", "fixtures");

interface Fixture {
  name: string;
  raw: string;
  doc: unknown;
}

function loadFixtures(): Fixture[] {
  const files = readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith(".fluyo.json"))
    .sort();
  if (!files.length) throw new Error(`No hay fixtures en ${FIXTURES_DIR}`);
  return files.map(name => {
    const raw = readFileSync(join(FIXTURES_DIR, name), "utf8");
    return { name, raw, doc: JSON.parse(raw) as unknown };
  });
}

/* ===================== Diff estructural legible ===================== */

type DiffKind = "descartada" | "añadida" | "distinta";
interface Diff {
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Compara el documento original con el que sale del schema y devuelve TODAS las
 *  diferencias, distinguiendo claves descartadas (el fallo grave) de claves añadidas
 *  por un `.default()` (también rompe el round-trip) y de valores cambiados. */
function collectDiffs(before: unknown, after: unknown, path = "$"): Diff[] {
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) return [{ path, kind: "distinta", before, after }];
    const out: Diff[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      out.push(...collectDiffs(before[i], after[i], `${path}[${i}]`));
    }
    return out;
  }
  if (isPlainObject(before)) {
    if (!isPlainObject(after)) return [{ path, kind: "distinta", before, after }];
    const out: Diff[] = [];
    for (const k of Object.keys(before)) {
      if (!(k in after)) out.push({ path: `${path}.${k}`, kind: "descartada", before: before[k], after: undefined });
      else out.push(...collectDiffs(before[k], after[k], `${path}.${k}`));
    }
    for (const k of Object.keys(after)) {
      if (!(k in before)) out.push({ path: `${path}.${k}`, kind: "añadida", before: undefined, after: after[k] });
    }
    return out;
  }
  if (!Object.is(before, after)) return [{ path, kind: "distinta", before, after }];
  return [];
}

/** Un diagrama de 10 nodos que pierde 6 claves produce 60 diffs idénticos en forma.
 *  Se colapsan los índices de array para que el informe quepa en pantalla y se lea. */
function summarizeDiffs(diffs: Diff[]): string {
  const groups = new Map<string, { kind: DiffKind; count: number; sample: Diff }>();
  for (const d of diffs) {
    const shape = d.path.replace(/\[\d+\]/g, "[*]");
    const key = `${d.kind}|${shape}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { kind: d.kind, count: 1, sample: d });
  }
  const lines = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, g]) => {
      const shape = key.slice(key.indexOf("|") + 1);
      const veces = g.count === 1 ? "" : ` ×${g.count}`;
      const valor =
        g.kind === "descartada" ? ` (valor original: ${JSON.stringify(g.sample.before)})`
        : g.kind === "añadida" ? ` (valor inyectado: ${JSON.stringify(g.sample.after)})`
        : ` (${JSON.stringify(g.sample.before)} → ${JSON.stringify(g.sample.after)})`;
      return `    ${g.kind.toUpperCase().padEnd(11)} ${shape}${veces}${valor}`;
    });
  return lines.join("\n");
}

/** Los issues de Zod salen como JSON crudo con `err.message`. Aquí se resumen. */
function summarizeZodIssues(issues: readonly { path: PropertyKey[]; message: string; code?: string }[]): string {
  const groups = new Map<string, number>();
  for (const i of issues) {
    const shape = i.path.map(p => (typeof p === "number" ? "*" : String(p))).join(".");
    const key = `${shape}: ${i.message}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([k, n]) => `    ${k}${n > 1 ? ` ×${n}` : ""}`)
    .join("\n");
}

/* ===================== Cliente MCP en memoria ===================== */

let client: Client;
let closeClient: () => Promise<void>;

before(async () => {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "contract-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeClient = async () => {
    await client.close();
    await server.close();
  };
});

after(async () => {
  await closeClient?.();
});

/** `callTool` devuelve una unión que incluye la forma legacy `{toolResult}`, así que
 *  se accede al contenido con un narrowing manual en vez de tipar el parámetro. */
function textOf(result: unknown): string {
  const blocks = ((result as { content?: unknown }).content ?? []) as Array<{ type: string; text?: string }>;
  return blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("\n");
}
function isToolError(result: unknown): boolean {
  return (result as { isError?: unknown }).isError === true;
}

/* ===================== El contrato ===================== */

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
          res.success
            ? ""
            : `el schema RECHAZA un documento real de Fluyo:\n${summarizeZodIssues(res.error.issues)}\n`
        );
      });

      it("b) round-trip sin pérdida (deep-equal, campo por campo)", () => {
        const res = FluyoProjectSchema.safeParse(fx.doc);
        if (!res.success) {
          assert.fail(
            `no se puede comprobar el round-trip porque el schema rechaza el documento:\n` +
              `${summarizeZodIssues(res.error.issues)}\n`
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
        const result = await client.callTool({
          name: "export_diagram",
          arguments: { document: fx.doc },
        });
        const text = textOf(result);
        assert.ok(!isToolError(result), `export_diagram devolvió error:\n    ${text}\n`);
        assert.match(text, /<svg[\s>]/, "la respuesta no contiene un elemento <svg>");
        assert.match(text, /<\/svg>/, "el SVG no está cerrado");
      });
    });
  }
});

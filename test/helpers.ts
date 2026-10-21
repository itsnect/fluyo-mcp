/** Utilidades compartidas por los tests. No es un `*.test.js`, así que el runner
 *  no lo ejecuta como suite. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../src/server.js";

/* ===================== Fixtures ===================== */

/** Sube desde este archivo hasta el package.json. Funciona igual corriendo desde
 *  `src/` con un loader de TS que desde `dist-test/`, que es donde cae compilado. */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("No se encontró package.json subiendo desde el test.");
    dir = parent;
  }
  return dir;
}

export const FIXTURES_DIR = join(packageRoot(), "test", "fixtures");

export interface Fixture {
  name: string;
  doc: unknown;
}

export function loadFixtures(): Fixture[] {
  /* Solo los ejemplos publicados (copias de fluyo/ejemplos/data). Los fixtures compartidos de una tarea (`fluyo-0xx-*`, p. ej. el
     documento con la piel de FLUYO-019.2) viven en el mismo directorio porque fluyo los compara por esa ruta, pero no son ejemplos. */
  const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith(".fluyo.json") && !f.startsWith("fluyo-")).sort();
  if (!files.length) throw new Error(`No hay fixtures en ${FIXTURES_DIR}`);
  return files.map(name => ({
    name,
    doc: JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")) as unknown,
  }));
}

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")) as unknown;
}

/* ===================== Cliente MCP en memoria ===================== */

export interface Harness {
  client: Client;
  close: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fluyo-mcp-tests", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** FLUYO-MCP-CATALOG-COMPACTION-001: el inputSchema publicado con sus $ref resueltos contra sus `definitions` (y sin ellas), es decir,
 *  la forma expandida que publicaba el catálogo antes de compartir esquemas. `{$ref}` solo → la definición; `{allOf:[{$ref}], …hermanos}`
 *  (lo que emite Zod en draft-07 cuando el uso lleva description u optional) → la definición con los hermanos encima. No muta la entrada. */
export function derefSchema(schema: any): any {
  const defs: Record<string, unknown> = schema?.definitions ?? {};
  const target = (ref: string) => {
    const m = /^#\/definitions\/(.+)$/.exec(ref);
    if (!m || !(m[1] in defs)) throw new Error(`$ref sin definición: ${ref}`);
    return defs[m[1]];
  };
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    if (typeof v.$ref === "string" && Object.keys(v).length === 1) return walk(target(v.$ref));
    if (Array.isArray(v.allOf) && v.allOf.length === 1 && typeof v.allOf[0]?.$ref === "string" && Object.keys(v.allOf[0]).length === 1) {
      const { allOf, ...siblings } = v;
      return { ...walk(target(allOf[0].$ref)), ...walk(siblings) };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  const { definitions, ...rest } = schema ?? {};
  return walk(rest);
}

/** `callTool` devuelve una unión que incluye la forma legacy `{toolResult}`, así que
 *  se accede al contenido con narrowing manual en vez de tipar el parámetro. */
export function textBlocks(result: unknown): string[] {
  const blocks = ((result as { content?: unknown }).content ?? []) as Array<{ type: string; text?: string }>;
  return blocks.filter(b => b.type === "text").map(b => b.text ?? "");
}
export function textOf(result: unknown): string {
  return textBlocks(result).join("\n");
}
export function isToolError(result: unknown): boolean {
  return (result as { isError?: unknown }).isError === true;
}
/** Los tools que devuelven documento contestan [resumen, json]. */
export function documentOf(result: unknown): any {
  const blocks = textBlocks(result);
  if (blocks.length < 2) throw new Error(`se esperaba [resumen, json], llegaron ${blocks.length} bloque(s): ${blocks[0] ?? ""}`);
  return JSON.parse(blocks[blocks.length - 1]);
}

/* ===================== Diff estructural legible ===================== */

export type DiffKind = "descartada" | "añadida" | "distinta";
export interface Diff {
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Compara dos documentos y devuelve TODAS las diferencias, distinguiendo claves
 *  descartadas (el fallo grave) de claves añadidas por un `.default()` (también
 *  rompe el round-trip) y de valores cambiados. */
export function collectDiffs(before: unknown, after: unknown, path = "$"): Diff[] {
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
export function summarizeDiffs(diffs: Diff[]): string {
  const groups = new Map<string, { kind: DiffKind; count: number; sample: Diff }>();
  for (const d of diffs) {
    const key = `${d.kind}|${d.path.replace(/\[\d+\]/g, "[*]")}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { kind: d.kind, count: 1, sample: d });
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, g]) => {
      const shape = key.slice(key.indexOf("|") + 1);
      const veces = g.count === 1 ? "" : ` ×${g.count}`;
      const valor =
        g.kind === "descartada" ? ` (valor original: ${JSON.stringify(g.sample.before)})`
        : g.kind === "añadida" ? ` (valor inyectado: ${JSON.stringify(g.sample.after)})`
        : ` (${JSON.stringify(g.sample.before)} → ${JSON.stringify(g.sample.after)})`;
      return `    ${g.kind.toUpperCase().padEnd(11)} ${shape}${veces}${valor}`;
    })
    .join("\n");
}

/** Los issues de Zod salen como JSON crudo con `err.message`. Aquí se resumen. */
export function summarizeZodIssues(
  issues: readonly { path: PropertyKey[]; message: string }[]
): string {
  const groups = new Map<string, number>();
  for (const i of issues) {
    const shape = i.path.map(p => (typeof p === "number" ? "*" : String(p))).join(".");
    groups.set(`${shape}: ${i.message}`, (groups.get(`${shape}: ${i.message}`) ?? 0) + 1);
  }
  return [...groups.entries()].map(([k, n]) => `    ${k}${n > 1 ? ` ×${n}` : ""}`).join("\n");
}

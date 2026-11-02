/**
 * FLUYO-MCP-STORY-AUTHORING-001 (G4): los errores de schema, estructurados y cortos.
 *
 * El SDK valida con Zod ANTES de llamar a la tool y devuelve el array de issues serializado: con la unión de `target` eran hasta 3,8 KB
 * de ramas que no tocan. Aquí se elige la rama que explica el error y se devuelve lo accionable: path, issue y expected. Sigue siendo el
 * mismo resultado de MCP (`isError`, 1.er bloque con el prefijo de siempre); lo nuevo es el 2.º bloque, con la forma de los demás
 * rechazos ({ok:false, valid:false, errors[]}).
 *
 * No se repite ningún valor de la entrada: solo rutas, tipos y las listas cerradas del propio schema.
 */

const PREFIX = /^MCP error -32602: Input validation error: Invalid arguments for tool (\S+): ([\s\S]*)$/;
const MAX_ERRORS = 5;

interface ZodIssue {
  code?: string;
  path?: Array<string | number>;
  message?: string;
  expected?: string;
  errors?: ZodIssue[][];
  discriminator?: string;
  options?: unknown[];
  values?: unknown[];
  keys?: string[];
  maximum?: number;
  minimum?: number;
  pattern?: string;
}

interface Leaf {
  path: Array<string | number>;
  issue: string;
  expected?: string;
  received?: string;
  keys?: string[];
  message: string;
}

const receivedIn = (message: string | undefined): string | undefined => /received (\w+)/.exec(message ?? "")?.[1];

function expectedOf(i: ZodIssue): string | undefined {
  if (i.code === "too_big") return `<= ${i.maximum}`;
  if (i.code === "too_small") return `>= ${i.minimum}`;
  if (i.code === "invalid_value") return (i.values ?? []).map(String).join(" | ");
  if (i.code === "invalid_format") return i.pattern;
  return i.expected;
}

function leavesOf(issue: ZodIssue, base: Array<string | number>): Leaf[] {
  const path = [...base, ...(issue.path ?? [])];
  if (issue.code !== "invalid_union") {
    return [{
      path,
      issue: issue.code ?? "invalid",
      expected: expectedOf(issue),
      received: receivedIn(issue.message),
      ...(issue.keys ? { keys: issue.keys } : {}),
      message: issue.message ?? "Valor no válido.",
    }];
  }
  if (issue.discriminator) {
    return [{
      path: path[path.length - 1] === issue.discriminator ? path : [...path, issue.discriminator],
      issue: "invalid_discriminator",
      expected: (issue.options ?? []).map(String).join(" | "),
      message: `Valor de '${issue.discriminator}' no válido.`,
    }];
  }
  const branches = (issue.errors ?? []).map(b => b.flatMap(i => leavesOf(i, path)));
  if (!branches.length) return [{ path, issue: "invalid_union", message: issue.message ?? "Valor no válido." }];
  /* La rama que explica el error es la que menos cosas echa en falta (claves ausentes o sobrantes son «otra forma», no un fallo de esta). */
  const misses = (b: Leaf[]) => b.filter(l => l.issue === "unrecognized_keys" || l.received === "undefined").length;
  const depth = (b: Leaf[]) => Math.max(...b.map(l => l.path.length));
  const best = [...branches].sort((a, b) => misses(a) - misses(b) || depth(b) - depth(a) || a.length - b.length)[0];
  /* Varias ramas con el mismo fallo en la misma ruta (número o {ref}) son una sola explicación: se juntan sus `expected`. */
  if (best.length === 1) {
    const at = JSON.stringify(best[0].path);
    const same = branches.filter(b => b.length === 1 && JSON.stringify(b[0].path) === at).map(b => b[0]);
    const expected = [...new Set(same.map(l => l.expected).filter(Boolean))].join(" | ");
    return [{ ...best[0], ...(expected ? { expected } : {}) }];
  }
  return best;
}

const pathText = (path: Array<string | number>): string =>
  path.map((p, i) => (typeof p === "number" ? `[${p}]` : i ? `.${p}` : String(p))).join("") || "(raíz)";

function operationAt(path: Array<string | number>, args: unknown): { operationIndex: number; operation?: string } | undefined {
  if (path[0] !== "operations" || typeof path[1] !== "number") return undefined;
  const list = (args as { operations?: unknown } | null | undefined)?.operations;
  const op = Array.isArray(list) ? (list[path[1]] as { op?: unknown } | null | undefined)?.op : undefined;
  return { operationIndex: path[1], ...(typeof op === "string" && op.length <= 40 ? { operation: op } : {}) };
}

type ToolResultLike = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

/** El resultado de validación del SDK con su explicación estructurada; cualquier otro resultado, tal cual. */
export function withStructuredSchemaError<T extends ToolResultLike>(result: T, args: unknown): T {
  const text = result.isError && result.content?.length === 1 ? result.content[0].text : undefined;
  const m = text === undefined ? null : PREFIX.exec(text);
  if (!m) return result;
  let issues: ZodIssue[];
  try {
    issues = JSON.parse(m[2]) as ZodIssue[];
    if (!Array.isArray(issues)) return result;
  } catch {
    return result;
  }
  const leaves = issues.flatMap(i => leavesOf(i, []));
  const errors = leaves.slice(0, MAX_ERRORS).map(l => ({
    code: "SCHEMA_INVALID",
    path: pathText(l.path),
    ...operationAt(l.path, args),
    issue: l.issue,
    ...(l.expected ? { expected: l.expected } : {}),
    ...(l.received ? { received: l.received } : {}),
    ...(l.keys ? { keys: l.keys } : {}),
    message: l.message,
  }));
  const body = {
    ok: false,
    valid: false,
    errors,
    ...(leaves.length > MAX_ERRORS ? { moreErrors: leaves.length - MAX_ERRORS } : {}),
    note: "La llamada no se ejecutó: corrige estos campos y repítela.",
  };
  const first = errors[0];
  const summary = `MCP error -32602: Input validation error (SCHEMA_INVALID) en ${m[1]}: ${first ? `${first.path}: ${first.message}` : "entrada no válida"}`;
  return { ...result, content: [{ type: "text", text: summary }, { type: "text", text: JSON.stringify(body) }] };
}

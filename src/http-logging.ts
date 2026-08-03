/**
 * REGISTRO DEL SERVIDOR HTTP — y, sobre todo, lo que este servidor NO registra.
 *
 * fluyo.space publica que los diagramas de sus usuarios no se almacenan. Para que
 * eso siga siendo cierto con un endpoint remoto de por medio, este módulo es el
 * ÚNICO sitio del proceso que escribe a stdout/stderr durante una petición, y el
 * tipo `RequestLog` es deliberadamente cerrado: no hay ningún campo donde quepa
 * contenido del usuario, así que no hay forma de filtrarlo por descuido.
 *
 * Lo que se registra, y nada más:
 *   · qué ruta y método se pidió
 *   · el nombre de las tools invocadas (no sus argumentos)
 *   · el código de estado y el desenlace
 *   · duración en milisegundos
 *   · tamaño en bytes de la petición y de la respuesta
 *
 * Lo que NO se registra, por decisión explícita:
 *   · el documento, las etiquetas, los colores o cualquier otro dato del diagrama
 *   · los argumentos de las tools, ni siquiera truncados o con hash
 *   · el cuerpo de la respuesta (el SVG, el JSON del documento)
 *   · los mensajes de error — ni los de `src/errors.ts`, que sí pueden nombrar
 *     valores del usuario porque van AL MODELO como respuesta, nunca al log
 *   · stack traces (un `err.message` de Zod arrastra el valor que falló)
 *   · la IP del cliente, ni completa ni truncada ni con hash
 *   · cabeceras, cookies, User-Agent, Origin
 *
 * No hay modo debug que levante estas restricciones. Si hiciera falta depurar un
 * fallo de producción, la vía es reproducirlo en local con stdio, no aflojar esto.
 */

/** Por qué terminó la petición. Un enum cerrado, no texto libre: así no hay hueco
 *  donde un mensaje de error acabe colándose en el log. */
export type Outcome =
  | "ok"
  /** La tool respondió `isError: true`. El motivo va al modelo, no aquí. */
  | "tool_error"
  | "forbidden_origin"
  | "rate_limited"
  | "payload_too_large"
  | "response_too_large"
  | "method_not_allowed"
  | "bad_request"
  | "not_found"
  /** Excepción no controlada. Se registra el nombre de la clase de error y ya. */
  | "internal_error";

export interface RequestLog {
  /** Ruta pedida, ya normalizada y sin query string. */
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly outcome: Outcome;
  readonly durationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  /** Nombres de las tools invocadas en esta petición. Nunca sus argumentos. */
  readonly tools?: readonly string[];
  /** Cuántas de ellas devolvieron `isError`. Sin el motivo. */
  readonly toolErrors?: number;
  /** Solo para `internal_error`: el nombre de la clase (`TypeError`, `ZodError`…).
   *  Nunca `err.message` ni `err.stack`, que sí pueden arrastrar datos del usuario. */
  readonly errorType?: string;
}

export type Logger = (entry: RequestLog) => void;

/** Una línea JSON por petición en stderr. stdout queda libre: en el transporte
 *  stdio es el canal del protocolo, y conviene no acostumbrarse a escribir ahí. */
export const stderrLogger: Logger = entry => {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
};

/** Para tests y para `FLUYO_MCP_LOG=off`. */
export const silentLogger: Logger = () => {};

/** El nombre de la clase de una excepción, que es lo máximo que se puede registrar
 *  de un error sin arriesgarse a filtrar el valor que lo provocó. */
export function errorTypeOf(err: unknown): string {
  if (err instanceof Error) return err.constructor?.name || "Error";
  return typeof err;
}

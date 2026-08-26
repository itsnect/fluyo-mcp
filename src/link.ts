import { deflateRawSync } from "node:zlib";

import type { FluyoProject } from "./model.js";

/**
 * Enlace que abre un diagrama directamente en la app: `fluyo.space/#d=<carga>`.
 *
 * Es el último paso del recorrido. Antes de esto, una tool devolvía JSON en el
 * chat y para ver la animación —que es el diferenciador del producto— había que
 * copiarlo, guardarlo como `.fluyo.json` y abrirlo a mano con el botón «Abrir».
 *
 * POR QUÉ EL FRAGMENTO
 *
 * El diagrama va DETRÁS de la almohadilla, y eso no es un detalle estético: el
 * navegador no envía el fragmento al servidor, ni en la petición ni en la
 * cabecera `Referer`. El diagrama viaja dentro del enlace sin llegar a ningún
 * registro de acceso, que es lo que permite que esto exista sin contradecir lo
 * que la política de privacidad promete. Y no hace falta backend: no hay nada
 * que dar de alta ni nada que caduque. El enlace ES el diagrama.
 *
 * La contrapartida, dicha en voz alta: va CODIFICADO, no cifrado. Quien reciba
 * el enlace puede leer el diagrama.
 *
 * FORMATO
 *
 *     #d= base64url( [1 byte de versión] + [carga] )
 *
 *     1 → deflate-raw            ← lo que se emite aquí
 *     0 → JSON en UTF-8 tal cual ← lo entiende el lector, no se emite
 *
 * El byte de versión va dentro de la carga y no en la URL, para no ensuciarla.
 * El lector está en `fluyo/js/deeplink.js`, y `deflateRawSync` de Node y
 * `DecompressionStream("deflate-raw")` del navegador producen y leen el mismo
 * formato — hay un test en `fluyo/test/documento-entrante.html` que lee con el
 * navegador cargas generadas aquí, precisamente porque ese es el acoplamiento
 * que puede romperse sin que nadie se entere.
 *
 * TAMAÑO
 *
 * Medido sobre los ocho ejemplos publicados: 3.971 bytes de JSON minificado de
 * media acaban en 1.061 caracteres de URL, factor 5 gracias a lo repetitivo que
 * es este JSON (cada nodo repite las mismas claves con los mismos valores por
 * defecto). Un diagrama de 8 nodos son 987 caracteres; uno de 30, 2.429.
 */

/** Dónde vive la app que abrirá el enlace. Se puede cambiar con `FLUYO_APP_URL`
 *  para un self-host o para una copia local. */
export const DEFAULT_APP_URL = "https://fluyo.space/";

/**
 * Tope de caracteres del enlace completo. Por encima no se emite enlace.
 *
 * El límite NO lo pone el navegador: Chrome acepta fragmentos de dos millones
 * de caracteres sin inmutarse. Lo pone el medio por el que viaja el enlace —un
 * cliente de correo en texto plano parte las líneas largas, y una URL partida
 * ya no abre nada. 16.000 caracteres son unos 150 nodos, que deja fuera de este
 * camino solo a los diagramas que además ya rozan el tope de 200 KB del
 * despliegue HTTP.
 *
 * Lo que de verdad dispara este tope no es el número de nodos: son los nodos
 * `image`, que llevan la imagen entera dentro como data URI. El MCP no puede
 * crearlos (`CreatableShapeSchema` excluye `image`) pero sí recibe documentos
 * que ya los tienen, y uno solo puede pesar más que un diagrama de cien nodos.
 */
export const MAX_LINK_CHARS = 16_000;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base del enlace, con el fragmento que traiga ya quitado. Un valor de entorno
 *  que no sea una URL se ignora en vez de producir enlaces rotos en silencio. */
function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.FLUYO_APP_URL?.trim();
  if (!raw) return DEFAULT_APP_URL;
  try {
    new URL(raw);
    return raw.replace(/#.*$/, "");
  } catch {
    return DEFAULT_APP_URL;
  }
}

/**
 * Devuelve el enlace, o `null` si no cabe.
 *
 * Devolver `null` en vez de lanzar es deliberado: que un diagrama no quepa en
 * una URL no lo hace inválido ni invalida la respuesta de la tool. El JSON sale
 * igual y quien llama explica el porqué en una frase.
 */
export function buildOpenLink(project: FluyoProject, env?: NodeJS.ProcessEnv): string | null {
  const json = Buffer.from(JSON.stringify(project), "utf8");
  const carga = Buffer.concat([Buffer.from([1]), deflateRawSync(json, { level: 9 })]);
  const url = `${appBaseUrl(env)}#d=${base64url(carga)}`;
  return url.length > MAX_LINK_CHARS ? null : url;
}

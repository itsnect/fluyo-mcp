/**
 * Punto de entrada de Vercel. Todo el tráfico del dominio llega aquí por el
 * rewrite de vercel.json, incluida la ruta del challenge de OpenAI.
 *
 * Es JavaScript plano a propósito: importa `dist/`, que ya produjo `npm run build`
 * (el buildCommand de vercel.json), en vez de pedirle a la plataforma que compile
 * TypeScript con una configuración distinta a la del repo. Si el deploy falla aquí
 * con "cannot resolve ../dist/http.js", lo que falló es el build, y conviene verlo
 * como el error que es.
 *
 * El manejador se crea UNA vez por instancia, no por petición: así el contador del
 * rate limit sobrevive entre peticiones que caigan en la misma instancia caliente.
 */

import { createRequestHandler, configFromEnv, installSafeProcessHandlers } from "../dist/http.js";

// Sin esto, una promesa rechazada sin atender haría que Node imprimiese el error
// entero —mensaje y stack— en los logs de la plataforma. Ver http-logging.ts.
installSafeProcessHandlers();

export default createRequestHandler(configFromEnv());

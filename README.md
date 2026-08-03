# fluyo-mcp

Servidor MCP para **[Fluyo](https://github.com/itsnect/fluyo)**: crea, edita y exporta diagramas de arquitectura desde un asistente de IA, operando sobre el mismo formato `.fluyo.json` que produce y consume la aplicación.

No necesita backend. Es una capa delgada sobre el modelo de documento de Fluyo, así que lo que genera se abre con el botón **Abrir** del editor sin conversión de por medio, y un diagrama guardado desde la app se puede seguir editando desde aquí.

---

## Qué resuelve

| Tool | Para qué |
|---|---|
| `create_diagram` | Texto → diagrama. Nodos y aristas; si no das `x`/`y`, aplica auto-layout por capas. |
| `edit_diagram` | Modifica un documento existente con operaciones (añadir, actualizar, borrar, cambiar tema, recalcular layout). |
| `export_diagram` | Renderiza una página a SVG estático. |
| `list_templates` / `create_from_template` | Instancia patrones de arquitectura predefinidos (Kafka, RAG, microservicios) con reemplazo de etiquetas. |
| `list_icons` | Las 47 claves de ícono, agrupadas (General, GCP, AWS, Azure, Estados, Varios). |
| `list_colors` | Los 14 colores semánticos de la paleta. |
| `list_anims` | Los 8 GIFs animados para nodos `shape:"anim"`. |
| `list_fonts` | Las 11 tipografías disponibles. |

Las nueve son funciones puras: reciben JSON y devuelven JSON, sin tocar disco, red ni ningún estado externo. Van anotadas como tal (`readOnlyHint`, `idempotentHint`).

---

## Instalación

```bash
npm install
npm run build
```

Requiere **Node 22.18 o superior**.

```bash
npm test        # contrato contra los ejemplos reales de Fluyo, tools y renderer
```

---

## Conectarlo

Hay dos transportes sobre el mismo núcleo. Las nueve tools, sus schemas y el renderer son idénticos en los dos; lo único que cambia es por dónde entran los mensajes.

| | stdio | Streamable HTTP |
|---|---|---|
| Entry point | `src/index.ts` | `src/http.ts` |
| Uso | local, el proceso lo lanza el cliente | conector remoto en `mcp.fluyo.space` |
| Sesiones | una por proceso | ninguna: **stateless**, cada petición se procesa y se descarta |
| Topes | ninguno | 1 MB de entrada, 200 KB por respuesta de tool, 30 req/min por IP |

### Como conector remoto

```text
POST https://mcp.fluyo.space/mcp
```

Sin autenticación y sin `Mcp-Session-Id`. Pega esa URL donde tu cliente pida un servidor MCP remoto.

### Como proceso local (stdio)

Añade el servidor a la configuración MCP de Claude Code o Claude Desktop:

```json
{
  "mcpServers": {
    "fluyo": {
      "command": "node",
      "args": ["/ruta/absoluta/a/fluyo-mcp/dist/index.js"]
    }
  }
}
```

O como ejecutable global (`npm link`):

```json
{
  "mcpServers": {
    "fluyo": { "command": "fluyo-mcp" }
  }
}
```

---

## Ejemplo de uso

> Diagrama un pipeline donde un API Gateway recibe requests, publica eventos en Kafka y dos servicios consumidores procesan los mensajes; uno de ellos persiste en Cloud SQL.

El modelo llamará a `create_diagram` con algo así:

```json
{
  "pageName": "Pipeline de eventos",
  "nodes": [
    { "key": "gw",    "shape": "rect",     "label": "API Gateway", "color": "Servicio" },
    { "key": "kafka", "shape": "icon",     "label": "Kafka", "icon": "kafka", "pulse": true, "color": "Eventos / Kafka" },
    { "key": "svcA",  "shape": "rect",     "label": "Servicio A", "color": "Servicio" },
    { "key": "svcB",  "shape": "rect",     "label": "Servicio B", "color": "Servicio" },
    { "key": "db",    "shape": "cylinder", "label": "Cloud SQL", "color": "Datos" }
  ],
  "edges": [
    { "from": "gw",    "to": "kafka", "label": "evento",       "route": "ortho" },
    { "from": "kafka", "to": "svcA",  "label": "topic: A",     "route": "ortho" },
    { "from": "kafka", "to": "svcB",  "label": "topic: B",     "route": "ortho" },
    { "from": "svcB",  "to": "db",    "label": "persistencia", "dashed": true }
  ]
}
```

El resultado es un `.fluyo.json` completo, listo para abrir en Fluyo o para seguir editando con `edit_diagram`.

---

## Operaciones de `edit_diagram`

Se envían como lista en `operations` y se aplican en orden.

| Operación | Campos principales | Descripción |
|---|---|---|
| `add_node` | `key`, `shape`, `label`, `color?`, `icon?`, `anim?`, estilo… | Añade un nodo. `key` solo vive durante la llamada, para que `add_edge` pueda referenciarlo. |
| `update_node` | `id`, … | Actualiza un nodo por su id numérico. |
| `remove_node` | `id` | Elimina el nodo y todas sus conexiones. |
| `add_edge` | `from`, `to`, … | Crea una conexión. Acepta ids existentes o `key` de nodos creados en la misma llamada. |
| `update_edge` | `id`, … | Modifica una arista. |
| `remove_edge` | `id` | Elimina una arista. |
| `set_theme` | `theme` | `dark`, `crema` o `claro`. |
| `rename_page` | `name` | Renombra la página. |
| `relayout` | — | Recalcula las posiciones en capas. **Borra todos los waypoints manuales** de la página. |

> Para referenciar nodos que ya existen en el documento usa siempre su `id` numérico. Las `key` de `add_node` son temporales y no se guardan en el `.fluyo.json`.

---

## Fidelidad con la aplicación

Importa ser preciso aquí, porque una versión anterior de este README prometía paridad que el código no daba.

**Derivado mecánicamente de Fluyo** — `npm run sync:config` lee `fluyo/js/config.js` y `fluyo/js/state.js` y genera `src/generated/config.ts`. La paleta, los temas, los 47 íconos con su SVG, los 8 GIFs, las 11 tipografías y los tamaños por forma no se copian a mano: se extraen. CI comprueba que sigan sincronizados.

**Portado a mano, verificado por tests** — la geometría de aristas y el exportador SVG son ports de `fluyo/js/geometry.js` y `fluyo/js/export.js`. No hay forma de derivarlos automáticamente, así que el renderer se compara en cada CI contra los SVG que produjo el exportador de la propia app para los cinco ejemplos publicados.

**Deliberadamente distinto** — dos cosas:

- **La medición de texto es una heurística.** La app pide `getBBox()` al navegador; aquí no hay DOM y se estima sumando anchos por carácter. Las etiquetas que caben en su forma salen idénticas; las que hay que encoger pueden quedar a un tamaño de fuente ligeramente distinto, y el fondo de una etiqueta de arista, unos píxeles más ancho o estrecho.
- **`export_diagram` no anima.** Igual que "Exportar → SVG" en la app: sin puntos de flujo ni aparición escalonada. Para el GIF animado hay que abrir el documento en Fluyo.

**Round-trip garantizado** — un documento guardado por la app entra y sale de este servidor **sin perder un solo campo**, incluidos los que el servidor todavía no sabe interpretar. Lo verifica un test de contrato contra los cinco ejemplos reales de `fluyo/ejemplos/data/`. No es un detalle: la versión anterior descartaba en silencio 16 campos de estilo en cada llamada.

---

## Limitaciones actuales

- **Solo SVG.** PNG y GIF necesitan un renderer de canvas (`sharp`, `resvg`, `node-canvas`).
- **El endpoint remoto tiene topes que el local no tiene.** 1 MB de cuerpo, 200 KB por respuesta de tool y 30 peticiones por minuto y por IP. Un diagrama con nodos `image` puede pasarse de cualquiera de los dos primeros; por stdio no hay ninguno.
- **Los nodos `image` no se pueden crear**, porque llevan los bytes de la imagen dentro (`img`, un data URI que se pega o arrastra en la app). Los que ya existen se leen, editan y exportan con normalidad. Los `anim` sí se pueden crear: sus claves son un catálogo cerrado (`list_anims`).
- **No se pueden crear ni borrar páginas.** Se puede elegir sobre cuál trabajar (`pageIndex`) y renombrarla.
- **No se leen documentos del formato v1.** La app los migra al abrirlos; ábrelo y vuelve a guardarlo.
- **El auto-layout es un Sugiyama simplificado.** Va muy bien en pipelines y arquitecturas convencionales; para grafos muy ramificados conviene dar coordenadas o retocar tras un `relayout`.
- **`edit_diagram` reenvía el documento entero** en la entrada y en la salida. En sesiones de edición largas sobre diagramas grandes eso consume bastante contexto.
- **No hay forma de abrir el resultado en fluyo.space directamente.** Hay que guardar el JSON y usar el botón **Abrir**.

---

## Privacidad

**Este servidor no almacena los diagramas.** No hay base de datos, no hay disco, no hay caché y no hay sesiones: cada petición HTTP construye un servidor, procesa el mensaje y lo descarta.

El registro de operación anota exactamente esto, una línea JSON por petición en `stderr`:

```json
{"ts":"…","route":"/mcp","method":"POST","status":200,"outcome":"ok",
 "durationMs":31,"requestBytes":1462,"responseBytes":9038,"tools":["export_diagram"]}
```

Y **nada más**. No se registra el documento, ni las etiquetas, ni los argumentos de las tools, ni el cuerpo de la respuesta, ni los mensajes de error, ni stack traces, ni la IP del cliente, ni cabeceras. No hay modo debug que levante esas restricciones.

Que siga siendo cierto no depende de la disciplina de quien edite el código: el tipo `RequestLog` de `src/http-logging.ts` es un enum cerrado sin ningún campo donde quepa texto libre del usuario, y `test/http.test.ts` mete marcadores irrepetibles en las etiquetas de un diagrama y falla si aparecen en alguna línea de log.

Detalle honesto sobre las IPs: el limitador de caudal guarda en memoria la IP del cliente y las marcas de tiempo de sus últimas peticiones, durante la ventana de un minuto. Nunca se escribe a disco ni al log, y desaparece al reciclarse la instancia.

Fuera de este proceso, Vercel mantiene sus propios logs de plataforma (IP, ruta, código de estado, user-agent) con la retención de la cuenta. Eso no lo controla este código y conviene decirlo en la política.

---

## Desplegar en Vercel

El repositorio está configurado como **proyecto de Vercel independiente** apuntando a `mcp.fluyo.space` — no como parte del deployment de `fluyo/`, que es estático a propósito y publica «no hay backend» como argumento de privacidad. Ver DRIFT.md §6.

### Piezas

| Archivo | Papel |
|---|---|
| `vercel.json` | `buildCommand`, la función y el rewrite de todo el tráfico a `api/index.js` |
| `api/index.js` | Entry point serverless. Importa `dist/http.js`, que produce `npm run build` |
| `public/robots.txt` | Único archivo estático. Existe también para que `outputDirectory` no caiga al raíz del repo |

### Variables de entorno

Se configuran en **Project → Settings → Environment Variables**. Ninguna es un secreto; ninguna es obligatoria salvo la del challenge, y esa solo hace falta mientras dure la verificación de OpenAI.

| Variable | Por defecto | Para qué |
|---|---|---|
| `OPENAI_APPS_CHALLENGE` | — | Valor que sirve `/.well-known/openai-apps-challenge`. Sin ella esa ruta da **404**, que es lo correcto: un 200 vacío haría pasar por verificado un despliegue mal configurado. |
| `ALLOWED_ORIGINS` | los de Claude, ChatGPT y Fluyo | Lista blanca de `Origin`, separada por comas. **Sustituye** la lista por defecto, no la amplía. `*` desactiva la comprobación y es solo para depurar en local. |
| `RATE_LIMIT_PER_MIN` | `30` | Peticiones por IP y por ventana en `/mcp`. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Tamaño de la ventana deslizante. |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | Tope del cuerpo de la petición. Por encima: 413. |
| `MAX_TOOL_RESULT_BYTES` | `204800` (200 KB) | Tope del resultado de una tool. Por encima se sustituye por un error que explica cómo reducir el diagrama. |
| `FLUYO_MCP_LOG` | activado | `off` para silenciar el registro por completo. |

`PORT` solo se usa en local (`npm run start:http`); en Vercel la pone la plataforma.

### Primer despliegue

```bash
# 1. Importa el repo en Vercel (Add New → Project → Import Git Repository).
#    Framework Preset: Other. No hace falta tocar nada más: vercel.json manda.

# 2. Añade las variables de entorno de la tabla de arriba.

# 3. Deploy. Comprueba las cuatro rutas:
curl -i https://mcp.fluyo.space/health
curl -i https://mcp.fluyo.space/
curl -i https://mcp.fluyo.space/.well-known/openai-apps-challenge
curl -i -X POST https://mcp.fluyo.space/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

### DNS de `mcp.fluyo.space`

En el DNS de `fluyo.space`, un registro para el subdominio:

```text
CNAME   mcp   cname.vercel-dns.com.
```

Y en Vercel, **Project → Settings → Domains → Add** `mcp.fluyo.space`. El certificado lo emite Vercel solo. Si el DNS de `fluyo.space` ya está delegado en Vercel, basta con añadir el dominio en el panel y el registro se crea automáticamente.

> `mcp.fluyo.space` tiene que apuntar a **este** proyecto, no al de `fluyo/`. Son dos proyectos en la misma cuenta compartiendo dominio raíz.

### La ruta del challenge de OpenAI

Es el punto que más fácil se rompe, así que conviene entenderlo antes de tocar `vercel.json`:

**El verificador de OpenAI elimina el subpath.** Da igual que el MCP esté montado en `/mcp`: siempre pide `https://mcp.fluyo.space/.well-known/openai-apps-challenge`, en la raíz del host. Y tiene que contestar **200 directo con `text/plain`**. Una redirección hacia la ruta «correcta», aunque acabe en el sitio adecuado, cuenta como fallo.

Lo que garantiza que eso se cumpla:

- El `rewrite` de `vercel.json` es **interno**, no una redirección: el cliente ve el 200 de la función en la URL que pidió. Ese rewrite es lo que hace que la ruta llegue al handler; no hay que quitarlo.
- La ruta se atiende **antes que nada** en `route()` de `src/http.ts` — antes del rate limit y antes de la comprobación de `Origin`. El verificador nunca puede recibir un 429 ni un 403.
- `"cleanUrls": false` y `"trailingSlash": false` están explícitos en `vercel.json` para que Vercel no invente redirecciones. **No los cambies**: `trailingSlash: true` haría que `/mcp` redirigiese a `/mcp/`, que también rompe a los clientes MCP.
- Hay un test (`test/http.test.ts`) que pide la ruta con `redirect: "manual"` y exige exactamente 200 y `text/plain`.

**Rotar el challenge:**

1. Cambia `OPENAI_APPS_CHALLENGE` en Vercel (Settings → Environment Variables → Edit).
2. **Redespliega.** En Vercel las variables se inyectan en el build, así que un cambio no surte efecto hasta el siguiente deploy: Deployments → el último → ⋯ → Redeploy.
3. Verifica: `curl https://mcp.fluyo.space/.well-known/openai-apps-challenge` debe devolver el valor nuevo.

### Verificar el build en local antes de subir

```bash
npm run build
npm run start:http          # http://localhost:3000/mcp
OPENAI_APPS_CHALLENGE=prueba npm run start:http
```

Y con el CLI de Vercel, que reproduce el pipeline entero incluido el rewrite:

```bash
npx vercel build && npx vercel dev
```

---

## Estructura del proyecto

```text
src/
  generated/
    config.ts       # GENERADO por sync:config desde fluyo/. No editar a mano.
  schema.ts         # Reexporta las constantes + helpers (iconDataUri, resolveColor…)
  model.ts          # Esquemas Zod y tipos del documento Fluyo
  errors.ts         # Traduce los fallos de validación a frases accionables
  layout.ts         # Auto-layout por capas
  diagram.ts        # createDiagram / editDiagram
  svg.ts            # Exportador SVG
  templates.ts      # Plantillas de arquitectura
  server.ts         # Registro de las tools MCP — común a los dos transportes
  index.ts          # Entry point 1: stdio
  http.ts           # Entry point 2: Streamable HTTP (stateless) + rutas del host
  http-security.ts  # Origin, rate limit, tope de cuerpo, gzip
  http-logging.ts   # Qué se registra, y sobre todo qué no

api/
  index.js          # Entry point de Vercel; importa dist/http.js
vercel.json         # Build, función y rewrites
public/robots.txt   # Único archivo estático

scripts/
  sync-config.ts    # Genera src/generated/config.ts desde fluyo/
  sync-fixtures.ts  # Refresca test/fixtures/ desde los ejemplos de fluyo/

test/
  contract.test.ts  # Los 5 ejemplos reales: se aceptan, round-trip sin pérdida, exportan
  tools.test.ts     # Flujo extremo a extremo de las 9 tools
  render.test.ts    # El SVG cuadra con el que produce la app
  http.test.ts      # Handshake por HTTP, paridad con stdio, seguridad y privacidad del log
  fixtures/         # Copias de fluyo/ejemplos/ (datos y previews de referencia)
```

---

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md). Lo importante en dos líneas: `src/generated/config.ts` no se edita a mano, y si añades un campo al formato tiene que sobrevivir al test de contrato.

## Licencia

MIT. Ver [LICENSE](LICENSE).

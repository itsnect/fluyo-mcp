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

Fuera de este proceso, **Cloud Run escribe automáticamente sus propios request logs** (IP del cliente, ruta, código de estado, latencia, user-agent) en Cloud Logging. Eso no lo controla este código: lo genera la plataforma antes de que la petición llegue al contenedor. La retención está fijada a **7 días** en el bucket `_Default` — ver [Retención de logs](#retención-de-logs), donde está el comando que lo fija, para que el número de la política de privacidad sea reproducible y no una promesa.

---

## Desplegar en Cloud Run

El servidor se despliega como **servicio propio de Cloud Run** en `mcp.fluyo.space` — no dentro del deployment de `fluyo/`, que es estático a propósito y publica «no hay backend» como argumento de privacidad. Ver DRIFT.md §6.

> **Por qué Cloud Run y no Vercel.** El plan Hobby de Vercel restringe el uso a personal no comercial y, al exceder los límites, **pausa el servicio 30 días**. Para un servidor listado en un directorio público eso es inaceptable: el modo de fallo es quedarse caído un mes sin recurso. Cloud Run no tiene esa restricción y su modo de fallo es facturar, que sí se puede acotar — de ahí los topes de la sección siguiente.

### Piezas

| Archivo | Papel |
|---|---|
| `Dockerfile` | Multi-stage: compila con todas las dependencias, y la imagen final solo lleva `dist/` y las de producción. Corre como usuario no-root |
| `.dockerignore` | Mantiene el contexto de build pequeño; `node_modules` se reinstala dentro con `npm ci` |
| `scripts/verify-deploy.sh` | 21 comprobaciones contra el despliegue ya en marcha |

No hay archivos estáticos. En Vercel `robots.txt` lo servía la plataforma desde `public/`; aquí el contenedor es lo único que contesta, así que la ruta `/robots.txt` la sirve `src/http.ts` como cualquier otra.

### Variables de entorno

Se fijan **por revisión**: cambiar una crea una revisión nueva, y hasta que esa revisión reciba tráfico el cambio no surte efecto. Ninguna es un secreto; ninguna es obligatoria salvo la del challenge, y esa solo mientras dure la verificación de OpenAI.

| Variable | Por defecto | Para qué |
|---|---|---|
| `OPENAI_APPS_CHALLENGE` | — | Valor que sirve `/.well-known/openai-apps-challenge`. Sin ella esa ruta da **404**, que es lo correcto: un 200 vacío haría pasar por verificado un despliegue mal configurado. |
| `ALLOWED_ORIGINS` | los de Claude, ChatGPT y Fluyo | Lista blanca de `Origin`, separada por comas. **Sustituye** la lista por defecto, no la amplía. `*` desactiva la comprobación y es solo para depurar en local. |
| `RATE_LIMIT_PER_MIN` | `30` | Peticiones por IP y por ventana en `/mcp`. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Tamaño de la ventana deslizante. |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | Tope del cuerpo de la petición. Por encima: 413. |
| `MAX_TOOL_RESULT_BYTES` | `204800` (200 KB) | Tope del resultado de una tool. Por encima se sustituye por un error que explica cómo reducir el diagrama. |
| `FLUYO_MCP_LOG` | activado | `off` para silenciar el registro por completo. |

**`PORT` no se configura.** La inyecta Cloud Run y el contenedor la lee; fijarla a mano rompe el despliegue. En local sí se usa (`PORT=3000 npm run start:http`).

### Topes de coste

Estos valores **no son negociables** y son la razón por la que este servicio no puede sorprender con una factura:

```bash
--max-instances=2       # techo de cómputo. Ver la aritmética de abajo
--concurrency=80        # peticiones simultáneas por instancia
--timeout=30s
--min-instances=0       # sin tráfico, no se paga nada
--cpu=1 --memory=512Mi
--cpu-boost             # arranque en frío más rápido
```

**La aritmética del techo.** Con `max-instances=2`, `cpu=1` y `memory=512Mi`, el peor caso es que las dos instancias estén saturadas las 24 horas:

```
2 instancias × 86.400 s          = 172.800 instancia-segundos/día
CPU:    172.800 × 1    × $0,000024 = $4,15/día
Memoria:172.800 × 0,5  × $0,0000025 = $0,22/día
                                    ─────────
                                     ≈ $4,4/día  ← el máximo posible
```

En operación normal la cifra real es una fracción de eso, porque con `min-instances=0` no se factura nada mientras no hay tráfico.

> **`--concurrency=80` no se toca.** Es contraintuitivo: **bajarlo multiplica el coste**. Cada instancia atiende hasta 80 peticiones a la vez; con `concurrency=10` harían falta ocho veces más instancias para el mismo tráfico, se toparía antes en `max-instances=2` y los usuarios recibirían 429 de la plataforma antes que del rate limiter. Las nueve tools son funciones puras que no comparten estado, así que 80 simultáneas por instancia no tienen ningún inconveniente.

### Primer despliegue

```bash
PROJECT=tu-proyecto-gcp
REGION=us-central1

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# Construye desde el Dockerfile y despliega en un solo paso.
gcloud run deploy fluyo-mcp \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --max-instances=2 \
  --concurrency=80 \
  --timeout=30s \
  --min-instances=0 \
  --cpu=1 --memory=512Mi --cpu-boost \
  --set-env-vars "OPENAI_APPS_CHALLENGE=el-valor-que-te-dio-openai"
```

`--allow-unauthenticated` es deliberado: es un servidor MCP público sin credenciales. Lo que lo protege del abuso es el rate limiter y `max-instances`, no IAM.

Después, verifica el despliegue entero de una vez:

```bash
./scripts/verify-deploy.sh https://mcp.fluyo.space
```

Son 21 comprobaciones con ✓/✗ y código de salida distinto de cero si algo falla. Cubre lo que los tests no pueden ver, porque corren contra un handler en memoria: redirecciones, cabeceras que añada la plataforma y el mapeo de dominio.

### Dominio `mcp.fluyo.space`

```bash
gcloud beta run domain-mappings create \
  --service fluyo-mcp \
  --domain mcp.fluyo.space \
  --region "$REGION"
```

El comando imprime el registro DNS que hay que crear en la zona de `fluyo.space`:

```text
CNAME   mcp   ghs.googlehosted.com.
```

El certificado lo emite Google automáticamente una vez propagado el DNS; suele tardar entre unos minutos y un par de horas. Mientras tanto el servicio ya responde en su URL `*.run.app`.

> Si tu región no ofrece domain mappings, la alternativa es un balanceador de carga HTTP(S) global con un backend serverless NEG apuntando al servicio. Cuesta más y añade una pieza; el mapeo directo basta para este caso.

### Retención de logs

Cloud Run escribe request logs automáticamente. La política de privacidad publica una retención de **7 días**, y esto es lo que la hace cierta:

```bash
gcloud logging buckets update _Default \
  --location=global \
  --retention-days=7 \
  --project="$PROJECT"

# Comprobarlo:
gcloud logging buckets describe _Default --location=global --format='value(retentionDays)'
```

El valor por defecto de `_Default` son 30 días. **Si no se ejecuta ese comando, la política dice 7 y la realidad son 30**, que es exactamente el tipo de desajuste que hace falsa una declaración de privacidad. Va aquí, y no solo en un runbook, para que sea reproducible.

Esto es independiente del logger de la aplicación: `src/http-logging.ts` no escribe ningún dato de usuario, y eso sigue siendo cierto pase lo que pase con la retención de la plataforma.

### La ruta del challenge de OpenAI

Es el punto que más fácil se rompe, así que conviene entenderlo antes de poner nada delante del servicio:

**El verificador de OpenAI elimina el subpath.** Da igual que el MCP esté montado en `/mcp`: siempre pide `https://mcp.fluyo.space/.well-known/openai-apps-challenge`, en la raíz del host. Y tiene que contestar **200 directo con `text/plain`**. Una redirección hacia la ruta «correcta», aunque acabe en el sitio adecuado, cuenta como fallo.

Lo que garantiza que eso se cumpla:

- **El contenedor no redirige nunca.** `normalizePath()` en `src/http.ts` quita la query string y la barra final sobrante sin emitir un 301. Si aparece una redirección, viene de delante: del mapeo de dominio o de un balanceador.
- La ruta se atiende **antes que nada** en `route()` — antes del rate limit y antes de la comprobación de `Origin`. El verificador nunca puede recibir un 429 ni un 403.
- Cloud Run reenvía la petición tal cual al contenedor, sin reescribir rutas ni añadir barras. No hay equivalente de `cleanUrls`/`trailingSlash` que pueda estropearlo por defecto.
- Hay un test (`test/http.test.ts`) que pide la ruta con `redirect: "manual"` y exige exactamente 200 y `text/plain`, y `verify-deploy.sh` repite la comprobación contra el despliegue real.

**Rotar el challenge:**

```bash
gcloud run services update fluyo-mcp \
  --region "$REGION" \
  --update-env-vars "OPENAI_APPS_CHALLENGE=el-valor-nuevo"
```

Eso **crea una revisión nueva** y le manda el tráfico. Las variables de entorno de Cloud Run pertenecen a la revisión, no al servicio: hasta que la revisión nueva esté sirviendo, la ruta sigue devolviendo el valor viejo. Verifica con:

```bash
curl -i https://mcp.fluyo.space/.well-known/openai-apps-challenge
gcloud run services describe fluyo-mcp --region "$REGION" \
  --format='value(spec.template.spec.containers[0].env)'
```

### Probar la imagen en local antes de subir

```bash
npm run build
npm run start:http          # sin contenedor: http://localhost:3000/mcp

# Con el contenedor real, que es lo que corre en Cloud Run:
docker build -t fluyo-mcp .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e OPENAI_APPS_CHALLENGE=prueba \
  fluyo-mcp

./scripts/verify-deploy.sh http://localhost:8080
```

El script pasa igual contra el contenedor local que contra producción, salvo la comprobación del challenge si no le pasas la variable.

### Cómo se comporta el rate limit aquí

`src/http-security.ts` lee la IP del cliente de `x-forwarded-for`, y **Cloud Run la rellena con el mismo formato que cualquier proxy**: el primer valor es el cliente y el resto la cadena de saltos (`203.0.113.45, 130.211.0.1`). El código toma el primero, así que dos clientes detrás del mismo front-end de Google no comparten cubo. Es la misma lectura que se hacía en Vercel; no hubo que cambiar nada.

Un matiz que conviene tener presente: el estado del limitador vive en la memoria de cada instancia. Con `max-instances=2`, el límite efectivo puede llegar a ser el doble del configurado. Es una barrera contra el abuso accidental y los bucles de reintentos, no una cuota exacta — para eso haría falta un almacén compartido, y almacenar algo es justo lo que este servicio evita.

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

Dockerfile          # Imagen de Cloud Run: multi-stage, no-root, lee PORT
.dockerignore       # Contexto de build mínimo

scripts/
  sync-config.ts    # Genera src/generated/config.ts desde fluyo/
  sync-fixtures.ts  # Refresca test/fixtures/ desde los ejemplos de fluyo/
  verify-deploy.sh  # 21 comprobaciones contra un despliegue en marcha

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

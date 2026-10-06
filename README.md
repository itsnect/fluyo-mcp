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
| `describe_document` | Lee un documento Fluyo (v1–v5) y lo resume para un agente: páginas, elementos, conexiones, biblioteca de eventos, Historias con sus pasos, validación de integridad, versiones de schema y motor. No modifica nada. |
| `author_document` | Crea, modifica y elimina el **diagrama** (`create_node`, `create_connection`, `update_node`, `update_connection`, `delete_node`, `delete_connection`), **páginas** (`create_page`, `rename_page`), **Historias** y **EventTypes** (la biblioteca de eventos) sobre una copia del documento en un lote atómico: diagrama (`create_node`, `create_connection`, `update_node`, `update_connection`, `delete_node`, `delete_connection`), Historias (`create_story`, `rename_story`, `duplicate_story`, `delete_story`, `add_step`, `remove_step`, `move_step`, `duplicate_step`, `retarget_step`, `set_wait`), página (`set_initial_availability`) y eventos (`create_event_type`, `update_event_type`, `delete_event_type`). Devuelve un documento nuevo que Fluyo ejecuta tal cual, o rechaza todo el lote explicando qué Historias/pasos quedarían inválidos. Requiere `baseRevision`. |
| `run_story` | Ejecuta una Historia con el **mismo motor** que el editor y devuelve el Trace, el resultado de cada paso, los errores de validación y las versiones. No simula nada: el motor es el de Fluyo. |

Las doce son funciones puras: reciben JSON y devuelven JSON, sin tocar disco, red ni ningún estado externo. Van anotadas como tal (`readOnlyHint`, `idempotentHint`).

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

Hay dos transportes sobre el mismo núcleo. Las doce tools, sus schemas y el renderer son idénticos en los dos; lo único que cambia es por dónde entran los mensajes.

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

## Historias: leer, validar y ejecutar (`describe_document`, `run_story`)

Estas dos tools **no escriben**: leen un documento, lo validan y ejecutan una Historia. No hay autoría de Historias (crear/duplicar/editar pasos) todavía.

```text
fluyo/js (kernel)  ──sync:kernel──▶  src/generated/kernel-sources.ts  ──▶  vm aislado por llamada
 modelo · motor · FluyoStory · FluyoIntegrity   (copia verbatim + sha256)      describe_document · run_story
```

- **El motor no se reimplementa.** `npm run sync:kernel` copia, sin modificarlos, los scripts de `fluyo/js` (`config`, `safe-svg`, `model`, `scenario-engine`, `scenario-playback`, `story-playback`, `document-integrity`). Cada llamada los carga en un contexto `vm` nuevo. `npm run check:kernel` (y el job `drift`) falla si la copia se desvía de `fluyo/`. Cada resultado trae el `kernelId` (hash del conjunto) para poder reproducirlo. El `vm` no trae los globals web que el kernel da por existentes; `src/kernel.ts` envuelve `atob`, `btoa`, `TextEncoder` y `TextDecoder` de Node en la frontera (los usan los nodos `image` al leer un documento). Eso no modifica el kernel ni cambia el `kernelId`.
- **Validación única.** La integridad (referencias a elementos, conexiones y eventos, acciones compatibles con su evento, Behaviors, ids, versión de schema y de motor) la decide `FluyoIntegrity` de Fluyo, no este servidor.
- **Un paso `OCCURRENCE` es siempre `narrated`**: el motor lo registra aunque el elemento esté no disponible; no prueba que ocurriera nada real. Reintentos, colas, timeouts y lógica interna de los elementos no están en el modelo y se declaran en `unmodeled`.
- Si una Historia no es válida (p. ej. apunta a una conexión eliminada) no hay Trace: se devuelven los errores con su Historia y Step.

---

## Autoría del diagrama, Historias y eventos (`author_document`)

```text
describe_document (revision) ──▶ author_document (baseRevision + operaciones) ──▶ run_story
                                   │ copia → lote → FluyoIntegrity (estado final)
                                   ▼
                          documento nuevo + resultRevision   |   rechazo: sin documento
```

- **Atómico**: o se aplica todo el lote o nada; el documento recibido nunca se modifica. `dryRun:true` valida y devuelve los `changes` sin documento.
- **Revisión optimista, sin estado**: `baseRevision` es la `revision` que anunció `describe_document` (sha256 del JSON canónico del documento normalizado). Si no coincide → `REVISION_MISMATCH`. `resultRevision` es determinista.
- **Un paso = evento + objetivo**: `eventTypeId` + `target` (`{edgeId}` / `{from,to}` para conexiones; `{nodeId}` para elementos; o `{ref}` de lo creado en el lote; los ids de `edgeId`/`nodeId`/`from`/`to` también admiten `{ref}`). La acción la decide el evento; no se escribe `action`, `state` ni `at`.
- **Tiempo narrativo**: `waitMs` al añadir al final o `set_wait` por momento; «al mismo tiempo» con `placement.sameMomentAs`. Eliminar colapsa la espera; duplicar entra en el mismo momento.
- **B2**: si el estado final dejaría una Historia inválida, se rechaza el lote con `REFERENCED_ENTITY` (entidad, Historias y pasos afectados). Retargetear y borrar en el mismo lote es válido. (El editor de Fluyo aplica la misma detección pero **confirma** en lugar de rechazar —una persona ve el resultado y tiene Undo—; ninguno de los dos borra Steps ni Historias en silencio.)
- **EventTypes** (scope `eventType`, globales al documento, sin `pageIndex`): `create_event_type` (`name`, `primitive` FLOW | OCCURRENCE | SET_AVAILABILITY, `sentence` con `{source}`/`{target}`/`{name}`, `symbol?`, `motion?` sólo FLOW, `availability` sólo y obligatoria en SET_AVAILABILITY, `presentation?` como parche, `ref?`), `update_event_type` y `delete_event_type`. Un evento creado en el lote se usa con `{ref}` en `add_step`. La acción del paso la deriva la primitiva (FLOW→SEND, OCCURRENCE→OCCURRENCE, SET_AVAILABILITY→SET_STATE); nunca se escribe.
- **Reglas del editor, las mismas**: de un evento **usado** no cambian `primitive` ni `availability` (`EVENT_TYPE_LOCKED`, con el campo y los usos) y no se elimina (`REFERENCED_ENTITY` con el EventType, las Historias y los Steps afectados). Nombre, frase, símbolo, movimiento y presentación sí cambian y se ven en todos sus usos; los Steps y el Trace no cambian. Un nombre repetido se acepta y se avisa (`DUPLICATE_EVENT_TYPE_NAME`). `describe_document` lista cada evento con `usedBy` y `usedIn` (página, Historia, Steps).
- **Crear elementos y conexiones** (scope `page`, FLUYO-018.2): `create_node` `{pageIndex, spec:{shape,x,y,w?,h?,label?,…}, ref?}` y `create_connection` `{pageIndex, source, target, spec?:{label?,route?,fromSide?,toSide?,waypoints?,…}, ref?}`. Los campos son los del documento (`w`/`h`, colores en hex tal cual); sin ellos rigen los defaults del editor. Todas las formas salvo `image` (necesita bytes de imagen, igual que `create_diagram`). Lo decide `createNodeIn`/`createConnectionIn` de Fluyo —las mismas funciones que el editor—: forma, ids, `source`/`target`, auto-lazo (`SELF_LOOP`), ids duplicados (`DUPLICATE_ID`), geometría por defecto. Este servidor no calcula ninguna geometría.
- **`ref` del lote**: nombre que das a lo que creas; NO se guarda en el documento. `source`/`target` son `{ref}` (algo creado antes en el lote, **en la misma página**: las refs son por página, así que `cliente` puede existir en la página 0 y en la 1) o `{id}` (un elemento existente). Así se construye Cliente → Comercio → Banco en una sola llamada sin conocer ningún id:

```json
[
  {"op":"create_node","scope":"page","pageIndex":0,"ref":"cliente","spec":{"shape":"rect","x":200,"y":300,"label":"Cliente"}},
  {"op":"create_node","scope":"page","pageIndex":0,"ref":"comercio","spec":{"shape":"rect","x":600,"y":300,"label":"Comercio"}},
  {"op":"create_connection","scope":"page","pageIndex":0,"ref":"pago","source":{"ref":"cliente"},"target":{"ref":"comercio"}}
]
```

  La respuesta trae `changes` (qué se creó, dónde, con qué `ref` e `id`) y `refs`: `[{ref, type:"node"|"connection", pageIndex, id}]` para seguir trabajando (también con `dryRun`, que no devuelve documento). Errores estructurados: `UNKNOWN_REF`, `DUPLICATE_REF`, `SOURCE_NOT_FOUND`, `TARGET_NOT_FOUND`, `SELF_LOOP`, `DUPLICATE_ID`, `INVALID_FIELD` (con `field`), `PAGE_NOT_FOUND`.
- **Límites**: 200 operaciones por lote (se rechazan antes de ejecutar nada); `label` ≤ 500, `waypoints` ≤ 100 por conexión, `keywords` ≤ 200, campos de texto cortos con tope.
- **Modificar** (scope `page`, FLUYO-018.3): `update_node` `{pageIndex, node:{id}|{ref}, spec:{…}}` y `update_connection` `{pageIndex, connection:{id}|{ref}, source?, target?, spec?:{…}}`. `spec` es un **parche**: solo cambia lo que envías (`undefined`/ausente no toca nada; `null` vacía lo anulable). Mover = `x`/`y`; redimensionar = `w`/`h`. Campos de un elemento: `x, y, w, h, shape, label, color, fill, border, lblPos, textBg, textColor, font, bold, pulse, order, fs` y, según la forma, `tint` (icono) o `lang, keywords, kwBg, kwColor` (código); la forma solo cambia entre las del selector del editor (rect, cylinder, diamond, circle, hex, text, code; no desde/hacia image, icon, anim). De una conexión: `label, route, fromSide, toSide, waypoints, font, bold, fs, animated, dashed, startArrow, endArrow, flowDir, lineColor, dotColor, speedFac, dots, dotsGlobal`. `id`, `icon`, `anim`, `img` y `ref` no se modifican; un campo desconocido es `INVALID_FIELD`. **Retarget** = `source`/`target` en la operación (`{ref}`|`{id}`; extremo inexistente → `SOURCE_NOT_FOUND`/`TARGET_NOT_FOUND`, auto-lazo → `SELF_LOOP`). **Los waypoints solo cambian si los envías** (mover, redimensionar o retargetear los conservan; `waypoints:[]` vuelve a la ruta automática): `changes[].affects.connectionsWithWaypoints` avisa de las conexiones con ruta manual afectadas por un movimiento. Este servidor no calcula geometría: la ruta se deriva en el editor.
- **Eliminar** (scope `page`): `delete_node` `{pageIndex, node}` (quita también las conexiones del elemento y su disponibilidad inicial; `changes[].cascade` lo informa) y `delete_connection` `{pageIndex, connection}`. **Las Historias mandan (B2)**: la validación es sobre el **estado final** del lote, así que el orden no importa; si alguna Historia quedaría con un paso que apunta a lo eliminado se rechaza TODO con `REFERENCED_ENTITY` `{entity, affectedStories[{storyId,storyName,stepIds}], affectedSteps, operationIndex, operation, reason, cascadedFrom?}` (una conexión eliminada en cascada con su elemento lleva `cascadedFrom`). **No se limpia nada en silencio**: ni Steps, ni EventTypes, ni Historias. Para eliminar algo usado, retargetea (`retarget_step`) o quita (`remove_step`) esos pasos en el mismo lote.
- **Páginas** (scope `document`, FLUYO-018.5): `create_page` `{name?}` (añade **siempre al final**, no cambia la página activa; sin nombre usa el del editor; 1–80 caracteres) y `rename_page` `{pageIndex, name}`. `create_page` devuelve el `pageIndex` creado en `changes[].pageIndex`: las operaciones siguientes **del mismo lote** ya pueden usarlo (`create_node`, `create_connection`, `create_story`…). Las páginas no tienen id. Son `createPageIn`/`renamePageIn` de `model.js`, las mismas que ejecuta el editor.
- **Reglas de entrada de `create_node`/`update_node`** (FLUYO-018.5): colores **solo HEX** (`#rgb`, `#rrggbb`, `#rrggbbaa`); `icon`/`anim` deben existir en el catálogo (`list_icons`, `list_anims`) y las formas `icon`/`anim` los exigen; `border` admite `none`. `update_node` solo valida lo que cambia: un valor antiguo inválido de un documento existente no impide editarlo.
- **Límites de autoría** (FLUYO-018.5; `describe_document` → `capabilities.limits`): `coordMax` 100000 (±, `x`/`y` y puntos de `waypoints`), `sizeMin`/`sizeMax` 10–5000 (`w`/`h`), `maxNodesPerPage` 300, `maxConnectionsPerPage` 600. Se evalúan sobre el **estado final** del lote (crear y borrar dentro del mismo lote, o cruzar un tope y volver, es válido) y solo sobre lo que el lote escribe: un documento antiguo que ya los excede se abre, se describe y se edita igual. Si no se cumplen se rechaza **todo** con `LIMIT_EXCEEDED` `{limit, limitName, actual, field, pageIndex, entity?, operationIndex}`.
- **`edit_diagram` es LEGACY**: se mantiene sin cambios por compatibilidad; la autoría moderna del diagrama usa `author_document`.
- **Refs en update/delete y en destinos**: `node`/`connection`/`source`/`target` de `update_*`/`delete_*` aceptan `{ref}` (algo creado antes en el lote, en la misma página) o `{id}`. Una ref desconocida (o de otra página) → `UNKNOWN_REF`; repetida → `DUPLICATE_REF`; usar una entidad que el propio lote ya eliminó → `NODE_NOT_FOUND`/`CONNECTION_NOT_FOUND` indicando qué operación la eliminó. Las refs de lo eliminado en el lote no se devuelven en `refs`.

```json
[
  {"op":"update_node","scope":"page","pageIndex":0,"node":{"id":1},"spec":{"x":240,"w":200,"label":"Cliente final"}},
  {"op":"update_connection","scope":"page","pageIndex":0,"connection":{"id":4},"target":{"id":3},"spec":{"label":"Pago","route":"ortho","waypoints":[]}},
  {"op":"delete_node","scope":"page","pageIndex":0,"node":{"id":2}}
]
```

  Errores nuevos: `NODE_NOT_FOUND`, `CONNECTION_NOT_FOUND`, `REFERENCED_ENTITY` (diagrama). `describe_document` añade lo necesario para modificar sin volcar el documento: por elemento `x,y,w,h`; por conexión `route`, `fromSide`/`toSide` y `waypoints` (solo si existen); por página `bounds {minX,minY,maxX,maxY}` (agregado de las cajas, sin rutas). Las refs son efímeras y no aparecen.
- `edit_diagram` no cambia (sigue siendo la herramienta legacy).

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

El resultado es un `.fluyo.json` completo, y el resumen de la respuesta trae un enlace
`fluyo.space/#d=…` que lo abre **ya animado** en la app, sin guardar ningún archivo. También se
puede guardar el JSON y abrirlo con el botón **Abrir**, o seguir editándolo con `edit_diagram`.

---

## El enlace `fluyo.space/#d=…`

`create_diagram`, `edit_diagram` y `create_from_template` devuelven, junto al resumen, un
enlace que abre el diagrama **ya animado** en la app. Es el paso que faltaba: antes había que
copiar el JSON del chat, guardarlo como `.fluyo.json` y abrirlo a mano.

**El diagrama viaja dentro del enlace.** No hay backend, no hay nada que dar de alta y no hay
nada que caduque. Va detrás de la almohadilla a propósito: el navegador **no envía el
fragmento al servidor**, ni en la petición ni en la cabecera `Referer`, así que el contenido
no llega a ningún registro de acceso — ni al de fluyo.space, ni al de nadie.

La contrapartida, dicha claramente: va **codificado, no cifrado**. Quien reciba el enlace
puede leer el diagrama. Trátalo como tratarías el archivo.

**Formato**, por si alguien quiere generarlos por su cuenta:

```
#d= base64url( [1 byte de versión] + [carga] )

     1 → deflate-raw            ← lo que emite este servidor
     0 → JSON en UTF-8 tal cual ← lo entiende el lector, no se emite
```

**Tamaño.** Medido sobre los ocho ejemplos que publica Fluyo: 3.971 bytes de JSON minificado
de media acaban en 1.061 caracteres de URL — factor 5, porque este JSON repite las mismas
claves en cada nodo y eso es justo lo que come el deflate. Un diagrama de 8 nodos son 987
caracteres; uno de 30, 2.429.

**Cuándo no hay enlace.** Por encima de 16.000 caracteres no se emite, y la respuesta explica
por qué. El límite no lo pone el navegador —Chrome traga fragmentos de dos millones de
caracteres— sino el medio por el que viaja el enlace: un cliente de correo en texto plano
parte las líneas largas, y una URL partida ya no abre nada. Lo que dispara el tope en la
práctica no es el número de nodos, son los nodos `image`: llevan la imagen entera dentro como
data URI y uno solo puede pesar más que un diagrama de cien nodos.

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

**Derivado mecánicamente de Fluyo** — `npm run sync:config` lee `fluyo/js/config.js` y `fluyo/js/state.js` y genera `src/generated/config.ts`. La paleta, los temas, los 72 íconos con su SVG, los 8 GIFs, las 12 tipografías y los tamaños por forma no se copian a mano: se extraen. CI comprueba que sigan sincronizados.

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
| `FLUYO_APP_URL` | `https://fluyo.space/` | Base de los enlaces `#d=` que devuelven las tools. Para un self-host o una copia local. Un valor que no sea una URL se ignora. |
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

> **`--concurrency=80` no se toca.** Es contraintuitivo: **bajarlo multiplica el coste**. Cada instancia atiende hasta 80 peticiones a la vez; con `concurrency=10` harían falta ocho veces más instancias para el mismo tráfico, se toparía antes en `max-instances=2` y los usuarios recibirían 429 de la plataforma antes que del rate limiter. Las doce tools son funciones puras que no comparten estado, así que 80 simultáneas por instancia no tienen ningún inconveniente.

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
  link.ts           # Enlace fluyo.space/#d=… (deflate-raw + base64url)
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
  tools.test.ts     # Flujo extremo a extremo de las 11 tools
  render.test.ts    # El SVG cuadra con el que produce la app
  http.test.ts      # Handshake por HTTP, paridad con stdio, seguridad y privacidad del log
  link.test.ts      # Formato del enlace, tope de tamaño y firma meta.generator
  fixtures/         # Copias de fluyo/ejemplos/ (datos y previews de referencia)
```

---

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md). Lo importante en dos líneas: `src/generated/config.ts` no se edita a mano, y si añades un campo al formato tiene que sobrevivir al test de contrato.

## Licencia

MIT. Ver [LICENSE](LICENSE).

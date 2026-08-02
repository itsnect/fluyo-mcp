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

## Conectarlo a Claude

Transporte **stdio**. Añade el servidor a la configuración MCP de Claude Code o Claude Desktop:

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
- **Solo stdio.** No hay transporte HTTP, así que todavía no se puede publicar como conector remoto.
- **Los nodos `image` no se pueden crear**, porque llevan los bytes de la imagen dentro (`img`, un data URI que se pega o arrastra en la app). Los que ya existen se leen, editan y exportan con normalidad. Los `anim` sí se pueden crear: sus claves son un catálogo cerrado (`list_anims`).
- **No se pueden crear ni borrar páginas.** Se puede elegir sobre cuál trabajar (`pageIndex`) y renombrarla.
- **No se leen documentos del formato v1.** La app los migra al abrirlos; ábrelo y vuelve a guardarlo.
- **El auto-layout es un Sugiyama simplificado.** Va muy bien en pipelines y arquitecturas convencionales; para grafos muy ramificados conviene dar coordenadas o retocar tras un `relayout`.
- **`edit_diagram` reenvía el documento entero** en la entrada y en la salida. En sesiones de edición largas sobre diagramas grandes eso consume bastante contexto.
- **No hay forma de abrir el resultado en fluyo.space directamente.** Hay que guardar el JSON y usar el botón **Abrir**.

---

## Estructura del proyecto

```text
src/
  generated/
    config.ts    # GENERADO por sync:config desde fluyo/. No editar a mano.
  schema.ts      # Reexporta las constantes + helpers (iconDataUri, resolveColor…)
  model.ts       # Esquemas Zod y tipos del documento Fluyo
  errors.ts      # Traduce los fallos de validación a frases accionables
  layout.ts      # Auto-layout por capas
  diagram.ts     # createDiagram / editDiagram
  svg.ts         # Exportador SVG
  templates.ts   # Plantillas de arquitectura
  server.ts      # Registro de las tools MCP
  index.ts       # Entry point (stdio)

scripts/
  sync-config.ts    # Genera src/generated/config.ts desde fluyo/
  sync-fixtures.ts  # Refresca test/fixtures/ desde los ejemplos de fluyo/

test/
  contract.test.ts  # Los 5 ejemplos reales: se aceptan, round-trip sin pérdida, exportan
  tools.test.ts     # Flujo extremo a extremo de las 9 tools
  render.test.ts    # El SVG cuadra con el que produce la app
  fixtures/         # Copias de fluyo/ejemplos/ (datos y previews de referencia)
```

---

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md). Lo importante en dos líneas: `src/generated/config.ts` no se edita a mano, y si añades un campo al formato tiene que sobrevivir al test de contrato.

## Licencia

MIT. Ver [LICENSE](LICENSE).

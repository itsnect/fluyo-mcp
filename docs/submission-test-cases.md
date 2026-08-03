# Directory submission — test cases

Test cases for the OpenAI apps directory submission (5 positive, 3 negative) and
example prompts for the Anthropic connector form.

**Every error message quoted here was captured by running the code**, not written
from memory. They are reproduced verbatim, including punctuation and Spanish
wording — the server speaks Spanish to the model on purpose, because the app,
the docs and the diagram vocabulary are Spanish. Re-verify them after any change
to `src/errors.ts`, `src/diagram.ts`, `src/templates.ts` or `src/http.ts`.

| | |
|---|---|
| Server | `fluyo-mcp` 1.0.0 |
| Endpoint | `POST https://mcp.fluyo.space/mcp` (Streamable HTTP, stateless, no auth) |
| Tools | 9, all `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` |
| Verified against | commit at the time of writing, `npm test` → 111/111 |

---

## Positive test cases

### P1 — Create an architecture diagram from a natural-language description

**User prompt**

> I'm designing an event ingestion pipeline. A web frontend calls an API gateway
> over HTTPS, the gateway publishes to Kafka, a worker consumes from Kafka and
> upserts into PostgreSQL. Draw it for me with the flow animated.

**Tools fired**

1. `list_icons` *(optional — the model may call it to pick valid icon keys)*
2. `create_diagram`

**Expected result**

A complete `.fluyo.json` v3 document. The model supplies no coordinates, so the
server applies its layered auto-layout left to right.

- Summary line: `Diagrama "Ingesta de eventos" — 5 nodo(s), 4 arista(s), tema "dark".`
- `version: 3`, `app: "fluyo"`, one page, 5 nodes, 4 edges.
- Every node has `x`/`y` assigned by auto-layout, spaced one layer apart following
  the edges — for this input: `(200,720) (460,720) (720,720) (980,720) (1240,720)`.
- Semantic colour names (`Servicio`, `Eventos / Kafka`, `Datos`) resolved to hex.
- Edges carry `animated: true`, which is what produces the moving dots in the app.

**Success criteria** — the returned JSON opens directly in the Fluyo editor via
**Abrir** with no conversion step.

---

### P2 — Multi-step orchestration: create, then edit the result

This is the case that exercises the server as a *workflow* rather than a single
call. It is the realistic shape of a real session.

**User prompt**

> Now add a Redis cache that the gateway checks before hitting Kafka, make the
> PostgreSQL node pulse so it stands out, switch the diagram to the light theme
> and rename the page to "Ingesta v2".

**Tools fired**

1. `create_diagram` *(from P1, the document already in context)*
2. `edit_diagram` — one call carrying five ordered operations:
   `add_node`, `add_edge`, `update_node`, `set_theme`, `rename_page`

**Expected result**

- Summary line: `Diagrama "Ingesta v2" — 6 nodo(s), 5 arista(s), tema "claro".`
- 6 nodes and 5 edges: the Redis node and its dashed edge were added.
- `doc.theme === "claro"`, `doc.pages[0].name === "Ingesta v2"`.
- The PostgreSQL node has `pulse: true`; every other node is untouched.
- **All styling from the original document survives** — fills, borders, label
  positions, fonts, text colours. The document schemas are `.passthrough()`, so
  fields this server does not know about are preserved rather than dropped.

**The detail that matters here**, and the most common way a model gets this
wrong: inside `edit_diagram`, nodes that already exist in the document are
referenced by their **numeric `id`**, not by the temporary `key` used in
`create_diagram`. Keys are scoped to a single call and are never persisted. If
the model passes a key, it gets a clean, specific error (see N-extra 1 below)
and can correct itself on the next turn.

---

### P3 — Export a diagram to SVG

**User prompt**

> Export that diagram to SVG so I can paste it into our Confluence page.

**Tools fired**

1. `export_diagram`

**Expected result**

- Summary line: `SVG de "Ingesta v2" (6 nodos, 5 aristas).`
- A well-formed SVG document beginning `<?xml version="1.0" encoding="UTF-8"?>`.
- `viewBox="0.00 0.00 2560.00 1440.00"` — the full canvas, byte-for-byte the
  framing the app's own **Exportar → SVG** produces. Passing `crop: true` switches
  to a bounding-box viewBox instead.
- Shapes, semantic colours, icons, fills, border styles and fonts all rendered.
- Roughly 7 KB for a 6-node diagram.

**Known and documented limitation:** the SVG is a static frame. It carries no
flow animation and no staggered build-in — the same limitation as the app's own
SVG export. For the animated GIF the user opens the document in the editor. PNG
and GIF are not available from this server: they need a canvas renderer.

---

### P4 — Discover and instantiate a template

**User prompt**

> Do you have a ready-made RAG chatbot architecture? Use Pinecone as the vector
> database and Claude Opus 4 as the model.

**Tools fired**

1. `list_templates`
2. `create_from_template`

**Expected result**

`list_templates` returns three patterns — `event_driven_pipeline`,
`rag_chatbot`, `microservices_gateway` — each with its description and its
list of overridable label keys.

`create_from_template` with `templateId: "rag_chatbot"` and
`labelOverrides: { vectordb: "Pinecone", llm: "Claude Opus 4" }` returns:

- Summary line: `Diagrama "Chatbot RAG" — 4 nodo(s), 5 arista(s), tema "dark".`
- Node labels: `Usuario`, `API / Orquestador`, `Pinecone`, `Claude Opus 4` — the
  two overrides applied, the two untouched labels kept from the template.
- Auto-layout already applied, so the document is ready to open.

**Success criteria** — overrides land on the right nodes, and an override key
that does not exist is rejected rather than silently ignored (see N2).

---

### P5 — Catalogue discovery, then build with animated status nodes

**User prompt**

> Draw a checkout flow: customer, payment gateway, a spinner while it processes
> and a green check when it's confirmed. Use Georgia for the whole diagram.

**Tools fired**

1. `list_anims` *(to get valid `anim` keys)*
2. `create_diagram`

**Expected result**

`list_anims` returns the eight keys: `spinner`, `progress`, `ticket`, `errmove`,
`check`, `typing`, `upload`, `pulse`.

`create_diagram` then returns:

- Summary line: `Diagrama "Checkout" — 4 nodo(s), 3 arista(s), tema "dark".`
- Two nodes with `shape: "anim"` carrying `anim: "spinner"` and `anim: "check"`.
- `settings.font === "Georgia, serif"` applied document-wide; nodes without their
  own `font` inherit it.

These `anim` nodes are frame-by-frame animations that Fluyo draws on the canvas
and bakes into the exported GIF. In a static SVG export they render as their
reference frame.

The three sibling catalogue tools behave the same way and are cheap to call:
`list_icons` (47 keys in 6 groups, ~760 B), `list_colors` (14 semantic names,
~250 B), `list_fonts` (11 families, ~510 B).

---

## Negative test cases

Inputs that **must fail cleanly** — the model receives an actionable sentence it
can recover from, never a stack trace or a serialized validator dump. All three
return a normal tool result with `isError: true`, which is what lets the model
read the message and correct itself.

### N1 — Unknown shape in the document

**Setup** — a document whose node carries `shape: "triangulo"`, a value this
server version does not know. Applies to both `export_diagram` and
`edit_diagram`, which return the identical message.

**Exact server response** (`isError: true`):

```
Error: El documento usa la forma "triangulo", que esta versión del servidor no reconoce. Formas soportadas: rect, cylinder, diamond, circle, hex, text, icon, image, anim. Suele significar que Fluyo estrenó una forma y fluyo-mcp se quedó atrás: actualiza el servidor a la última versión (o ejecuta `npm run sync:config` si trabajas desde el repo). El diagrama no tiene nada malo.
```

**Why this is the right failure** — it names the offending value, lists every
accepted alternative, states the most likely cause, gives the fix, and explicitly
tells the user their diagram is not corrupt. This is the exact scenario the
server was hardened against: an earlier version crashed with a raw Zod issue dump
on any document containing an animated node.

---

### N2 — Invalid `labelOverrides` key in `create_from_template`

**Setup** — `templateId: "rag_chatbot"` with
`labelOverrides: { "vectorDB": "Pinecone" }`. The correct key is lowercase
`vectordb`; the capitalised form does not exist.

**Exact server response** (`isError: true`):

```
Error: La clave "vectorDB" de labelOverrides no existe en el template "rag_chatbot". Claves personalizables: user, api, vectordb, llm.
```

**Why this is the right failure** — the dangerous behaviour here is *silence*.
An unknown key that gets ignored leaves the model believing it customised the
diagram when it did not, and the user discovers a stale label later. The key is
validated against the template's declared `overridableKeys` and rejected up front.

---

### N3 — Document in the legacy v1 format

**Setup** — a document using the pre-v3 shape, with a top-level `state` key
instead of `doc`. The Fluyo app migrates these on open; this server does not.

**Exact server response** (`isError: true`):

```
Error: El documento está en el formato v1 de Fluyo (clave 'state'), que este servidor no lee. Ábrelo en Fluyo y vuelve a guardarlo con Ctrl+S: la app lo migra a v3 al abrirlo.
```

**Why this is the right failure** — it identifies the format by the exact key
that gives it away, states plainly that this is unsupported rather than broken,
and hands the user a two-step fix that works today with no new software.

---

## Additional verified failures

Not part of the three submitted cases, but captured from the same run and worth
keeping accurate.

### N-extra 1 — Referencing a temporary `key` that was never defined

```
Error: add_edge referencia el key "api", pero ningún add_node anterior en esta llamada lo definió.
```

Fired when an `edit_diagram` operation references an existing node by its
`create_diagram` key instead of its numeric `id`. See P2.

### N-extra 2 — Unknown icon key

```
Error: Ícono desconocido: "kubernets". Usa list_icons para ver las claves válidas.
```

### N-extra 3 — Unrecognised colour name

```
Error: Color "Turquesa" no reconocido. Usa un hex (#6a9fb5) o uno de: Servicio, Eventos / Kafka, Datos, IA, Alerta, Externo, Config, Cache, Cola, Red, Almacén, Éxito, Error, Info.
```

### N-extra 4 — Unknown template id

```
Error: Template desconocido: "no_existe". Usa list_templates para ver los disponibles.
```

### N-extra 5 — `pageIndex` out of range

```
Error: pageIndex 7 fuera de rango (el documento tiene 1 página(s)).
```

### N-extra 6 — Response above the 200 KB cap (HTTP transport only)

Reproduced with a 260-node icon-heavy diagram; the SVG came to 401 KB. HTTP 200
with a tool result carrying `isError: true`:

```
Error: la respuesta de export_diagram ocupa 401 KB y supera el límite de 200 KB del servidor remoto (mcp.fluyo.space).

El SVG crece sobre todo por los nodos que llevan imágenes dentro. Para reducirlo:
  · Si el documento tiene varias páginas, exporta una sola con 'pageIndex'.
  · Los nodos shape:"image" incrustan la imagen entera como data URI: son con diferencia lo más pesado. Quítalos del documento antes de exportar o sustitúyelos por un nodo 'rect' con etiqueta.
  · Cada nodo shape:"icon" inserta su SVG completo, y se repite por nodo. En diagramas de más de ~100 iconos conviene dejar el ícono solo en los componentes clave y usar 'rect' o 'text' en el resto.
  · Divide el diagrama en varias páginas más pequeñas y expórtalas por separado.

El diagrama en sí es válido: el límite es de este despliegue HTTP. El mismo servidor ejecutado en local por stdio (npx fluyo-mcp) exporta sin tope de tamaño.
```

This cap belongs to the HTTP deployment, not to the document model. Over stdio
there is no size limit.

### N-extra 7 — Request body above 1 MB

HTTP **413**, JSON-RPC body:

```json
{"jsonrpc":"2.0","error":{"code":-32600,"message":"El cuerpo de la petición supera el límite de 1024 KB de este servidor. Suele ocurrir con documentos que contienen nodos shape:\"image\", porque llevan la imagen entera dentro como data URI. Quítalos o divide el documento en varias páginas. El servidor en local por stdio (npx fluyo-mcp) no tiene este tope."},"id":null}
```

### N-extra 8 — Transport-level rejections

| Request | Status | Message |
|---|---|---|
| `GET /mcp` | **405** | `Method Not Allowed: este servidor no ofrece el stream SSE de GET. Es stateless y responde cada petición POST con un JSON completo.` |
| `DELETE /mcp` | **405** | `Method Not Allowed: este servidor es stateless y no mantiene sesiones, así que no hay ninguna que terminar con DELETE.` |
| `POST /mcp` with a non-whitelisted `Origin` | **403** | `Origen no permitido. Este endpoint solo acepta peticiones desde los orígenes de la lista blanca del servidor, o desde clientes que no envían el header Origin (lo normal en un cliente MCP).` |

All three are well-formed JSON-RPC error objects with `id: null`, not framework
HTML — a client that receives them can parse them like any other response.

### N-extra 9 — Adding a new page ⚠️ known rough edge

Creating and deleting pages is not supported; only selecting (`pageIndex`) and
renaming (`rename_page`). An `edit_diagram` call carrying `{ "op": "add_page" }`
is rejected — but **not** with a hand-written message. `operations` is part of
the published `inputSchema`, so the SDK validates it *before* the handler runs
and returns its own dump:

```
MCP error -32602: Input validation error: Invalid arguments for tool edit_diagram: [
  {
    "code": "invalid_union",
    "errors": [],
    "note": "No matching discriminator",
    "discriminator": "op",
    "options": ["add_node","update_node","remove_node","add_edge","update_edge","remove_edge","set_theme","rename_page","relayout"],
    "path": ["operations", 0, "op"],
    "message": "Invalid discriminator value. Expected 'add_node' | 'update_node' | ..."
  }
]
```

It is recoverable — the valid operations are listed, so a model can retry — but
it is a validator dump, not prose, and it is the one place where the error
quality drops below the rest of the server. **Deliberately excluded from the
three submitted negative cases.** Closing it means either declaring `add_page`
and `remove_page` as real operations that fail with an explanatory message, or
loosening the published schema so the handler owns the rejection.

---

## Example prompts for the Anthropic connector form

Three prompts exercising different tools, each self-contained and safe to run
against the public endpoint.

**1. Build a diagram from a description** — exercises `create_diagram`
(and usually `list_icons` / `list_colors` first)

> Draw me the architecture of an event-driven order system: a React storefront
> calls an API gateway, the gateway publishes order events to Kafka, an
> inventory service and a billing service both consume from Kafka, and both
> write to a shared PostgreSQL database. Animate the flow and use cloud icons.

**2. Edit an existing diagram without losing its styling** — exercises
`edit_diagram` and demonstrates round-trip fidelity

> Here's my `.fluyo.json` from Fluyo. Add a Redis cache between the gateway and
> the database with a dashed arrow, make the Kafka node pulse, and switch it to
> the light theme. Keep all my existing colours and fonts exactly as they are.

**3. Start from a template and export** — exercises `list_templates`,
`create_from_template` and `export_diagram` in sequence

> What architecture templates do you have? Use the RAG chatbot one, rename the
> vector database to Qdrant and the model to Claude, then export it to SVG so I
> can drop it into our design doc.

Two more, if the form takes them:

**4. Catalogue discovery** — exercises `list_icons`, `list_anims`, `list_fonts`

> What icons, animated status indicators and fonts can you use in a Fluyo
> diagram? Then build me a small CI/CD pipeline that uses a spinner while tests
> run and a green check when they pass.

**5. Layout repair** — exercises `edit_diagram` with `relayout`

> This diagram's nodes are all overlapping. Re-lay it out cleanly in layers.

*(Note: `relayout` recomputes every node position and deletes all manually
placed waypoints on the page. Its tool description says so.)*

---

## Reproducing these results

```bash
npm ci
npm run build
npm test          # 111/111
```

The failures above were captured by driving the built server through the MCP SDK
client over `InMemoryTransport` for tool-level errors, and over a real HTTP
listener for the transport-level ones (N-extra 6, 7 and 8), since the size caps
and the origin check live in `src/http.ts`, not in the tools.

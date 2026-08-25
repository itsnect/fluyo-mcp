# Fixtures de regresión visual

Dos diagramas **producidos por el servidor MCP en producción**, guardados tal cual
salieron. No son ejemplos publicados de Fluyo: son casos que se ven mal al abrirlos
en la app, y están aquí para que dejen de verse mal y no vuelvan a hacerlo.

| Archivo | Origen | Qué demuestra |
|---|---|---|
| `ingesta-v2.fluyo.json` | `create_diagram` | Par bidireccional 2↔10 (`check cache` / `hit`) con rutas idénticas; aristas que cruzan el cilindro PostgreSQL; extremos de arista que caen en el aire junto a nodos `icon` |
| `rag-chatbot.fluyo.json` | `create_from_template` (`rag-chatbot`) | Par bidireccional 2↔3 (`busca contexto` / `chunks relevantes`); etiquetas encima del nodo «Usuario»; etiqueta más ancha que el hueco entre nodos |

**No las toques a mano.** Si el layout cambia y estas fixtures dejan de reproducir
el defecto, el valor del test se pierde en silencio. Para regenerarlas hay que
volver a pedírselas al servidor con el mismo prompt y comprobar que el nuevo
resultado sigue siendo el caso interesante.

Están **fuera** del directorio padre a propósito: `test/fixtures/*.fluyo.json` es un
espejo exacto de `fluyo/ejemplos/data/`, mantenido por `npm run sync:fixtures`, y el
test de contrato afirma que ahí hay exactamente ocho archivos. Estas tres no vienen
de allí y no deben aparecer en ese recuento.

La copia gemela vive en `fluyo/test/fixtures/regresion-visual/`. Las dos deben ser
idénticas byte a byte: el mismo documento tiene que renderizarse igual en los dos
lados, y ese es justamente el invariante que estas fixtures vigilan.

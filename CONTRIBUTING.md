# Contribuir a fluyo-mcp

Gracias por pasarte. Este repo es el servidor MCP de [Fluyo](https://github.com/itsnect/fluyo);
si vienes buscando el editor de diagramas, está en el otro repositorio.

---

## Puesta en marcha

```bash
npm install
npm run build      # compila src/ -> dist/
npm test           # compila y ejecuta los tests
```

Hace falta **Node 22.18 o superior**: los scripts de `scripts/` son TypeScript y se
ejecutan directamente con el type stripping nativo de Node, sin paso de compilación.

No necesitas tener `fluyo/` clonado para compilar, testear ni contribuir. Solo lo
necesitas si vas a resincronizar las constantes (ver más abajo).

---

## La relación con `fluyo/`, y por qué importa

Este servidor tiene que producir y consumir exactamente el mismo `.fluyo.json` que la
aplicación. Fluyo es **estático a propósito**: sin `package.json`, sin build, sin
dependencias. Esa restricción es innegociable, así que no se puede compartir un
paquete npm entre los dos repos.

La consecuencia es que las constantes del formato (paleta, iconos, temas, tamaños)
tienen que existir a los dos lados. Durante un tiempo estuvieron **copiadas a mano**, y
pasó lo previsible: Fluyo añadió 7 colores, 18 iconos, 8 GIFs animados y 11
tipografías, y el servidor se quedó atrás sin que nada avisara. Los documentos de los
usuarios perdían el estilo en silencio.

Hoy hay dos mecanismos para que eso no se repita. **Los dos corren en CI.**

### 1. Codegen — `src/generated/config.ts`

```bash
npm run sync:config     # regenera desde ../fluyo (requiere tener Fluyo al lado)
npm run check:config    # falla si el archivo está desactualizado
```

`scripts/sync-config.ts` lee `fluyo/js/config.js`, lo evalúa con el módulo `vm` en un
contexto vacío —no es un módulo ESM, declara globals para cargarse con `<script>`— y
emite `src/generated/config.ts` con la paleta, los temas, los iconos, los GIFs, las
tipografías, el canvas y las direcciones. Los tamaños por defecto de cada forma salen
de `fluyo/js/state.js`, donde viven dentro de `newNode()`.

**`src/generated/config.ts` se commitea al repo.** No es un artefacto de build. Eso es
deliberado: cualquiera tiene que poder clonar solo `fluyo-mcp` y compilar sin tener
Fluyo al lado. Si lo mandáramos a `.gitignore`, contribuir exigiría clonar los dos
repos y el paquete publicado dependería de un repo externo en tiempo de build.

Dos reglas que se derivan de eso:

- **No edites `src/generated/config.ts` a mano.** La siguiente sincronización lo pisa.
  Si algo está mal, arréglalo en Fluyo o en `scripts/sync-config.ts`.
- **Si lo regeneras, commitea el resultado** en el mismo PR.

`check:config` **no falla** cuando no encuentra `fluyo/`: sale con código 0 y un aviso.
Así, un PR de alguien que solo clonó este repo pasa CI igual. La comprobación de
verdad ocurre en el job que sí clona los dos.

¿Ruta distinta para Fluyo? `FLUYO_PATH=/donde/tengas/fluyo npm run sync:config`.

### 2. Test de contrato — `test/contract.test.ts`

Carga los cinco ejemplos **reales** que Fluyo publica en `/ejemplos` (copiados en
`test/fixtures/`) y comprueba tres cosas sobre cada uno:

1. que el schema los acepta;
2. que el round-trip es **deep-equal**: ni una clave descartada, ni una inventada;
3. que `export_diagram` produce un SVG.

El punto 2 es el importante. Un `z.object()` de Zod **descarta las claves desconocidas
en silencio**, así que sin esta comprobación el servidor puede pasar todos los demás
tests mientras borra el estilo del diagrama del usuario en cada llamada.

Para refrescar las fixtures cuando Fluyo cambie sus ejemplos:

```bash
npm run sync:fixtures
```

Si tras refrescarlas el contrato falla, **el fallo es real**: el formato creció y el
servidor todavía no lo soporta.

---

## Añadir un campo nuevo al formato

Cuando Fluyo añade un campo al documento, aquí hay que hacer tres cosas:

1. `npm run sync:fixtures` y `npm run sync:config`, y ver qué falla.
2. Añadir el campo **explícitamente** a los schemas de `src/model.ts`. Todos llevan
   además `.passthrough()`, así que un campo nuevo no se pierde aunque te olvides —
   pero el `.passthrough()` es la red de seguridad, no la solución. El campo explícito
   es lo que documenta la entrada para el modelo y lo que permite editarlo.
3. Si el campo afecta al dibujo, soportarlo en `src/svg.ts` mirando cómo lo hace
   `fluyo/js/export.js`.

Un campo que la app puede escribir pero el servidor no entiende **no es un error de
validación**: es un campo que debe sobrevivir intacto al round-trip.

---

## Estilo

- Comentarios y mensajes de error **en español**, como el resto del proyecto.
- Los mensajes de error de las tools se los lee un modelo: di **qué** falló y **cuál es
  la salida** (`Ícono desconocido: "x". Usa list_icons para ver las claves válidas.`).
  Un error que no dice cómo recuperarse obliga al modelo a adivinar.
- Sin dependencias nuevas salvo que haya un motivo fuerte. Los tests usan `node:test`,
  que viene con Node.

---

## Antes de abrir el PR

```bash
npm run check:config
npm run build
npm test
```

Es lo mismo que ejecuta CI.

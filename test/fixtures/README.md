# Fixtures del test de contrato

Estos ocho `.fluyo.json` son **copias literales** de los ejemplos que Fluyo publica
en `fluyo/ejemplos/data/` y sirve en <https://fluyo.space/ejemplos/>. Son documentos
reales producidos por la aplicación, no fixtures escritos a mano.

Están copiados dentro de `fluyo-mcp` a propósito: el test de contrato tiene que poder
correr en CI y en un clon que no tenga `fluyo/` al lado.

## Por qué estos y no otros

Entre los ocho cubren toda la superficie del formato v3 que la app produce hoy. Los
cinco primeros son de arquitectura de software; los tres últimos, de proceso de
negocio, y son los únicos del corpus con `build:true` en `settings`:

| Ejemplo | Cubre |
|---|---|
| `arquitectura-serverless-aws` | iconos AWS, `text`, `customBg` |
| `kafka-event-pipeline` | `cylinder`, iconos General |
| `microservicios-api-gateway` | grafo con bifurcación, rutas `ortho` |
| `oauth2-flujo-autenticacion` | **`shape:"anim"`**, `diamond`, `hex` |
| `pipeline-etl-datos` | **`shape:"anim"`**, iconos de los grupos Estados y Varios |
| `funnel-de-ventas` | `build:true`, `diamond` con dos salidas, `circle` con `pulse` |
| `onboarding-de-cliente` | `build:true`, arista de vuelta sobre el flujo principal |
| `cadena-de-suministro` | `build:true`, **`shape:"anim"`** con `progress`, `cylinder` |

Los dos con `shape:"anim"` y los iconos de los grupos `Estados`/`Varios`
(`bell`, `cache`, `cdn`, `file`, `graph`, `warn`) son justo lo que el servidor no
sabía procesar antes de este test.

## Refrescarlos

```bash
npm run sync:fixtures        # requiere fluyo/ al lado, o FLUYO_PATH
```

Si un cambio en Fluyo hace fallar el contrato tras refrescar, **el fallo es real**:
significa que el formato creció y el servidor todavía no lo soporta.

#!/usr/bin/env bash
#
# Verificación post-deploy del endpoint HTTP de fluyo-mcp.
#
#   ./scripts/verify-deploy.sh https://mcp.fluyo.space
#   ./scripts/verify-deploy.sh http://localhost:3000
#
# Comprueba lo que rompe un despliegue de verdad, no lo que ya cubren los tests:
# los tests corren contra un handler en memoria y no ven redirecciones, reescrituras
# ni cabeceras que añada la plataforma. Esto sí.
#
# Salida: un ✓ o ✗ por comprobación y código de salida distinto de cero si algo falla.
#
# Requisitos: curl y node (el repo ya exige node >= 22.18). Sin jq: el parseo de JSON
# lo hace node, que está garantizado.

set -uo pipefail   # sin -e: cada check decide si es fatal, y queremos verlos todos

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "uso: $0 <url-base>" >&2
  echo "ej.: $0 https://mcp.fluyo.space" >&2
  exit 2
fi
BASE="${BASE%/}"   # sin barra final: todas las rutas se concatenan crudas

for cmd in curl node; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "falta '$cmd' en el PATH" >&2; exit 2; }
done

# Colores solo si la salida es un terminal: en CI el escape sucio estorba más que ayuda.
if [ -t 1 ]; then
  V=$'\033[32m'; X=$'\033[31m'; D=$'\033[2m'; B=$'\033[1m'; Z=$'\033[0m'
else
  V=""; X=""; D=""; B=""; Z=""
fi

PASS=0
FAIL=0
FAILED_NAMES=()

pass() { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$V" "$Z" "$1"; }
fail() {
  FAIL=$((FAIL+1)); FAILED_NAMES+=("$1")
  printf '  %s✗%s %s\n' "$X" "$Z" "$1"
  [ $# -gt 1 ] && printf '      %s%s%s\n' "$D" "$2" "$Z"
  return 0
}
section() { printf '\n%s%s%s\n' "$B" "$1" "$Z"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CURL=(curl -sS --max-time 25)

# Lee un campo del JSON de un archivo. Devuelve cadena vacía si no existe o no parsea.
json_field() {
  node -e '
    const fs=require("fs");
    try {
      const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const v=process.argv[2].split(".").reduce((o,k)=>o?.[k], d);
      process.stdout.write(v===undefined||v===null?"":String(v));
    } catch { process.stdout.write(""); }
  ' "$1" "$2" 2>/dev/null
}

printf '%sVerificando %s%s\n' "$B" "$BASE" "$Z"

# ═══════════════════════════════════════════════════════════════════════════
section "1. /health"
# ═══════════════════════════════════════════════════════════════════════════
code=$("${CURL[@]}" -o "$TMP/health.json" -w '%{http_code}' "$BASE/health")
if [ "$code" = "200" ]; then
  pass "GET /health → 200"
  status=$(json_field "$TMP/health.json" status)
  version=$(json_field "$TMP/health.json" version)
  transport=$(json_field "$TMP/health.json" transport)
  [ "$status" = "ok" ] \
    && pass "status: ok" \
    || fail "status debería ser 'ok'" "recibido: '${status:-<vacío o no es JSON>}'"
  [ "$transport" = "streamable-http" ] \
    && pass "transport: streamable-http" \
    || fail "transport debería ser 'streamable-http'" "recibido: '${transport:-<ausente>}'"
  [ -n "$version" ] && printf '      %sversión desplegada: %s%s\n' "$D" "$version" "$Z"
else
  fail "GET /health → 200" "recibido HTTP $code"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "2. /.well-known/openai-apps-challenge"
# ═══════════════════════════════════════════════════════════════════════════
# El fallo más común de este flujo, y el más difícil de diagnosticar: el
# verificador de OpenAI pide SIEMPRE la ruta en la raíz del host y exige 200
# directo. Una redirección hacia la forma «canónica» cuenta como fallo aunque
# acabe sirviendo el valor correcto. Por eso se pide SIN -L y se mira el código
# de la PRIMERA respuesta.
CH="$BASE/.well-known/openai-apps-challenge"
code=$("${CURL[@]}" -o "$TMP/ch.txt" -D "$TMP/ch.head" -w '%{http_code}' "$CH")

case "$code" in
  200)
    pass "GET challenge → 200 sin redirección"
    ;;
  301|302|303|307|308)
    loc=$(grep -i '^location:' "$TMP/ch.head" | head -1 | tr -d '\r' | sed 's/^[Ll]ocation: *//')
    fail "GET challenge → 200 sin redirección" \
         "HTTP $code redirigiendo a '${loc:-?}'. El verificador de OpenAI trata esto como FALLO. El contenedor no redirige nunca, así que esto viene de delante: revisa el mapeo de dominio de Cloud Run o el balanceador y las reglas de reescritura de URL que tenga configuradas."
    ;;
  404)
    fail "GET challenge → 200 sin redirección" \
         "HTTP 404: OPENAI_APPS_CHALLENGE no está en la revisión que está sirviendo. Las variables de entorno de Cloud Run se fijan POR REVISIÓN: si la añadiste después del último deploy, hay que crear una revisión nueva (gcloud run services update fluyo-mcp --update-env-vars OPENAI_APPS_CHALLENGE=...). Comprueba con: gcloud run services describe fluyo-mcp --format='value(spec.template.spec.containers[0].env)'"
    ;;
  *)
    fail "GET challenge → 200 sin redirección" "recibido HTTP $code"
    ;;
esac

if [ "$code" = "200" ]; then
  ctype=$(grep -i '^content-type:' "$TMP/ch.head" | head -1 | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype: *//')
  case "$ctype" in
    text/plain*) pass "Content-Type: text/plain" ;;
    *)           fail "Content-Type: text/plain" "recibido: '${ctype:-<ausente>}'" ;;
  esac
  if [ -s "$TMP/ch.txt" ]; then
    pass "el cuerpo no está vacío ($(wc -c < "$TMP/ch.txt" | tr -d ' ') bytes)"
  else
    fail "el cuerpo no está vacío" "cuerpo vacío: un 200 sin valor haría pasar por verificado un despliegue mal configurado"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
section "3. / (página de inicio)"
# ═══════════════════════════════════════════════════════════════════════════
code=$("${CURL[@]}" -o "$TMP/root.html" -D "$TMP/root.head" -w '%{http_code}' "$BASE/")
if [ "$code" = "200" ]; then
  pass "GET / → 200"
  ctype=$(grep -i '^content-type:' "$TMP/root.head" | head -1 | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype: *//')
  case "$ctype" in
    text/html*) pass "Content-Type: text/html" ;;
    *)          fail "Content-Type: text/html" "recibido: '${ctype:-<ausente>}'" ;;
  esac
  grep -qi '<html' "$TMP/root.html" \
    && pass "el cuerpo es HTML" \
    || fail "el cuerpo es HTML" "no se encontró '<html' en la respuesta"
else
  fail "GET / → 200" "recibido HTTP $code"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "4. POST /mcp — initialize"
# ═══════════════════════════════════════════════════════════════════════════
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-deploy","version":"1"}}}'
code=$("${CURL[@]}" -o "$TMP/init.json" -w '%{http_code}' \
  -X POST "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$INIT")

if [ "$code" = "200" ]; then
  pass "POST /mcp initialize → 200"
  srv_name=$(json_field "$TMP/init.json" result.serverInfo.name)
  proto=$(json_field "$TMP/init.json" result.protocolVersion)
  [ "$srv_name" = "fluyo-mcp" ] \
    && pass "serverInfo.name: fluyo-mcp" \
    || fail "serverInfo.name: fluyo-mcp" "recibido: '${srv_name:-<ausente; ¿respuesta no JSON-RPC?>}'"
  [ -n "$proto" ] \
    && pass "handshake válido (protocolVersion: $proto)" \
    || fail "handshake válido" "falta result.protocolVersion en la respuesta"
else
  fail "POST /mcp initialize → 200" "recibido HTTP $code"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "5. POST /mcp — tools/list"
# ═══════════════════════════════════════════════════════════════════════════
LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
code=$("${CURL[@]}" -o "$TMP/tools.json" -w '%{http_code}' \
  -X POST "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$LIST")

if [ "$code" != "200" ]; then
  fail "POST /mcp tools/list → 200" "recibido HTTP $code"
else
  pass "POST /mcp tools/list → 200"
  # Un solo pase de node: cuenta, valida title y annotations, y nombra a los que fallen.
  report=$(node -e '
    const fs = require("fs");
    const EXPECTED = 9;
    const ANN = ["readOnlyHint","destructiveHint","idempotentHint","openWorldHint"];
    let d;
    try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { console.log("ERR|la respuesta no es JSON"); process.exit(0); }
    const tools = d?.result?.tools;
    if (!Array.isArray(tools)) { console.log("ERR|la respuesta no trae result.tools"); process.exit(0); }
    console.log(`COUNT|${tools.length}|${EXPECTED}`);
    // El SDK puede exponer el title en la raíz o dentro de annotations; vale cualquiera.
    const sinTitle = tools.filter(t => !(t.title || t.annotations?.title)).map(t => t.name);
    console.log(`TITLE|${sinTitle.join(",")}`);
    const sinAnn = tools
      .filter(t => !t.annotations || ANN.some(k => typeof t.annotations[k] !== "boolean"))
      .map(t => t.name);
    console.log(`ANN|${sinAnn.join(",")}`);
    console.log(`NAMES|${tools.map(t => t.name).sort().join(" ")}`);
  ' "$TMP/tools.json")

  while IFS='|' read -r kind a b; do
    case "$kind" in
      ERR)
        fail "tools/list devuelve una lista de tools" "$a"
        ;;
      COUNT)
        [ "$a" = "$b" ] \
          && pass "las 9 tools están presentes" \
          || fail "las 9 tools están presentes" "encontradas $a de $b"
        ;;
      TITLE)
        [ -z "$a" ] \
          && pass "todas las tools tienen title" \
          || fail "todas las tools tienen title" "sin title: $a"
        ;;
      ANN)
        [ -z "$a" ] \
          && pass "todas las tools tienen las 4 annotations booleanas" \
          || fail "todas las tools tienen las 4 annotations booleanas" "incompletas: $a"
        ;;
      NAMES)
        printf '      %s%s%s\n' "$D" "$a" "$Z"
        ;;
    esac
  done <<< "$report"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "6. GET /mcp → 405"
# ═══════════════════════════════════════════════════════════════════════════
# Stateless: no hay stream SSE que abrir. La especificación prescribe 405, y el
# cuerpo tiene que ser JSON-RPC para que el cliente pueda leerlo.
code=$("${CURL[@]}" -o "$TMP/get.json" -D "$TMP/get.head" -w '%{http_code}' "$BASE/mcp")
if [ "$code" = "405" ]; then
  pass "GET /mcp → 405"
  allow=$(grep -i '^allow:' "$TMP/get.head" | head -1 | tr -d '\r' | sed 's/^[Aa]llow: *//')
  [ -n "$allow" ] \
    && pass "cabecera Allow: $allow" \
    || fail "cabecera Allow presente" "no vino la cabecera Allow"
  [ -n "$(json_field "$TMP/get.json" error.message)" ] \
    && pass "el cuerpo del 405 es JSON-RPC" \
    || fail "el cuerpo del 405 es JSON-RPC" "no se encontró error.message; ¿un 405 de la plataforma en vez del de la app?"
else
  fail "GET /mcp → 405" "recibido HTTP $code"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "7. Origen no permitido → 403"
# ═══════════════════════════════════════════════════════════════════════════
code=$("${CURL[@]}" -o "$TMP/origin.json" -w '%{http_code}' \
  -X POST "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Origin: https://origen-no-permitido.example' \
  -d "$INIT")
if [ "$code" = "403" ]; then
  pass "Origin fuera de la lista blanca → 403"
else
  fail "Origin fuera de la lista blanca → 403" \
       "recibido HTTP $code. Si es 200, ALLOWED_ORIGINS podría estar puesta a '*' en producción."
fi

# Contraprueba: sin Origin tiene que pasar. Es el caso normal de un cliente MCP
# servidor-a-servidor, y romperlo dejaría fuera a todos los clientes legítimos —
# un fallo que el check anterior por sí solo no detecta.
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$INIT")
if [ "$code" = "200" ]; then
  pass "sin header Origin → 200 (cliente servidor-a-servidor)"
else
  fail "sin header Origin → 200" "recibido HTTP $code: se estarían rechazando los clientes MCP normales"
fi

# ═══════════════════════════════════════════════════════════════════════════
printf '\n%s─────────────────────────────────────────%s\n' "$D" "$Z"
if [ "$FAIL" -eq 0 ]; then
  printf '%s✓ %d comprobaciones, todas correctas%s\n' "$V" "$PASS" "$Z"
  exit 0
fi
printf '%s✗ %d de %d comprobaciones fallaron%s\n' "$X" "$FAIL" "$((PASS+FAIL))" "$Z"
for n in "${FAILED_NAMES[@]}"; do printf '    %s· %s%s\n' "$X" "$n" "$Z"; done
exit 1

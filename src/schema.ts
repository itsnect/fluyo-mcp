/**
 * Constantes del formato Fluyo, portadas 1:1 desde fluyo.html
 * (PALETTE, tamaños por defecto por forma, THEMES, e ICONS + sus generadores SVG).
 *
 * Mantener esto sincronizado con el motor de fluyo.html es lo que garantiza
 * que un documento generado por el MCP se vea idéntico si se abre en la app
 * (Archivo -> Abrir) y que el SVG exportado por el MCP luzca igual al de
 * "Exportar" dentro de la app.
 */

export const CANVAS = { W: 2560, H: 1440, GRID: 20 };

export type Shape =
  | "rect"
  | "cylinder"
  | "diamond"
  | "circle"
  | "hex"
  | "text"
  | "icon"
  | "image";

export const DEFAULT_SIZES: Record<Shape, [number, number]> = {
  rect: [180, 70],
  cylinder: [150, 90],
  diamond: [160, 100],
  circle: [110, 110],
  hex: [170, 80],
  text: [200, 40],
  icon: [120, 92],
  image: [220, 160],
};

export interface PaletteEntry {
  name: string;
  hex: string;
}

/** Colores semánticos disponibles para nodos, líneas y puntos. */
export const PALETTE: PaletteEntry[] = [
  { name: "Servicio", hex: "#6a9fb5" },
  { name: "Eventos / Kafka", hex: "#d08b5b" },
  { name: "Datos", hex: "#7fa66b" },
  { name: "IA", hex: "#9b7fb5" },
  { name: "Alerta", hex: "#c16a6a" },
  { name: "Externo", hex: "#8f8f8f" },
  { name: "Config", hex: "#c9b458" },
];

export type ThemeName = "dark" | "crema" | "claro";

export interface ThemeDef {
  bg: string;
  grid: string;
  text: string;
  edge: string;
  edgeLbl: string;
  lblBg: string;
}

export const THEMES: Record<ThemeName, ThemeDef> = {
  dark: { bg: "#161616", grid: "rgba(255,255,255,.045)", text: "#ededed", edge: "#777", edgeLbl: "#bdbdbd", lblBg: "#161616" },
  crema: { bg: "#f4eee1", grid: "rgba(0,0,0,.06)", text: "#2b2620", edge: "#8a8275", edgeLbl: "#6b6457", lblBg: "#f4eee1" },
  claro: { bg: "#ffffff", grid: "rgba(0,0,0,.05)", text: "#111111", edge: "#888888", edgeLbl: "#444444", lblBg: "#ffffff" },
};

export type Side = "n" | "s" | "e" | "w";
export const SIDES: Side[] = ["n", "e", "s", "w"];
export const DIR: Record<Side, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
};

/* ============ Íconos (generadores SVG portados de fluyo.html) ============ */

const badge = (bg: string, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="14" fill="${bg}"/>${inner}</svg>`;

const wheel = (col: string) => {
  let s = "";
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    const x = 32 + Math.cos(a) * 15;
    const y = 32 + Math.sin(a) * 15;
    s += `<line x1="32" y1="32" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="3.4"/>`;
  }
  return s + `<circle cx="32" cy="32" r="16" fill="none" stroke="${col}" stroke-width="3.6"/><circle cx="32" cy="32" r="5" fill="${col}"/>`;
};

const cylin = (col: string) =>
  `<path d="M18 22 v20 c0 4 6 7 14 7 s14 -3 14 -7 V22" fill="none" stroke="${col}" stroke-width="3.6"/><ellipse cx="32" cy="22" rx="14" ry="6.5" fill="none" stroke="${col}" stroke-width="3.6"/>`;

const txtG = (t: string, col: string, fs = 30) =>
  `<text x="32" y="33" font-size="${fs}" font-family="Georgia,serif" fill="${col}" text-anchor="middle" dominant-baseline="central">${t}</text>`;

const GCP_BLUE = "#4285f4", AWS_BG = "#232f3e", AWS_OR = "#ff9900", AZ_BLUE = "#0078d4";

export interface IconDef {
  group: "General" | "GCP" | "AWS" | "Azure";
  label: string;
  svg: string;
}

export const ICONS: Record<string, IconDef> = {
  kafka: { group: "General", label: "Kafka", svg: badge("#1b1b1b", `<circle cx="32" cy="14" r="6" fill="#fff"/><circle cx="32" cy="50" r="6" fill="#fff"/><circle cx="46" cy="23" r="6" fill="#fff"/><circle cx="46" cy="41" r="6" fill="#fff"/><circle cx="28" cy="32" r="7" fill="#fff"/><line x1="32" y1="18" x2="42" y2="24" stroke="#fff" stroke-width="3"/><line x1="42" y1="40" x2="32" y2="46" stroke="#fff" stroke-width="3"/><line x1="30" y1="20" x2="29" y2="26" stroke="#fff" stroke-width="3"/><line x1="29" y1="38" x2="30" y2="44" stroke="#fff" stroke-width="3"/>`) },
  k8s: { group: "General", label: "K8s", svg: badge("#326ce5", wheel("#fff")) },
  db: { group: "General", label: "BD", svg: badge("#3b4252", cylin("#fff")) },
  queue: { group: "General", label: "Cola", svg: badge("#5b4a72", `<rect x="14" y="18" width="24" height="8" rx="3" fill="#fff"/><rect x="14" y="29" width="24" height="8" rx="3" fill="#fff"/><rect x="14" y="40" width="24" height="8" rx="3" fill="#fff"/><path d="M42 28 l10 5 -10 5z" fill="#fff"/>`) },
  user: { group: "General", label: "Usuario", svg: badge("#6b7b8c", `<circle cx="32" cy="24" r="9" fill="#fff"/><path d="M15 50 c2-11 8-15 17-15 s15 4 17 15z" fill="#fff"/>`) },
  movil: { group: "General", label: "Móvil", svg: badge("#4a5560", `<rect x="22" y="12" width="20" height="40" rx="4" fill="none" stroke="#fff" stroke-width="3.4"/><circle cx="32" cy="45" r="2.4" fill="#fff"/>`) },
  web: { group: "General", label: "Web", svg: badge("#3c6e71", `<circle cx="32" cy="32" r="17" fill="none" stroke="#fff" stroke-width="3.2"/><ellipse cx="32" cy="32" rx="8" ry="17" fill="none" stroke="#fff" stroke-width="3"/><line x1="15" y1="32" x2="49" y2="32" stroke="#fff" stroke-width="3"/>`) },
  api: { group: "General", label: "API", svg: badge("#2f4858", txtG("&lt;/&gt;", "#fff", 22)) },
  lock: { group: "General", label: "Seguridad", svg: badge("#7a3b3b", `<rect x="19" y="29" width="26" height="21" rx="4" fill="#fff"/><path d="M24 29 v-5 a8 8 0 0 1 16 0 v5" fill="none" stroke="#fff" stroke-width="3.6"/>`) },
  ai: { group: "General", label: "IA", svg: badge("#6d5a96", `<path d="M32 12 l4.5 13 13 4.5 -13 4.5 -4.5 13 -4.5 -13 -13 -4.5 13 -4.5z" fill="#fff"/><circle cx="48" cy="16" r="3.4" fill="#fff"/>`) },

  gke: { group: "GCP", label: "GKE", svg: badge(GCP_BLUE, wheel("#fff")) },
  cloudsql: { group: "GCP", label: "Cloud SQL", svg: badge(GCP_BLUE, cylin("#fff")) },
  pubsub: { group: "GCP", label: "Pub/Sub", svg: badge(GCP_BLUE, `<circle cx="32" cy="16" r="6" fill="#fff"/><circle cx="18" cy="44" r="6" fill="#fff"/><circle cx="46" cy="44" r="6" fill="#fff"/><circle cx="32" cy="33" r="4.4" fill="#fff"/><line x1="32" y1="21" x2="32" y2="29" stroke="#fff" stroke-width="3"/><line x1="28" y1="36" x2="22" y2="40" stroke="#fff" stroke-width="3"/><line x1="36" y1="36" x2="42" y2="40" stroke="#fff" stroke-width="3"/>`) },
  bigquery: { group: "GCP", label: "BigQuery", svg: badge(GCP_BLUE, `<circle cx="29" cy="29" r="13" fill="none" stroke="#fff" stroke-width="3.6"/><line x1="38" y1="38" x2="49" y2="49" stroke="#fff" stroke-width="5" stroke-linecap="round"/><line x1="24" y1="31" x2="24" y2="34" stroke="#fff" stroke-width="3"/><line x1="29" y1="26" x2="29" y2="34" stroke="#fff" stroke-width="3"/><line x1="34" y1="29" x2="34" y2="34" stroke="#fff" stroke-width="3"/>`) },
  run: { group: "GCP", label: "Cloud Run", svg: badge(GCP_BLUE, `<circle cx="32" cy="32" r="17" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M27 24 l13 8 -13 8z" fill="#fff"/>`) },
  gcs: { group: "GCP", label: "Storage", svg: badge(GCP_BLUE, `<rect x="16" y="20" width="32" height="10" rx="3" fill="#fff"/><rect x="16" y="34" width="32" height="10" rx="3" fill="#fff"/><circle cx="42" cy="25" r="2.2" fill="${GCP_BLUE}"/><circle cx="42" cy="39" r="2.2" fill="${GCP_BLUE}"/>`) },
  vertex: { group: "GCP", label: "Vertex AI", svg: badge(GCP_BLUE, `<circle cx="20" cy="20" r="4" fill="#fff"/><circle cx="44" cy="20" r="4" fill="#fff"/><circle cx="32" cy="30" r="4" fill="#fff"/><circle cx="32" cy="46" r="5" fill="#fff"/><line x1="22" y1="23" x2="30" y2="28" stroke="#fff" stroke-width="2.6"/><line x1="42" y1="23" x2="34" y2="28" stroke="#fff" stroke-width="2.6"/><line x1="32" y1="34" x2="32" y2="41" stroke="#fff" stroke-width="2.6"/>`) },
  gcf: { group: "GCP", label: "Functions", svg: badge(GCP_BLUE, txtG("ƒ", "#fff", 34)) },

  lambda: { group: "AWS", label: "Lambda", svg: badge(AWS_BG, txtG("λ", AWS_OR, 34)) },
  s3: { group: "AWS", label: "S3", svg: badge(AWS_BG, `<path d="M18 18 h28 l-4 30 q-10 5 -20 0z" fill="none" stroke="${AWS_OR}" stroke-width="3.4"/><ellipse cx="32" cy="18" rx="14" ry="5.4" fill="none" stroke="${AWS_OR}" stroke-width="3.4"/>`) },
  ec2: { group: "AWS", label: "EC2", svg: badge(AWS_BG, `<rect x="20" y="20" width="24" height="24" rx="3" fill="none" stroke="${AWS_OR}" stroke-width="3.4"/>` + ["26", "32", "38"].map(p => `<line x1="${p}" y1="13" x2="${p}" y2="20" stroke="${AWS_OR}" stroke-width="3"/><line x1="${p}" y1="44" x2="${p}" y2="51" stroke="${AWS_OR}" stroke-width="3"/><line x1="13" y1="${p}" x2="20" y2="${p}" stroke="${AWS_OR}" stroke-width="3"/><line x1="44" y1="${p}" x2="51" y2="${p}" stroke="${AWS_OR}" stroke-width="3"/>`).join("")) },
  dynamo: { group: "AWS", label: "DynamoDB", svg: badge(AWS_BG, cylin(AWS_OR)) },
  sqs: { group: "AWS", label: "SQS", svg: badge(AWS_BG, `<path d="M14 24 h26 m0 0 l-7 -6 m7 6 l-7 6" fill="none" stroke="${AWS_OR}" stroke-width="3.4"/><path d="M50 42 h-26 m0 0 l7 -6 m-7 6 l7 6" fill="none" stroke="${AWS_OR}" stroke-width="3.4"/>`) },
  apigw: { group: "AWS", label: "API GW", svg: badge(AWS_BG, txtG("&lt;/&gt;", AWS_OR, 21)) },

  azvm: { group: "Azure", label: "VM", svg: badge(AZ_BLUE, `<rect x="16" y="17" width="32" height="22" rx="3" fill="none" stroke="#fff" stroke-width="3.4"/><line x1="24" y1="48" x2="40" y2="48" stroke="#fff" stroke-width="3.4"/><line x1="32" y1="39" x2="32" y2="48" stroke="#fff" stroke-width="3.4"/>`) },
  azfun: { group: "Azure", label: "Functions", svg: badge(AZ_BLUE, `<path d="M36 12 L22 35 h9 l-4 17 16 -25 h-9z" fill="#ffd400"/>`) },
  cosmos: { group: "Azure", label: "Cosmos DB", svg: badge(AZ_BLUE, `<circle cx="32" cy="32" r="12" fill="none" stroke="#fff" stroke-width="3.4"/><ellipse cx="32" cy="32" rx="22" ry="8" fill="none" stroke="#fff" stroke-width="2.6" transform="rotate(-20 32 32)"/>`) },
  azbus: { group: "Azure", label: "Service Bus", svg: badge(AZ_BLUE, `<rect x="14" y="26" width="36" height="12" rx="4" fill="#fff"/><circle cx="22" cy="32" r="2.6" fill="${AZ_BLUE}"/><circle cx="32" cy="32" r="2.6" fill="${AZ_BLUE}"/><circle cx="42" cy="32" r="2.6" fill="${AZ_BLUE}"/>`) },
  aks: { group: "Azure", label: "AKS", svg: badge(AZ_BLUE, `<path d="M32 12 l17 10 v20 l-17 10 -17 -10 V22z" fill="none" stroke="#fff" stroke-width="3.4"/><circle cx="32" cy="32" r="6" fill="#fff"/>`) },
};

export function iconDataUri(key: string): string {
  const def = ICONS[key];
  if (!def) throw new Error(`Ícono desconocido: "${key}". Usa list_icons para ver los válidos.`);
  return "data:image/svg+xml;utf8," + encodeURIComponent(def.svg);
}

export function resolveColor(input: string | undefined, fallback = PALETTE[0].hex): string {
  if (!input) return fallback;
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  const byName = PALETTE.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return byName.hex;
  throw new Error(`Color "${input}" no reconocido. Usa un hex (#6a9fb5) o uno de: ${PALETTE.map(p => p.name).join(", ")}.`);
}

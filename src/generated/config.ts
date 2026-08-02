/* ════════════════════════════════════════════════════════════════════════
   ARCHIVO GENERADO — NO EDITAR A MANO

   Lo produce `npm run sync:config` a partir del motor de Fluyo:
     js/config.js  → paleta, temas, iconos, GIFs, tipografías, canvas, direcciones
     js/state.js   → tamaños por defecto de cada forma (dentro de newNode)

   Cualquier cambio que hagas aquí lo pisa la próxima sincronización. Si algo
   está mal, arréglalo en Fluyo o en scripts/sync-config.ts.

   `npm run check:config` falla si este archivo no coincide con Fluyo.
   Sincronizado desde la revisión eb8a054 de fluyo/.
   ════════════════════════════════════════════════════════════════════════ */

/* ===================== Lienzo ===================== */

export const CANVAS = { W: 2560, H: 1440, GRID: 20 } as const;

/* ===================== Formas ===================== */

export const SHAPE_NAMES = ["rect", "cylinder", "diamond", "circle", "hex", "text", "icon", "image", "anim"] as const;
export type Shape = (typeof SHAPE_NAMES)[number];

/** Ancho y alto con los que Fluyo crea cada forma (js/state.js, newNode). */
export const DEFAULT_SIZES: Record<Shape, readonly [number, number]> = {
  rect: [180, 70],
  cylinder: [150, 90],
  diamond: [160, 100],
  circle: [110, 110],
  hex: [170, 80],
  text: [200, 40],
  icon: [120, 92],
  image: [220, 160],
  anim: [120, 100],
};

/* ===================== Paleta semántica ===================== */

export interface PaletteEntry {
  /** Nombre visible, tal como aparece en el selector de color de la app. */
  name: string;
  hex: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  { name: "Servicio", hex: "#6a9fb5" },
  { name: "Eventos / Kafka", hex: "#d08b5b" },
  { name: "Datos", hex: "#7fa66b" },
  { name: "IA", hex: "#9b7fb5" },
  { name: "Alerta", hex: "#c16a6a" },
  { name: "Externo", hex: "#8f8f8f" },
  { name: "Config", hex: "#c9b458" },
  { name: "Cache", hex: "#5bb0a0" },
  { name: "Cola", hex: "#b5739b" },
  { name: "Red", hex: "#6b78c9" },
  { name: "Almacén", hex: "#c98f5b" },
  { name: "Éxito", hex: "#7bb85b" },
  { name: "Error", hex: "#d0576a" },
  { name: "Info", hex: "#5b9bd0" },
];

/* ===================== Temas ===================== */

export const THEME_NAMES = ["dark", "crema", "claro"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

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

/* ===================== Anclas ===================== */

export const SIDES = ["n", "e", "s", "w"] as const;
export type Side = (typeof SIDES)[number];

export const DIR: Record<Side, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  e: { x: 1, y: 0 },
  w: { x: -1, y: 0 },
};

/* ===================== Tipografías ===================== */

export interface FontDef {
  /** Nombre corto para el usuario (p. ej. "Georgia"). */
  name: string;
  /** Valor real de font-family, que es lo que se guarda en el documento. */
  family: string;
}

export const FONTS: readonly FontDef[] = [
  { name: "Georgia", family: "Georgia, serif" },
  { name: "Times", family: "'Times New Roman', Times, serif" },
  { name: "Palatino", family: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { name: "Segoe UI", family: "'Segoe UI', system-ui, sans-serif" },
  { name: "Arial", family: "Arial, Helvetica, sans-serif" },
  { name: "Verdana", family: "Verdana, Geneva, sans-serif" },
  { name: "Trebuchet", family: "'Trebuchet MS', Tahoma, sans-serif" },
  { name: "Tahoma", family: "Tahoma, Geneva, sans-serif" },
  { name: "Courier", family: "'Courier New', Courier, monospace" },
  { name: "Impact", family: "Impact, Haettenschweiler, sans-serif" },
  { name: "Comic Sans", family: "'Comic Sans MS', 'Comic Sans', cursive" },
];

export const DEFAULT_FONT = "Georgia, serif";

/* ===================== Iconos ===================== */

export const ICON_GROUPS = ["General", "GCP", "AWS", "Azure", "Estados", "Varios"] as const;
export type IconGroup = (typeof ICON_GROUPS)[number];

export interface IconDef {
  group: IconGroup;
  label: string;
  /** SVG completo. Se sirve como data URI, igual que en la app. */
  svg: string;
}

export const ICONS: Record<string, IconDef> = {
  "kafka": { group: "General", label: "Kafka", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#1b1b1b\"/><circle cx=\"32\" cy=\"14\" r=\"6\" fill=\"#fff\"/><circle cx=\"32\" cy=\"50\" r=\"6\" fill=\"#fff\"/><circle cx=\"46\" cy=\"23\" r=\"6\" fill=\"#fff\"/><circle cx=\"46\" cy=\"41\" r=\"6\" fill=\"#fff\"/><circle cx=\"28\" cy=\"32\" r=\"7\" fill=\"#fff\"/><line x1=\"32\" y1=\"18\" x2=\"42\" y2=\"24\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"42\" y1=\"40\" x2=\"32\" y2=\"46\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"30\" y1=\"20\" x2=\"29\" y2=\"26\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"29\" y1=\"38\" x2=\"30\" y2=\"44\" stroke=\"#fff\" stroke-width=\"3\"/></svg>" },
  "k8s": { group: "General", label: "K8s", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#326ce5\"/><line x1=\"32\" y1=\"32\" x2=\"32.0\" y2=\"17.0\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"45.0\" y2=\"24.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"45.0\" y2=\"39.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"32.0\" y2=\"47.0\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"19.0\" y2=\"39.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"19.0\" y2=\"24.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><circle cx=\"32\" cy=\"32\" r=\"16\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/><circle cx=\"32\" cy=\"32\" r=\"5\" fill=\"#fff\"/></svg>" },
  "db": { group: "General", label: "BD", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#3b4252\"/><path d=\"M18 22 v20 c0 4 6 7 14 7 s14 -3 14 -7 V22\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/><ellipse cx=\"32\" cy=\"22\" rx=\"14\" ry=\"6.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/></svg>" },
  "queue": { group: "General", label: "Cola", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#5b4a72\"/><rect x=\"14\" y=\"18\" width=\"24\" height=\"8\" rx=\"3\" fill=\"#fff\"/><rect x=\"14\" y=\"29\" width=\"24\" height=\"8\" rx=\"3\" fill=\"#fff\"/><rect x=\"14\" y=\"40\" width=\"24\" height=\"8\" rx=\"3\" fill=\"#fff\"/><path d=\"M42 28 l10 5 -10 5z\" fill=\"#fff\"/></svg>" },
  "user": { group: "General", label: "Usuario", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#6b7b8c\"/><circle cx=\"32\" cy=\"24\" r=\"9\" fill=\"#fff\"/><path d=\"M15 50 c2-11 8-15 17-15 s15 4 17 15z\" fill=\"#fff\"/></svg>" },
  "movil": { group: "General", label: "Móvil", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4a5560\"/><rect x=\"22\" y=\"12\" width=\"20\" height=\"40\" rx=\"4\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><circle cx=\"32\" cy=\"45\" r=\"2.4\" fill=\"#fff\"/></svg>" },
  "web": { group: "General", label: "Web", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#3c6e71\"/><circle cx=\"32\" cy=\"32\" r=\"17\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.2\"/><ellipse cx=\"32\" cy=\"32\" rx=\"8\" ry=\"17\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"15\" y1=\"32\" x2=\"49\" y2=\"32\" stroke=\"#fff\" stroke-width=\"3\"/></svg>" },
  "api": { group: "General", label: "API", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#2f4858\"/><text x=\"32\" y=\"33\" font-size=\"22\" font-family=\"Georgia,serif\" fill=\"#fff\" text-anchor=\"middle\" dominant-baseline=\"central\">&lt;/&gt;</text></svg>" },
  "lock": { group: "General", label: "Seguridad", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#7a3b3b\"/><rect x=\"19\" y=\"29\" width=\"26\" height=\"21\" rx=\"4\" fill=\"#fff\"/><path d=\"M24 29 v-5 a8 8 0 0 1 16 0 v5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/></svg>" },
  "ai": { group: "General", label: "IA", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#6d5a96\"/><path d=\"M32 12 l4.5 13 13 4.5 -13 4.5 -4.5 13 -4.5 -13 -13 -4.5 13 -4.5z\" fill=\"#fff\"/><circle cx=\"48\" cy=\"16\" r=\"3.4\" fill=\"#fff\"/></svg>" },
  "gke": { group: "GCP", label: "GKE", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><line x1=\"32\" y1=\"32\" x2=\"32.0\" y2=\"17.0\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"45.0\" y2=\"24.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"45.0\" y2=\"39.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"32.0\" y2=\"47.0\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"19.0\" y2=\"39.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"19.0\" y2=\"24.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><circle cx=\"32\" cy=\"32\" r=\"16\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/><circle cx=\"32\" cy=\"32\" r=\"5\" fill=\"#fff\"/></svg>" },
  "cloudsql": { group: "GCP", label: "Cloud SQL", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><path d=\"M18 22 v20 c0 4 6 7 14 7 s14 -3 14 -7 V22\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/><ellipse cx=\"32\" cy=\"22\" rx=\"14\" ry=\"6.5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/></svg>" },
  "pubsub": { group: "GCP", label: "Pub/Sub", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><circle cx=\"32\" cy=\"16\" r=\"6\" fill=\"#fff\"/><circle cx=\"18\" cy=\"44\" r=\"6\" fill=\"#fff\"/><circle cx=\"46\" cy=\"44\" r=\"6\" fill=\"#fff\"/><circle cx=\"32\" cy=\"33\" r=\"4.4\" fill=\"#fff\"/><line x1=\"32\" y1=\"21\" x2=\"32\" y2=\"29\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"28\" y1=\"36\" x2=\"22\" y2=\"40\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"36\" y1=\"36\" x2=\"42\" y2=\"40\" stroke=\"#fff\" stroke-width=\"3\"/></svg>" },
  "bigquery": { group: "GCP", label: "BigQuery", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><circle cx=\"29\" cy=\"29\" r=\"13\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/><line x1=\"38\" y1=\"38\" x2=\"49\" y2=\"49\" stroke=\"#fff\" stroke-width=\"5\" stroke-linecap=\"round\"/><line x1=\"24\" y1=\"31\" x2=\"24\" y2=\"34\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"29\" y1=\"26\" x2=\"29\" y2=\"34\" stroke=\"#fff\" stroke-width=\"3\"/><line x1=\"34\" y1=\"29\" x2=\"34\" y2=\"34\" stroke=\"#fff\" stroke-width=\"3\"/></svg>" },
  "run": { group: "GCP", label: "Cloud Run", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><circle cx=\"32\" cy=\"32\" r=\"17\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><path d=\"M27 24 l13 8 -13 8z\" fill=\"#fff\"/></svg>" },
  "gcs": { group: "GCP", label: "Storage", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><rect x=\"16\" y=\"20\" width=\"32\" height=\"10\" rx=\"3\" fill=\"#fff\"/><rect x=\"16\" y=\"34\" width=\"32\" height=\"10\" rx=\"3\" fill=\"#fff\"/><circle cx=\"42\" cy=\"25\" r=\"2.2\" fill=\"#4285f4\"/><circle cx=\"42\" cy=\"39\" r=\"2.2\" fill=\"#4285f4\"/></svg>" },
  "vertex": { group: "GCP", label: "Vertex AI", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><circle cx=\"20\" cy=\"20\" r=\"4\" fill=\"#fff\"/><circle cx=\"44\" cy=\"20\" r=\"4\" fill=\"#fff\"/><circle cx=\"32\" cy=\"30\" r=\"4\" fill=\"#fff\"/><circle cx=\"32\" cy=\"46\" r=\"5\" fill=\"#fff\"/><line x1=\"22\" y1=\"23\" x2=\"30\" y2=\"28\" stroke=\"#fff\" stroke-width=\"2.6\"/><line x1=\"42\" y1=\"23\" x2=\"34\" y2=\"28\" stroke=\"#fff\" stroke-width=\"2.6\"/><line x1=\"32\" y1=\"34\" x2=\"32\" y2=\"41\" stroke=\"#fff\" stroke-width=\"2.6\"/></svg>" },
  "gcf": { group: "GCP", label: "Functions", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4285f4\"/><text x=\"32\" y=\"33\" font-size=\"34\" font-family=\"Georgia,serif\" fill=\"#fff\" text-anchor=\"middle\" dominant-baseline=\"central\">ƒ</text></svg>" },
  "lambda": { group: "AWS", label: "Lambda", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#232f3e\"/><text x=\"32\" y=\"33\" font-size=\"34\" font-family=\"Georgia,serif\" fill=\"#ff9900\" text-anchor=\"middle\" dominant-baseline=\"central\">λ</text></svg>" },
  "s3": { group: "AWS", label: "S3", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#232f3e\"/><path d=\"M18 18 h28 l-4 30 q-10 5 -20 0z\" fill=\"none\" stroke=\"#ff9900\" stroke-width=\"3.4\"/><ellipse cx=\"32\" cy=\"18\" rx=\"14\" ry=\"5.4\" fill=\"none\" stroke=\"#ff9900\" stroke-width=\"3.4\"/></svg>" },
  "ec2": { group: "AWS", label: "EC2", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#232f3e\"/><rect x=\"20\" y=\"20\" width=\"24\" height=\"24\" rx=\"3\" fill=\"none\" stroke=\"#ff9900\" stroke-width=\"3.4\"/><line x1=\"26\" y1=\"13\" x2=\"26\" y2=\"20\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"26\" y1=\"44\" x2=\"26\" y2=\"51\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"13\" y1=\"26\" x2=\"20\" y2=\"26\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"44\" y1=\"26\" x2=\"51\" y2=\"26\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"32\" y1=\"13\" x2=\"32\" y2=\"20\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"32\" y1=\"44\" x2=\"32\" y2=\"51\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"13\" y1=\"32\" x2=\"20\" y2=\"32\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"44\" y1=\"32\" x2=\"51\" y2=\"32\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"38\" y1=\"13\" x2=\"38\" y2=\"20\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"38\" y1=\"44\" x2=\"38\" y2=\"51\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"13\" y1=\"38\" x2=\"20\" y2=\"38\" stroke=\"#ff9900\" stroke-width=\"3\"/><line x1=\"44\" y1=\"38\" x2=\"51\" y2=\"38\" stroke=\"#ff9900\" stroke-width=\"3\"/></svg>" },
  "dynamo": { group: "AWS", label: "DynamoDB", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#232f3e\"/><path d=\"M18 22 v20 c0 4 6 7 14 7 s14 -3 14 -7 V22\" fill=\"none\" stroke=\"#ff9900\" stroke-width=\"3.6\"/><ellipse cx=\"32\" cy=\"22\" rx=\"14\" ry=\"6.5\" fill=\"none\" stroke=\"#ff9900\" stroke-width=\"3.6\"/></svg>" },
  "sqs": { group: "AWS", label: "SQS", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#232f3e\"/><path d=\"M14 24 h26 m0 0 l-7 -6 m7 6 l-7 6\" fill=\"none\" stroke=\"#ff9900\" stroke-width=\"3.4\"/><path d=\"M50 42 h-26 m0 0 l7 -6 m-7 6 l7 6\" fill=\"none\" stroke=\"#ff9900\" stroke-width=\"3.4\"/></svg>" },
  "apigw": { group: "AWS", label: "API GW", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#232f3e\"/><text x=\"32\" y=\"33\" font-size=\"21\" font-family=\"Georgia,serif\" fill=\"#ff9900\" text-anchor=\"middle\" dominant-baseline=\"central\">&lt;/&gt;</text></svg>" },
  "azvm": { group: "Azure", label: "VM", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#0078d4\"/><rect x=\"16\" y=\"17\" width=\"32\" height=\"22\" rx=\"3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"24\" y1=\"48\" x2=\"40\" y2=\"48\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"39\" x2=\"32\" y2=\"48\" stroke=\"#fff\" stroke-width=\"3.4\"/></svg>" },
  "azfun": { group: "Azure", label: "Functions", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#0078d4\"/><path d=\"M36 12 L22 35 h9 l-4 17 16 -25 h-9z\" fill=\"#ffd400\"/></svg>" },
  "cosmos": { group: "Azure", label: "Cosmos DB", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#0078d4\"/><circle cx=\"32\" cy=\"32\" r=\"12\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><ellipse cx=\"32\" cy=\"32\" rx=\"22\" ry=\"8\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.6\" transform=\"rotate(-20 32 32)\"/></svg>" },
  "azbus": { group: "Azure", label: "Service Bus", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#0078d4\"/><rect x=\"14\" y=\"26\" width=\"36\" height=\"12\" rx=\"4\" fill=\"#fff\"/><circle cx=\"22\" cy=\"32\" r=\"2.6\" fill=\"#0078d4\"/><circle cx=\"32\" cy=\"32\" r=\"2.6\" fill=\"#0078d4\"/><circle cx=\"42\" cy=\"32\" r=\"2.6\" fill=\"#0078d4\"/></svg>" },
  "aks": { group: "Azure", label: "AKS", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#0078d4\"/><path d=\"M32 12 l17 10 v20 l-17 10 -17 -10 V22z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><circle cx=\"32\" cy=\"32\" r=\"6\" fill=\"#fff\"/></svg>" },
  "ok": { group: "Estados", label: "Éxito", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#2e7d46\"/><path d=\"M20 33 l8 9 16 -18\" fill=\"none\" stroke=\"#fff\" stroke-width=\"5.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" },
  "err": { group: "Estados", label: "Error", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#c1272d\"/><path d=\"M22 22 l20 20 M42 22 l-20 20\" stroke=\"#fff\" stroke-width=\"5.5\" stroke-linecap=\"round\"/></svg>" },
  "warn": { group: "Estados", label: "Aviso", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#d99a1f\"/><path d=\"M32 14 l20 34 h-40z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"4\" stroke-linejoin=\"round\"/><line x1=\"32\" y1=\"28\" x2=\"32\" y2=\"38\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\"/><circle cx=\"32\" cy=\"44\" r=\"2.6\" fill=\"#fff\"/></svg>" },
  "info": { group: "Estados", label: "Info", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#2f6fb5\"/><circle cx=\"32\" cy=\"32\" r=\"19\" fill=\"none\" stroke=\"#fff\" stroke-width=\"4\"/><circle cx=\"32\" cy=\"22\" r=\"2.8\" fill=\"#fff\"/><path d=\"M32 30 v14\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>" },
  "bug": { group: "Estados", label: "Bug", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#7a3b3b\"/><ellipse cx=\"32\" cy=\"34\" rx=\"11\" ry=\"13\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><circle cx=\"32\" cy=\"18\" r=\"6\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><path d=\"M18 28 h8 M38 28 h8 M17 40 h8 M39 40 h8 M32 21 v26\" stroke=\"#fff\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>" },
  "bell": { group: "Estados", label: "Alerta", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#b5732e\"/><path d=\"M20 42 c0 -3 3 -4 3 -12 a9 9 0 0 1 18 0 c0 8 3 9 3 12z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\" stroke-linejoin=\"round\"/><path d=\"M28 46 a4 4 0 0 0 8 0\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/></svg>" },
  "file": { group: "Varios", label: "Archivo", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#455060\"/><path d=\"M22 14 h14 l8 8 v28 h-22z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\" stroke-linejoin=\"round\"/><path d=\"M36 14 v8 h8\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\" stroke-linejoin=\"round\"/></svg>" },
  "folder": { group: "Varios", label: "Carpeta", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#c9992e\"/><path d=\"M14 22 h12 l4 5 h20 v20 h-36z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\" stroke-linejoin=\"round\"/></svg>" },
  "mail": { group: "Varios", label: "Correo", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#3c6e71\"/><rect x=\"14\" y=\"20\" width=\"36\" height=\"24\" rx=\"3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><path d=\"M14 22 l18 14 18 -14\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\" stroke-linejoin=\"round\"/></svg>" },
  "clock": { group: "Varios", label: "Reloj", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#4a5560\"/><circle cx=\"32\" cy=\"32\" r=\"18\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\"/><path d=\"M32 22 v11 l8 5\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\" stroke-linecap=\"round\"/></svg>" },
  "gear": { group: "Varios", label: "Config", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#3b4252\"/><line x1=\"32\" y1=\"32\" x2=\"32.0\" y2=\"17.0\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"45.0\" y2=\"24.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"45.0\" y2=\"39.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"32.0\" y2=\"47.0\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"19.0\" y2=\"39.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><line x1=\"32\" y1=\"32\" x2=\"19.0\" y2=\"24.5\" stroke=\"#fff\" stroke-width=\"3.4\"/><circle cx=\"32\" cy=\"32\" r=\"16\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.6\"/><circle cx=\"32\" cy=\"32\" r=\"5\" fill=\"#fff\"/></svg>" },
  "server": { group: "Varios", label: "Servidor", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#3b4252\"/><rect x=\"16\" y=\"16\" width=\"32\" height=\"14\" rx=\"3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.2\"/><rect x=\"16\" y=\"34\" width=\"32\" height=\"14\" rx=\"3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.2\"/><circle cx=\"23\" cy=\"23\" r=\"2.4\" fill=\"#fff\"/><circle cx=\"23\" cy=\"41\" r=\"2.4\" fill=\"#fff\"/></svg>" },
  "cache": { group: "Varios", label: "Cache", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#7a2e2e\"/><path d=\"M20 26 l12 -8 12 8 v12 l-12 8 -12 -8z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.4\" stroke-linejoin=\"round\"/><path d=\"M20 26 l12 8 12 -8 M32 34 v12\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3\"/></svg>" },
  "cdn": { group: "Varios", label: "CDN", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#2f4858\"/><circle cx=\"32\" cy=\"32\" r=\"16\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3\"/><ellipse cx=\"32\" cy=\"32\" rx=\"7\" ry=\"16\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.6\"/><line x1=\"16\" y1=\"32\" x2=\"48\" y2=\"32\" stroke=\"#fff\" stroke-width=\"2.6\"/><circle cx=\"46\" cy=\"20\" r=\"4\" fill=\"#fff\"/></svg>" },
  "balancer": { group: "Varios", label: "Balanceador", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#2e6b5b\"/><circle cx=\"32\" cy=\"16\" r=\"5\" fill=\"#fff\"/><circle cx=\"16\" cy=\"46\" r=\"5\" fill=\"#fff\"/><circle cx=\"32\" cy=\"46\" r=\"5\" fill=\"#fff\"/><circle cx=\"48\" cy=\"46\" r=\"5\" fill=\"#fff\"/><path d=\"M32 21 v8 M32 29 h-16 v10 M32 29 v10 M32 29 h16 v10\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3\"/></svg>" },
  "git": { group: "Varios", label: "Git", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#5b3a2e\"/><circle cx=\"22\" cy=\"20\" r=\"5\" fill=\"#fff\"/><circle cx=\"22\" cy=\"44\" r=\"5\" fill=\"#fff\"/><circle cx=\"42\" cy=\"30\" r=\"5\" fill=\"#fff\"/><path d=\"M22 25 v14 M22 32 c0 -8 8 -2 16 -4\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.2\"/></svg>" },
  "docker": { group: "Varios", label: "Docker", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#1d63a8\"/><rect x=\"18\" y=\"30\" width=\"7\" height=\"7\" fill=\"#fff\"/><rect x=\"27\" y=\"30\" width=\"7\" height=\"7\" fill=\"#fff\"/><rect x=\"36\" y=\"30\" width=\"7\" height=\"7\" fill=\"#fff\"/><rect x=\"27\" y=\"22\" width=\"7\" height=\"7\" fill=\"#fff\"/><path d=\"M14 38 h34 c0 6 -5 9 -12 9 h-10 c-8 0 -12 -4 -12 -9z\" fill=\"#fff\"/></svg>" },
  "graph": { group: "Varios", label: "Métricas", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#3c5a3c\"/><path d=\"M16 46 v-28 M16 46 h32\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.2\" stroke-linecap=\"round\"/><path d=\"M20 40 l8 -10 6 6 12 -16\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" },
};

/* ===================== GIFs animados ===================== */

export interface AnimDef {
  label: string;
  /** Vista previa estática. En el lienzo la app los dibuja por fotograma. */
  svg: string;
}

export const ANIMS: Record<string, AnimDef> = {
  "spinner": { label: "Cargando", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><circle cx=\"32\" cy=\"32\" r=\"15\" fill=\"none\" stroke=\"#3aa7e8\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-dasharray=\"60 40\"/></svg>" },
  "progress": { label: "Progreso", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><rect x=\"14\" y=\"28\" width=\"36\" height=\"8\" rx=\"4\" fill=\"none\" stroke=\"#e8e6e1\" stroke-width=\"2.6\"/><rect x=\"14\" y=\"28\" width=\"22\" height=\"8\" rx=\"4\" fill=\"#3aa7e8\"/></svg>" },
  "ticket": { label: "Ticket", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><rect x=\"16\" y=\"22\" width=\"32\" height=\"20\" rx=\"3\" fill=\"none\" stroke=\"#7bb85b\" stroke-width=\"3\"/><path d=\"M22 30 h20 M22 36 h12\" stroke=\"#7bb85b\" stroke-width=\"2.6\" stroke-linecap=\"round\"/></svg>" },
  "errmove": { label: "Error", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><circle cx=\"32\" cy=\"32\" r=\"15\" fill=\"none\" stroke=\"#d0576a\" stroke-width=\"3.4\"/><path d=\"M25 25 l14 14 M39 25 l-14 14\" stroke=\"#d0576a\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>" },
  "check": { label: "Éxito anim", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><circle cx=\"32\" cy=\"32\" r=\"15\" fill=\"none\" stroke=\"#7bb85b\" stroke-width=\"3.4\"/><path d=\"M24 33 l6 6 11 -13\" fill=\"none\" stroke=\"#7bb85b\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" },
  "typing": { label: "Escribiendo", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><circle cx=\"22\" cy=\"32\" r=\"4\" fill=\"#e8e6e1\"/><circle cx=\"32\" cy=\"32\" r=\"4\" fill=\"#e8e6e1\"/><circle cx=\"42\" cy=\"32\" r=\"4\" fill=\"#e8e6e1\"/></svg>" },
  "upload": { label: "Subiendo", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><path d=\"M32 44 v-22 M24 30 l8 -8 8 8\" fill=\"none\" stroke=\"#5b9bd0\" stroke-width=\"3.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M18 46 h28\" stroke=\"#5b9bd0\" stroke-width=\"3.4\" stroke-linecap=\"round\"/></svg>" },
  "pulse": { label: "Latido", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect x=\"2\" y=\"2\" width=\"60\" height=\"60\" rx=\"14\" fill=\"#20242a\"/><circle cx=\"32\" cy=\"32\" r=\"8\" fill=\"#c16a6a\"/><circle cx=\"32\" cy=\"32\" r=\"15\" fill=\"none\" stroke=\"#c16a6a\" stroke-width=\"2.4\" opacity=\".5\"/></svg>" },
};

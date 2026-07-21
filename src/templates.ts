import { NodeSpec, EdgeSpec, ThemeName } from "./model.js";

export interface TemplateResult {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  suggestedTheme: ThemeName;
  suggestedPageName: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** keys de nodos cuyo label puede personalizarse vía overrides (create_from_template). */
  overridableKeys: string[];
  build: (labelOverrides: Record<string, string>) => TemplateResult;
}

function lbl(defaults: Record<string, string>, overrides: Record<string, string>, key: string): string {
  return overrides[key] ?? defaults[key];
}

/* ===================== 1. Pipeline orientado a eventos ===================== */

const eventDrivenPipeline: TemplateDef = {
  id: "event_driven_pipeline",
  name: "Pipeline orientado a eventos (Kafka)",
  description: "Gateway -> Kafka -> N servicios consumidores -> base de datos. El patrón clásico de dispersión/streaming: un productor emite eventos, varios servicios los consumen en paralelo.",
  overridableKeys: ["gateway", "kafka", "svcA", "svcB", "db"],
  build(overrides) {
    const d: Record<string, string> = {
      gateway: "API\nGateway",
      kafka: "Kafka",
      svcA: "Servicio\nA",
      svcB: "Servicio\nB",
      db: "Base de\ndatos",
    };
    const nodes: NodeSpec[] = [
      { key: "gateway", shape: "rect", label: lbl(d, overrides, "gateway"), color: "Servicio" },
      { key: "kafka", shape: "icon", icon: "kafka", label: lbl(d, overrides, "kafka"), pulse: true, color: "Eventos / Kafka" },
      { key: "svcA", shape: "rect", label: lbl(d, overrides, "svcA"), color: "Servicio" },
      { key: "svcB", shape: "rect", label: lbl(d, overrides, "svcB"), color: "Servicio" },
      { key: "db", shape: "cylinder", label: lbl(d, overrides, "db"), color: "Datos" },
    ];
    const edges: EdgeSpec[] = [
      { from: "gateway", to: "kafka", label: "evento", route: "ortho" },
      { from: "kafka", to: "svcA", label: "topic: A", route: "ortho" },
      { from: "kafka", to: "svcB", label: "topic: B", route: "ortho" },
      { from: "svcA", to: "db", label: "persistencia", dashed: true },
    ];
    return { nodes, edges, suggestedTheme: "dark", suggestedPageName: "Pipeline de eventos" };
  },
};

/* ===================== 2. RAG chatbot ===================== */

const ragChatbot: TemplateDef = {
  id: "rag_chatbot",
  name: "Chatbot RAG",
  description: "Usuario -> API -> retrieval sobre una base vectorial -> LLM -> respuesta. El patrón de tu propio ScotiaNGen/IB Metrics Chatbot.",
  overridableKeys: ["user", "api", "vectordb", "llm"],
  build(overrides) {
    const d: Record<string, string> = {
      user: "Usuario",
      api: "API /\nOrquestador",
      vectordb: "Vector DB",
      llm: "LLM",
    };
    const nodes: NodeSpec[] = [
      { key: "user", shape: "icon", icon: "user", label: lbl(d, overrides, "user"), color: "Externo" },
      { key: "api", shape: "rect", label: lbl(d, overrides, "api"), color: "Servicio" },
      { key: "vectordb", shape: "cylinder", label: lbl(d, overrides, "vectordb"), color: "Datos" },
      { key: "llm", shape: "icon", icon: "ai", label: lbl(d, overrides, "llm"), pulse: true, color: "IA" },
    ];
    const edges: EdgeSpec[] = [
      { from: "user", to: "api", label: "pregunta", route: "ortho" },
      { from: "api", to: "vectordb", label: "busca contexto", route: "ortho" },
      { from: "vectordb", to: "api", label: "chunks relevantes", route: "ortho", flowDir: "reverse" },
      { from: "api", to: "llm", label: "contexto + pregunta", route: "ortho" },
      { from: "llm", to: "user", label: "respuesta", route: "ortho", flowDir: "reverse" },
    ];
    return { nodes, edges, suggestedTheme: "dark", suggestedPageName: "Chatbot RAG" };
  },
};

/* ===================== 3. Microservicios con API Gateway ===================== */

const microservicesGateway: TemplateDef = {
  id: "microservices_gateway",
  name: "Microservicios con API Gateway",
  description: "Cliente -> Gateway -> autenticación + N servicios de dominio -> base de datos compartida o por servicio.",
  overridableKeys: ["client", "gateway", "auth", "svc1", "svc2", "db"],
  build(overrides) {
    const d: Record<string, string> = {
      client: "Cliente",
      gateway: "API\nGateway",
      auth: "Auth",
      svc1: "Servicio 1",
      svc2: "Servicio 2",
      db: "Base de\ndatos",
    };
    const nodes: NodeSpec[] = [
      { key: "client", shape: "icon", icon: "web", label: lbl(d, overrides, "client"), color: "Externo" },
      { key: "gateway", shape: "rect", label: lbl(d, overrides, "gateway"), color: "Servicio" },
      { key: "auth", shape: "icon", icon: "lock", label: lbl(d, overrides, "auth"), color: "Alerta" },
      { key: "svc1", shape: "rect", label: lbl(d, overrides, "svc1"), color: "Servicio" },
      { key: "svc2", shape: "rect", label: lbl(d, overrides, "svc2"), color: "Servicio" },
      { key: "db", shape: "cylinder", label: lbl(d, overrides, "db"), color: "Datos" },
    ];
    const edges: EdgeSpec[] = [
      { from: "client", to: "gateway", label: "request", route: "ortho" },
      { from: "gateway", to: "auth", label: "valida token", route: "ortho" },
      { from: "gateway", to: "svc1", route: "ortho" },
      { from: "gateway", to: "svc2", route: "ortho" },
      { from: "svc1", to: "db", dashed: true },
      { from: "svc2", to: "db", dashed: true },
    ];
    return { nodes, edges, suggestedTheme: "dark", suggestedPageName: "Microservicios" };
  },
};

export const TEMPLATES: TemplateDef[] = [eventDrivenPipeline, ragChatbot, microservicesGateway];

export function getTemplate(id: string): TemplateDef {
  const t = TEMPLATES.find(t => t.id === id);
  if (!t) throw new Error(`Template desconocido: "${id}". Usa list_templates para ver los disponibles.`);
  return t;
}

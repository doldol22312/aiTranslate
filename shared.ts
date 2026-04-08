export type TranslationKind = "received" | "sent";
export type KeyRoutingMode = "ordered" | "roundRobin" | "random";

export type ReasoningEffort =
    | "default"
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high";

export type GeminiThinkingMode = "none" | "level" | "budget";
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface NativeTranslationRequest {
    apiKey: string;
    baseUrl: string;
    model: string;
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    reasoningEffort: ReasoningEffort;
    geminiThinkingMode: GeminiThinkingMode;
    geminiThinkingLevel: GeminiThinkingLevel;
    geminiThinkingBudget: number;
    geminiIncludeThoughts: boolean;
    proxyUrl: string;
    requestTimeoutMs: number;
}

export interface NativeTranslationResult {
    status: number;
    text?: string;
    model?: string;
    thoughtSummary?: string;
    error?: string;
}

export interface NativeKeyCheckRequest {
    apiKeys: string;
    baseUrl: string;
    model: string;
    proxyUrl: string;
    requestTimeoutMs: number;
}

export interface NativeKeyCheckResultEntry {
    index: number;
    maskedKey: string;
    ok: boolean;
    status: number;
    message: string;
    model?: string;
}

export interface NativeKeyCheckResult {
    results: NativeKeyCheckResultEntry[];
}

export interface NativeProxyDiagnosticRequest {
    proxyUrl: string;
    requestTimeoutMs: number;
}

export interface NativeProxyDiagnosticResult {
    proxied: boolean;
    ip?: string;
    city?: string;
    region?: string;
    countryCode?: string;
    countryName?: string;
    org?: string;
    asn?: string;
    status: number;
    error?: string;
}

export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
export const DEFAULT_MODEL = "gemini-3-flash-preview";
export const DEFAULT_GEMINI_KEY_CHECK_MODEL = "gemma-3-27b-it";
export const PROXY_DIAGNOSTIC_URL = "https://ipapi.co/json/";

export function buildTranslationSystemPrompt(sourceLanguage: string, targetLanguage: string) {
    const source = sourceLanguage.trim() || "auto";
    const target = targetLanguage.trim() || "English";

    return [
        "You are a translation engine.",
        source === "auto"
            ? `Detect the source language and translate the user message to ${target}.`
            : `Translate the user message from ${source} to ${target}.`,
        "Preserve meaning, tone, markdown, mentions, custom emoji, URLs, code blocks, inline code, and line breaks.",
        "Do not add explanations, notes, language labels, or quotation marks.",
        "Return only the translated text."
    ].join(" ");
}

export function parseApiKeys(raw: string) {
    return Array.from(new Set(
        raw
            .split(/\r?\n|,/g)
            .map(key => key.trim())
            .filter(Boolean)
    ));
}

export function maskApiKey(key: string) {
    const trimmed = key.trim();
    if (!trimmed) return "(empty)";
    if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

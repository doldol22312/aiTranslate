/*
 * AITranslate, a Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import type { KeyRoutingMode, NativeTranslationRequest, NativeTranslationResult } from "./shared";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, parseApiKeys } from "./shared";
import { settings } from "./settings";

export const cl = classNameFactory("vc-ai-trans-");

const Native = VencordNative.pluginHelpers.AITranslate as PluginNative<typeof import("./native")>;
let roundRobinCursor = 0;

export interface TranslationValue {
    model: string;
    targetLanguage: string;
    text: string;
    thoughtSummary?: string;
}

export function getLanguagePair(kind: "received" | "sent") {
    return {
        sourceLanguage: settings.store[`${kind}Input`].trim() || "auto",
        targetLanguage: settings.store[`${kind}Output`].trim() || "en"
    };
}

function getConfiguredApiKeys() {
    return parseApiKeys(settings.store.apiKeys || settings.store.apiKey || "");
}

function getConfiguredRoutingMode(): KeyRoutingMode {
    return settings.store.keyRouting ?? "ordered";
}

function getKeyOrder(keys: string[], routing: KeyRoutingMode) {
    switch (routing) {
        case "roundRobin": {
            const start = roundRobinCursor % keys.length;
            roundRobinCursor = (roundRobinCursor + 1) % keys.length;
            return [...keys.slice(start), ...keys.slice(0, start)];
        }
        case "random":
            return shuffle([...keys]);
        case "ordered":
        default:
            return [...keys];
    }
}

function shuffle<T>(items: T[]) {
    for (let index = items.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }

    return items;
}

function isTranslationSuccess(result: NativeTranslationResult) {
    return result.status >= 200 && result.status < 300 && Boolean(result.text);
}

function shouldTryNextKey(status: number) {
    return status === -1
        || status === 0
        || status === 401
        || status === 403
        || status === 404
        || status === 408
        || status === 409
        || status === 423
        || status === 425
        || status === 429
        || status >= 500;
}

function formatNativeFailure(result?: NativeTranslationResult) {
    if (!result) return "Translation request failed";

    if (result.error) {
        return result.status === -1
            ? result.error
            : `${result.error} (${result.status})`;
    }

    return `Translation request failed with status ${result.status}`;
}

export async function translate(kind: "received" | "sent", text: string): Promise<TranslationValue> {
    if (!text.trim()) {
        throw new Error("Cannot translate an empty message");
    }

    if (IS_WEB) {
        throw new Error("AITranslate is desktop-only because it uses native requests for custom endpoints and SOCKS proxies.");
    }

    const { sourceLanguage, targetLanguage } = getLanguagePair(kind);
    const apiKeys = getConfiguredApiKeys();

    if (!apiKeys.length) {
        const message = "No API keys are configured";
        showToast(message, Toasts.Type.FAILURE);
        throw new Error(message);
    }

    const requestBase: Omit<NativeTranslationRequest, "apiKey"> = {
        baseUrl: settings.store.baseUrl.trim() || DEFAULT_BASE_URL,
        model: settings.store.model.trim() || DEFAULT_MODEL,
        text,
        sourceLanguage,
        targetLanguage,
        reasoningEffort: settings.store.reasoningEffort ?? "default",
        geminiThinkingMode: settings.store.geminiThinkingMode ?? "none",
        geminiThinkingLevel: settings.store.geminiThinkingLevel ?? "minimal",
        geminiThinkingBudget: settings.store.geminiThinkingBudget ?? 8192,
        geminiIncludeThoughts: settings.store.geminiIncludeThoughts ?? false,
        proxyUrl: settings.store.proxyUrl.trim(),
        requestTimeoutMs: settings.store.requestTimeoutMs ?? 45000,
    };

    let lastFailure: NativeTranslationResult | undefined;

    for (const apiKey of getKeyOrder(apiKeys, getConfiguredRoutingMode())) {
        let result: NativeTranslationResult;

        try {
            result = await Native.translateText({
                ...requestBase,
                apiKey
            });
        } catch (error) {
            result = {
                status: -1,
                error: error instanceof Error ? error.message : String(error)
            };
        }

        if (isTranslationSuccess(result)) {
            return {
                model: result.model || requestBase.model,
                targetLanguage,
                text: result.text!,
                thoughtSummary: result.thoughtSummary
            };
        }

        lastFailure = result;
        if (!shouldTryNextKey(result.status)) break;
    }

    const message = formatNativeFailure(lastFailure);
    showToast(message, Toasts.Type.FAILURE);
    throw new Error(message);
}

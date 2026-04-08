/*
 * AITranslate, a Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { makeRange, OptionType } from "@utils/types";

import { KeyTools } from "./KeyTools";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, parseApiKeys } from "./shared";

const REASONING_EFFORT_OPTIONS = [
    { label: "Default", value: "default", default: true },
    { label: "None", value: "none" },
    { label: "Minimal", value: "minimal" },
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" }
] as const;

const GEMINI_THINKING_MODE_OPTIONS = [
    { label: "Off", value: "none", default: true },
    { label: "Thinking Level", value: "level" },
    { label: "Thinking Budget", value: "budget" }
] as const;

const GEMINI_THINKING_LEVEL_OPTIONS = [
    { label: "Minimal", value: "minimal", default: true },
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" }
] as const;

const KEY_ROUTING_OPTIONS = [
    { label: "Listed Order", value: "ordered", default: true },
    { label: "Round Robin", value: "roundRobin" },
    { label: "Random", value: "random" }
] as const;

export const settings = definePluginSettings({
    receivedInput: {
        type: OptionType.STRING,
        description: "Language that received messages should be translated from",
        default: "auto",
        hidden: true
    },
    receivedOutput: {
        type: OptionType.STRING,
        description: "Language that received messages should be translated to",
        default: "en",
        hidden: true
    },
    sentInput: {
        type: OptionType.STRING,
        description: "Language that your own messages should be translated from",
        default: "auto",
        hidden: true
    },
    sentOutput: {
        type: OptionType.STRING,
        description: "Language that your own messages should be translated to",
        default: "en",
        hidden: true
    },

    baseUrl: {
        type: OptionType.STRING,
        description: "OpenAI-compatible base URL. Gemini's OpenAI endpoint works here as-is.",
        default: DEFAULT_BASE_URL,
        placeholder: DEFAULT_BASE_URL
    },
    apiKeys: {
        type: OptionType.STRING,
        description: "One or more API keys for the configured OpenAI-compatible endpoint. Put one key per line.",
        default: "",
        multiline: true,
        placeholder: "key-1\nkey-2"
    },
    apiKey: {
        type: OptionType.STRING,
        description: "Legacy single-key setting kept for migration",
        default: "",
        hidden: true
    },
    model: {
        type: OptionType.STRING,
        description: "Model name to use for translation. This is free-form on purpose.",
        default: DEFAULT_MODEL,
        placeholder: DEFAULT_MODEL
    },
    keyRouting: {
        type: OptionType.SELECT,
        description: "How requests are distributed across multiple keys. Failed keys fall through to the next candidate.",
        options: KEY_ROUTING_OPTIONS,
        disabled: () => parseApiKeys(settings.store.apiKeys || settings.store.apiKey).length < 2
    },
    keyTools: {
        type: OptionType.COMPONENT,
        component: KeyTools
    },
    reasoningEffort: {
        type: OptionType.SELECT,
        description: "OpenAI-compatible reasoning_effort. Ignored when Gemini thinking config is enabled below.",
        options: REASONING_EFFORT_OPTIONS,
        disabled: () => settings.store.geminiThinkingMode !== "none"
    },
    geminiThinkingMode: {
        type: OptionType.SELECT,
        description: "Gemini-specific thinking controls sent through extra_body.google.thinking_config",
        options: GEMINI_THINKING_MODE_OPTIONS
    },
    geminiThinkingLevel: {
        type: OptionType.SELECT,
        description: "Gemini thinking_level to send when Gemini Thinking Mode is set to Thinking Level",
        options: GEMINI_THINKING_LEVEL_OPTIONS,
        disabled: () => settings.store.geminiThinkingMode !== "level"
    },
    geminiThinkingBudget: {
        type: OptionType.NUMBER,
        description: "Gemini thinking_budget to send when Gemini Thinking Mode is set to Thinking Budget",
        default: 8192,
        disabled: () => settings.store.geminiThinkingMode !== "budget"
    },
    geminiIncludeThoughts: {
        type: OptionType.BOOLEAN,
        description: "Ask Gemini to include thought summaries when Gemini thinking config is enabled",
        default: false,
        disabled: () => settings.store.geminiThinkingMode === "none"
    },
    proxyUrl: {
        type: OptionType.STRING,
        description: "Optional SOCKS5 proxy URL. Example: socks5://127.0.0.1:1080 or socks5://user:pass@127.0.0.1:1080",
        default: "",
        placeholder: "socks5://127.0.0.1:1080"
    },
    requestTimeoutMs: {
        type: OptionType.NUMBER,
        description: "Request timeout in milliseconds",
        default: 45000
    },
    autoTranslate: {
        type: OptionType.BOOLEAN,
        description: "Automatically translate your messages before sending. Shift-click or right-click the translate button to toggle this.",
        default: false
    },
    showAutoTranslateTooltip: {
        type: OptionType.BOOLEAN,
        description: "Show a tooltip on the chat bar button whenever a message is automatically translated",
        default: true
    },
    accessoryOpacity: {
        type: OptionType.SLIDER,
        description: "Translated message accessory opacity",
        markers: makeRange(0.4, 1, 0.05),
        default: 0.8,
        stickToMarkers: false
    }
}, {
    baseUrl: {
        isValid(value) {
            try {
                const url = new URL(value);
                return ["http:", "https:"].includes(url.protocol) || "Base URL must use http:// or https://";
            } catch {
                return "Base URL must be a valid URL";
            }
        }
    },
    apiKeys: {
        isValid: value => parseApiKeys(value).length > 0 || "At least one API key is required"
    },
    model: {
        isValid: value => value.trim().length > 0 || "Model is required"
    },
    geminiThinkingBudget: {
        isValid(value) {
            if (settings.store.geminiThinkingMode !== "budget") return true;
            return Number.isFinite(value) && value >= 1 || "Thinking budget must be at least 1";
        }
    },
    proxyUrl: {
        isValid(value) {
            if (!value.trim()) return true;

            try {
                const url = new URL(value);
                return ["socks5:", "socks5h:", "socks:"].includes(url.protocol)
                    || "Proxy URL must use socks5://, socks5h://, or socks://";
            } catch {
                return "Proxy URL must be a valid URL";
            }
        }
    },
    requestTimeoutMs: {
        isValid: value => Number.isFinite(value) && value >= 1000 || "Timeout must be at least 1000ms"
    }
}).withPrivateSettings<{
    showAutoTranslateAlert: boolean;
}>();

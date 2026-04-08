/*
 * AITranslate, a Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { PluginNative } from "@utils/types";
import { Forms, useState } from "@webpack/common";

import { settings } from "./settings";
import { DEFAULT_GEMINI_KEY_CHECK_MODEL, NativeKeyCheckResultEntry, NativeProxyDiagnosticResult, parseApiKeys } from "./shared";
import { cl } from "./utils";

const Native = VencordNative.pluginHelpers.AITranslate as PluginNative<typeof import("./native")>;

const routingLabels = {
    ordered: "Listed Order",
    roundRobin: "Round Robin",
    random: "Random"
} as const;

export function KeyTools() {
    const {
        apiKeys,
        apiKey,
        baseUrl,
        keyCheckModel,
        keyRouting,
        model,
        proxyUrl,
        requestTimeoutMs
    } = settings.use(["apiKeys", "apiKey", "baseUrl", "keyCheckModel", "keyRouting", "model", "proxyUrl", "requestTimeoutMs"]);

    const [isChecking, setIsChecking] = useState(false);
    const [isDiagnosing, setIsDiagnosing] = useState(false);
    const [results, setResults] = useState<NativeKeyCheckResultEntry[] | null>(null);
    const [diagnostic, setDiagnostic] = useState<NativeProxyDiagnosticResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const rawKeys = apiKeys || apiKey;
    const configuredKeys = parseApiKeys(rawKeys);
    const routingLabel = routingLabels[keyRouting ?? "ordered"];
    const effectiveCheckModel = getEffectiveKeyCheckModel(baseUrl, keyCheckModel, model);

    async function runCheck() {
        setIsChecking(true);
        setError(null);

        try {
            const response = await Native.checkKeys({
                apiKeys: rawKeys,
                baseUrl,
                model: effectiveCheckModel,
                proxyUrl,
                requestTimeoutMs
            });

            setResults(response.results);
        } catch (err) {
            setResults(null);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsChecking(false);
        }
    }

    async function runDiagnostic() {
        setIsDiagnosing(true);
        setError(null);

        try {
            const response = await Native.diagnoseProxy({
                proxyUrl,
                requestTimeoutMs
            });

            setDiagnostic(response);
        } catch (err) {
            setDiagnostic(null);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsDiagnosing(false);
        }
    }

    return (
        <div className={cl("key-tools")}>
            <Forms.FormText>
                Configured keys: <strong>{configuredKeys.length}</strong>
                {" · "}
                Routing: <strong>{routingLabel}</strong>
            </Forms.FormText>
            <Forms.FormText>
                Key checker uses <code>{effectiveCheckModel}</code> and the configured base URL to verify each key.
            </Forms.FormText>
            <Forms.FormText>
                Proxy diagnostic checks the public IP and country through the same native network path used by translations.
            </Forms.FormText>

            <div className={cl("key-tools-actions")}>
                <Button
                    onClick={runCheck}
                    disabled={isChecking || configuredKeys.length === 0 || !effectiveCheckModel.trim() || !baseUrl.trim()}
                >
                    {isChecking ? "Checking..." : "Check Keys"}
                </Button>

                <Button
                    variant="secondary"
                    onClick={runDiagnostic}
                    disabled={isDiagnosing}
                >
                    {isDiagnosing ? "Diagnosing..." : "Run Proxy Diagnostic"}
                </Button>

                {(results || diagnostic) && (
                    <Button
                        variant="secondary"
                        onClick={() => {
                            setResults(null);
                            setDiagnostic(null);
                            setError(null);
                        }}
                    >
                        Clear Results
                    </Button>
                )}
            </div>

            {error && (
                <div className={cl("key-result", "key-result-fail")}>
                    <Forms.FormText>{error}</Forms.FormText>
                </div>
            )}

            {diagnostic && (
                <div className={cl("diagnostic", diagnostic.error ? "key-result-fail" : "key-result-ok")}>
                    <div className={cl("key-result-header")}>
                        <span>Proxy Diagnostic</span>
                        <span>{diagnostic.proxied ? "SOCKS5 enabled" : "Direct connection"}</span>
                        <span>{diagnostic.status}</span>
                    </div>

                    {diagnostic.error ? (
                        <Forms.FormText>{diagnostic.error}</Forms.FormText>
                    ) : (
                        <>
                            <Forms.FormText>
                                IP: <code>{diagnostic.ip || "unknown"}</code>
                            </Forms.FormText>
                            <Forms.FormText>
                                Location: <code>{formatLocation(diagnostic)}</code>
                            </Forms.FormText>
                            {(diagnostic.asn || diagnostic.org) && (
                                <Forms.FormText>
                                    Network: <code>{[diagnostic.asn, diagnostic.org].filter(Boolean).join(" · ")}</code>
                                </Forms.FormText>
                            )}
                        </>
                    )}
                </div>
            )}

            {results && (
                <div className={cl("key-results")}>
                    {results.map(result => (
                        <div
                            key={`${result.index}-${result.maskedKey}`}
                            className={cl("key-result", result.ok ? "key-result-ok" : "key-result-fail")}
                        >
                            <div className={cl("key-result-header")}>
                                <span>Key {result.index + 1}</span>
                                <code>{result.maskedKey}</code>
                                <span>{result.status}</span>
                            </div>

                            <Forms.FormText>{result.message}</Forms.FormText>
                            {result.model && (
                                <Forms.FormText>
                                    Model: <code>{result.model}</code>
                                </Forms.FormText>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function getEffectiveKeyCheckModel(baseUrl: string, keyCheckModel: string | undefined, model: string | undefined) {
    const explicitModel = keyCheckModel?.trim();
    if (explicitModel) return explicitModel;

    try {
        const hostname = new URL(baseUrl).hostname;
        if (hostname === "generativelanguage.googleapis.com") {
            return DEFAULT_GEMINI_KEY_CHECK_MODEL;
        }
    } catch { }

    return model?.trim() || "";
}

function formatLocation(result: NativeProxyDiagnosticResult) {
    return [
        result.city,
        result.region,
        result.countryCode || result.countryName
    ].filter(Boolean).join(", ") || "unknown";
}

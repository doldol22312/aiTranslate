/*
 * AITranslate, a Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { isIP, Socket, connect as connectSocket } from "net";
import { TLSSocket, connect as connectTls } from "tls";

import { IpcMainInvokeEvent } from "electron";

import {
    buildTranslationSystemPrompt,
    maskApiKey,
    NativeKeyCheckRequest,
    NativeKeyCheckResult,
    NativeProxyDiagnosticRequest,
    NativeProxyDiagnosticResult,
    NativeTranslationRequest,
    NativeTranslationResult,
    parseApiKeys,
    PROXY_DIAGNOSTIC_URL
} from "./shared";

type ConnectableSocket = Socket | TLSSocket;
type HttpMethod = "GET" | "POST";

interface HttpResult {
    data: string;
    status: number;
}

interface HttpRequestOptions {
    body?: string;
    headers: Record<string, string>;
    method: HttpMethod;
    proxyUrl: string;
    timeoutMs: number;
    url: URL;
}

interface SocksProxyConfig {
    host: string;
    password?: string;
    port: number;
    username?: string;
}

class SocketBuffer {
    private buffer = Buffer.alloc(0);
    private error: Error | null = null;
    private pendingResolvers = new Set<() => void>();
    private readableEnded = false;

    constructor(socket: Socket) {
        socket.on("data", chunk => {
            this.buffer = Buffer.concat([this.buffer, chunk]);
            this.flush();
        });

        socket.once("close", () => {
            this.readableEnded = true;
            this.flush();
        });

        socket.once("end", () => {
            this.readableEnded = true;
            this.flush();
        });

        socket.once("error", error => {
            this.error = error;
            this.flush();
        });
    }

    async read(length: number) {
        while (this.buffer.length < length) {
            if (this.error) throw this.error;
            if (this.readableEnded) throw new Error("SOCKS5 proxy socket closed during negotiation");

            await new Promise<void>(resolve => this.pendingResolvers.add(resolve));
        }

        const chunk = this.buffer.subarray(0, length);
        this.buffer = this.buffer.subarray(length);
        return chunk;
    }

    private flush() {
        for (const resolve of this.pendingResolvers) {
            resolve();
        }

        this.pendingResolvers.clear();
    }
}

export async function translateText(_: IpcMainInvokeEvent, request: NativeTranslationRequest): Promise<NativeTranslationResult> {
    try {
        validateRequest(request);

        const url = normalizeChatCompletionsUrl(request.baseUrl);
        const payload = buildPayload(request);
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${request.apiKey.trim()}`,
            "Content-Length": Buffer.byteLength(payload).toString(),
        };

        const { status, data } = await makeHttpRequest({
            body: payload,
            headers,
            method: "POST",
            proxyUrl: request.proxyUrl.trim(),
            timeoutMs: request.requestTimeoutMs,
            url
        });
        const parsed = safeParseJson(data);

        if (status < 200 || status >= 300) {
            return {
                status,
                error: formatApiError(status, data, parsed)
            };
        }

        const message = parsed?.choices?.[0]?.message;
        const text = extractText(message);
        if (!text) {
            return {
                status: -1,
                error: "The model returned an empty translation response"
            };
        }

        return {
            status,
            model: parsed?.model || request.model.trim(),
            text,
            thoughtSummary: extractThoughtSummary(message)
        };
    } catch (error) {
        return {
            status: -1,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export async function checkKeys(_: IpcMainInvokeEvent, request: NativeKeyCheckRequest): Promise<NativeKeyCheckResult> {
    validateKeyCheckRequest(request);

    const keys = parseApiKeys(request.apiKeys);
    const results = await Promise.all(keys.map((apiKey, index) => checkSingleKey(index, apiKey, request)));

    return { results };
}

export async function diagnoseProxy(_: IpcMainInvokeEvent, request: NativeProxyDiagnosticRequest): Promise<NativeProxyDiagnosticResult> {
    try {
        const { status, data } = await makeHttpRequest({
            headers: {
                "Accept": "application/json"
            },
            method: "GET",
            proxyUrl: request.proxyUrl.trim(),
            timeoutMs: request.requestTimeoutMs,
            url: new URL(PROXY_DIAGNOSTIC_URL)
        });

        const parsed = safeParseJson(data);
        if (status < 200 || status >= 300) {
            return {
                proxied: Boolean(request.proxyUrl.trim()),
                status,
                error: formatApiError(status, data, parsed)
            };
        }

        return {
            proxied: Boolean(request.proxyUrl.trim()),
            ip: parsed?.ip,
            city: parsed?.city,
            region: parsed?.region,
            countryCode: parsed?.country_code,
            countryName: parsed?.country_name,
            org: parsed?.org,
            asn: parsed?.asn,
            status
        };
    } catch (error) {
        return {
            proxied: Boolean(request.proxyUrl.trim()),
            status: -1,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

function validateRequest(request: NativeTranslationRequest) {
    if (!request.apiKey.trim()) throw new Error("API key is not configured");
    if (!request.baseUrl.trim()) throw new Error("Base URL is not configured");
    if (!request.model.trim()) throw new Error("Model is not configured");
    if (!request.targetLanguage.trim()) throw new Error("Target language is not configured");
}

function validateKeyCheckRequest(request: NativeKeyCheckRequest) {
    if (!parseApiKeys(request.apiKeys).length) throw new Error("No API keys are configured");
    if (!request.baseUrl.trim()) throw new Error("Base URL is not configured");
    if (!request.model.trim()) throw new Error("Model is not configured");
}

function normalizeChatCompletionsUrl(baseUrl: string) {
    return normalizeApiUrl(baseUrl, "/chat/completions");
}

function normalizeModelUrl(baseUrl: string, model: string) {
    return normalizeApiUrl(baseUrl, `/models/${encodeURIComponent(model.trim())}`);
}

function normalizeApiUrl(baseUrl: string, path: string) {
    const url = new URL(baseUrl.trim());
    const basePath = url.pathname
        .replace(/\/chat\/completions\/?$/, "")
        .replace(/\/models(?:\/[^/]+)?\/?$/, "")
        .replace(/\/+$/, "");

    url.pathname = `${basePath}${path}`;
    return url;
}

function buildPayload(request: NativeTranslationRequest) {
    const body: Record<string, any> = {
        model: request.model.trim(),
        messages: [
            {
                role: "system",
                content: buildTranslationSystemPrompt(request.sourceLanguage, request.targetLanguage)
            },
            {
                role: "user",
                content: request.text
            }
        ]
    };

    if (request.geminiThinkingMode === "none") {
        if (request.reasoningEffort !== "default") {
            body.reasoning_effort = request.reasoningEffort;
        }
    } else {
        const thinkingConfig: Record<string, any> = {};

        if (request.geminiThinkingMode === "level") {
            thinkingConfig.thinking_level = request.geminiThinkingLevel;
        } else {
            thinkingConfig.thinking_budget = request.geminiThinkingBudget;
        }

        if (request.geminiIncludeThoughts) {
            thinkingConfig.include_thoughts = true;
        }

        body.extra_body = {
            google: {
                thinking_config: thinkingConfig
            }
        };
    }

    return JSON.stringify(body);
}

function extractText(message: any) {
    const content = message?.content;

    if (typeof content === "string") {
        return content.trim();
    }

    if (!Array.isArray(content)) {
        return "";
    }

    return content
        .filter(part => !["reasoning", "thinking"].includes(part?.type))
        .map(extractPartText)
        .join("")
        .trim();
}

function extractThoughtSummary(message: any) {
    if (typeof message?.reasoning === "string") {
        return message.reasoning.trim() || undefined;
    }

    if (Array.isArray(message?.reasoning)) {
        const text = message.reasoning.map(extractPartText).join("").trim();
        return text || undefined;
    }

    if (!Array.isArray(message?.content)) {
        return undefined;
    }

    const text = message.content
        .filter(part => ["reasoning", "thinking"].includes(part?.type))
        .map(extractPartText)
        .join("")
        .trim();

    return text || undefined;
}

function extractPartText(part: any) {
    if (typeof part === "string") return part;
    if (typeof part?.text === "string") return part.text;
    if (typeof part?.text?.value === "string") return part.text.value;
    return "";
}

function safeParseJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function formatApiError(status: number, data: string, parsed: any) {
    return parsed?.error?.message
        || parsed?.message
        || data
        || `Request failed with status ${status}`;
}

async function checkSingleKey(index: number, apiKey: string, request: NativeKeyCheckRequest) {
    try {
        const url = normalizeModelUrl(request.baseUrl, request.model);
        const { status, data } = await makeHttpRequest({
            headers: {
                "Authorization": `Bearer ${apiKey.trim()}`
            },
            method: "GET",
            proxyUrl: request.proxyUrl.trim(),
            timeoutMs: request.requestTimeoutMs,
            url
        });
        const parsed = safeParseJson(data);

        if (status >= 200 && status < 300) {
            return {
                index,
                maskedKey: maskApiKey(apiKey),
                ok: true,
                status,
                message: "Key can access the configured model",
                model: parsed?.id || request.model.trim()
            };
        }

        return {
            index,
            maskedKey: maskApiKey(apiKey),
            ok: false,
            status,
            message: formatApiError(status, data, parsed),
            model: parsed?.id
        };
    } catch (error) {
        return {
            index,
            maskedKey: maskApiKey(apiKey),
            ok: false,
            status: -1,
            message: error instanceof Error ? error.message : String(error)
        };
    }
}

async function makeHttpRequest({
    body,
    headers,
    method,
    proxyUrl,
    timeoutMs,
    url
}: HttpRequestOptions): Promise<HttpResult> {
    if (proxyUrl) {
        return await makeProxiedHttpRequest({
            body,
            headers,
            method,
            proxyUrl,
            timeoutMs,
            url
        });
    }

    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

    return await new Promise<HttpResult>((resolve, reject) => {
        const requestOptions: Record<string, any> = {
            agent: undefined,
            headers,
            host: url.hostname,
            hostname: url.hostname,
            method,
            path: `${url.pathname}${url.search}`,
            port: url.port || undefined,
            protocol: url.protocol,
            timeout: timeoutMs
        };

        const req = requestFn(requestOptions, res => {
            const chunks: Buffer[] = [];
            res.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.once("end", () => {
                resolve({
                    data: Buffer.concat(chunks).toString("utf8"),
                    status: res.statusCode ?? 0
                });
            });
        });

        req.once("timeout", () => {
            req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
        });

        req.once("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

async function makeProxiedHttpRequest({
    body,
    headers,
    method,
    proxyUrl,
    timeoutMs,
    url
}: HttpRequestOptions): Promise<HttpResult> {
    const socket = await openSocksConnection(url, proxyUrl, timeoutMs);
    socket.setTimeout(timeoutMs);

    const requestBody = body ?? "";
    const headerLines = {
        ...headers,
        "Host": formatHostHeader(url),
        "Connection": "close",
        ...(requestBody && !hasHeader(headers, "content-length")
            ? { "Content-Length": Buffer.byteLength(requestBody).toString() }
            : {})
    };

    const rawRequest = [
        `${method} ${url.pathname}${url.search} HTTP/1.1`,
        ...Object.entries(headerLines).map(([key, value]) => `${key}: ${value}`),
        "",
        requestBody
    ].join("\r\n");

    return await new Promise<HttpResult>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = (handler: () => void) => {
            if (settled) return;
            settled = true;
            handler();
        };

        socket.once("timeout", () => socket.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
        socket.once("error", error => finish(() => reject(error)));
        socket.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        socket.once("end", () => {
            finish(() => {
                try {
                    resolve(parseRawHttpResponse(Buffer.concat(chunks)));
                } catch (error) {
                    reject(error);
                }
            });
        });
        socket.once("close", hadError => {
            if (hadError) return;
            if (!chunks.length) return;

            finish(() => {
                try {
                    resolve(parseRawHttpResponse(Buffer.concat(chunks)));
                } catch (error) {
                    reject(error);
                }
            });
        });

        socket.end(rawRequest);
    });
}

function hasHeader(headers: Record<string, string>, target: string) {
    const normalizedTarget = target.toLowerCase();
    return Object.keys(headers).some(key => key.toLowerCase() === normalizedTarget);
}

function formatHostHeader(url: URL) {
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    return url.port && url.port !== defaultPort
        ? `${url.hostname}:${url.port}`
        : url.hostname;
}

function parseRawHttpResponse(response: Buffer): HttpResult {
    const separatorIndex = response.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
        throw new Error("Proxy response did not contain valid HTTP headers");
    }

    const headerText = response.subarray(0, separatorIndex).toString("utf8");
    const body = response.subarray(separatorIndex + 4);
    const [statusLine, ...headerLines] = headerText.split("\r\n");
    const statusMatch = /^HTTP\/\d+(?:\.\d+)?\s+(\d+)/i.exec(statusLine);
    if (!statusMatch) {
        throw new Error(`Invalid HTTP status line from proxy response: ${statusLine}`);
    }

    const headers = Object.fromEntries(headerLines.map(line => {
        const separator = line.indexOf(":");
        return [
            line.slice(0, separator).trim().toLowerCase(),
            line.slice(separator + 1).trim()
        ];
    }));

    const decodedBody = headers["transfer-encoding"]?.toLowerCase().includes("chunked")
        ? decodeChunkedBody(body)
        : body;

    return {
        data: decodedBody.toString("utf8"),
        status: Number(statusMatch[1])
    };
}

function decodeChunkedBody(buffer: Buffer) {
    let offset = 0;
    const chunks: Buffer[] = [];

    while (offset < buffer.length) {
        const lineEnd = buffer.indexOf("\r\n", offset);
        if (lineEnd === -1) throw new Error("Invalid chunked response from proxy");

        const chunkSizeHex = buffer.subarray(offset, lineEnd).toString("utf8").split(";", 1)[0].trim();
        const chunkSize = Number.parseInt(chunkSizeHex, 16);
        if (Number.isNaN(chunkSize)) {
            throw new Error(`Invalid chunk size in proxy response: ${chunkSizeHex}`);
        }

        offset = lineEnd + 2;
        if (chunkSize === 0) {
            return Buffer.concat(chunks);
        }

        const chunkEnd = offset + chunkSize;
        if (chunkEnd > buffer.length) throw new Error("Chunked response ended unexpectedly");

        chunks.push(buffer.subarray(offset, chunkEnd));
        offset = chunkEnd + 2;
    }

    throw new Error("Chunked response terminated unexpectedly");
}

async function openSocksConnection(url: URL, proxyUrl: string, timeoutMs: number): Promise<ConnectableSocket> {
    const proxy = parseProxyUrl(proxyUrl);

    const socket = await new Promise<Socket>((resolve, reject) => {
        const tcpSocket = connectSocket(proxy.port, proxy.host);

        tcpSocket.setTimeout(timeoutMs);
        tcpSocket.once("timeout", () => tcpSocket.destroy(new Error(`SOCKS5 connection timed out after ${timeoutMs}ms`)));
        tcpSocket.once("error", reject);
        tcpSocket.once("connect", () => resolve(tcpSocket));
    });

    await negotiateSocksConnection(socket, url, proxy);

    if (url.protocol !== "https:") {
        return socket;
    }

    return await new Promise<TLSSocket>((resolve, reject) => {
        const secureSocket = connectTls({
            servername: url.hostname,
            socket
        });

        secureSocket.setTimeout(timeoutMs);
        secureSocket.once("timeout", () => secureSocket.destroy(new Error(`TLS handshake timed out after ${timeoutMs}ms`)));
        secureSocket.once("error", reject);
        secureSocket.once("secureConnect", () => resolve(secureSocket));
    });
}

function parseProxyUrl(proxyUrl: string): SocksProxyConfig {
    const url = new URL(proxyUrl);
    if (!["socks5:", "socks5h:", "socks:"].includes(url.protocol)) {
        throw new Error("Only SOCKS5 proxy URLs are supported");
    }

    return {
        host: url.hostname,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        port: Number(url.port || 1080),
        username: url.username ? decodeURIComponent(url.username) : undefined
    };
}

async function negotiateSocksConnection(socket: Socket, targetUrl: URL, proxy: SocksProxyConfig) {
    const reader = new SocketBuffer(socket);
    const methods = proxy.username || proxy.password ? [0x00, 0x02] : [0x00];

    socket.write(Buffer.from([0x05, methods.length, ...methods]));

    const hello = await reader.read(2);
    if (hello[0] !== 0x05) throw new Error("SOCKS5 proxy returned an invalid version");
    if (hello[1] === 0xff) throw new Error("SOCKS5 proxy rejected all authentication methods");

    if (hello[1] === 0x02) {
        await authenticateWithPassword(socket, reader, proxy);
    } else if (hello[1] !== 0x00) {
        throw new Error(`SOCKS5 proxy selected unsupported auth method ${hello[1]}`);
    }

    const port = Number(targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80));
    const address = encodeSocksAddress(targetUrl.hostname);
    const portBytes = Buffer.from([port >> 8, port & 0xff]);

    socket.write(Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00]),
        address,
        portBytes
    ]));

    const responseHead = await reader.read(4);
    if (responseHead[0] !== 0x05) throw new Error("SOCKS5 proxy connect response had an invalid version");
    if (responseHead[1] !== 0x00) throw new Error(getSocksReplyError(responseHead[1]));

    await discardBoundAddress(reader, responseHead[3]);
}

async function authenticateWithPassword(socket: Socket, reader: SocketBuffer, proxy: SocksProxyConfig) {
    const username = Buffer.from(proxy.username || "", "utf8");
    const password = Buffer.from(proxy.password || "", "utf8");

    if (username.length > 255 || password.length > 255) {
        throw new Error("SOCKS5 username/password must be 255 bytes or fewer");
    }

    socket.write(Buffer.concat([
        Buffer.from([0x01, username.length]),
        username,
        Buffer.from([password.length]),
        password
    ]));

    const response = await reader.read(2);
    if (response[1] !== 0x00) {
        throw new Error("SOCKS5 proxy authentication failed");
    }
}

function encodeSocksAddress(hostname: string) {
    const ipVersion = isIP(hostname);
    if (ipVersion === 4) {
        return Buffer.from([
            0x01,
            ...hostname.split(".").map(Number)
        ]);
    }

    if (ipVersion === 6) {
        throw new Error("IPv6 literal targets are not supported by this lightweight SOCKS5 implementation");
    }

    const encodedHostname = Buffer.from(hostname, "utf8");
    if (encodedHostname.length > 255) {
        throw new Error("Target hostname is too long for SOCKS5");
    }

    return Buffer.concat([
        Buffer.from([0x03, encodedHostname.length]),
        encodedHostname
    ]);
}

async function discardBoundAddress(reader: SocketBuffer, addressType: number) {
    switch (addressType) {
        case 0x01:
            await reader.read(4 + 2);
            return;
        case 0x03: {
            const [length] = await reader.read(1);
            await reader.read(length + 2);
            return;
        }
        case 0x04:
            await reader.read(16 + 2);
            return;
        default:
            throw new Error(`SOCKS5 proxy returned an unsupported address type ${addressType}`);
    }
}

function getSocksReplyError(code: number) {
    switch (code) {
        case 0x01: return "SOCKS5 proxy reported a general failure";
        case 0x02: return "SOCKS5 proxy connection is not allowed by its ruleset";
        case 0x03: return "SOCKS5 proxy reported network unreachable";
        case 0x04: return "SOCKS5 proxy reported host unreachable";
        case 0x05: return "SOCKS5 proxy refused the connection";
        case 0x06: return "SOCKS5 proxy TTL expired";
        case 0x07: return "SOCKS5 proxy does not support the requested command";
        case 0x08: return "SOCKS5 proxy does not support the requested address type";
        default: return `SOCKS5 proxy returned error code ${code}`;
    }
}

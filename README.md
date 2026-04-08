# AITranslate

Desktop-only Vencord userplugin that translates messages through any OpenAI-compatible `chat/completions` endpoint.

## Features

- OpenAI-compatible base URL plus free-form model name
- Multiple API keys with listed-order, round-robin, or random routing
- Built-in key checker against the configured model
- Gemini support through Google's OpenAI endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/`
- Optional SOCKS5 proxy support for native requests
- Generic `reasoning_effort` plus Gemini-specific thinking controls
- Message context-menu translation, popover translation, and optional auto-translate on send

## Install

Copy this folder into your Vencord checkout at:

`src/userplugins/aiTranslate.desktop`

Then rebuild Vencord.

## Gemini Setup

- `Base URL`: `https://generativelanguage.googleapis.com/v1beta/openai/`
- `API keys`: one Gemini API key per line
- `Model`: any Gemini OpenAI-compatible model string, for example `gemini-3-flash-preview`
- `Key Check Model`: leave empty to default to `gemma-3-27b-it` on Google's endpoint

Google's OpenAI-compatibility doc:

https://ai.google.dev/gemini-api/docs/openai

## Proxy Format

Examples:

- `socks5://127.0.0.1:1080`
- `socks5://user:pass@127.0.0.1:1080`

## Usage

- Click the translate icon in the chat bar to edit language pairs.
- Shift-click or right-click the translate icon to toggle auto-translate.
- Use the message popover button or message context menu to translate received messages.
- Use the plugin settings page to check configured keys and choose the routing mode.
- Use `Run Proxy Diagnostic` to see the public IP and country observed through the same native proxy path used by requests.

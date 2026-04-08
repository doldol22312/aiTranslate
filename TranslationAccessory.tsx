/*
 * AITranslate, a Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { Parser, useEffect, useState } from "@webpack/common";

import { settings } from "./settings";
import { TranslateIcon } from "./TranslateIcon";
import { cl, TranslationValue } from "./utils";

const TranslationSetters = new Map<string, (value: TranslationValue | undefined) => void>();

export function handleTranslate(messageId: string, value: TranslationValue) {
    TranslationSetters.get(messageId)?.(value);
}

function Dismiss({ onDismiss }: { onDismiss: () => void; }) {
    return (
        <button
            className={cl("dismiss")}
            onClick={onDismiss}
        >
            Dismiss
        </button>
    );
}

export function TranslationAccessory({ message }: { message: Message; }) {
    const [translation, setTranslation] = useState<TranslationValue>();

    useEffect(() => {
        if ((message as any).vencordEmbeddedBy) return;

        TranslationSetters.set(message.id, setTranslation);
        return () => void TranslationSetters.delete(message.id);
    }, []);

    if (!translation) return null;

    return (
        <span
            className={cl("accessory")}
            style={{ opacity: settings.store.accessoryOpacity }}
        >
            <TranslateIcon width={16} height={16} className={cl("accessory-icon")} />
            {Parser.parse(translation.text)}
            <br />
            (translated to {translation.targetLanguage} with {translation.model} - <Dismiss onDismiss={() => setTranslation(undefined)} />)
        </span>
    );
}

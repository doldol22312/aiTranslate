/*
 * AITranslate, a Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { migratePluginSetting } from "@api/Settings";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Menu } from "@webpack/common";

import { settings } from "./settings";
import { handleTranslate, TranslationAccessory } from "./TranslationAccessory";
import { setShouldShowTranslateEnabledTooltip, TranslateChatBarIcon, TranslateIcon } from "./TranslateIcon";
import { translate } from "./utils";

const authors = [{ name: "cones", id: 0n }];

migratePluginSetting("AITranslate", "apiKey", "apiKeys");

const messageContextPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    const content = getMessageContent(message);
    if (!content) return;

    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    group.splice(group.findIndex(child => child?.props?.id === "copy-text") + 1, 0, (
        <Menu.MenuItem
            id="vc-ai-translate"
            label="Translate With AI"
            icon={TranslateIcon}
            action={async () => {
                const translated = await translate("received", content);
                handleTranslate(message.id, translated);
            }}
        />
    ));
};

function getMessageContent(message: Message) {
    return message.content
        || message.messageSnapshots?.[0]?.message.content
        || message.embeds?.find(embed => embed.type === "auto_moderation_message")?.rawDescription
        || "";
}

let tooltipTimeout: ReturnType<typeof setTimeout> | undefined;

export default definePlugin({
    name: "AITranslate",
    description: "Translate messages with OpenAI-compatible models, including Gemini via Google's OpenAI endpoint",
    authors,
    settings,
    contextMenus: {
        message: messageContextPatch
    },
    translate,

    renderMessageAccessory: props => <TranslationAccessory message={props.message} />,

    chatBarButton: {
        icon: TranslateIcon,
        render: TranslateChatBarIcon
    },

    messagePopoverButton: {
        icon: TranslateIcon,
        render(message: Message) {
            const content = getMessageContent(message);
            if (!content) return null;

            return {
                label: "Translate With AI",
                icon: TranslateIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: async () => {
                    const translated = await translate("received", content);
                    handleTranslate(message.id, translated);
                }
            };
        }
    },

    async onBeforeMessageSend(_, message) {
        if (!settings.store.autoTranslate || !message.content) return;

        const translated = await translate("sent", message.content);
        message.content = translated.text;

        setShouldShowTranslateEnabledTooltip?.(true);
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => setShouldShowTranslateEnabledTooltip?.(false), 2000);
    }
});

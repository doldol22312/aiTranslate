/*
 * AITranslate, a Vencord userplugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot } from "@utils/modal";
import { Forms, TextInput } from "@webpack/common";

import { settings } from "./settings";
import { cl } from "./utils";

const LANGUAGE_FIELDS = [
    {
        key: "receivedInput",
        title: "Received Messages: From",
        placeholder: "auto"
    },
    {
        key: "receivedOutput",
        title: "Received Messages: To",
        placeholder: "en"
    },
    {
        key: "sentInput",
        title: "Your Messages: From",
        placeholder: "auto"
    },
    {
        key: "sentOutput",
        title: "Your Messages: To",
        placeholder: "en"
    }
] as const;

function LanguageInput({
    settingsKey,
    title,
    placeholder
}: {
    settingsKey: typeof LANGUAGE_FIELDS[number]["key"];
    title: string;
    placeholder: string;
}) {
    const currentValue = settings.use([settingsKey])[settingsKey];

    return (
        <section className={Margins.bottom16}>
            <Forms.FormTitle tag="h3">{title}</Forms.FormTitle>
            <TextInput
                value={currentValue}
                placeholder={placeholder}
                onChange={value => settings.store[settingsKey] = value}
            />
        </section>
    );
}

function AutoTranslateToggle() {
    const { autoTranslate } = settings.use(["autoTranslate"]);

    return (
        <FormSwitch
            title="Auto Translate"
            description={settings.def.autoTranslate.description}
            value={autoTranslate}
            onChange={value => settings.store.autoTranslate = value}
            hideBorder
        />
    );
}

export function TranslateModal({ rootProps }: { rootProps: ModalProps; }) {
    return (
        <ModalRoot {...rootProps}>
            <ModalHeader className={cl("modal-header")}>
                <Forms.FormTitle tag="h2" className={cl("modal-title")}>
                    AI Translate
                </Forms.FormTitle>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("modal-content")}>
                <Forms.FormText className={Margins.bottom16}>
                    Use ISO language codes or plain names. Examples: <code>auto</code>, <code>en</code>, <code>ru</code>, <code>Japanese</code>.
                </Forms.FormText>

                {LANGUAGE_FIELDS.map(field => (
                    <LanguageInput
                        key={field.key}
                        settingsKey={field.key}
                        title={field.title}
                        placeholder={field.placeholder}
                    />
                ))}

                <Divider className={Margins.bottom16} />

                <AutoTranslateToggle />
            </ModalContent>
        </ModalRoot>
    );
}

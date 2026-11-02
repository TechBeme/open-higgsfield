"use client";

import { useTranslations } from "next-intl";
import { catalogText, localizeSchema, modelCopyKey } from "@/i18n/catalog-copy";

function readable(label: string) {
    const text = label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export function useModelCopy() {
    const t = useTranslations("commandBar");
    const catalog = useTranslations("catalog");
    const description = (source: string) => catalogText(catalog, "descriptions", source);
    return {
        fieldLabel: (id: string, label: string) => t.has(`fields.${modelCopyKey(id)}`) ? t(`fields.${modelCopyKey(id)}`) : readable(label),
        slotLabel: (id: string, label: string) => t.has(`slots.${modelCopyKey(id)}`) ? t(`slots.${modelCopyKey(id)}`) : readable(label),
        description,
        optionLabel: (value: string) => catalogText(catalog, "options", value),
        modelLabel: (value: string) => catalogText(catalog, "models", value),
        schema: <T,>(value: T) => localizeSchema(value, description),
    };
}

"use client";

import { ModelField } from "@/features/studio/components/ModelField";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Settings2 } from "lucide-react";
import { PillPopover } from "./PillPopover";
import type { ImageModelCapability } from "@/models/capabilities/types";

interface ControlsPillProps {
    model: ImageModelCapability;
    fieldValues: Record<string, unknown>;
    onFieldChange: (id: string, value: unknown) => void;
    count: number;
}

export function ControlsPill({ model, fieldValues, onFieldChange }: ControlsPillProps) {
    const t = useTranslations("commandBar");
    const [open, setOpen] = useState(false);

    const extraFields = model.custom_fields.filter(field =>
        !(model.size_ui && [model.size_ui.width_field, model.size_ui.height_field].includes(field.id))
        && !(model.aspect_ratio && field.id === "aspect_ratio")
        && !(model.resolution_variant && field.id === "resolution"));

    const hasContent = extraFields.length > 0;
    if (!hasContent) return null;

    return (
        <PillPopover
            triggerLabel={t("controls")}
            open={open}
            onOpenChange={setOpen}
            width="w-[34rem]"
            contentClassName="model-scrollbar max-h-[70dvh] overflow-x-hidden overflow-y-auto overscroll-contain"
            trigger={
                <>
                    <Settings2 className="h-3 w-3" />
                    <span>{t("controlsCount", { count: extraFields.length })}</span>
                </>
            }
        >
            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] mb-2 px-1" style={{ color: "rgba(244,247,251,.66)" }}>
                {t("moreControls")}
            </p>
            <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 px-1 pb-1 sm:grid-cols-2">



                {/* Extra fields */}
                {extraFields.map(field => <ModelField key={field.id} field={field} value={fieldValues[field.id]} onChange={value => onFieldChange(field.id, value)} />)}
            </div>
        </PillPopover>
    );
}

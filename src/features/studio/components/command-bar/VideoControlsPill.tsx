"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Settings2 } from "lucide-react";
import { PillPopover } from "./PillPopover";
import { Input } from "@/components/ui/input";
import { ModelField } from "@/features/studio/components/ModelField";
import type { ModelCapabilities } from "@/models/capabilities/types";
import type { SettingsValues } from "@/features/studio/model-settings";

export function VideoControlsPill({ model, settings, onSettingsChange }: {
    model: ModelCapabilities; settings: SettingsValues; onSettingsChange: (settings: SettingsValues) => void;
}) {
    const [open, setOpen] = useState(false);
    const t = useTranslations("commandBar");
    const video = useTranslations("studio.video");
    const id = useId();
    const hasContent = model.seed || model.cfg_scale || model.negative_prompt || model.shot_type || model.style || model.custom_fields.length > 0;
    if (!hasContent) return null;
    const update = (partial: Partial<SettingsValues>) => onSettingsChange({ ...settings, ...partial });
    return <PillPopover open={open} onOpenChange={setOpen} width="w-[38rem]" triggerLabel={t("controls")} trigger={<><Settings2 className="size-4" /><span>{t("controls")}</span></>}>
        <div><p className="text-sm font-semibold">{t("moreControls")}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("controlsHint")}</p></div>
        <div className="mt-3 grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            {model.seed && <div className="space-y-2"><label className="block space-y-2"><span className="text-xs font-medium">{video("seed")}</span><Input type="number" min={model.seed.minimum} max={model.seed.maximum} step={1} aria-describedby={`${id}-seed-hint`} value={settings.seed === "-1" ? "" : settings.seed} onChange={event => update({ seed: event.target.value || "-1" })} placeholder={t("auto")} /></label><p id={`${id}-seed-hint`} className="text-xs text-muted-foreground">{video("seedHint")}</p></div>}
            {model.negative_prompt && <label className="space-y-2 sm:col-span-2"><span className="text-xs font-medium">{video("negativePrompt.label")}</span><Input value={settings.negativePrompt} onChange={event => update({ negativePrompt: event.target.value })} placeholder={video("negativePrompt.placeholder")} /></label>}
            {model.cfg_scale && <label className="space-y-2"><span className="text-xs font-medium">{video("cfgScale")}</span><Input type="number" min={0} max={1} step={0.01} value={settings.cfgScale} onChange={event => update({ cfgScale: Number(event.target.value) })} /></label>}
            {model.shot_type && <div className="space-y-2"><p id={`${id}-shot`} className="text-xs font-medium">{video("shotType")}</p><div role="group" aria-labelledby={`${id}-shot`} className="flex gap-2">{(["single", "multi"] as const).map(shotType => <button key={shotType} type="button" aria-pressed={settings.shotType === shotType} onClick={() => update({ shotType })} className={`min-h-10 rounded-lg border px-3 text-xs ${settings.shotType === shotType ? "border-primary/30 bg-primary/10 text-primary" : "border-white/15"}`}>{video(`shotTypes.${shotType}`)}</button>)}</div></div>}
            {model.custom_fields.map(field => <ModelField key={field.id} field={field} value={settings.fieldValues[field.id]} onChange={value => update({ fieldValues: { ...settings.fieldValues, [field.id]: value } })} />)}
            {model.style && <div className="space-y-2 sm:col-span-2"><p id={`${id}-style`} className="text-xs font-medium">{video("style")}</p><div role="group" aria-labelledby={`${id}-style`} className="flex flex-wrap gap-2">{["none", "anime", "3d", "clay", "cyberpunk", "comic"].map(style => <button key={style} type="button" aria-pressed={settings.style === style} onClick={() => update({ style })} className={`min-h-10 rounded-lg border px-3 text-xs ${settings.style === style ? "border-primary/30 bg-primary/10 text-primary" : "border-white/15"}`}>{video(`styles.${style}`)}</button>)}</div></div>}
        </div>
    </PillPopover>;
}

"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { PillPopover } from "./PillPopover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModelCapabilities } from "@/models/capabilities/types";
import type { SettingsValues } from "@/components/studio/SettingsPanel";

interface VideoControlsPillProps {
    model: ModelCapabilities;
    settings: SettingsValues;
    onSettingsChange: (settings: SettingsValues) => void;
}

export function VideoControlsPill({ model, settings, onSettingsChange }: VideoControlsPillProps) {
    const [open, setOpen] = useState(false);

    const hasContent =
        model.cfg_scale ||
        model.negative_prompt ||
        model.shot_type ||
        model.style ||
        (model.custom_fields?.length ?? 0) > 0;

    if (!hasContent) return null;

    function update(partial: Partial<SettingsValues>) {
        onSettingsChange({ ...settings, ...partial });
    }

    function updateField(id: string, value: unknown) {
        onSettingsChange({
            ...settings,
            fieldValues: { ...settings.fieldValues, [id]: value },
        });
    }

    const styleOptions = ["none", "anime", "3d", "clay", "cyberpunk", "comic"];
    const customSelectFields = model.custom_fields?.filter((field) => field.type === "select") ?? [];
    const customNumberFields = model.custom_fields?.filter((field) => field.type === "number") ?? [];
    const customCheckboxFields = model.custom_fields?.filter((field) => field.type === "checkbox") ?? [];

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            width="w-[42rem]"
            contentClassName="overflow-hidden"
            trigger={
                <>
                    <Settings2 className="h-3 w-3" />
                    <span>Controls</span>
                </>
            }
        >
            <div className="px-1">
                <p className="mb-4 text-[10px] font-extrabold uppercase tracking-[.08em]" style={{ color: "rgba(244,247,251,.44)" }}>
                    Advanced controls
                </p>

                <div className="space-y-4">
                    {model.negative_prompt && (
                        <div className="space-y-1.5">
                            <Label className="text-[11px]">Negative prompt</Label>
                            <Input
                                value={settings.negativePrompt}
                                onChange={(e) => update({ negativePrompt: e.target.value })}
                                placeholder="Objects/styles to avoid..."
                                className="h-8 text-xs"
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2">
                        {model.cfg_scale && (
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <Label className="text-[11px]">CFG Scale</Label>
                                    <span className="text-[10px] font-mono text-muted-foreground">
                                        {settings.cfgScale.toFixed(2)}
                                    </span>
                                </div>
                                <Slider
                                    value={[settings.cfgScale]}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    onValueChange={(v) =>
                                        update({ cfgScale: Array.isArray(v) ? (v as number[])[0] : (v as number) })
                                    }
                                />
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label className="text-[11px]">Seed</Label>
                            <Input
                                value={settings.seed}
                                onChange={(e) => update({ seed: e.target.value })}
                                placeholder="-1"
                                className="h-8 text-xs font-mono"
                            />
                        </div>

                        {model.shot_type && (
                            <div className="space-y-1.5">
                                <Label className="text-[11px]">Shot type</Label>
                                <div className="flex gap-1.5">
                                    {(["single", "multi"] as const).map((shotType) => (
                                        <button
                                            key={shotType}
                                            type="button"
                                            onClick={() => update({ shotType })}
                                            className="cursor-pointer rounded-[10px] border px-3 py-1 text-[10px] font-bold transition-colors"
                                            style={{
                                                background: settings.shotType === shotType ? "#d5ff47" : "rgba(255,255,255,.04)",
                                                color: settings.shotType === shotType ? "#0b1118" : "#f4f7fb",
                                                borderColor: settings.shotType === shotType ? "transparent" : "rgba(255,255,255,.08)",
                                            }}
                                        >
                                            {shotType}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {customSelectFields.map((field) => {
                            const val = settings.fieldValues[field.id];
                            return (
                                <div key={field.id} className="space-y-1.5">
                                    <Label className="text-[11px]">{field.label}</Label>
                                    <Select
                                        value={String(val ?? field.default ?? "")}
                                        onValueChange={(v) => updateField(field.id, v)}
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(field.options ?? []).map((option) => (
                                                <SelectItem key={option} value={option} className="text-xs">
                                                    {option}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            );
                        })}

                        {customNumberFields.map((field) => {
                            const val = settings.fieldValues[field.id];
                            return (
                                <div key={field.id} className="space-y-1.5">
                                    <Label className="text-[11px]">{field.label}</Label>
                                    <Input
                                        type="number"
                                        value={String(val ?? field.default ?? "")}
                                        min={field.minimum}
                                        max={field.maximum}
                                        onChange={(e) =>
                                            updateField(field.id, e.target.value === "" ? null : Number(e.target.value))
                                        }
                                        className="h-8 text-xs"
                                    />
                                </div>
                            );
                        })}

                        {model.style && (
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label className="text-[11px]">Style</Label>
                                <div className="flex flex-wrap gap-1.5">
                                    {styleOptions.map((style) => (
                                        <button
                                            key={style}
                                            type="button"
                                            onClick={() => update({ style })}
                                            className="cursor-pointer rounded-[10px] border px-2.5 py-1 text-[10px] font-bold transition-colors"
                                            style={{
                                                background: settings.style === style ? "#d5ff47" : "rgba(255,255,255,.04)",
                                                color: settings.style === style ? "#0b1118" : "#f4f7fb",
                                                borderColor: settings.style === style ? "transparent" : "rgba(255,255,255,.08)",
                                            }}
                                        >
                                            {style}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {customCheckboxFields.length > 0 && (
                        <div className="grid grid-cols-1 gap-2 border-t border-white/[.08] pt-3 sm:grid-cols-2">
                            {customCheckboxFields.map((field) => {
                                const val = settings.fieldValues[field.id];
                                return (
                                    <div
                                        key={field.id}
                                        className="flex min-h-11 items-center justify-between gap-3 rounded-[12px] border border-white/[.07] bg-white/[.025] px-3 py-2"
                                    >
                                        <Label className="text-[11px] leading-tight">{field.label}</Label>
                                        <Switch
                                            checked={Boolean(val ?? field.default)}
                                            onCheckedChange={(v) => updateField(field.id, v)}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </PillPopover>
    );
}

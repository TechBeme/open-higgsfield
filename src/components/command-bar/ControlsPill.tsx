"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { PillPopover } from "./PillPopover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { ImageModelCapability } from "@/models/capabilities/image";

interface ControlsPillProps {
    model: ImageModelCapability;
    fieldValues: Record<string, unknown>;
    onFieldChange: (id: string, value: unknown) => void;
    count: number;
}

export function ControlsPill({ model, fieldValues, onFieldChange, count }: ControlsPillProps) {
    const [open, setOpen] = useState(false);

    // Filter out prompt pill, width/height (AspectRatioPill custom), aspect_ratio and resolution (shown as dedicated pills)
    const extraFields = (model.custom_fields ?? []).filter(
        (f) => !(f.type === "checkbox" && f.id.includes("prompt"))
            && !(f.id.toLowerCase().includes("width") || f.id.toLowerCase().includes("height"))
            && f.id !== "aspect_ratio"
            && f.id !== "resolution"
    );

    const hasContent = extraFields.length > 0;
    if (!hasContent) return null;

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            width="w-[34rem]"
            contentClassName="overflow-hidden"
            trigger={
                <>
                    <Settings2 className="h-3 w-3" />
                    <span>{count} controls</span>
                </>
            }
        >
            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] mb-2 px-1" style={{ color: "rgba(244,247,251,.44)" }}>
                More controls
            </p>
            <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 px-1 pb-1 sm:grid-cols-2">



                {/* Extra fields */}
                {extraFields.map((field) => {
                    const val = fieldValues[field.id] ?? field.default ?? "";
                    if (field.type === "select" && field.options) {
                        const selected = String(val);
                        return (
                            <div key={field.id} className="space-y-1.5">
                                <Label className="text-[11px]">{field.label}</Label>
                                <div className="flex flex-wrap gap-1.5">
                                    {field.options.map((o) => {
                                        const active = selected === o;
                                        return (
                                            <button
                                                key={o}
                                                type="button"
                                                onClick={() => onFieldChange(field.id, o)}
                                                className="rounded-[8px] border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.04em] transition-colors cursor-pointer"
                                                style={active ? {
                                                    background: "rgba(213,255,71,.14)",
                                                    borderColor: "rgba(213,255,71,.4)",
                                                    color: "#d5ff47",
                                                } : {
                                                    background: "rgba(255,255,255,.04)",
                                                    borderColor: "rgba(255,255,255,.1)",
                                                    color: "rgba(244,247,251,.55)",
                                                }}
                                            >
                                                {o}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    }
                    if (field.type === "checkbox") {
                        const label = field.label.replace(/^Enable\s+/i, "");
                        return (
                            <div key={field.id} className="flex items-center gap-2.5 pt-3 mt-2 border-t" style={{ borderColor: "rgba(255,255,255,.08)" }}>
                                <Switch
                                    checked={Boolean(val)}
                                    onCheckedChange={(v) => onFieldChange(field.id, v)}
                                />
                                <Label className="text-[11px]">{label}</Label>
                            </div>
                        );
                    }
                    if (field.type === "number") {
                        return (
                            <div key={field.id} className="space-y-1.5">
                                <div className="flex justify-between">
                                    <Label className="text-[11px]">{field.label}</Label>
                                    <span className="text-[10px] text-muted-foreground">{String(val)}</span>
                                </div>
                                <Slider
                                    min={field.minimum ?? 0}
                                    max={field.maximum ?? 100}
                                    step={1}
                                    value={[Number(val)]}
                                    onValueChange={(v) => onFieldChange(field.id, Array.isArray(v) ? (v as number[])[0] : v)}
                                />
                            </div>
                        );
                    }
                    return (
                        <div key={field.id} className="space-y-1">
                            <Label className="text-[11px]">{field.label}</Label>
                            <Input className="h-7 text-xs" value={String(val)} onChange={(e) => onFieldChange(field.id, e.target.value)} />
                        </div>
                    );
                })}
            </div>
        </PillPopover>
    );
}

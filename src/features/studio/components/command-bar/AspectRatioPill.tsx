"use client";

import { useTranslations } from "next-intl";
import { useModelCopy } from "@/i18n/use-model-copy";
import { useState } from "react";
import { RectangleHorizontal, RectangleVertical, Square, Check, Wand2, SlidersHorizontal } from "lucide-react";
import { PillPopover } from "./PillPopover";

function classifyRatio(val: string): "square" | "portrait" | "landscape" {
    // "w:h" format
    const colonParts = val.split(":").map(Number);
    if (colonParts.length === 2 && !isNaN(colonParts[0]) && !isNaN(colonParts[1])) {
        const [w, h] = colonParts;
        if (w === h) return "square";
        return h > w ? "portrait" : "landscape";
    }
    // Named format: extract last two numbers (e.g. widescreen_16_9)
    const m = val.match(/_(\d+)_(\d+)$/);
    if (m) {
        const w = Number(m[1]), h = Number(m[2]);
        if (w === h) return "square";
        return h > w ? "portrait" : "landscape";
    }
    if (val.includes("square")) return "square";
    if (val.includes("portrait") || val.includes("vertical") || val.includes("story")) return "portrait";
    return "landscape";
}

function prettifyRatio(val: string): string {
    if (val.includes(":")) return val;
    const m = val.match(/_(\d+)_(\d+)$/);
    if (m) return `${m[1]}:${m[2]}`;
    return val.replace(/_/g, " ");
}

function AspectRatioIcon({ ratio }: { ratio: string }) {
    if (ratio === "custom") return <SlidersHorizontal className="w-4 h-4" />;
    if (!ratio) return <RectangleHorizontal className="w-4 h-4" />;
    const c = classifyRatio(ratio);
    if (c === "square") return <Square className="w-4 h-4" />;
    if (c === "portrait") return <RectangleVertical className="w-4 h-4" />;
    return <RectangleHorizontal className="w-4 h-4" />;
}

interface CustomFields {
    widthId: string;
    heightId: string;
    widthLabel: string;
    heightLabel: string;
    defaultWidth: number;
    defaultHeight: number;
}

interface AspectRatioPillProps {
    ratios: [string, string][];
    value: string;
    onChange: (ratio: string) => void;
    customFields?: CustomFields | null;
    fieldValues?: Record<string, unknown>;
    onFieldChange?: (id: string, val: unknown) => void;
}

export function AspectRatioPill({ ratios, value, onChange, customFields, fieldValues, onFieldChange }: AspectRatioPillProps) {
    const t = useTranslations("commandBar");
    const { optionLabel, fieldLabel } = useModelCopy();
    const [open, setOpen] = useState(false);
    function ratioLabel(val: string, label = val) {
        if (!val) return t("auto");
        if (val === "custom") return t("custom");
        if (/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(val)) return val;
        const localized = optionLabel(val);
        return localized === val ? prettifyRatio(label) : localized;
    }
    const displayValue = ratioLabel(value);
    const widthLabel = customFields ? fieldLabel(customFields.widthId, customFields.widthLabel) : "";
    const heightLabel = customFields ? fieldLabel(customFields.heightId, customFields.heightLabel) : "";

    const portrait = ratios.filter(([val]) => classifyRatio(val) === "portrait");
    const square = ratios.filter(([val]) => classifyRatio(val) === "square");
    const landscape = ratios.filter(([val]) => classifyRatio(val) === "landscape");

    function renderRatioButton(val: string, label: string) {
        const selected = value === val;
        return (
            <button
                type="button"
                aria-pressed={selected}
                onClick={() => { onChange(val); setOpen(false); }}
                className="flex items-center gap-2 rounded-[10px] min-h-10 px-2 py-2 text-xs transition-colors cursor-pointer w-full"
                style={{
                    background: selected ? "rgba(213,255,71,.1)" : "transparent",
                    color: selected ? "#d5ff47" : "#f4f7fb",
                    fontWeight: selected ? 700 : 500,
                }}
                onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
                onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
            >
                <AspectRatioIcon ratio={val} />
                <span className="flex-1 text-left">{label}</span>
                {selected && <Check className="h-3 w-3 shrink-0" style={{ color: "#d5ff47" }} />}
            </button>
        );
    }

    function renderTopButton(val: string, label: string, Icon: React.ElementType, keepOpen?: boolean) {
        const selected = value === val;
        return (
            <button
                type="button"
                aria-pressed={selected}
                onClick={() => { onChange(val); if (!keepOpen) setOpen(false); }}
                className="flex items-center gap-2 w-full rounded-[10px] min-h-10 px-2 py-2 text-xs transition-colors cursor-pointer"
                style={{
                    background: selected ? "rgba(213,255,71,.1)" : "transparent",
                    color: selected ? "#d5ff47" : "#f4f7fb",
                    fontWeight: selected ? 700 : 500,
                }}
                onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
                onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
            >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                {selected && <Check className="h-3 w-3 shrink-0" style={{ color: "#d5ff47" }} />}
            </button>
        );
    }

    return (
        <PillPopover
            triggerLabel={t("aspectRatio")}
            open={open}
            onOpenChange={setOpen}
            width="w-fit"
            trigger={
                <>
                    <AspectRatioIcon ratio={value} />
                    <span>{displayValue}</span>
                </>
            }
        >
            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] mb-2 px-1" style={{ color: "rgba(244,247,251,.66)" }}>
                {t("aspectRatio")}
            </p>

            {/* Unified 2-column layout: Auto over Portrait | 1:1 over Landscape */}
            <div className="flex gap-2">
                {/* Left column */}
                <div className="flex flex-col min-w-0">
                    {renderTopButton("", t("auto"), Wand2)}
                    {portrait.length > 0 && (
                        <>
                            <div className="h-px my-1.5" style={{ background: "rgba(255,255,255,.08)" }} />
                            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] mb-1 px-2" style={{ color: "rgba(244,247,251,.66)" }}>{t("portrait")}</p>
                            <div className="space-y-0.5">
                                {portrait.map(([val, label]) => (
                                    <div key={val}>{renderRatioButton(val, ratioLabel(val, label))}</div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Single continuous vertical divider */}
                <div className="w-px self-stretch" style={{ background: "rgba(255,255,255,.08)" }} />

                {/* Right column */}
                <div className="flex flex-col min-w-0">
                    {square.map(([val, label]) => (
                        <div key={val}>{renderTopButton(val, ratioLabel(val, label), Square)}</div>
                    ))}
                    {landscape.length > 0 && (
                        <>
                            <div className="h-px my-1.5" style={{ background: "rgba(255,255,255,.08)" }} />
                            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] mb-1 px-2" style={{ color: "rgba(244,247,251,.66)" }}>{t("landscape")}</p>
                            <div className="space-y-0.5">
                                {landscape.map(([val, label]) => (
                                    <div key={val}>{renderRatioButton(val, ratioLabel(val, label))}</div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Custom option + inputs */}
            {customFields && (
                <>
                    <div className="h-px my-2" style={{ background: "rgba(255,255,255,.08)" }} />
                    {renderTopButton("custom", t("custom"), SlidersHorizontal, true)}
                </>
            )}
            {value === "custom" && customFields && (
                <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                            <p className="text-[10px] font-semibold px-1" style={{ color: "rgba(244,247,251,.66)" }}>{widthLabel}</p>
                            <input
                                type="number"
                                aria-label={widthLabel}
                                min={64}
                                max={4096}
                                value={Number(fieldValues?.[customFields.widthId] ?? customFields.defaultWidth)}
                                onChange={(e) => onFieldChange?.(customFields.widthId, Number(e.target.value))}
                                className="w-full rounded-[8px] border px-2 py-1 text-xs bg-transparent outline-none"
                                style={{ borderColor: "rgba(255,255,255,.12)", color: "#f4f7fb" }}
                            />
                        </div>
                        <div className="flex-1 space-y-1">
                            <p className="text-[10px] font-semibold px-1" style={{ color: "rgba(244,247,251,.66)" }}>{heightLabel}</p>
                            <input
                                type="number"
                                aria-label={heightLabel}
                                min={64}
                                max={4096}
                                value={Number(fieldValues?.[customFields.heightId] ?? customFields.defaultHeight)}
                                onChange={(e) => onFieldChange?.(customFields.heightId, Number(e.target.value))}
                                className="w-full rounded-[8px] border px-2 py-1 text-xs bg-transparent outline-none"
                                style={{ borderColor: "rgba(255,255,255,.12)", color: "#f4f7fb" }}
                            />
                        </div>
                    </div>
                    <div className="h-px" style={{ background: "rgba(255,255,255,.08)" }} />
                </div>
            )}
        </PillPopover>
    );
}

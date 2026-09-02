"use client";

import { useState } from "react";
import { Wand2, Check } from "lucide-react";
import { PillPopover } from "./PillPopover";
import { IMAGE_CAPABILITIES, IMAGE_CAPABILITY_GROUPS, getImageCapabilitiesByGroup } from "@/models/capabilities/image";
import { getEditVariant } from "@/models/capabilities/image-helpers";

/** Check if a model accepts image input (media_slots or edit variant slots) */
function modelAcceptsImageInput(id: string): boolean {
    const caps = IMAGE_CAPABILITIES[id];
    if (!caps) return false;
    if (caps.media_slots.some((s) => s.kind === "image")) return true;
    const ev = getEditVariant(caps);
    return !!ev && ev.slots.some((s) => s.kind === "image");
}

interface ImageModelPillProps {
    modelId: string;
    onModelChange: (modelId: string) => void;
    /** Files uploaded for image slots — used to determine if Edit models are available */
    slotFiles: Record<string, File[]>;
}

export function ImageModelPill({ modelId, onModelChange, slotFiles }: ImageModelPillProps) {
    const [open, setOpen] = useState(false);
    const model = IMAGE_CAPABILITIES[modelId];
    const label = model?.label ?? modelId;

    const hasAnyFiles = Object.values(slotFiles).some((files) => files.length > 0);

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            width="w-72"
            contentClassName="flex max-h-[70dvh] min-h-0 flex-col overflow-hidden"
            trigger={
                <>
                    <Wand2 className="h-3 w-3" />
                    <span>{label}</span>
                </>
            }
        >
            <p className="mb-2 shrink-0 px-1 text-[10px] font-extrabold uppercase tracking-[.08em]" style={{ color: "rgba(244,247,251,.44)" }}>
                Model
            </p>
            <div className="model-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
                <div className="space-y-3 pr-1">
                    {IMAGE_CAPABILITY_GROUPS.map((group) => {
                        const models = getImageCapabilitiesByGroup(group);
                        // When files are attached, only show models that accept image input
                        const visibleModels = hasAnyFiles
                            ? models.filter((m) => modelAcceptsImageInput(m.id))
                            : models;
                        if (visibleModels.length === 0) return null;
                        return (
                            <div key={group}>
                                <p className="text-[11px] font-bold px-1 py-1" style={{ color: "rgba(244,247,251,.72)" }}>{group}</p>
                                <div className="space-y-0.5">
                                    {visibleModels.map((m) => {
                                        const isSelected = m.id === modelId;

                                        return (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => {
                                                    onModelChange(m.id);
                                                    setOpen(false);
                                                }}
                                                className="w-full flex items-center justify-between rounded-[10px] px-2.5 py-2 text-xs transition-colors cursor-pointer"
                                                style={{
                                                    background: isSelected ? "rgba(213,255,71,.1)" : "transparent",
                                                    color: isSelected ? "#d5ff47" : "#f4f7fb",
                                                    fontWeight: isSelected ? 700 : 500,
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,.06)";
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (!isSelected) e.currentTarget.style.background = "transparent";
                                                }}
                                                >
                                                    <span className="truncate">{m.label}</span>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                    {isSelected && <Check className="h-3.5 w-3.5" style={{ color: "#d5ff47" }} />}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </PillPopover>
    );
}

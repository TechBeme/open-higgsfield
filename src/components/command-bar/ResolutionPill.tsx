"use client";

import { useState } from "react";
import { Diamond, Check, Monitor, Tv, MonitorDot } from "lucide-react";
import { PillPopover } from "./PillPopover";
import type { SizeUiResolution } from "@/types";

const RESOLUTION_ICONS: Record<string, React.ElementType> = {
    "1k": Monitor,
    "1.5k": Tv,
    "2k": MonitorDot,
};

interface ResolutionPillProps {
    resolutions: SizeUiResolution[];
    value: string;
    onChange: (resolution: string) => void;
}

export function ResolutionPill({ resolutions, value, onChange }: ResolutionPillProps) {
    const [open, setOpen] = useState(false);
    const displayValue = value || resolutions[0]?.id || "1k";

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            width="w-fit"
            trigger={
                <>
                    {(() => { const Icon = RESOLUTION_ICONS[displayValue] ?? Diamond; return <Icon className="h-3 w-3" />; })()}
                    <span>{displayValue}</span>
                </>
            }
        >
            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] mb-2 px-1" style={{ color: "rgba(244,247,251,.44)" }}>
                Resolution
            </p>
            <div className="space-y-0.5">
                {resolutions.map((res) => {
                    const selected = value === res.id;
                    return (
                        <button
                            key={res.id}
                            type="button"
                            onClick={() => { onChange(res.id); setOpen(false); }}
                            className="w-full flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-xs transition-colors cursor-pointer"
                            style={{
                                background: selected ? "rgba(213,255,71,.1)" : "transparent",
                                color: selected ? "#d5ff47" : "#f4f7fb",
                                fontWeight: selected ? 700 : 500,
                            }}
                            onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
                            onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
                        >
                            {(() => { const Icon = RESOLUTION_ICONS[res.id] ?? Diamond; return <Icon className="h-3.5 w-3.5 shrink-0" />; })()}
                            <span>{res.id}</span>
                            {selected && <Check className="h-3.5 w-3.5 ml-auto" style={{ color: "#d5ff47" }} />}
                        </button>
                    );
                })}
            </div>
        </PillPopover>
    );
}

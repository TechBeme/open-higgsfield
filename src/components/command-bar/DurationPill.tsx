"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { PillPopover } from "./PillPopover";

interface DurationPillProps {
    durations: string[];
    value: string;
    onChange: (duration: string) => void;
}

export function DurationPill({ durations, value, onChange }: DurationPillProps) {
    const [open, setOpen] = useState(false);

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            width="w-fit"
            trigger={
                <>
                    <Clock className="h-3 w-3" />
                    <span>{value || durations[0]}s</span>
                </>
            }
        >
            <p className="text-[10px] font-extrabold uppercase tracking-[.08em] mb-2 px-1" style={{ color: "rgba(244,247,251,.44)" }}>
                Duration
            </p>
            <div className="flex flex-wrap gap-1.5">
                {durations.map((d) => (
                    <button
                        key={d}
                        type="button"
                        onClick={() => { onChange(d); setOpen(false); }}
                        className="rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
                        style={{
                            background: value === d ? "#d5ff47" : "rgba(255,255,255,.06)",
                            color: value === d ? "#0b1118" : "#f4f7fb",
                        }}
                    >
                        {d}s
                    </button>
                ))}
            </div>
        </PillPopover>
    );
}

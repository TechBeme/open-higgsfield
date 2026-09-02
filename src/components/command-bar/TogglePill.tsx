"use client";

import { Sparkles, Shield } from "lucide-react";

interface TogglePillProps {
    label: string;
    icon: "sparkle" | "shield";
    value: boolean;
    onChange: (value: boolean) => void;
}

export function TogglePill({ label, icon, value, onChange }: TogglePillProps) {
    const Icon = icon === "sparkle" ? Sparkles : Shield;

    return (
        <button
            type="button"
            onClick={() => onChange(!value)}
            className="flex items-center gap-2 h-9 rounded-[14px] border border-white/[.08] px-3 text-xs font-extrabold transition-all whitespace-nowrap cursor-pointer text-foreground"
            style={{ background: "rgba(255,255,255,.04)" }}
        >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
            {/* Custom toggle track */}
            <span
                className="inline-flex items-center rounded-full transition-colors"
                style={{
                    width: 30,
                    height: 18,
                    padding: "0 3px",
                    background: value ? "#d5ff47" : "rgba(255,255,255,.14)",
                }}
            >
                <span
                    className="h-3 w-3 rounded-full shadow-sm transition-transform shrink-0"
                    style={{
                        background: value ? "#0b1118" : "#fff",
                        transform: value ? "translateX(12px)" : "translateX(0)",
                    }}
                />
            </span>
        </button>
    );
}

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
            role="switch"
            aria-checked={value}
            aria-label={label}
            title={label}
            onClick={() => onChange(!value)}
            className="flex min-w-0 max-w-full items-center gap-2 min-h-10 rounded-[14px] border border-white/[.08] px-3 text-xs font-extrabold transition-all whitespace-nowrap cursor-pointer text-foreground"
            style={{ background: "rgba(255,255,255,.04)" }}
        >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
            {/* Custom toggle track */}
            <span
                className="inline-flex shrink-0 items-center rounded-full transition-colors"
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

"use client";

import { useRef, useEffect, useLayoutEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface PillPopoverProps {
    trigger: React.ReactNode;
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    width?: string;
    contentClassName?: string;
}

export function PillPopover({
    trigger,
    children,
    open,
    onOpenChange,
    width = "w-64",
    contentClassName,
}: PillPopoverProps) {
    const ref = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onOpenChange(false);
            }
        };
        document.addEventListener("mousedown", handler);
        document.addEventListener("touchstart", handler);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("touchstart", handler);
        };
    }, [open, onOpenChange]);

    useLayoutEffect(() => {
        if (!open) return;

        const keepInsideViewport = () => {
            const popup = popupRef.current;
            if (!popup) return;

            const margin = 8;
            const rect = popup.getBoundingClientRect();
            let deltaX = 0;
            let deltaY = 0;

            if (rect.left < margin) deltaX = margin - rect.left;
            else if (rect.right > window.innerWidth - margin) deltaX = window.innerWidth - margin - rect.right;

            if (rect.top < margin) deltaY = margin - rect.top;
            else if (rect.bottom > window.innerHeight - margin) deltaY = window.innerHeight - margin - rect.bottom;

            if (deltaX !== 0 || deltaY !== 0) {
                setViewportOffset((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
            }
        };

        const timer = window.setTimeout(keepInsideViewport, 170);
        window.addEventListener("resize", keepInsideViewport);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("resize", keepInsideViewport);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => {
                    const nextOpen = !open;
                    if (nextOpen) setViewportOffset({ x: 0, y: 0 });
                    onOpenChange(nextOpen);
                }}
                className={`flex items-center gap-1.5 h-9 rounded-[14px] border px-3 text-xs font-extrabold transition-all whitespace-nowrap cursor-pointer ${open
                    ? "border-white/[.14] text-foreground"
                    : "border-white/[.08] text-foreground hover:border-white/[.14]"
                    }`}
                style={{ background: open ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.04)" }}
            >
                {trigger}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        ref={popupRef}
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        transition={{ duration: 0.15 }}
                        className={cn(
                            "absolute bottom-full left-0 z-50 max-w-[calc(100vw-1rem)] rounded-[22px] border border-white/[.08] p-3",
                            width,
                            contentClassName,
                        )}
                        style={{
                            background: "rgba(12,12,12,.94)",
                            backdropFilter: "blur(26px)",
                            boxShadow: "0 28px 80px rgba(0,0,0,.42)",
                            marginLeft: viewportOffset.x,
                            marginBottom: 8 - viewportOffset.y,
                        }}
                    >
                        {children}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

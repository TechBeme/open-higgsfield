"use client";

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface PillPopoverProps {
    trigger: React.ReactNode;
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    width?: string;
    contentClassName?: string;
    triggerLabel: string;
}

export function PillPopover({ trigger, children, open, onOpenChange, width = "w-64", contentClassName, triggerLabel }: PillPopoverProps) {
    return <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger type="button" aria-label={triggerLabel} className={cn("flex min-h-10 max-w-full items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs font-semibold transition-colors", open ? "border-primary/40 bg-primary/5" : "border-white/15 bg-white/[.04] hover:bg-white/[.08]")}>
            {trigger}
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={10} onKeyDown={event => {
            if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
        }} className={cn("max-h-[min(70dvh,var(--available-height))] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#151719] p-4 shadow-2xl", width, contentClassName)}>
            <PopoverTitle className="sr-only">{triggerLabel}</PopoverTitle>
            {children}
        </PopoverContent>
    </Popover>;
}

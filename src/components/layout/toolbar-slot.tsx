"use client";

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

/** The workspace header exposes one slot so pages can place their tools beside the navigation instead of in a second row. */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null);

export function HeaderToolbar({ children }: { children: React.ReactNode }) {
    const slot = useContext(ToolbarSlotContext);
    return slot ? createPortal(children, slot) : null;
}

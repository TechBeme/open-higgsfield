"use client";

import { useEffect, useState } from "react";
import type { AnyTask } from "@/types";
import { isTaskActive } from "@/features/tasks/hooks/useTaskHistory";

export function useTaskRefresh(task: AnyTask): number {
    const active = isTaskActive(task);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        // The shared history hook polls active tasks; cards only update their clocks.
        const timer = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, [active]);
    const created = Date.parse(task.created_at);
    return Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 1_000)) : 0;
}

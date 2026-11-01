"use client";

import { useEffect, useState } from "react";
import type { AnyTask } from "@/types";
import { imageHistoryKey, isTaskActive, revalidateHistory, videoHistoryKey } from "@/hooks/useTaskHistory";

export function useTaskRefresh(task: AnyTask): number {
    const active = isTaskActive(task);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const refresh = () => { void revalidateHistory(task.media_type === "image" ? imageHistoryKey : videoHistoryKey); };
        const events = new EventSource(`/api/events/${encodeURIComponent(task.task_id)}`);
        events.onopen = refresh;
        events.onmessage = refresh;
        events.onerror = refresh;
        const timer = setInterval(() => setNow(Date.now()), 1_000);
        return () => { events.close(); clearInterval(timer); };
    }, [task.task_id, task.media_type, active]);
    const created = Date.parse(task.created_at);
    return Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 1_000)) : 0;
}

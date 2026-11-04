"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE = "open-higgsfield:stored-number";
// Keeps the choice for this page view when the browser refuses storage (private windows, blocked site data).
const memory = new Map<string, number>();

function read(key: string, fallback: number, min: number, max: number): number {
    let stored: number | undefined;
    try {
        const raw = window.localStorage.getItem(key);
        if (raw !== null && Number.isFinite(Number(raw))) stored = Number(raw);
    } catch { /* storage unavailable */ }
    const value = stored ?? memory.get(key) ?? fallback;
    return Math.min(max, Math.max(min, value));
}

function subscribe(onChange: () => void) {
    window.addEventListener("storage", onChange);
    window.addEventListener(CHANGE, onChange);
    return () => { window.removeEventListener("storage", onChange); window.removeEventListener(CHANGE, onChange); };
}

/**
 * A per-browser number preference such as the preview size. The server and the first client render use
 * the fallback, so hydration matches, and the saved value applies right after.
 */
export function useStoredNumber(key: string, fallback: number, min: number, max: number): [number, (value: number) => void] {
    const value = useSyncExternalStore(subscribe, () => read(key, fallback, min, max), () => fallback);
    const set = useCallback((next: number) => {
        const clamped = Math.min(max, Math.max(min, next));
        memory.set(key, clamped);
        try { window.localStorage.setItem(key, String(clamped)); } catch { /* the in-memory value still applies */ }
        window.dispatchEvent(new Event(CHANGE));
    }, [key, min, max]);
    return [value, set];
}

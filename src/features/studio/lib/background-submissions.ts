"use client";

import { useSyncExternalStore } from "react";
import { parseSubmissionResponse, unknownSubmission, type SubmissionOutcome } from "./client-submission";

export interface BackgroundSubmission {
    id: string;
    mode: "image" | "video";
    model: string;
    prompt: string;
    createdAt: string;
    outcome?: SubmissionOutcome;
}

const empty: BackgroundSubmission[] = [];
let snapshot = empty;
const listeners = new Set<() => void>();
function emit(next: BackgroundSubmission[]) { snapshot = next; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useBackgroundSubmissions() { return useSyncExternalStore(subscribe, () => snapshot, () => empty); }
export function dismissSubmission(id: string) { emit(snapshot.filter(item => item.id !== id)); }

/** Each invocation owns its request and immutable multipart snapshot. Never retry a billable POST. */
export function submitInBackground(input: Omit<BackgroundSubmission, "id" | "createdAt" | "outcome">, body: FormData, refresh: () => unknown): string {
    const id = crypto.randomUUID();
    body.set("client_submission_id", id);
    emit([{ ...input, id, createdAt: new Date().toISOString() }, ...snapshot]);
    void (async () => {
        let outcome: SubmissionOutcome;
        try {
            const response = await fetch(input.mode === "video" ? "/api/generate" : "/api/generate-image", { method: "POST", body });
            outcome = await parseSubmissionResponse(response);
        } catch { outcome = unknownSubmission(); }
        emit(snapshot.map(item => item.id === id ? { ...item, outcome } : item));
        refresh();
    })();
    return id;
}

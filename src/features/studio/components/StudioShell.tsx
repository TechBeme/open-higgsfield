"use client";

import { useState } from "react";
import { CommandBar, type IncomingImage } from "./command-bar/CommandBar";
import { StudioEmpty } from "./StudioEmpty";
import { ResultsGrid } from "@/features/tasks/components/ResultsGrid";

export function StudioShell() {
    const [mode, setMode] = useState<"video" | "image">("image");
    const [supportsPrompt, setSupportsPrompt] = useState(true);
    const [suggestion, setSuggestion] = useState<{ text: string; revision: number }>();
    const [incoming, setIncoming] = useState<IncomingImage>();
    const suggest = (text: string) => setSuggestion(current => ({ text, revision: (current?.revision ?? 0) + 1 }));
    return <div className="relative flex h-full min-h-0 flex-col overflow-y-auto bg-background">
        <div className="min-h-52 min-w-0 flex-1 sm:min-h-0">
            <ResultsGrid mode={mode} onReusePrompt={suggest} onSendImage={(url, target) => {
                const next = target === "reference" ? mode : "video";
                setMode(next);
                setIncoming(current => ({ url, target, mode: next, revision: (current?.revision ?? 0) + 1 }));
            }} empty={<StudioEmpty mode={mode} supportsPrompt={supportsPrompt} onIdea={suggest} />} />
        </div>
        <CommandBar mode={mode} onModeChange={setMode} suggestion={suggestion} incoming={incoming} onPromptSupportChange={setSupportsPrompt} />
    </div>;
}

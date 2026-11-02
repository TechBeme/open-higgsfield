"use client";

import { useState } from "react";
import { CommandBar } from "./command-bar/CommandBar";
import { StudioEmpty } from "./StudioEmpty";
import { ResultsGrid } from "@/features/tasks/components/ResultsGrid";

export function StudioShell() {
    const [mode, setMode] = useState<"video" | "image">("image");
    const [supportsPrompt, setSupportsPrompt] = useState(true);
    const [suggestion, setSuggestion] = useState<{ text: string; revision: number }>();
    return <div className="relative flex h-full min-h-0 flex-col overflow-y-auto bg-background">
        <div className="min-h-52 min-w-0 flex-1 sm:min-h-0">
            <ResultsGrid mode={mode} empty={<StudioEmpty mode={mode} supportsPrompt={supportsPrompt} onIdea={text => setSuggestion(current => ({ text, revision: (current?.revision ?? 0) + 1 }))} />} />
        </div>
        <CommandBar mode={mode} onModeChange={setMode} suggestion={suggestion} onPromptSupportChange={setSupportsPrompt} />
    </div>;
}

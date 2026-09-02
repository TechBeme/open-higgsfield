"use client";

import { useState } from "react";
import { CommandBar } from "@/components/command-bar/CommandBar";
import { ResultsGrid } from "@/components/tasks/ResultsGrid";

export function StudioShell() {
  const [mode, setMode] = useState<"video" | "image">("image");

  return (
    <div className="relative h-screen overflow-hidden" style={{ background: "#060606" }}>
      {/* Workspace — full screen, scrolls naturally */}
      <ResultsGrid mode={mode} />

      {/* Bottom composer */}
      <CommandBar mode={mode} onModeChange={setMode} />
    </div>
  );
}

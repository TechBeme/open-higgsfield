"use client";

import { Sparkles, Clapperboard, Image as ImageIcon } from "lucide-react";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/ui-custom/ThemeToggle";
import { LanguageSwitcher } from "@/components/ui-custom/LanguageSwitcher";
import { useTranslations } from "next-intl";

interface HeaderProps {
  mode: "video" | "image";
  onModeChange: (mode: "video" | "image") => void;
}

export function Header({ mode, onModeChange }: HeaderProps) {
  const t = useTranslations("nav");

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/80 backdrop-blur-md px-4 sm:px-6">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-bold text-sm hidden sm:inline tracking-tight">
          Open<span className="text-primary">Higgsfield</span>
        </span>
      </div>

      {/* Mode toggle */}
      <nav className="flex items-center gap-1 rounded-full border bg-muted p-1">
        {(["video", "image"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className="relative flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none"
          >
            {mode === m && (
              <motion.div
                layoutId="mode-indicator"
                className="absolute inset-0 rounded-full bg-background shadow-sm"
                transition={{ type: "spring", bounce: 0.25, duration: 0.3 }}
              />
            )}
            <span className={`relative z-10 flex items-center gap-1.5 ${mode === m ? "text-foreground" : "text-muted-foreground"}`}>
              {m === "video" ? <Clapperboard className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
              {m === "video" ? t("video") : t("image")}
            </span>
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        {/* API badge */}
        <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Multi-provider
        </span>
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}

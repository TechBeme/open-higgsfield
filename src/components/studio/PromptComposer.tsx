"use client";

import { useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";

interface PromptComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  error?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  error,
  placeholder,
  maxLength = 2000,
  disabled = false,
}: PromptComposerProps) {
  const t = useTranslations("studio.video.prompt");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    },
    [onSubmit]
  );

  const charCount = value.length;
  const isNearLimit = charCount > maxLength * 0.85;
  const isOverLimit = charCount > maxLength;

  return (
    <div className="space-y-1">
      <div
        className={`relative rounded-xl border transition-all duration-200 ${error
            ? "border-destructive ring-2 ring-destructive/20"
            : "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
          }`}
      >
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t("placeholder")}
          disabled={disabled}
          maxLength={maxLength + 100}
          className="min-h-[90px] resize-none border-0 bg-transparent px-4 py-3 pr-16 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 leading-relaxed"
          rows={3}
        />
        {/* Character counter */}
        <div className="absolute bottom-2 right-3 pointer-events-none">
          <motion.span
            key={isNearLimit ? "warn" : "ok"}
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className={`text-[10px] font-mono tabular-nums ${isOverLimit
                ? "text-destructive font-bold"
                : isNearLimit
                  ? "text-amber-500"
                  : "text-muted-foreground"
              }`}
          >
            {charCount}/{maxLength}
          </motion.span>
        </div>
      </div>
      {error ? (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-destructive px-1"
        >
          {error}
        </motion.p>
      ) : (
        <p className="text-[10px] text-muted-foreground px-1">{t("hint")}</p>
      )}
    </div>
  );
}

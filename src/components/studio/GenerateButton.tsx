"use client";

import { motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface GenerateButtonProps {
  isSubmitting: boolean;
  disabled?: boolean;
  mode: "video" | "image";
}

export function GenerateButton({ isSubmitting, disabled, mode }: GenerateButtonProps) {
  const t = useTranslations("studio");

  const label = mode === "video"
    ? t("video.generateButton")
    : t("image.generateButton");

  return (
    <Button
      type="submit"
      disabled={disabled || isSubmitting}
      className="w-full h-11 btn-gradient text-white font-semibold gap-2 relative overflow-hidden"
    >
      {isSubmitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {mode === "video" ? t("video.generating") : t("image.generating")}
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" />
          {label}
          <motion.span
            className="absolute inset-0 bg-white/10"
            initial={{ x: "-100%", opacity: 0 }}
            whileHover={{ x: "100%", opacity: 0.5 }}
            transition={{ duration: 0.5 }}
          />
        </>
      )}
    </Button>
  );
}

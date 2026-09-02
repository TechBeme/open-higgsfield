"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Trash2, RotateCcw, AlertCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { IMAGE_CAPABILITIES } from "@/models/capabilities/image";
import type { ImageTask } from "@/types";

interface ImageTaskCardProps {
  task: ImageTask;
  onDelete: (id: string) => void;
  onReuse: (task: ImageTask) => void;
  onLightbox: (urls: string[], index: number, modelId?: string, prompt?: string) => void;
}

const STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  IN_PROGRESS: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  FAILED: "bg-destructive/10 text-destructive border-destructive/20",
  ERROR: "bg-destructive/10 text-destructive border-destructive/20",
};

export function ImageTaskCard({ task, onDelete, onReuse, onLightbox }: ImageTaskCardProps) {
  const t = useTranslations("tasks");
  const [showFull, setShowFull] = useState(false);
  const modelLabel = IMAGE_CAPABILITIES[task.model_id]?.label ?? task.model_id;

  const status = task.status ?? task.freepik_status ?? "COMPLETED";
  const images = task.result_urls ?? [];
  const isProcessing = ["CREATED", "IN_PROGRESS"].includes(status);
  const isFailed = ["FAILED", "ERROR", "CANCELLED"].includes(status);

  const promptPreview = task.prompt ?? "";
  const truncated = !showFull && promptPreview.length > 80;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-xl border bg-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
        <Badge
          variant="outline"
          className={`text-[10px] font-semibold border ${STATUS_STYLES[status] ?? STATUS_STYLES.CREATED}`}
        >
          {isProcessing && (
            <motion.span
              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
          {t(`status.${status}` as Parameters<typeof t>[0])}
        </Badge>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onDelete(task.task_id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Prompt */}
      {promptPreview && (
        <div className="px-4 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {truncated ? promptPreview.slice(0, 80) + "…" : promptPreview}
          </p>
          {promptPreview.length > 80 && (
            <button
              onClick={() => setShowFull(!showFull)}
              className="text-[10px] text-primary hover:underline mt-0.5"
            >
              {showFull ? t("seeLess") : t("seeMore")}
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {isProcessing && (
        <div className="px-4 pb-4">
          <div className="relative h-32 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
              animate={{ x: ["-100%", "100%"] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            />
            <div className="flex flex-col items-center gap-2 relative z-10">
              <motion.div
                className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
              <span className="text-xs text-muted-foreground">{t("status.IN_PROGRESS")}</span>
            </div>
          </div>
        </div>
      )}

      {/* Image grid */}
      {images.length > 0 && (
        <div className="px-4 pb-3">
          <div className={`grid gap-1.5 ${images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
            {images.map((url, idx) => (
              <div
                key={idx}
                className="relative group cursor-pointer rounded-lg overflow-hidden aspect-square bg-muted"
                onClick={() => onLightbox(images, idx, modelLabel, task.prompt)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Generated image ${idx + 1}`}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />
                <span
                  className="absolute bottom-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 max-w-[calc(100%-8px)] truncate"
                  style={{ background: "rgba(0,0,0,.6)", color: "rgba(244,247,251,.8)" }}
                >
                  {modelLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {isFailed && (
        <div className="px-4 pb-3 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">
            {task.error_message ?? "Generation failed"}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-4 pb-3">
        {images.length > 0 && images.map((url, idx) =>
          images.length === 1 ? (
            <a key={idx} href={`/api/download/${task.task_id}?index=0`} download target="_blank" rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" }) + " h-7 text-xs gap-1.5"}>
              <Download className="h-3 w-3" />
              {t("downloadImage")}
            </a>
          ) : null
        )}
        {images.length > 1 && (
          <a href={`/api/download/${task.task_id}`} download
            className={buttonVariants({ variant: "outline", size: "sm" }) + " h-7 text-xs gap-1.5"}>
            <Download className="h-3 w-3" />
            {t("downloadAll")}
          </a>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5 ml-auto"
          onClick={() => onReuse(task)}
        >
          <RotateCcw className="h-3 w-3" />
          {t("reuse")}
        </Button>
      </div>
    </motion.div>
  );
}

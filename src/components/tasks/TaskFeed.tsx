"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Film, Image as ImageIcon, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { VideoTaskCard } from "@/components/tasks/VideoTaskCard";
import { ImageTaskCard } from "@/components/tasks/ImageTaskCard";
import { Lightbox } from "@/components/tasks/Lightbox";
import { useVideoTasks, revalidateVideoTasks } from "@/hooks/useVideoTasks";
import { useImageTasks, revalidateImageTasks } from "@/hooks/useImageTasks";
import type { VideoTask, ImageTask } from "@/types";

interface TaskFeedProps {
  mode: "video" | "image";
  onReuse: (task: VideoTask | ImageTask) => void;
}

export function TaskFeed({ mode, onReuse }: TaskFeedProps) {
  const t = useTranslations("tasks");
  const videoHistory = useVideoTasks();
  const imageHistory = useImageTasks();
  const { tasks: videoTasks } = videoHistory;
  const { tasks: imageTasks } = imageHistory;
  const history = mode === "video" ? videoHistory : imageHistory;

  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; modelId?: string; prompt?: string } | null>(null);

  const handleDeleteVideo = useCallback(async (id: string) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    revalidateVideoTasks();
  }, []);

  const handleDeleteImage = useCallback(async (id: string) => {
    await fetch(`/api/image-tasks/${id}`, { method: "DELETE" });
    revalidateImageTasks();
  }, []);

  const openLightbox = useCallback((images: string[], index: number, modelId?: string, prompt?: string) => {
    setLightbox({ images, index, modelId, prompt });
  }, []);

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const nextImage = useCallback(() =>
    setLightbox((lb) => lb ? { ...lb, index: (lb.index + 1) % lb.images.length } : null), []);
  const prevImage = useCallback(() =>
    setLightbox((lb) => lb ? { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length } : null), []);

  const tasks = mode === "video" ? videoTasks : imageTasks;
  const isEmpty = tasks.length === 0 && !history.isLoading && !history.error;

  return (
    <div className="flex flex-col h-full">
      {/* Feed header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        {mode === "video" ? (
          <Film className="h-4 w-4 text-primary" />
        ) : (
          <ImageIcon className="h-4 w-4 text-primary" />
        )}
        <span className="text-sm font-semibold">{t("feedTitle")}</span>
        {tasks.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {tasks.length} {t("taskCount")}
          </span>
        )}
      </div>

      {/* Tasks list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {history.isLoading && <p role="status">{t("loadingHistory")}</p>}
        {history.error && <div role="alert" className="text-sm text-destructive">
          <p>{t("historyError")}</p>
          <button type="button" className="underline" onClick={() => void history.mutate().catch(() => undefined)}>{t("retryHistory")}</button>
        </div>}
        <AnimatePresence mode="popLayout">
          {isEmpty && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-center"
            >
              <Inbox className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </motion.div>
          )}

          {mode === "video" &&
            (videoTasks as VideoTask[]).map((task) => (
              <VideoTaskCard
                key={task.task_id}
                task={task}
                onDelete={handleDeleteVideo}
                onReuse={onReuse}
              />
            ))}

          {mode === "image" &&
            (imageTasks as ImageTask[]).map((task) => (
              <ImageTaskCard
                key={task.task_id}
                task={task}
                onDelete={handleDeleteImage}
                onReuse={onReuse}
                onLightbox={openLightbox}
              />
            ))}
        </AnimatePresence>
        {history.hasMore && <button type="button" disabled={history.isLoadingMore || Boolean(history.error)}
          onClick={() => void history.loadMore()} className="w-full rounded-lg border p-2 text-sm disabled:opacity-50">
          {history.isLoadingMore ? t("loadingHistory") : t("loadMore")}
        </button>}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          modelId={lightbox.modelId}
          prompt={lightbox.prompt}
          onClose={closeLightbox}
          onNext={nextImage}
          onPrev={prevImage}
        />
      )}
    </div>
  );
}

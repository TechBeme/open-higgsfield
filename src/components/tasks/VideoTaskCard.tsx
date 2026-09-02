"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, Trash2, RotateCcw, Volume2, VolumeX, Clock, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { VIDEO_CAPABILITIES } from "@/models/capabilities/video";
import type { VideoTask, TaskEvent } from "@/types";

interface VideoTaskCardProps {
  task: VideoTask;
  onDelete: (id: string) => void;
  onReuse: (task: VideoTask) => void;
}

const STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  IN_PROGRESS: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  FAILED: "bg-destructive/10 text-destructive border-destructive/20",
  ERROR: "bg-destructive/10 text-destructive border-destructive/20",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export function VideoTaskCard({ task, onDelete, onReuse }: VideoTaskCardProps) {
  const t = useTranslations("tasks");
  const [status, setStatus] = useState(task.status ?? task.freepik_status ?? "CREATED");
  const [videoUrls, setVideoUrls] = useState<string[]>(task.video_urls ?? []);
  const [hasDownload, setHasDownload] = useState(!!task.video_path);
  const [errorMsg, setErrorMsg] = useState(task.error_message ?? "");
  const [elapsed, setElapsed] = useState(0);
  const [showFull, setShowFull] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isDone = useRef(["COMPLETED", "FAILED", "ERROR", "CANCELLED"].includes(task.status ?? task.freepik_status ?? ""));

  useEffect(() => {
    if (isDone.current) return;

    const es = new EventSource(`/api/events/${task.task_id}`);
    const timer: NodeJS.Timeout = setInterval(() => {
      if (!isDone.current) setElapsed((prev) => prev + 1);
    }, 1000);

    es.onmessage = (e) => {
      const event: TaskEvent = JSON.parse(e.data);
      if (event.type === "status") {
        setStatus(event.status ?? "IN_PROGRESS");
        if (event.elapsed !== undefined) setElapsed(event.elapsed);
      } else if (event.type === "completed") {
        setStatus("COMPLETED");
        if (event.video_urls) setVideoUrls(event.video_urls);
        if (event.has_download) setHasDownload(true);
        isDone.current = true;
        es.close();
        if (timer) clearInterval(timer);
      } else if (event.type === "failed" || event.type === "error" || event.type === "timeout") {
        setStatus(event.type === "timeout" ? "FAILED" : (event.status ?? "FAILED").toUpperCase());
        setErrorMsg(event.message ?? "Generation failed");
        isDone.current = true;
        es.close();
        if (timer) clearInterval(timer);
      }
    };

    es.onerror = () => {
      console.error("[SSE] connection error for task:", task.task_id);
    };

    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [task.task_id]);

  const isProcessing = ["CREATED", "IN_PROGRESS"].includes(status);
  const isCompleted = status === "COMPLETED";
  const isFailed = ["FAILED", "ERROR", "CANCELLED"].includes(status);

  const promptPreview = task.prompt ?? "";
  const truncated = !showFull && promptPreview.length > 100;

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
        <span className="text-xs text-muted-foreground truncate flex-1">{VIDEO_CAPABILITIES[task.model_id]?.label ?? task.model_id}</span>
        {isProcessing && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {t("elapsed", { seconds: elapsed })}
          </span>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onDelete(task.task_id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Prompt */}
      {promptPreview && (
        <div className="px-4 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {truncated ? promptPreview.slice(0, 100) + "…" : promptPreview}
          </p>
          {promptPreview.length > 100 && (
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

      {/* Video player */}
      {isCompleted && (hasDownload || videoUrls.length > 0) && (
        <div className="px-4 pb-3">
          <div className="relative rounded-lg overflow-hidden bg-black">
            <video
              ref={videoRef}
              src={hasDownload ? `/api/download/${task.task_id}?inline=1` : videoUrls[0]}
              className="w-full max-h-[240px] object-contain"
              muted={muted}
              controls={false}
              loop
              autoPlay
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <div className="absolute bottom-2 right-2 flex gap-1">
              <button
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  if (v.paused) { v.play(); } else { v.pause(); }
                }}
                className="rounded-full bg-black/60 p-1.5 backdrop-blur-sm"
              >
                {playing ? <Pause className="h-3 w-3 text-white" /> : <Play className="h-3 w-3 text-white" />}
              </button>
              <button
                onClick={() => setMuted(!muted)}
                className="rounded-full bg-black/60 p-1.5 backdrop-blur-sm"
              >
                {muted ? <VolumeX className="h-3 w-3 text-white" /> : <Volume2 className="h-3 w-3 text-white" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {isFailed && errorMsg && (
        <div className="px-4 pb-3">
          <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{errorMsg}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-4 pb-3">
        {isCompleted && hasDownload && (
          <a
            href={`/api/download/${task.task_id}`}
            download
            className={buttonVariants({ variant: "outline", size: "sm" }) + " h-7 text-xs gap-1.5"}
          >
            <Download className="h-3 w-3" />
            {t("downloadVideo")}
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

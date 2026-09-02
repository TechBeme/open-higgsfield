"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Inbox, Download, Trash2, Clock, AlertCircle, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { IMAGE_CAPABILITIES } from "@/models/capabilities/image";
import { VIDEO_CAPABILITIES } from "@/models/capabilities/video";
import { Lightbox } from "@/components/tasks/Lightbox";
import { useVideoTasks, revalidateVideoTasks } from "@/hooks/useVideoTasks";
import { useImageTasks, revalidateImageTasks } from "@/hooks/useImageTasks";
import type { VideoTask, ImageTask, TaskEvent } from "@/types";

interface ResultsGridProps {
    mode: "video" | "image";
}

function formatFailureMessage(rawMessage: string | undefined, status: string | undefined): string {
    const raw = (rawMessage ?? "").trim();
    const normalized = raw.toLowerCase();
    const generic = new Set([
        "failed",
        "error",
        "cancelled",
        "canceled",
        "task failed with status failed",
        "task failed with status error",
        "task failed with status cancelled",
    ]);

    if (!raw || generic.has(normalized)) {
        const currentStatus = (status ?? "FAILED").toUpperCase();
        return `Task failed (${currentStatus}) with no details returned by API.`;
    }
    return raw;
}

export function ResultsGrid({ mode }: ResultsGridProps) {
    const t = useTranslations("tasks");
    const { tasks: videoTasks } = useVideoTasks();
    const { tasks: imageTasks } = useImageTasks();
    const [lightbox, setLightbox] = useState<{ images: string[]; index: number; modelId?: string; prompt?: string; mediaType?: "image" | "video" } | null>(null);

    const handleDeleteVideo = useCallback(async (id: string) => {
        await fetch(`/api/tasks/${id}`, { method: "DELETE" });
        revalidateVideoTasks();
    }, []);

    const handleDeleteImage = useCallback(async (id: string) => {
        await fetch(`/api/image-tasks/${id}`, { method: "DELETE" });
        revalidateImageTasks();
    }, []);

    const openLightbox = useCallback((images: string[], index: number, modelId?: string, prompt?: string, mediaType?: "image" | "video") => {
        setLightbox({ images, index, modelId, prompt, mediaType });
    }, []);

    // Build flat list of all completed video URLs for cross-video navigation
    const allVideoItems = useMemo(() => {
        return (videoTasks as VideoTask[])
            .filter((t) => {
                const s = t.status ?? t.freepik_status ?? "CREATED";
                return s === "COMPLETED" && (t.video_path || (t.video_urls && t.video_urls.length > 0));
            })
            .map((t) => ({
                url: t.video_path ? `/api/download/${t.task_id}?inline=1` : t.video_urls![0],
                modelLabel: VIDEO_CAPABILITIES[t.model_id]?.label ?? t.model_id,
                prompt: t.prompt,
            }));
    }, [videoTasks]);

    const openVideoLightbox = useCallback((videoUrl: string) => {
        const urls = allVideoItems.map((v) => v.url);
        const idx = urls.indexOf(videoUrl);
        const item = allVideoItems[idx >= 0 ? idx : 0];
        setLightbox({
            images: urls,
            index: idx >= 0 ? idx : 0,
            modelId: item?.modelLabel,
            prompt: item?.prompt,
            mediaType: "video",
        });
    }, [allVideoItems]);

    const tasks = mode === "video" ? videoTasks : imageTasks;
    const isEmpty = tasks.length === 0;

    return (
        <div className="h-full overflow-y-auto" style={{ paddingBottom: 296 }}>
            {isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: "rgba(255,255,255,.04)" }}>
                        <Inbox className="h-8 w-8" style={{ color: "rgba(244,247,251,.24)" }} />
                    </div>
                    <div>
                        <p className="text-sm font-medium" style={{ color: "rgba(244,247,251,.44)" }}>{t("empty")}</p>
                        <p className="text-xs mt-1" style={{ color: "rgba(244,247,251,.28)" }}>
                            {mode === "video" ? "Generate a video to see results here" : "Generate an image to see results here"}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="p-5">
                    <div className="flex flex-wrap gap-[18px]">
                        <AnimatePresence mode="popLayout">
                            {mode === "video" &&
                                (videoTasks as VideoTask[]).map((task) => (
                                    <VideoResultCard
                                        key={task.task_id}
                                        task={task}
                                        onDelete={handleDeleteVideo}
                                        onLightbox={(urls) => {
                                            const url = urls[0];
                                            if (url) openVideoLightbox(url);
                                        }}
                                        t={t}
                                    />
                                ))}
                            {mode === "image" &&
                                (imageTasks as ImageTask[]).map((task) => (
                                    <ImageResultCard
                                        key={task.task_id}
                                        task={task}
                                        onDelete={handleDeleteImage}
                                        onLightbox={openLightbox}
                                        t={t}
                                    />
                                ))}
                        </AnimatePresence>
                    </div>
                </div>
            )}

            {lightbox && (
                <Lightbox
                    images={lightbox.images}
                    index={lightbox.index}
                    modelId={lightbox.modelId}
                    prompt={lightbox.prompt}
                    mediaType={lightbox.mediaType}
                    onClose={() => setLightbox(null)}
                    onNext={() => setLightbox((lb) => {
                        if (!lb) return null;
                        const nextIdx = (lb.index + 1) % lb.images.length;
                        if (lb.mediaType === "video" && allVideoItems[nextIdx]) {
                            return { ...lb, index: nextIdx, modelId: allVideoItems[nextIdx].modelLabel, prompt: allVideoItems[nextIdx].prompt };
                        }
                        return { ...lb, index: nextIdx };
                    })}
                    onPrev={() => setLightbox((lb) => {
                        if (!lb) return null;
                        const prevIdx = (lb.index - 1 + lb.images.length) % lb.images.length;
                        if (lb.mediaType === "video" && allVideoItems[prevIdx]) {
                            return { ...lb, index: prevIdx, modelId: allVideoItems[prevIdx].modelLabel, prompt: allVideoItems[prevIdx].prompt };
                        }
                        return { ...lb, index: prevIdx };
                    })}
                />
            )}
        </div>
    );
}

/* ── Video card ── */

function VideoResultCard({
    task,
    onDelete,
    onLightbox,
    t,
}: {
    task: VideoTask;
    onDelete: (id: string) => void;
    onLightbox: (urls: string[], index: number, modelId?: string, prompt?: string) => void;
    t: ReturnType<typeof useTranslations<"tasks">>;
}) {
    const [status, setStatus] = useState(task.status ?? task.freepik_status ?? "CREATED");
    const [videoUrls, setVideoUrls] = useState<string[]>(task.video_urls ?? []);
    const [hasDownload, setHasDownload] = useState(!!task.video_path);
    const [errorMsg, setErrorMsg] = useState(task.error_message ?? "");
    const [elapsed, setElapsed] = useState(0);
    const [muted, setMuted] = useState(true);
    const videoRef = useRef<HTMLVideoElement>(null);
    const isDone = useRef(["COMPLETED", "FAILED", "ERROR", "CANCELLED"].includes(task.status ?? task.freepik_status ?? ""));
    const modelLabel = VIDEO_CAPABILITIES[task.model_id]?.label ?? task.model_id;

    useEffect(() => {
        if (isDone.current) return;
        const es = new EventSource(`/api/events/${task.task_id}`);
        const timer: ReturnType<typeof setInterval> = setInterval(() => {
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
                setStatus(event.status ?? "FAILED");
                setErrorMsg(event.message ?? "Generation failed");
                isDone.current = true;
                es.close();
                if (timer) clearInterval(timer);
            }
        };

        es.onerror = () => { };

        return () => {
            es.close();
            clearInterval(timer);
        };
    }, [task.task_id]);

    const isProcessing = ["CREATED", "IN_PROGRESS"].includes(status);
    const isCompleted = status === "COMPLETED";
    const isFailed = ["FAILED", "ERROR", "CANCELLED"].includes(status);

    // Pending card
    if (isProcessing) {
        return (
            <motion.div
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative rounded-[18px] overflow-hidden shrink-0"
                style={{ width: 320, aspectRatio: "16/9", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}
            >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <motion.div
                        className="h-9 w-9 rounded-full"
                        style={{ border: "2.5px solid #d5ff47", borderTopColor: "transparent" }}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                    <div className="flex items-center gap-1 text-[11px]" style={{ color: "rgba(244,247,251,.44)" }}>
                        <Clock className="h-3 w-3" />
                        {t("elapsed", { seconds: elapsed })}
                    </div>
                </div>
                {/* Model chip */}
                <div className="absolute bottom-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-md" style={{ background: "rgba(0,0,0,.5)", color: "rgba(244,247,251,.72)" }}>
                    {modelLabel}
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="group relative rounded-[18px] overflow-hidden shrink-0 cursor-pointer"
            style={{ height: 240 }}
            onClick={() => {
                if (isCompleted) {
                    const url = hasDownload ? `/api/download/${task.task_id}?inline=1` : videoUrls[0];
                    if (url) onLightbox([url], 0, modelLabel, task.prompt);
                }
            }}
        >
            {isCompleted && (hasDownload || videoUrls.length > 0) && (
                <video
                    ref={videoRef}
                    src={hasDownload ? `/api/download/${task.task_id}?inline=1` : videoUrls[0]}
                    className="h-full w-auto max-w-none object-cover rounded-[18px]"
                    muted={muted}
                    loop
                    autoPlay
                    playsInline
                />
            )}

            {isFailed && (
                <div className="flex items-center justify-center rounded-[18px]" style={{ width: 320, height: 240, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}>
                    <div className="text-center px-4">
                        <AlertCircle className="h-6 w-6 mx-auto mb-1" style={{ color: "#ff6b6b" }} />
                        <p className="text-[11px] line-clamp-2" style={{ color: "#ff6b6b" }}>{errorMsg}</p>
                    </div>
                    <div className="absolute bottom-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-md" style={{ background: "rgba(0,0,0,.5)", color: "rgba(244,247,251,.72)" }}>
                        {modelLabel}
                    </div>
                </div>
            )}

            {/* Hover overlay — matching image style */}
            <div
                className="absolute inset-0 rounded-[18px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-between p-3 overflow-hidden"
                style={{ background: "linear-gradient(to bottom, rgba(0,0,0,.6) 0%, transparent 40%, transparent 60%, rgba(0,0,0,.7) 100%)" }}
            >
                <div className="flex items-start justify-end gap-1 min-w-0">
                    <div className="flex items-center gap-1.5 shrink-0">
                        {isCompleted && (
                            <button onClick={(e) => { e.stopPropagation(); setMuted(!muted); }} className="w-[34px] h-[34px] rounded-full grid place-items-center text-white" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(8px)" }}>
                                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                            </button>
                        )}
                        {isCompleted && hasDownload && (
                            <a href={`/api/download/${task.task_id}`} download onClick={(e) => e.stopPropagation()} className="w-[34px] h-[34px] rounded-full grid place-items-center text-white" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(8px)" }}>
                                <Download className="h-3.5 w-3.5" />
                            </a>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); onDelete(task.task_id); }} className="w-[34px] h-[34px] rounded-full grid place-items-center text-white hover:text-red-400" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(8px)" }}>
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                <p className="text-[11px] line-clamp-1 leading-relaxed font-bold" style={{ color: "rgba(244,247,251,.86)" }}>{modelLabel}</p>
            </div>
        </motion.div>
    );
}

/* ── Image card ── */

function ImageResultCard({
    task,
    onDelete,
    onLightbox,
    t,
}: {
    task: ImageTask;
    onDelete: (id: string) => void;
    onLightbox: (urls: string[], index: number, modelId?: string, prompt?: string) => void;
    t: ReturnType<typeof useTranslations<"tasks">>;
}) {
    const [status, setStatus] = useState(task.status ?? task.freepik_status ?? "CREATED");
    const [images, setImages] = useState<string[]>(task.result_urls ?? []);
    const [errorMsg, setErrorMsg] = useState(task.error_message ?? "");
    const isDone = useRef(["COMPLETED", "FAILED", "ERROR", "CANCELLED"].includes(task.status ?? task.freepik_status ?? ""));
    const modelLabel = IMAGE_CAPABILITIES[task.model_id]?.label ?? task.model_id;

    useEffect(() => {
        if (isDone.current) return;
        const es = new EventSource(`/api/events/${task.task_id}`);

        es.onmessage = (e) => {
            const event: TaskEvent = JSON.parse(e.data);
            if (event.type === "status") {
                setStatus(event.status ?? "IN_PROGRESS");
            } else if (event.type === "completed") {
                setStatus("COMPLETED");
                if (event.result_urls) setImages(event.result_urls);
                isDone.current = true;
                es.close();
            } else if (event.type === "failed" || event.type === "error" || event.type === "timeout") {
                setStatus(event.status ?? "FAILED");
                if (event.message) setErrorMsg(event.message);
                isDone.current = true;
                es.close();
            }
        };

        es.onerror = () => { };

        return () => { es.close(); };
    }, [task.task_id]);

    const isProcessing = ["CREATED", "IN_PROGRESS"].includes(status);
    const isFailed = ["FAILED", "ERROR", "CANCELLED"].includes(status);

    // Pending card
    if (isProcessing) {
        return (
            <motion.div
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative rounded-[18px] overflow-hidden shrink-0"
                style={{ width: 320, aspectRatio: "4/3", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}
            >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <motion.div
                        className="h-9 w-9 rounded-full"
                        style={{ border: "2.5px solid #d5ff47", borderTopColor: "transparent" }}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                    <span className="text-[11px]" style={{ color: "rgba(244,247,251,.44)" }}>{t("status.IN_PROGRESS")}</span>
                </div>
                <div className="absolute bottom-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-md" style={{ background: "rgba(0,0,0,.5)", color: "rgba(244,247,251,.72)" }}>
                    {modelLabel}
                </div>
            </motion.div>
        );
    }

    // Failed card
    if (isFailed) {
        return (
            <motion.div
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative rounded-[18px] overflow-hidden shrink-0"
                style={{ width: 320, aspectRatio: "4/3", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)" }}
            >
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center px-4">
                        <AlertCircle className="h-6 w-6 mx-auto mb-1" style={{ color: "#ff6b6b" }} />
                        <p className="text-[11px] line-clamp-3" style={{ color: "#ff6b6b" }}>{formatFailureMessage(errorMsg, status)}</p>
                    </div>
                </div>
                <div className="absolute top-2 right-2">
                    <button onClick={() => onDelete(task.task_id)} className="w-[34px] h-[34px] rounded-full grid place-items-center text-white hover:text-red-400" style={{ background: "rgba(0,0,0,.5)" }}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
                <div className="absolute bottom-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-md" style={{ background: "rgba(0,0,0,.5)", color: "rgba(244,247,251,.72)" }}>
                    {modelLabel}
                </div>
            </motion.div>
        );
    }

    // Completed — render each image as separate card
    return (
        <>
            {images.map((url, idx) => (
                <motion.div
                    key={`${task.task_id}-${idx}`}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group relative rounded-[18px] overflow-hidden shrink-0 cursor-pointer"
                    style={{ height: 240 }}
                    onClick={() => onLightbox(images, idx, modelLabel, task.prompt)}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={url}
                        alt={task.prompt ?? `Image ${idx + 1}`}
                        className="h-full w-auto max-w-none object-cover rounded-[18px]"
                        loading="lazy"
                    />

                    {/* Hover overlay — Flask style */}
                    <div
                        className="absolute inset-0 rounded-[18px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-between p-3 overflow-hidden"
                        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,.6) 0%, transparent 40%, transparent 60%, rgba(0,0,0,.7) 100%)" }}
                    >
                        <div className="flex items-start justify-end gap-1 min-w-0">
                            <div className="flex items-center gap-1.5 shrink-0">
                                <a href={`/api/download/${task.task_id}?index=${idx}`} download onClick={(e) => e.stopPropagation()} className="w-[34px] h-[34px] rounded-full grid place-items-center text-white" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(8px)" }}>
                                    <Download className="h-3.5 w-3.5" />
                                </a>
                                <button onClick={(e) => { e.stopPropagation(); onDelete(task.task_id); }} className="w-[34px] h-[34px] rounded-full grid place-items-center text-white hover:text-red-400" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(8px)" }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                        <p className="text-[11px] line-clamp-1 leading-relaxed font-bold" style={{ color: "rgba(244,247,251,.86)" }}>{modelLabel}</p>
                    </div>
                </motion.div>
            ))}
        </>
    );
}

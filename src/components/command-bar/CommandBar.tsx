"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { VIDEO_CAPABILITIES } from "@/models/capabilities/video";
import { IMAGE_CAPABILITIES } from "@/models/capabilities/image";
import { getEditVariant } from "@/models/capabilities/image-helpers";
import { getVideoOverrides, getDurations, getAspectRatios, hasAttachments as videoHasAttachments } from "@/models/capabilities/video-helpers";
import type { AttachmentRole } from "@/models/capabilities/video-helpers";
import type { MediaSlotCapability } from "@/models/capabilities/types";
import { revalidateVideoTasks } from "@/hooks/useVideoTasks";
import { revalidateImageTasks } from "@/hooks/useImageTasks";
import { defaultSettings } from "@/components/studio/SettingsPanel";
import type { SettingsValues } from "@/components/studio/SettingsPanel";
import type { AttachmentItem } from "@/components/studio/AttachmentZone";
import type { SizeUiResolution } from "@/types";
import { buildGroupedDropTargets, slotsToDropDescriptors, type GroupedDropTarget } from "@/lib/attachment-drop-targets";
import { remapSlotFilesOnModelSwitch, remapVideoAttachmentsOnModelSwitch } from "@/lib/attachment-remap";

import { VideoModelPill } from "@/components/command-bar/VideoModelPill";
import { ImageModelPill } from "@/components/command-bar/ImageModelPill";
import { DurationPill } from "@/components/command-bar/DurationPill";
import { AspectRatioPill } from "@/components/command-bar/AspectRatioPill";
import { ResolutionPill } from "@/components/command-bar/ResolutionPill";
import { TogglePill } from "@/components/command-bar/TogglePill";
import { ControlsPill } from "@/components/command-bar/ControlsPill";
import { VideoControlsPill } from "@/components/command-bar/VideoControlsPill";
import { AttachmentButton } from "@/components/command-bar/AttachmentButton";
import { ImageAttachmentButton } from "@/components/command-bar/ImageAttachmentButton";

const schema = z.object({ prompt: z.string().max(2000) });
type FormData = z.infer<typeof schema>;

interface CommandBarProps {
    mode: "video" | "image";
    onModeChange: (mode: "video" | "image") => void;
}

export function CommandBar({ mode, onModeChange }: CommandBarProps) {
    const t = useTranslations("studio");
    const tErrors = useTranslations("errors");
    const tCommon = useTranslations("common");
    const tCommand = useTranslations("commandBar");

    // ── Video state ──
    const firstVideoId = Object.keys(VIDEO_CAPABILITIES)[0];
    const [videoModelId, setVideoModelId] = useState(firstVideoId);
    const [videoVariantId, setVideoVariantId] = useState("");
    const [videoSettings, setVideoSettings] = useState<SettingsValues>(
        defaultSettings(VIDEO_CAPABILITIES[firstVideoId])
    );
    const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

    // ── Image state ──
    const firstImageId = Object.keys(IMAGE_CAPABILITIES)[0];
    const [imageModelId, setImageModelId] = useState(firstImageId);
    const [sizeAspect, setSizeAspect] = useState(() => {
        const m = IMAGE_CAPABILITIES[firstImageId];
        if (m?.size_ui) return m.size_ui.default_aspect ?? "";
        const arField = m?.custom_fields?.find((f) => f.id === "aspect_ratio" && f.type === "select");
        const defOpt = arField?.default ? String(arField.default) : (arField?.options?.[0] ?? "");
        const match = defOpt.match(/_(\.?\d+)_(\d+)$/);
        return match ? `${match[1]}:${match[2]}` : defOpt;
    });
    const [sizeResolution, setSizeResolution] = useState(() => {
        const m = IMAGE_CAPABILITIES[firstImageId];
        if (m?.size_ui) return m.size_ui.default_resolution ?? "";
        const resField = m?.custom_fields?.find((f) => f.id === "resolution" && f.type === "select");
        return resField?.default ? String(resField.default) : (resField?.options?.[0] ?? "");
    });
    const [imageFieldValues, setImageFieldValues] = useState<Record<string, unknown>>({});
    const [slotFiles, setSlotFiles] = useState<Record<string, File[]>>({});

    // ── Shared state ──
    const [apiError, setApiError] = useState<string | null>(null);
    const [isDragOverlayVisible, setIsDragOverlayVisible] = useState(false);
    const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null);

    const { control, setValue, handleSubmit } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { prompt: "" },
    });
    const prompt = useWatch({ control, name: "prompt" }) ?? "";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dragDepthRef = useRef(0);

    const autoResize = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, []);

    // ── Models ──
    const videoModel = VIDEO_CAPABILITIES[videoModelId] ?? VIDEO_CAPABILITIES[firstVideoId];
    const videoOverrides = getVideoOverrides(videoModelId);
    const imageModel = IMAGE_CAPABILITIES[imageModelId] ?? IMAGE_CAPABILITIES[firstImageId];
    const imageEditVariant = getEditVariant(imageModel);

    const imageUploadSlots = useMemo<MediaSlotCapability[]>(() => {
        const editSlots = (imageEditVariant?.slots ?? []).map((slot) => ({ ...slot, required: false }));
        return [...imageModel.media_slots, ...editSlots];
    }, [imageModel, imageEditVariant]);

    const videoRoleDescriptors = useMemo(() => {
        const overrideRoles = videoOverrides.attachment_roles;
        if (overrideRoles && overrideRoles.length > 0) {
            return overrideRoles.map((role: AttachmentRole) => ({
                id: role.id,
                label: role.label,
                kind: role.kind,
                required: role.required,
                multiple: false,
            }));
        }

        return videoModel.media_slots.map((slot) => ({
            id: slot.id,
            label: slot.label,
            kind: slot.kind,
            required: slot.required,
            multiple: slot.multiple,
        }));
    }, [videoModel, videoOverrides]);

    const dropTargets = useMemo(() => {
        if (mode === "image") {
            return buildGroupedDropTargets(slotsToDropDescriptors(imageUploadSlots));
        }
        return buildGroupedDropTargets(videoRoleDescriptors);
    }, [mode, imageUploadSlots, videoRoleDescriptors]);

    const hasDropTargets = dropTargets.length > 0;

    useEffect(() => {
        const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

        const handleDragEnter = (event: DragEvent) => {
            if (!hasFiles(event) || !hasDropTargets) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDragOverlayVisible(true);
        };

        const handleDragOver = (event: DragEvent) => {
            if (!hasFiles(event) || !hasDropTargets) return;
            event.preventDefault();
            if (!isDragOverlayVisible) setIsDragOverlayVisible(true);
        };

        const handleDragLeave = (event: DragEvent) => {
            if (!hasFiles(event) || !hasDropTargets) return;
            event.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) {
                setIsDragOverlayVisible(false);
                setActiveDropTargetId(null);
            }
        };

        const handleDrop = (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepthRef.current = 0;
            setIsDragOverlayVisible(false);
            setActiveDropTargetId(null);
        };

        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("drop", handleDrop);

        return () => {
            window.removeEventListener("dragenter", handleDragEnter);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("drop", handleDrop);
        };
    }, [hasDropTargets, isDragOverlayVisible]);

    function fileToAttachment(roleId: string, file: File, kind: "image" | "video" | "audio"): AttachmentItem {
        return {
            id: `${roleId}-${file.name}-${file.size}-${file.lastModified}`,
            roleId,
            type: "file",
            file,
            previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
            kind,
        };
    }

    function applyImageDrop(target: GroupedDropTarget, files: File[]) {
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length === 0) return;

        setSlotFiles((prev) => {
            const next = { ...prev };

            if (target.roleIds.length > 1) {
                // Find empty slots first, then fill occupied ones
                const emptySlotIds = target.roleIds.filter((id) => !next[id]?.length);
                const occupiedSlotIds = target.roleIds.filter((id) => next[id]?.length);
                const orderedSlotIds = [...emptySlotIds, ...occupiedSlotIds];

                imageFiles.forEach((file, index) => {
                    const slotId = orderedSlotIds[index];
                    if (!slotId) return;
                    next[slotId] = [file];
                });
                return next;
            }

            const slotId = target.roleIds[0];
            if (target.acceptMany) {
                next[slotId] = [...(next[slotId] ?? []), ...imageFiles];
            } else {
                next[slotId] = [imageFiles[0]];
            }

            return next;
        });
    }

    function applyVideoDrop(target: GroupedDropTarget, files: File[]) {
        const acceptedFiles = files.filter((file) => file.type.startsWith(`${target.kind}/`));
        if (acceptedFiles.length === 0) return;

        setAttachments((prev) => {
            const withoutTargetRoles = prev.filter((item) => !target.roleIds.includes(item.roleId));

            if (target.roleIds.length > 1) {
                const distributed = target.roleIds
                    .map((roleId, index) => {
                        const file = acceptedFiles[index];
                        if (!file) return null;
                        return fileToAttachment(roleId, file, target.kind);
                    })
                    .filter((item): item is AttachmentItem => Boolean(item));
                return [...withoutTargetRoles, ...distributed];
            }

            const roleId = target.roleIds[0];
            const dropped = target.acceptMany
                ? acceptedFiles.map((file) => fileToAttachment(roleId, file, target.kind))
                : [fileToAttachment(roleId, acceptedFiles[0], target.kind)];

            return [...withoutTargetRoles, ...dropped];
        });
    }

    function handleDropToTarget(target: GroupedDropTarget, event: React.DragEvent<HTMLElement>) {
        event.preventDefault();
        event.stopPropagation();
        setActiveDropTargetId(null);
        setIsDragOverlayVisible(false);
        dragDepthRef.current = 0;

        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length === 0) return;

        if (mode === "image") {
            applyImageDrop(target, files);
            return;
        }

        applyVideoDrop(target, files);
    }

    // ── Handlers ──
    const handleVideoModelChange = useCallback((id: string, varId: string) => {
        const previousModel = VIDEO_CAPABILITIES[videoModelId] ?? VIDEO_CAPABILITIES[firstVideoId];
        const previousOverrides = getVideoOverrides(previousModel.id);
        const previousRoles =
            previousOverrides.attachment_roles?.map((role) => ({
                id: role.id,
                label: role.label,
                kind: role.kind,
                multiple: false,
            }))
            ?? previousModel.media_slots.map((slot) => ({
                id: slot.id,
                label: slot.label,
                kind: slot.kind,
                multiple: slot.multiple,
            }));

        const nextModel = VIDEO_CAPABILITIES[id] ?? VIDEO_CAPABILITIES[firstVideoId];
        const nextOverrides = getVideoOverrides(nextModel.id);
        const nextRoles =
            nextOverrides.attachment_roles?.map((role) => ({
                id: role.id,
                label: role.label,
                kind: role.kind,
                multiple: false,
            }))
            ?? nextModel.media_slots.map((slot) => ({
                id: slot.id,
                label: slot.label,
                kind: slot.kind,
                multiple: slot.multiple,
            }));

        setAttachments((current) => remapVideoAttachmentsOnModelSwitch(current, previousRoles, nextRoles));
        setVideoModelId(id);
        setVideoVariantId(varId);
        setVideoSettings(defaultSettings(VIDEO_CAPABILITIES[id], varId));
    }, [videoModelId, firstVideoId]);

    const handleImageModelChange = useCallback((id: string) => {
        const previousModel = IMAGE_CAPABILITIES[imageModelId] ?? IMAGE_CAPABILITIES[firstImageId];
        const previousEditVariant = getEditVariant(previousModel);
        const previousSlots: MediaSlotCapability[] = [
            ...previousModel.media_slots,
            ...((previousEditVariant?.slots ?? []).map((slot) => ({ ...slot, required: false }))),
        ];

        const nextModel = IMAGE_CAPABILITIES[id] ?? IMAGE_CAPABILITIES[firstImageId];
        const nextEditVariant = getEditVariant(nextModel);
        const nextSlots: MediaSlotCapability[] = [
            ...nextModel.media_slots,
            ...((nextEditVariant?.slots ?? []).map((slot) => ({ ...slot, required: false }))),
        ];

        setSlotFiles((current) => remapSlotFilesOnModelSwitch(current, previousSlots, nextSlots));

        setImageModelId(id);
        // Preserve field values for fields that exist in both old and new model (same id + type)
        setImageFieldValues((prev) => {
            const prevModel = IMAGE_CAPABILITIES[imageModelId] ?? IMAGE_CAPABILITIES[firstImageId];
            const prevFields = prevModel.custom_fields ?? [];
            const nextFields = m?.custom_fields ?? [];
            const preserved: Record<string, unknown> = {};
            for (const nf of nextFields) {
                const pf = prevFields.find((f) => f.id === nf.id && f.type === nf.type);
                if (pf && prev[nf.id] !== undefined) {
                    // For select fields, only keep if value is a valid option in the new model
                    if (nf.type === "select" && nf.options) {
                        if (nf.options.includes(String(prev[nf.id]))) {
                            preserved[nf.id] = prev[nf.id];
                        }
                    } else {
                        preserved[nf.id] = prev[nf.id];
                    }
                }
            }
            return preserved;
        });
        const m = IMAGE_CAPABILITIES[id];
        if (m?.size_ui) {
            // Keep current aspect ratio if the new model supports it
            const supportedRatios = m.size_ui.aspect_ratios.map((ar) => `${ar.w}:${ar.h}`);
            if (!supportedRatios.includes(sizeAspect)) {
                setSizeAspect(m.size_ui.default_aspect ?? "");
            }
            // Keep current resolution if supported
            const supportedRes = m.size_ui.resolutions.map((r) => r.id);
            if (!supportedRes.includes(sizeResolution)) {
                setSizeResolution(m.size_ui.default_resolution ?? "");
            }
        } else {
            const arField = m?.custom_fields?.find((f) => f.id === "aspect_ratio" && f.type === "select");
            if (arField?.options) {
                // Convert current sizeAspect to check against custom field options
                const optionRatios = arField.options.map((opt) => {
                    const match = opt.match(/_(\.?\d+)_(\d+)$/);
                    return match ? `${match[1]}:${match[2]}` : opt;
                });
                if (!optionRatios.includes(sizeAspect)) {
                    const firstOpt = arField.options[0] ?? "";
                    const defOpt = arField.default ? String(arField.default) : firstOpt;
                    const mDef = defOpt.match(/_(\.?\d+)_(\d+)$/);
                    setSizeAspect(mDef ? `${mDef[1]}:${mDef[2]}` : defOpt);
                }
            } else {
                setSizeAspect("");
            }
            const resField = m?.custom_fields?.find((f) => f.id === "resolution" && f.type === "select");
            if (resField?.options) {
                if (!resField.options.includes(sizeResolution)) {
                    setSizeResolution(resField.default ? String(resField.default) : (resField.options[0] ?? ""));
                }
            } else {
                setSizeResolution("");
            }
        }
    }, [imageModelId, firstImageId, sizeAspect, sizeResolution]);

    // Count extra controls for image mode
    const imageControlCount = (imageModel.custom_fields ?? []).filter(
        (f) => !(f.type === "checkbox" && f.id.includes("prompt"))
            && !(f.id.toLowerCase().includes("width") || f.id.toLowerCase().includes("height"))
            && f.id !== "aspect_ratio"
            && f.id !== "resolution"
    ).length;

    // Custom dimension fields for AspectRatioPill
    const widthField = imageModel.custom_fields?.find(f => f.id.toLowerCase().includes("width"));
    const heightField = imageModel.custom_fields?.find(f => f.id.toLowerCase().includes("height"));
    const imageCustomFields = (widthField && heightField) ? {
        widthId: widthField.id,
        heightId: heightField.id,
        widthLabel: widthField.label,
        heightLabel: heightField.label,
        defaultWidth: Number(widthField.default) || 1024,
        defaultHeight: Number(heightField.default) || 768,
    } : null;

    // Unified aspect ratios
    const imageRatios: [string, string][] = imageModel.size_ui
        ? imageModel.size_ui.aspect_ratios.map((ar) => [`${ar.w}:${ar.h}`, `${ar.w}:${ar.h}`] as [string, string])
        : (() => {
            const arField = imageModel.custom_fields?.find((f) => f.id === "aspect_ratio" && f.type === "select");
            return arField?.options?.map((opt) => {
                const m = opt.match(/_(\.?\d+)_(\d+)$/);
                return [m ? `${m[1]}:${m[2]}` : opt, m ? `${m[1]}:${m[2]}` : opt.replace(/_/g, " ")] as [string, string];
            }) ?? [];
        })();

    // Unified resolutions
    const imageResolutions: SizeUiResolution[] = imageModel.size_ui
        ? imageModel.size_ui.resolutions
        : (() => {
            const resField = imageModel.custom_fields?.find((f) => f.id === "resolution" && f.type === "select");
            return resField?.options?.map((opt) => ({ id: opt, base: 0 })) ?? [];
        })();

    const onSubmit = async (data: FormData) => {
        setApiError(null);
        if (mode === "video") {
            const body = new FormData();
            body.append("model_id", videoModelId);
            body.append("variant_id", videoVariantId);
            body.append("prompt", data.prompt);
            body.append("settings", JSON.stringify(videoSettings));
            for (const att of attachments) {
                if (att.file) body.append(`file_${att.roleId}`, att.file);
                else if (att.url) body.append(`url_${att.roleId}`, att.url);
            }
            fetch("/api/generate", { method: "POST", body })
                .then(async (res) => {
                    if (!res.ok) {
                        const json = await res.json().catch(() => ({}));
                        setApiError(json.error ?? "ERR_GENERIC");
                    }
                    revalidateVideoTasks();
                })
                .catch(() => setApiError("ERR_GENERIC"));
        } else {
            const body = new FormData();
            body.append("model_id", imageModelId);
            body.append("prompt", data.prompt);
            body.append("size_aspect", sizeAspect);
            body.append("size_resolution", sizeResolution);
            body.append("field_values", JSON.stringify(imageFieldValues));
            for (const [slotId, files] of Object.entries(slotFiles)) {
                files.forEach((f) => body.append(`slot_${slotId}`, f));
            }
            fetch("/api/generate-image", { method: "POST", body })
                .then(async (res) => {
                    if (!res.ok) {
                        const json = await res.json().catch(() => ({}));
                        setApiError(json.error ?? "ERR_GENERIC");
                    }
                    revalidateImageTasks();
                })
                .catch(() => setApiError("ERR_GENERIC"));
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(onSubmit)();
        }
    };

    return (
        <div className="fixed left-0 right-0 bottom-0 z-20 pointer-events-none" style={{ padding: "16px 20px 20px" }}>
            {/* Error toast */}
            <AnimatePresence>
                {apiError && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="pointer-events-auto fixed right-6 z-42 min-w-[240px] max-w-[360px] rounded-[18px] border border-white/[.08] text-[13px] leading-[1.5] mb-2"
                        style={{ bottom: 170, padding: "14px 16px", background: "rgba(12,16,24,.96)", boxShadow: "0 28px 80px rgba(0,0,0,.42)" }}
                    >
                        <div className="flex items-center gap-2 text-[#ffc4c4]" style={{ borderColor: "rgba(255,128,128,.22)" }}>
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            <span className="flex-1">{tErrors.has(apiError as never) ? tErrors(apiError as never) : tErrors("ERR_GENERIC")}</span>
                            <button onClick={() => setApiError(null)} className="font-bold hover:opacity-70">×</button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Composer stage — matches Flask grid */}
            <form
                onSubmit={handleSubmit(onSubmit)}
                className="pointer-events-auto mx-auto grid gap-3 items-stretch"
                style={{ width: "min(70rem, 100%)", gridTemplateColumns: "64px minmax(0,1fr)" }}
            >
                {/* Mode rail */}
                <div
                    className="rounded-[20px] p-1.5 border border-white/[.08] flex flex-col gap-1.5"
                    style={{
                        background: "rgba(12,12,12,.88)",
                        boxShadow: "0 28px 80px rgba(0,0,0,.42)",
                        backdropFilter: "blur(18px)",
                    }}
                >
                    {(["image", "video"] as const).map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => onModeChange(m)}
                            className={`flex-1 min-h-0 p-1.5 flex flex-col items-center justify-center gap-[5px] rounded-[14px] text-[10px] font-extrabold tracking-[0.02em] cursor-pointer border transition-colors ${mode === m
                                ? "text-foreground border-white/[.1]"
                                : "text-muted-foreground border-transparent hover:text-foreground"
                                }`}
                            style={mode === m ? {
                                background: "linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.04)), rgba(255,255,255,.03)"
                            } : { background: "transparent" }}
                        >
                            {m === "image" ? (
                                <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px] shrink-0">
                                    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" stroke="currentColor" strokeWidth="1.6" />
                                    <path d="M7.5 15.5l2.8-3.1a1 1 0 0 1 1.48-.05l2.12 2.12a1 1 0 0 0 1.47-.05l2.13-2.52" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                    <circle cx="9" cy="9" r="1.2" fill="currentColor" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px] shrink-0">
                                    <rect x="4" y="5" width="11" height="14" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
                                    <path d="M15 10.1l4.5-2.5A1 1 0 0 1 21 8.48v7.04a1 1 0 0 1-1.5.87L15 13.9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                </svg>
                            )}
                            <span>{m === "image" ? tCommon("image") : tCommon("video")}</span>
                        </button>
                    ))}
                </div>

                {/* Composer card */}
                <div
                    className="rounded-[28px] border border-white/[.08] flex items-stretch gap-3"
                    style={{
                        backdropFilter: "blur(26px)",
                        background: "radial-gradient(circle at 92% 82%, rgba(213,255,71,.07), transparent 18%), linear-gradient(90deg, rgba(12,12,12,.96), rgba(20,20,20,.92) 52%, rgba(24,24,24,.88))",
                        boxShadow: "0 28px 80px rgba(0,0,0,.42)",
                        padding: "12px",
                    }}
                >
                    {/* Content: prompt + pills */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                        {/* Main prompt area */}
                        <div className="flex items-start gap-2">
                            {/* Plus / attach button */}
                            {mode === "video" && videoHasAttachments(videoModel) ? (
                                <AttachmentButton
                                    model={videoModel}
                                    attachments={attachments}
                                    onAttachmentsChange={setAttachments}
                                />
                            ) : mode === "image" && imageUploadSlots.length > 0 ? (
                                <ImageAttachmentButton
                                    slots={imageUploadSlots}
                                    slotFiles={slotFiles}
                                    onSlotFilesChange={setSlotFiles}
                                />
                            ) : mode === "video" ? (
                                <button
                                    type="button"
                                    className="w-8 h-8 border border-white/[.08] rounded-xl text-base font-medium leading-none cursor-pointer self-start grid place-items-center text-foreground shrink-0"
                                    style={{ background: "rgba(255,255,255,.05)" }}
                                >
                                    +
                                </button>
                            ) : null}

                            {/* Image slot thumbnails */}
                            {mode === "image" && Object.values(slotFiles).some((f) => f.length > 0) && (
                                <div className="flex items-center gap-[5px] flex-wrap shrink-0">
                                    {Object.entries(slotFiles).flatMap(([slotId, files]) =>
                                        files.map((file, idx) => (
                                            <div key={`${slotId}-${idx}`} className="relative w-[50px] h-[50px] shrink-0">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={URL.createObjectURL(file)} alt="" className="block object-cover rounded-[9px] w-[50px] h-[50px] border border-white/[.12]" />
                                                <button
                                                    type="button"
                                                    onClick={() => setSlotFiles((prev) => ({
                                                        ...prev,
                                                        [slotId]: (prev[slotId] ?? []).filter((_, i) => i !== idx),
                                                    }))}
                                                    className="absolute -top-[5px] -right-[5px] w-4 h-4 rounded-full border border-white/[.20] text-white text-[9px] grid place-items-center leading-none"
                                                    style={{ background: "rgba(20,20,20,.92)", zIndex: 2 }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Video attachment thumbnails */}
                            {mode === "video" && attachments.length > 0 && (
                                <div className="flex items-center gap-[5px] flex-wrap shrink-0">
                                    {attachments.map((att) => (
                                        <div key={att.id} className="relative w-[50px] h-[50px] shrink-0">
                                            {att.previewUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={att.previewUrl} alt="" className="block object-cover rounded-[9px] w-[50px] h-[50px] border border-white/[.12]" />
                                            ) : (
                                                <div className="rounded-[9px] grid place-items-center text-[20px] border border-white/[.10] w-[50px] h-[50px]" style={{ background: "rgba(255,255,255,.06)" }}>
                                                    📎
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setAttachments(attachments.filter((a) => a.id !== att.id))}
                                                className="absolute -top-[5px] -right-[5px] w-4 h-4 rounded-full border border-white/[.20] text-white text-[9px] grid place-items-center leading-none"
                                                style={{ background: "rgba(20,20,20,.92)", zIndex: 2 }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Prompt surface */}
                            <div className="flex-1 min-w-0 min-h-8">
                                {isDragOverlayVisible && hasDropTargets ? (
                                    <div
                                        className="rounded-[14px] border border-dashed p-2.5"
                                        style={{ borderColor: "rgba(213,255,71,.44)", background: "rgba(213,255,71,.06)" }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onDrop={(e) => {
                                            if (dropTargets.length === 1) {
                                                handleDropToTarget(dropTargets[0], e);
                                                return;
                                            }
                                            e.preventDefault();
                                        }}
                                    >
                                        {dropTargets.length === 1 ? (
                                            <div className="px-2 py-3 text-center">
                                                <p className="text-[11px] font-bold uppercase tracking-[.08em]" style={{ color: "rgba(213,255,71,.92)" }}>
                                                    {tCommand("dropSingleTitle", { field: dropTargets[0].label })}
                                                </p>
                                                <p className="mt-1 text-[12px]" style={{ color: "rgba(244,247,251,.72)" }}>
                                                    {tCommand("dropSingleHint")}
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                {dropTargets.map((target) => (
                                                    <div
                                                        key={target.id}
                                                        className="rounded-[10px] border px-2.5 py-2 transition-colors"
                                                        style={{
                                                            borderColor: activeDropTargetId === target.id ? "rgba(213,255,71,.64)" : "rgba(255,255,255,.16)",
                                                            background: activeDropTargetId === target.id ? "rgba(213,255,71,.14)" : "rgba(255,255,255,.04)",
                                                        }}
                                                        onDragEnter={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setActiveDropTargetId(target.id);
                                                        }}
                                                        onDragOver={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            if (activeDropTargetId !== target.id) setActiveDropTargetId(target.id);
                                                        }}
                                                        onDragLeave={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setActiveDropTargetId((current) => (current === target.id ? null : current));
                                                        }}
                                                        onDrop={(e) => handleDropToTarget(target, e)}
                                                    >
                                                        <p className="text-[11px] font-bold" style={{ color: "#f4f7fb" }}>
                                                            {target.label}
                                                        </p>
                                                        <p className="mt-0.5 text-[10px]" style={{ color: "rgba(244,247,251,.58)" }}>
                                                            {target.kind.toUpperCase()} {target.required ? `• ${tCommand("required")}` : `• ${tCommand("optional")}`}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <textarea
                                        ref={textareaRef}
                                        rows={1}
                                        value={prompt}
                                        onChange={(e) => { setValue("prompt", e.target.value); autoResize(); }}
                                        onKeyDown={handleKeyDown}
                                        placeholder={mode === "video" ? t("video.promptPlaceholder") : t("image.promptPlaceholder")}
                                        className="w-full border-none bg-transparent resize-none outline-none text-[15px] font-normal min-h-8 py-1.5 box-border text-foreground leading-[1.3]"
                                        style={{
                                            maxHeight: "35dvh",
                                            overflowY: "auto",
                                            overflowX: "hidden",
                                        }}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Control row (pills) */}
                        <div className="flex flex-wrap items-center gap-2 mt-[2px]">
                            {mode === "video" ? (
                                <>
                                    <VideoModelPill
                                        modelId={videoModelId}
                                        variantId={videoVariantId}
                                        onModelChange={handleVideoModelChange}
                                        attachments={attachments}
                                    />
                                    {getDurations(videoModel).length > 0 && (
                                        <DurationPill
                                            durations={getDurations(videoModel)}
                                            value={videoSettings.duration}
                                            onChange={(d) => setVideoSettings((s) => ({ ...s, duration: d }))}
                                        />
                                    )}
                                    {(getAspectRatios(videoModel)?.length ?? 0) > 0 && !attachments.some(a => a.kind === "image") && (
                                        <AspectRatioPill
                                            ratios={getAspectRatios(videoModel)!}
                                            value={videoSettings.aspectRatio}
                                            onChange={(r) => setVideoSettings((s) => ({ ...s, aspectRatio: r }))}
                                        />
                                    )}
                                    {videoModel.prompt_expansion && (
                                        <TogglePill
                                            label={t("video.expandPrompt")}
                                            icon="sparkle"
                                            value={videoSettings.expandPrompt}
                                            onChange={(v) => setVideoSettings((s) => ({ ...s, expandPrompt: v }))}
                                        />
                                    )}
                                    <VideoControlsPill
                                        model={videoModel}
                                        settings={videoSettings}
                                        onSettingsChange={setVideoSettings}
                                    />
                                </>
                            ) : (
                                <>
                                    <ImageModelPill
                                        modelId={imageModelId}
                                        onModelChange={handleImageModelChange}
                                        slotFiles={slotFiles}
                                    />
                                    {imageRatios.length > 0 && (
                                        <AspectRatioPill
                                            ratios={imageRatios}
                                            value={sizeAspect}
                                            onChange={setSizeAspect}
                                            customFields={imageCustomFields}
                                            fieldValues={imageFieldValues}
                                            onFieldChange={(id, val) => setImageFieldValues((prev) => ({ ...prev, [id]: val }))}
                                        />
                                    )}
                                    {imageResolutions.length > 0 && (
                                        <ResolutionPill
                                            resolutions={imageResolutions}
                                            value={sizeResolution}
                                            onChange={setSizeResolution}
                                        />
                                    )}
                                    {imageModel.custom_fields?.some((f) => f.type === "checkbox" && f.id.includes("prompt")) && (
                                        <TogglePill
                                            label={t("image.enhancePrompt")}
                                            icon="sparkle"
                                            value={Boolean(imageFieldValues[imageModel.custom_fields!.find((f) => f.type === "checkbox" && f.id.includes("prompt"))!.id] ?? false)}
                                            onChange={(v) => {
                                                const fid = imageModel.custom_fields!.find((f) => f.type === "checkbox" && f.id.includes("prompt"))!.id;
                                                setImageFieldValues((prev) => ({ ...prev, [fid]: v }));
                                            }}
                                        />
                                    )}
                                    {imageControlCount > 0 && (
                                        <ControlsPill
                                            model={imageModel}
                                            fieldValues={imageFieldValues}
                                            onFieldChange={(id, val) => setImageFieldValues((prev) => ({ ...prev, [id]: val }))}
                                            count={imageControlCount}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    </div>{/* end content wrapper */}

                    {/* Generate button — flex end, large lime */}
                    <button
                        type="submit"
                        className="shrink-0 self-center border-none rounded-[22px] font-bold cursor-pointer active:scale-95 transition-transform"
                        style={{
                            width: 146,
                            minHeight: 84,
                            background: "linear-gradient(180deg, #d5ff47, #bcf122)",
                            color: "#0b1118",
                            fontFamily: "'Space Grotesk', system-ui, sans-serif",
                            fontSize: 18,
                            letterSpacing: "-0.04em",
                            boxShadow: "0 20px 42px rgba(188,241,34,.18)",
                        }}
                    >
                        <span>{tCommon("generate")}</span>
                        <small className="block mt-1 text-[10px] font-extrabold tracking-[.08em] uppercase" style={{ fontFamily: "'Manrope', sans-serif" }}>
                            {mode === "video" ? tCommon("video") : tCommon("image")}
                        </small>
                    </button>
                </div>
            </form>
        </div>
    );
}

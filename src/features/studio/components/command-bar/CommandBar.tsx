"use client";

import { useState, useCallback, useRef, useMemo, useEffect, useEffectEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useRuntimeModels, asImageModel } from "@/features/catalog/hooks/useRuntimeModels";
import { getEditVariant } from "@/models/capabilities/image-helpers";
import { getVideoOverrides, getDurations, getAspectRatios, hasAttachments as videoHasAttachments } from "@/models/capabilities/video-helpers";
import type { AttachmentRole } from "@/models/capabilities/video-helpers";
import type { MediaSlotCapability } from "@/models/capabilities/types";
import { revalidateVideoTasks } from "@/features/tasks/hooks/useVideoTasks";
import { revalidateImageTasks } from "@/features/tasks/hooks/useImageTasks";
import { defaultSettings, type SettingsValues } from "@/features/studio/model-settings";
import type { AttachmentItem } from "@/features/studio/types";
import type { SizeUiResolution } from "@/types";
import { buildGroupedDropTargets, filesForDropTarget, slotsToDropDescriptors, type GroupedDropTarget } from "@/features/studio/lib/attachment-drop-targets";
import { remapSlotFilesOnModelSwitch, remapVideoAttachmentsOnModelSwitch } from "@/features/studio/lib/attachment-remap";
import { submitInBackground } from "@/features/studio/lib/background-submissions";
import { hasMediaTransfer, isUrlReference, readMediaTransfer } from "@/features/studio/lib/media-transfer";

import { VideoModelPill } from "@/features/studio/components/command-bar/VideoModelPill";
import { ImageModelPill } from "@/features/studio/components/command-bar/ImageModelPill";
import { DurationPill } from "@/features/studio/components/command-bar/DurationPill";
import { AspectRatioPill } from "@/features/studio/components/command-bar/AspectRatioPill";
import { ResolutionPill } from "@/features/studio/components/command-bar/ResolutionPill";
import { TogglePill } from "@/features/studio/components/command-bar/TogglePill";
import { ControlsPill } from "@/features/studio/components/command-bar/ControlsPill";
import { VideoControlsPill } from "@/features/studio/components/command-bar/VideoControlsPill";
import { AttachmentButton } from "@/features/studio/components/command-bar/AttachmentButton";
import { ImageAttachmentButton } from "@/features/studio/components/command-bar/ImageAttachmentButton";
import { ReferencePreview } from "@/features/studio/components/ReferencePreview";
import { useModelCopy } from "@/i18n/use-model-copy";

const schema = z.object({ prompt: z.string().max(65536) });
type FormData = z.infer<typeof schema>;

export interface IncomingImage { url: string; target: "reference" | "start" | "end"; mode: "image" | "video"; revision: number }

interface CommandBarProps {
    mode: "video" | "image";
    onPromptSupportChange: (supported: boolean) => void;
    suggestion?: { text: string; revision: number };
    /** A gallery image sent to the composer as a reference or as a video start/end frame. */
    incoming?: IncomingImage;
    onModeChange: (mode: "video" | "image") => void;
}

export function CommandBar({ mode, onModeChange, suggestion, incoming, onPromptSupportChange }: CommandBarProps) {
    const t = useTranslations("studio");
    const tErrors = useTranslations("errors");
    const tCommon = useTranslations("common");
    const tCommand = useTranslations("commandBar");
    const { slotLabel } = useModelCopy();
    const videoCatalog = useRuntimeModels("video");
    const imageCatalog = useRuntimeModels("image");


    // ── Video state ──
    const firstVideoId = videoCatalog.models[0]?.id ?? "";
    const [videoModelId, setVideoModelId] = useState(firstVideoId);
    const [videoVariantId, setVideoVariantId] = useState("");
    const [videoSettings, setVideoSettings] = useState<SettingsValues>(() =>
        defaultSettings(videoCatalog.byId[firstVideoId])
    );
    const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

    // ── Image state ──
    const firstImageId = imageCatalog.models[0]?.id ?? "";
    const [imageModelId, setImageModelId] = useState(firstImageId);
    const [sizeAspect, setSizeAspect] = useState(() => {
        const m = asImageModel(imageCatalog.byId[firstImageId]);
        if (m?.size_ui) return m.size_ui.default_aspect ?? "";
        const arField = m?.custom_fields?.find((f) => f.id === "aspect_ratio" && f.type === "select");
        const defOpt = arField?.default ? String(arField.default) : (arField?.options?.[0] ?? "");
        const match = defOpt.match(/_(\.?\d+)_(\d+)$/);
        return match ? `${match[1]}:${match[2]}` : defOpt;
    });
    const [sizeResolution, setSizeResolution] = useState(() => {
        const m = asImageModel(imageCatalog.byId[firstImageId]);
        if (m?.size_ui) return m.size_ui.default_resolution ?? "";
        const resField = m?.custom_fields?.find((f) => f.id === "resolution" && f.type === "select");
        return resField?.default ? String(resField.default) : (resField?.options?.[0] ?? "");
    });
    const [imageFieldValues, setImageFieldValues] = useState<Record<string, unknown>>(() =>
        Object.fromEntries((imageCatalog.byId[firstImageId]?.custom_fields ?? []).filter(field => field.default !== undefined).map(field => [field.id, field.default]))
    );
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

    useEffect(() => {
        if (!suggestion) return;
        setValue("prompt", suggestion.text);
        requestAnimationFrame(() => { autoResize(); textareaRef.current?.focus(); });
    }, [suggestion, setValue, autoResize]);

    // ── Models ──
    const videoModel = videoCatalog.byId[videoModelId];
    const videoOverrides = getVideoOverrides(videoModelId);
    const imageModel = asImageModel(imageCatalog.byId[imageModelId]);
    const imageEditVariant = imageModel ? getEditVariant(imageModel) : null;

    const imageUploadSlots = useMemo<MediaSlotCapability[]>(() => {
        const editSlots = (imageEditVariant?.slots ?? []).map((slot) => ({ ...slot, required: false }));
        return [...(imageModel?.media_slots ?? []), ...editSlots];
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

        return (videoModel?.media_slots ?? []).map((slot) => ({
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
        const hasFiles = (event: DragEvent) => hasMediaTransfer(event.dataTransfer);

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
        const clearDrag = () => {
            dragDepthRef.current = 0;
            setIsDragOverlayVisible(false);
            setActiveDropTargetId(null);
        };

        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("drop", handleDrop);
        window.addEventListener("dragend", clearDrag);
        window.addEventListener("blur", clearDrag);

        return () => {
            window.removeEventListener("dragenter", handleDragEnter);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("drop", handleDrop);
            window.removeEventListener("dragend", clearDrag);
            window.removeEventListener("blur", clearDrag);
        };
    }, [hasDropTargets, isDragOverlayVisible]);

    function fileToAttachment(roleId: string, file: File, kind: "image" | "video" | "audio"): AttachmentItem {
        return {
            id: crypto.randomUUID(),
            roleId,
            type: isUrlReference(file) ? "url" : "file",
            ...(isUrlReference(file) ? { url: file.name } : { file }),
            kind,
        };
    }

    function applyImageDrop(target: GroupedDropTarget, files: File[]) {
        const acceptedFiles = filesForDropTarget(target, files);
        if (acceptedFiles.length === 0) return;

        setSlotFiles((prev) => {
            const next = { ...prev };

            if (target.roleIds.length > 1) {
                // Find empty slots first, then fill occupied ones
                const emptySlotIds = target.roleIds.filter((id) => !next[id]?.length);
                const orderedSlotIds = emptySlotIds;

                acceptedFiles.forEach((file, index) => {
                    const slotId = orderedSlotIds[index];
                    if (!slotId) return;
                    next[slotId] = [file];
                });
                return next;
            }

            const slotId = target.roleIds[0];
            if (target.acceptMany) {
                next[slotId] = [...(next[slotId] ?? []), ...acceptedFiles].slice(0, imageUploadSlots.find(slot => slot.id === slotId)?.max_count ?? 256);
            } else {
                next[slotId] = [acceptedFiles[0]];
            }

            return next;
        });
    }

    function applyVideoDrop(target: GroupedDropTarget, files: File[]) {
        const acceptedFiles = filesForDropTarget(target, files);
        if (acceptedFiles.length === 0) return;

        setAttachments((prev) => {
            const withoutTargetRoles = prev.filter((item) => !target.roleIds.includes(item.roleId));

            if (target.roleIds.length > 1) {
                const emptyRoles = target.roleIds.filter(roleId => !prev.some(item => item.roleId === roleId));
                const distributed = emptyRoles
                    .map((roleId, index) => {
                        const file = acceptedFiles[index];
                        if (!file) return null;
                        return fileToAttachment(roleId, file, target.kind);
                    })
                    .filter((item): item is AttachmentItem => Boolean(item));
                return [...prev, ...distributed];
            }

            const roleId = target.roleIds[0];
            const dropped = target.acceptMany
                ? [...prev.filter(item => item.roleId === roleId), ...acceptedFiles.map(file => fileToAttachment(roleId, file, target.kind))].slice(0, videoModel?.media_slots.find(slot => slot.id === roleId)?.max_count ?? 256)
                : [fileToAttachment(roleId, acceptedFiles[0], target.kind)];

            return [...withoutTargetRoles, ...dropped];
        });
    }

    function attachTransferredFiles(files: File[], preferred?: GroupedDropTarget) {
        if (!files.length) { setApiError("ERR_UNSUPPORTED_MEDIA_TYPE"); return; }
        let rejected = false;
        const batches = preferred ? [preferred] : dropTargets.filter(target => files.some(file => file.type.startsWith(`${target.kind}/`)))
            .filter((target, index, targets) => targets.findIndex(other => other.kind === target.kind) === index);
        if (!batches.length) { setApiError("ERR_UNSUPPORTED_MEDIA_TYPE"); return; }
        for (const candidate of batches) {
            const sameKind = filesForDropTarget(candidate, files);
            const compatible = preferred ? [candidate] : dropTargets.filter(target => target.kind === candidate.kind);
            const count = (id: string) => mode === "image" ? slotFiles[id]?.length ?? 0 : attachments.filter(item => item.roleId === id).length;
            const capacity = (id: string) => {
                const slot = mode === "image" ? imageUploadSlots.find(item => item.id === id) : videoModel?.media_slots.find(item => item.id === id);
                return slot?.max_count ?? (slot?.multiple ? 256 : 1);
            };
            // Generic prompt drops prefer ordinary references, keeping masks and end frames explicit.
            const ordered = [...compatible].sort((a, b) => Number(/mask|last|end/i.test(a.id)) - Number(/mask|last|end/i.test(b.id)));
            const target = ordered.find(item => item.roleIds.some(id => count(id) < capacity(id)));
            if (!target) { rejected = true; continue; }
            const remaining = target.roleIds.reduce((sum, id) => sum + Math.max(0, capacity(id) - count(id)), 0);
            if (sameKind.length > remaining) rejected = true;
            const accepted = sameKind.slice(0, remaining);
            if (mode === "image") applyImageDrop(target, accepted); else applyVideoDrop(target, accepted);
        }
        if (files.some(file => !batches.some(target => file.type.startsWith(`${target.kind}/`)))) {
            setApiError("ERR_UNSUPPORTED_MEDIA_TYPE");
        } else setApiError(rejected ? "ERR_ATTACHMENT_LIMIT" : null);
    }

    function handleDropToTarget(target: GroupedDropTarget | undefined, event: React.DragEvent<HTMLElement>) {
        event.preventDefault();
        event.stopPropagation();
        setActiveDropTargetId(null);
        setIsDragOverlayVisible(false);
        dragDepthRef.current = 0;
        attachTransferredFiles(readMediaTransfer(event.dataTransfer, window.location.origin), target);
    }

    const attachIncoming = useEffectEvent((image: IncomingImage) => {
        const frame = image.target === "end" ? /end|last/i : image.target === "start" ? /start|first/i : null;
        const preferred = frame ? dropTargets.find(target => target.kind === "image" && target.roleIds.some(id => frame.test(id))) : undefined;
        if (image.target === "end" && !preferred) { setApiError("ERR_END_FRAME_UNSUPPORTED"); return; }
        attachTransferredFiles([new File([], image.url, { type: "image/png" })], preferred);
    });
    const consumedIncoming = useRef(0);
    useEffect(() => {
        // Wait until the requested mode is active so the new model's slots receive the image.
        if (!incoming || incoming.mode !== mode || consumedIncoming.current === incoming.revision) return;
        consumedIncoming.current = incoming.revision;
        attachIncoming(incoming);
    }, [incoming, mode]);

    // ── Handlers ──
    const handleVideoModelChange = useCallback((id: string, varId: string) => {
        const previousModel = videoCatalog.byId[videoModelId];
        const previousOverrides = getVideoOverrides(previousModel?.id ?? "");
        const previousRoles =
            previousOverrides.attachment_roles?.map((role) => ({
                id: role.id,
                label: role.label,
                kind: role.kind,
                multiple: false,
            }))
            ?? (previousModel?.media_slots ?? []).map((slot) => ({
                id: slot.id,
                label: slot.label,
                kind: slot.kind,
                multiple: slot.multiple,
                max_count: slot.max_count,
            }));

        const nextModel = videoCatalog.byId[id];
        const nextOverrides = getVideoOverrides(nextModel?.id ?? "");
        const nextRoles =
            nextOverrides.attachment_roles?.map((role) => ({
                id: role.id,
                label: role.label,
                kind: role.kind,
                multiple: false,
            }))
            ?? (nextModel?.media_slots ?? []).map((slot) => ({
                id: slot.id,
                label: slot.label,
                kind: slot.kind,
                multiple: slot.multiple,
                max_count: slot.max_count,
            }));

        setAttachments((current) => remapVideoAttachmentsOnModelSwitch(current, previousRoles, nextRoles));
        setVideoModelId(nextModel?.id ?? "");
        setVideoVariantId(nextModel ? varId : "");
        setVideoSettings(defaultSettings(videoCatalog.byId[id], varId));
    }, [videoModelId, videoCatalog.byId]);

    const handleImageModelChange = useCallback((id: string) => {
        const previousModel = imageCatalog.byId[imageModelId];
        const previousEditVariant = previousModel ? getEditVariant(asImageModel(previousModel)) : null;
        const previousSlots: MediaSlotCapability[] = [
            ...(previousModel?.media_slots ?? []),
            ...((previousEditVariant?.slots ?? []).map((slot) => ({ ...slot, required: false }))),
        ];

        const nextModel = imageCatalog.byId[id];
        const nextEditVariant = nextModel ? getEditVariant(asImageModel(nextModel)) : null;
        const nextSlots: MediaSlotCapability[] = [
            ...(nextModel?.media_slots ?? []),
            ...((nextEditVariant?.slots ?? []).map((slot) => ({ ...slot, required: false }))),
        ];

        setSlotFiles((current) => remapSlotFilesOnModelSwitch(current, previousSlots, nextSlots));

        setImageModelId(nextModel?.id ?? "");
        const m = asImageModel(imageCatalog.byId[id]);
        const defaults = Object.fromEntries((m?.custom_fields ?? []).filter(f => f.default !== undefined).map(f => [f.id, f.default]));
        setImageFieldValues(defaults);
        setSizeAspect(m?.size_ui?.default_aspect ?? (m?.aspect_ratio ? m.aspect_ratio.default?.[1] ?? m.aspect_ratio.options?.[0]?.[1] : "") ?? "");
        setSizeResolution(m?.size_ui?.default_resolution ?? (m?.resolution_variant ? m.resolution_variant.default ?? m.resolution_variant.options?.[0] : "") ?? "");

    }, [imageModelId, imageCatalog.byId]);

    // Resolve async catalogs and reset settings/attachments when a selection disappears.
    useEffect(() => {
        if (!videoCatalog.byId[videoModelId] && (videoModelId || firstVideoId)) {
            queueMicrotask(() => handleVideoModelChange(firstVideoId, ""));
        }
        if (!imageCatalog.byId[imageModelId] && (imageModelId || firstImageId)) {
            queueMicrotask(() => handleImageModelChange(firstImageId));
        }
    }, [videoCatalog.byId, imageCatalog.byId, videoModelId, imageModelId, firstVideoId, firstImageId, handleVideoModelChange, handleImageModelChange]);

    const imageControlCount = imageModel?.custom_fields.filter(f => !(imageModel.size_ui && [imageModel.size_ui.width_field, imageModel.size_ui.height_field].includes(f.id))).length ?? 0;
    const imageCustomFields = null;
    const imageRatios: [string, string][] = imageModel?.size_ui
        ? imageModel.size_ui.aspect_ratios.map(ar => [`${ar.w}:${ar.h}`, `${ar.w}:${ar.h}`])
        : imageModel?.aspect_ratio ? (imageModel.aspect_ratio.options ?? []).map(([label, value]) => [value, label]) : [];
    const imageResolutions: SizeUiResolution[] = imageModel?.size_ui?.resolutions
        ?? (imageModel?.resolution_variant ? imageModel.resolution_variant.options?.map(id => ({ id, base: 0 })) : []) ?? [];
    const activeModel = mode === "image" ? imageModel : videoModel;
    const activeCatalog = mode === "image" ? imageCatalog : videoCatalog;
    const modelUnavailable = !activeModel || activeCatalog.isLoading || Boolean(activeCatalog.error);
    const supportsPrompt = activeModel?.prompt_supported !== false;
    useEffect(() => { onPromptSupportChange(supportsPrompt); }, [supportsPrompt, onPromptSupportChange]);
    useEffect(() => { if (supportsPrompt) requestAnimationFrame(autoResize); }, [supportsPrompt, autoResize]);

    const onSubmit = (data: FormData) => {
        if (!activeModel || activeCatalog.isLoading || activeCatalog.error) return;
        if (supportsPrompt && activeModel.prompt_required && !data.prompt.trim()) { setApiError("ERR_PROMPT_REQUIRED"); textareaRef.current?.focus(); return; }
        const requiredSlots = mode === "image" ? imageUploadSlots : videoRoleDescriptors;
        if (requiredSlots.some(slot => slot.required && !(mode === "image" ? slotFiles[slot.id]?.length : attachments.some(item => item.roleId === slot.id)))) { setApiError("ERR_MISSING_ATTACHMENT"); return; }
        if (supportsPrompt && data.prompt.length > (activeModel.prompt_max ?? 65536)) { setApiError("ERR_PROMPT_TOO_LONG"); return; }
        setApiError(null);
        const submittedMode = mode;
        const body = new FormData();
        body.append("prompt", supportsPrompt ? data.prompt : "");
        if (submittedMode === "video") {
            body.append("model_id", videoModelId);
            body.append("variant_id", videoVariantId);
            body.append("settings", JSON.stringify(videoSettings));
            for (const att of attachments) {
                if (att.file) body.append(`file_${att.roleId}`, att.file);
                else if (att.url) body.append(`url_${att.roleId}`, att.url);
            }
        } else {
            body.append("model_id", imageModelId);
            body.append("size_aspect", sizeAspect);
            body.append("size_resolution", sizeResolution);
            body.append("field_values", JSON.stringify(imageFieldValues));
            for (const [slotId, files] of Object.entries(slotFiles)) {
                files.forEach((file) => {
                    if (file.size === 0 && /^(https:\/\/|\/api\/)/.test(file.name)) body.append(`url_${slotId}`, file.name);
                    else body.append(`slot_${slotId}`, file);
                });
            }
        }
        submitInBackground({ mode: submittedMode, model: activeModel.label, prompt: supportsPrompt ? data.prompt : "" }, body,
            submittedMode === "video" ? revalidateVideoTasks : revalidateImageTasks);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit(onSubmit, () => setApiError("ERR_PROMPT_TOO_LONG"))();
        }
    };

    return (
        <div className="relative z-20 shrink-0 px-3 pb-3 pt-2 sm:px-5 sm:pb-5">
            {/* Error toast */}
            <AnimatePresence>
                {apiError && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="relative mx-auto z-40 w-full max-w-[70rem] rounded-[18px] border border-white/[.08] text-[13px] leading-[1.5] mb-3"
                        style={{ padding: "14px 16px", background: "rgba(12,16,24,.96)", boxShadow: "0 28px 80px rgba(0,0,0,.42)" }}
                    >
                        <div role="alert" className="flex items-center gap-2 text-[#ffc4c4]" style={{ borderColor: "rgba(255,128,128,.22)" }}>
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            <span className="flex-1">{tErrors.has(apiError as never) ? tErrors(apiError as never) : tErrors("ERR_GENERIC")}</span>
                            <button type="button" aria-label={tCommand("dismissError")} onClick={() => setApiError(null)} className="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-white/10"><X className="size-4" /></button>
                        </div>

                    </motion.div>
                )}
            </AnimatePresence>

            {/* Composer */}
            <form
                data-studio-composer
                onDragOver={event => { if (hasMediaTransfer(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
                onDrop={event => { if (hasMediaTransfer(event.dataTransfer)) handleDropToTarget(undefined, event); }}
                onPaste={event => {
                    const files = Array.from(event.clipboardData.files);
                    if (files.length) { event.preventDefault(); attachTransferredFiles(files); }
                }}
                onSubmit={(event) => { void handleSubmit(onSubmit, () => setApiError("ERR_PROMPT_TOO_LONG"))(event); }}
                className="mx-auto grid w-full max-w-[70rem] grid-cols-1 items-stretch gap-2 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-3"
            >
                {/* Mode rail */}
                <div
                    role="group" aria-label={tCommand("mode")}
                    className="flex w-fit gap-1 rounded-2xl border border-white/10 p-1 sm:w-auto sm:flex-col sm:p-1.5"
                    style={{
                        background: "rgba(12,12,12,.88)",
                        boxShadow: "0 28px 80px rgba(0,0,0,.42)",
                        backdropFilter: "blur(18px)",
                    }}
                >
                    {(["image", "video"] as const).map((m) => (
                        <button
                            key={m}
                            aria-pressed={mode === m}
                            type="button"
                            onClick={() => onModeChange(m)}
                            className={`min-h-10 flex-1 px-4 py-1.5 flex sm:flex-col sm:px-1.5 items-center justify-center gap-[5px] rounded-[14px] text-[10px] font-extrabold tracking-[0.02em] cursor-pointer border transition-colors ${mode === m
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
                    className="min-w-0 rounded-[24px] border border-white/15 flex flex-col items-stretch gap-3 sm:flex-row"
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
                        <div className="flex flex-wrap items-start gap-2">
                            {/* Plus / attach button */}
                            {mode === "video" && videoModel && videoHasAttachments(videoModel) ? (
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
                            ) : null}

                            {/* Image slot thumbnails */}
                            {mode === "image" && Object.values(slotFiles).some((f) => f.length > 0) && (
                                <div className="flex max-w-full items-center gap-[5px] flex-wrap shrink-0">
                                    {Object.entries(slotFiles).flatMap(([slotId, files]) =>
                                        files.map((file, idx) => (
                                            <div key={`${slotId}-${idx}`} className="relative w-[50px] h-[50px] shrink-0">
                                                <ReferencePreview file={isUrlReference(file) ? undefined : file} url={isUrlReference(file) ? file.name : undefined} kind={imageUploadSlots.find(slot => slot.id === slotId)?.kind} />
                                                <button
                                                    type="button"
                                                    aria-label={tCommand("removeAttachment", { name: file.size ? file.name : tCommand("urlReference") })}
                                                    onClick={() => setSlotFiles((prev) => ({
                                                        ...prev,
                                                        [slotId]: (prev[slotId] ?? []).filter((_, i) => i !== idx),
                                                    }))}
                                                    className="absolute -top-1 -right-1 size-6 rounded-full border border-white/[.20] text-white text-[9px] grid place-items-center leading-none"
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
                                <div className="flex max-w-full items-center gap-[5px] flex-wrap shrink-0">
                                    {attachments.map((att) => (
                                        <div key={att.id} className="relative w-[50px] h-[50px] shrink-0">
                                            <ReferencePreview file={att.file} url={att.url} kind={att.kind} />
                                            <button
                                                type="button"
                                                aria-label={tCommand("removeAttachment", { name: att.file?.name ?? att.roleId })}
                                                onClick={() => setAttachments(attachments.filter((a) => a.id !== att.id))}
                                                className="absolute -top-1 -right-1 size-6 rounded-full border border-white/[.20] text-white text-[9px] grid place-items-center leading-none"
                                                style={{ background: "rgba(20,20,20,.92)", zIndex: 2 }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Prompt surface */}
                            <div className="min-w-40 flex-1 min-h-12">
                                {isDragOverlayVisible && hasDropTargets ? (
                                    <div
                                        className="rounded-[14px] border border-dashed p-2.5"
                                        style={{ borderColor: "rgba(213,255,71,.44)", background: "rgba(213,255,71,.06)" }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onDrop={(e) => {
                                            handleDropToTarget(dropTargets.length === 1 ? dropTargets[0] : undefined, e);
                                        }}
                                    >
                                        {dropTargets.length === 1 ? (
                                            <div className="px-2 py-3 text-center">
                                                <p className="text-[11px] font-bold uppercase tracking-[.08em]" style={{ color: "rgba(213,255,71,.92)" }}>
                                                    {tCommand("dropSingleTitle", { field: slotLabel(dropTargets[0].roleIds[0], dropTargets[0].label) })}
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
                                                            {slotLabel(target.roleIds[0], target.label)}
                                                        </p>
                                                        <p className="mt-0.5 text-[10px]" style={{ color: "rgba(244,247,251,.58)" }}>
                                                            {tCommon(target.kind)} {target.required ? `• ${tCommand("required")}` : `• ${tCommand("optional")}`}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : supportsPrompt ? (
                                    <textarea
                                        ref={textareaRef}
                                        rows={1}
                                        value={prompt}
                                        disabled={modelUnavailable}
                                        onChange={(e) => { setValue("prompt", e.target.value); autoResize(); }}
                                        onKeyDown={handleKeyDown}
                                        aria-label={tCommand(activeModel?.prompt_required === false ? "promptOptional" : "promptLabel")}
                                        aria-invalid={apiError === "ERR_PROMPT_REQUIRED" || apiError === "ERR_PROMPT_TOO_LONG"}
                                        maxLength={activeModel?.prompt_max ?? 65536}
                                        placeholder={mode === "video" ? t("video.promptPlaceholder") : t("image.promptPlaceholder")}
                                        className="w-full border-none bg-transparent resize-none rounded-lg outline-none text-base font-normal min-h-16 max-h-[20dvh] py-1.5 box-border text-foreground leading-[1.3] disabled:cursor-not-allowed disabled:opacity-60 sm:text-[15px] sm:min-h-14 sm:max-h-[25dvh]"
                                        style={{
                                            overflowY: "auto",
                                            overflowX: "hidden",
                                        }}
                                    />
                                ) : <p className="px-1 py-2 text-sm leading-relaxed text-muted-foreground">{tCommand("referenceOnly")}</p>}
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
                                    {videoModel && <>
                                    {videoModel.resolution_variant && (videoModel.resolution_variant.options?.length ?? 0) > 0 && <ResolutionPill
                                        resolutions={videoModel.resolution_variant.options!.map(id => ({ id, base: 0 }))}
                                        value={videoVariantId || videoModel.resolution_variant.default || videoModel.resolution_variant.options![0]}
                                        onChange={id => {
                                            const defaults = defaultSettings(videoModel, id);
                                            setVideoVariantId(id);
                                            setVideoSettings(current => ({ ...current, duration: defaults.duration, aspectRatio: defaults.aspectRatio, size: defaults.size }));
                                        }}
                                    />}
                                    {getDurations(videoModel, videoVariantId).length > 0 && (
                                        <DurationPill
                                            durations={getDurations(videoModel, videoVariantId)}
                                            value={videoSettings.duration}
                                            onChange={(d) => setVideoSettings((s) => ({ ...s, duration: d }))}
                                        />
                                    )}
                                    {(getAspectRatios(videoModel, videoVariantId)?.length ?? 0) > 0 && !attachments.some(a => a.kind === "image") && (
                                        <AspectRatioPill
                                            ratios={getAspectRatios(videoModel, videoVariantId)!.map(([label, value]) => [value, label])}
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
                                    </>}
                                </>
                            ) : (
                                <>
                                    <ImageModelPill
                                        modelId={imageModelId}
                                        onModelChange={handleImageModelChange}
                                        slotFiles={slotFiles}
                                    />
                                    {imageModel && <>
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
                                    </>}
                                </>
                            )}
                        </div>
                        {(activeCatalog.isLoading || activeCatalog.error) && (
                            <p role="status" className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {tCommand(activeCatalog.error ? "modelsLoadError" : "modelsLoading")}
                            </p>
                        )}
                        {(attachments.some((attachment) => attachment.file) || Object.values(slotFiles).some((files) => files.length)) && (
                            <p className="mt-2 text-[10px] text-muted-foreground">{tCommand("uploadLimit")}</p>
                        )}
                    </div>{/* end content wrapper */}

                    {/* Generate button — flex end, large lime */}
                    <button
                        type="submit"
                        disabled={modelUnavailable}
                        className="w-full min-h-12 shrink-0 self-center border-none rounded-[22px] font-bold cursor-pointer active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed sm:w-[146px] sm:min-h-[88px]"
                        style={{
                            background: "linear-gradient(180deg, #d5ff47, #bcf122)",
                            color: "#0b1118",
                            fontFamily: "var(--font-space-grotesk), sans-serif",
                            fontSize: 18,
                            letterSpacing: "-0.04em",
                            boxShadow: "0 20px 42px rgba(188,241,34,.18)",
                        }}
                    >
                        <span>{tCommon("generate")}</span>
                        <small className="block mt-1 text-[10px] font-extrabold tracking-[.08em] uppercase" style={{ fontFamily: "var(--font-manrope), sans-serif" }}>
                            {mode === "video" ? tCommon("video") : tCommon("image")}
                        </small>
                    </button>
                </div>
            </form>
            {!supportsPrompt && <p className="mx-auto mt-2 hidden max-w-[70rem] text-right text-[11px] text-muted-foreground sm:block">{tCommand("referenceOnlyHint")}</p>}
        </div>
    );
}

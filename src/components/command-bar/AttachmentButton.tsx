"use client";

import { useState, useRef } from "react";
import { Paperclip, Upload, X, Image as ImageIcon, Video, Link2 } from "lucide-react";
import { PillPopover } from "./PillPopover";
import { Input } from "@/components/ui/input";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { getImageRoles, getVideoOverrides, getImageField, isImageRequired } from "@/models/capabilities/video-helpers";
import type { AttachmentItem } from "@/components/studio/AttachmentZone";
import { useTranslations } from "next-intl";

function shortId() {
    return Math.random().toString(36).slice(2, 10);
}

interface AttachmentButtonProps {
    model: ModelCapabilities;
    attachments: AttachmentItem[];
    onAttachmentsChange: (items: AttachmentItem[]) => void;
}

export function AttachmentButton({ model, attachments, onAttachmentsChange }: AttachmentButtonProps) {
    const t = useTranslations("commandBar");
    const [open, setOpen] = useState(false);

    const imageRoles = getImageRoles(model);
    const overrides = getVideoOverrides(model.id);
    const imageField = getImageField(model);

    // Extract non-image slots (video/audio) directly from media_slots
    // Skip if overrides define their own attachment_roles (they already include video/audio roles)
    const nonImageSlots = overrides.attachment_roles
        ? []
        : model.media_slots.filter(s => s.kind !== "image");

    const roles = [
        ...(imageRoles?.map((r) => ({
            id: r.id,
            label: r.label,
            kind: "image" as const,
            required: false,
        })) ?? []),
        ...(overrides.attachment_roles?.map((r) => ({
            id: r.id,
            label: r.label,
            kind: r.kind,
            required: r.required ?? false,
        })) ?? []),
        ...(imageField
            ? [{ id: imageField, label: t("imageLabel"), kind: "image" as const, required: isImageRequired(model) }]
            : []),
        ...nonImageSlots.map((s) => ({
            id: s.id,
            label: s.label,
            kind: s.kind,
            required: s.required ?? false,
        })),
    ];

    // Deduplicate by id
    const seen = new Set<string>();
    const uniqueRoles = roles.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
    });

    const count = attachments.length;

    function addFile(roleId: string, file: File, kind: "image" | "video" | "audio") {
        const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
        onAttachmentsChange([
            ...attachments,
            { id: shortId(), roleId, type: "file", file, previewUrl, kind },
        ]);
    }

    function addUrl(roleId: string, url: string, kind: "image" | "video" | "audio") {
        onAttachmentsChange([
            ...attachments,
            { id: shortId(), roleId, type: "url", url, kind },
        ]);
    }

    function remove(id: string) {
        onAttachmentsChange(attachments.filter((a) => a.id !== id));
    }

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            width="w-80"
            trigger={
                <>
                    <Paperclip className="h-3.5 w-3.5" />
                    {count > 0 && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                            {count}
                        </span>
                    )}
                </>
            }
        >
            <div className="space-y-3 max-h-72 overflow-y-auto">
                <p className="text-[10px] font-extrabold uppercase tracking-[.08em] px-1" style={{ color: "rgba(244,247,251,.44)" }}>
                    {t("attachmentsTitle")}
                </p>

                {uniqueRoles.map((role) => (
                    <RoleUpload
                        key={role.id}
                        roleId={role.id}
                        label={role.label}
                        kind={role.kind}
                        required={role.required}
                        items={attachments.filter((a) => a.roleId === role.id)}
                        onAddFile={(f) => addFile(role.id, f, role.kind)}
                        onAddUrl={(u) => addUrl(role.id, u, role.kind)}
                        onRemove={remove}
                        t={t}
                    />
                ))}

                {uniqueRoles.length === 0 && (
                    <p className="text-[11px] text-center py-2" style={{ color: "rgba(244,247,251,.44)" }}>
                        {t("noAttachmentSlots")}
                    </p>
                )}
            </div>
        </PillPopover>
    );
}

interface RoleUploadProps {
    roleId: string;
    label: string;
    kind: "image" | "video" | "audio";
    required: boolean;
    items: AttachmentItem[];
    onAddFile: (file: File) => void;
    onAddUrl: (url: string) => void;
    onRemove: (id: string) => void;
    t: ReturnType<typeof useTranslations<"commandBar">>;
}

function RoleUpload({ label, kind, required, items, onAddFile, onAddUrl, onRemove, t }: RoleUploadProps) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [urlInput, setUrlInput] = useState("");
    const [showUrl, setShowUrl] = useState(false);

    const accept =
        kind === "image" ? "image/*" : kind === "video" ? "video/*" : "audio/*";
    const KindIcon = kind === "video" ? Video : ImageIcon;

    return (
        <div className="rounded-[12px] border p-2.5 space-y-1.5" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)" }}>
            <div className="flex items-center gap-1.5">
                <KindIcon className="h-3 w-3" style={{ color: "rgba(244,247,251,.44)" }} />
                <span className="text-[11px] font-bold flex-1" style={{ color: "#f4f7fb" }}>{label}</span>
                {required && <span className="text-[9px] font-bold" style={{ color: "#ff6b6b" }}>{t("required")}</span>}
            </div>

            {/* Existing items */}
            {items.map((item) => (
                <div
                    key={item.id}
                    className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[10px]"
                    style={{ background: "rgba(255,255,255,.05)" }}
                >
                    {item.previewUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={item.previewUrl}
                            alt=""
                            className="h-6 w-6 rounded object-cover"
                        />
                    )}
                    <span className="flex-1 truncate" style={{ color: "rgba(244,247,251,.6)" }}>
                        {item.file?.name ?? item.url}
                    </span>
                    <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        className="hover:text-red-400 transition-colors"
                        style={{ color: "rgba(244,247,251,.44)" }}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            ))}

            {/* Upload controls */}
            <div className="flex gap-1">
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1 rounded-[8px] border border-dashed px-2 py-1 text-[10px] transition-colors flex-1 cursor-pointer"
                    style={{ borderColor: "rgba(255,255,255,.12)", color: "rgba(244,247,251,.44)" }}
                >
                    <Upload className="h-3 w-3" />
                    {t("upload")}
                </button>
                <button
                    type="button"
                    onClick={() => setShowUrl(!showUrl)}
                    className="flex items-center gap-1 rounded-[8px] border border-dashed px-2 py-1 text-[10px] transition-colors cursor-pointer"
                    style={{ borderColor: "rgba(255,255,255,.12)", color: "rgba(244,247,251,.44)" }}
                >
                    <Link2 className="h-3 w-3" />
                    {t("url")}
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    accept={accept}
                    className="sr-only"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onAddFile(f);
                        e.target.value = "";
                    }}
                />
            </div>

            {showUrl && (
                <div className="flex gap-1">
                    <Input
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder={t("urlPlaceholder")}
                        className="h-6 text-[10px] flex-1"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            if (urlInput.trim()) {
                                onAddUrl(urlInput.trim());
                                setUrlInput("");
                                setShowUrl(false);
                            }
                        }}
                        className="rounded-[8px] px-2 text-[10px] font-bold cursor-pointer"
                        style={{ background: "#d5ff47", color: "#0b1118" }}
                    >
                        {t("add")}
                    </button>
                </div>
            )}
        </div>
    );
}

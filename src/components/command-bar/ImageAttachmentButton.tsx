"use client";

import { useRef, useState } from "react";
import { Paperclip, Upload, Link2, X, Image as ImageIcon } from "lucide-react";
import { PillPopover } from "./PillPopover";
import { Input } from "@/components/ui/input";
import type { MediaSlotCapability } from "@/models/capabilities/types";
import { useTranslations } from "next-intl";

interface ImageAttachmentButtonProps {
    slots: MediaSlotCapability[];
    slotFiles: Record<string, File[]>;
    onSlotFilesChange: (files: Record<string, File[]>) => void;
}

export function ImageAttachmentButton({ slots, slotFiles, onSlotFilesChange }: ImageAttachmentButtonProps) {
    const t = useTranslations("commandBar");
    const [open, setOpen] = useState(false);
    const totalFiles = Object.values(slotFiles).reduce((sum, files) => sum + files.length, 0);

    function setFile(slotId: string, file: File | null) {
        if (file === null) {
            const next = { ...slotFiles };
            delete next[slotId];
            onSlotFilesChange(next);
        } else {
            onSlotFilesChange({ ...slotFiles, [slotId]: [file] });
        }
    }

    return (
        <PillPopover
            open={open}
            onOpenChange={setOpen}
            width="w-80"
            trigger={
                <>
                    <Paperclip className="h-3.5 w-3.5" />
                    {totalFiles > 0 && (
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                            {totalFiles}
                        </span>
                    )}
                </>
            }
        >
            <div className="space-y-3 max-h-72 overflow-y-auto">
                <p className="text-[10px] font-extrabold uppercase tracking-[.08em] px-1" style={{ color: "rgba(244,247,251,.44)" }}>
                    {t("imageAttachmentsTitle")}
                </p>
                {slots.map((slot) => (
                    <SlotUpload
                        key={slot.id}
                        slot={slot}
                        file={slotFiles[slot.id]?.[0] ?? null}
                        onFile={(f) => setFile(slot.id, f)}
                        t={t}
                    />
                ))}
            </div>
        </PillPopover>
    );
}

interface SlotUploadProps {
    slot: MediaSlotCapability;
    file: File | null;
    onFile: (file: File | null) => void;
    t: ReturnType<typeof useTranslations<"commandBar">>;
}

function SlotUpload({ slot, file, onFile, t }: SlotUploadProps) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [urlInput, setUrlInput] = useState("");
    const [showUrl, setShowUrl] = useState(false);

    return (
        <div className="rounded-[12px] border p-2.5 space-y-1.5" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)" }}>
            <div className="flex items-center gap-1.5">
                <ImageIcon className="h-3 w-3" style={{ color: "rgba(244,247,251,.44)" }} />
                <span className="text-[11px] font-bold flex-1" style={{ color: "#f4f7fb" }}>
                    {slot.label}
                </span>
                {slot.description && (
                    <span className="text-[9px]" style={{ color: "rgba(244,247,251,.4)" }}>{slot.description}</span>
                )}
                {slot.required && <span className="text-[9px] font-bold" style={{ color: "#ff6b6b" }}>{t("required")}</span>}
            </div>

            {/* Existing file */}
            {file && (
                <div
                    className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[10px]"
                    style={{ background: "rgba(255,255,255,.05)" }}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={URL.createObjectURL(file)} alt="" className="h-6 w-6 rounded object-cover shrink-0" />
                    <span className="flex-1 truncate" style={{ color: "rgba(244,247,251,.6)" }}>{file.name}</span>
                    <button
                        type="button"
                        onClick={() => onFile(null)}
                        className="hover:text-red-400 transition-colors shrink-0"
                        style={{ color: "rgba(244,247,251,.44)" }}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}

            {/* Upload controls — hidden when a file is already attached */}
            {!file && (
                <div className="flex gap-1">
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-1 rounded-[8px] border border-dashed px-2 py-1 text-[10px] transition-colors flex-1 cursor-pointer"
                        style={{ borderColor: "rgba(255,255,255,.12)", color: "rgba(244,247,251,.44)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,.24)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,.12)"; }}
                    >
                        <Upload className="h-3 w-3" />
                        {t("upload")}
                    </button>
                    {slot.accept !== "b64_only" && (
                        <button
                            type="button"
                            onClick={() => setShowUrl(!showUrl)}
                            className="flex items-center gap-1 rounded-[8px] border border-dashed px-2 py-1 text-[10px] transition-colors cursor-pointer"
                            style={{ borderColor: "rgba(255,255,255,.12)", color: "rgba(244,247,251,.44)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,.24)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,.12)"; }}
                        >
                            <Link2 className="h-3 w-3" />
                            {t("url")}
                        </button>
                    )}
                </div>
            )}

            {/* URL input */}
            {!file && showUrl && (
                <div className="flex gap-1">
                    <Input
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder={t("urlPlaceholder")}
                        className="h-7 text-[11px] flex-1"
                        style={{ background: "rgba(255,255,255,.05)", borderColor: "rgba(255,255,255,.12)" }}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            if (!urlInput.trim()) return;
                            const blob = new Blob([], { type: "image/png" });
                            const fakeFile = new File([blob], urlInput.trim(), { type: "image/png" });
                            onFile(fakeFile);
                            setUrlInput("");
                            setShowUrl(false);
                        }}
                        className="rounded-[8px] px-2 py-1 text-[10px] font-bold cursor-pointer"
                        style={{ background: "rgba(213,255,71,.12)", color: "#d5ff47" }}
                    >
                        {t("add")}
                    </button>
                </div>
            )}

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = "";
                }}
            />
        </div>
    );
}

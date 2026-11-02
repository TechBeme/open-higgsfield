"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MediaSlotCapability } from "@/models/capabilities/types";
import { ReferenceUpload } from "../ReferenceUpload";
import { PillPopover } from "./PillPopover";

export function ImageAttachmentButton({ slots, slotFiles, onSlotFilesChange }: {
    slots: MediaSlotCapability[]; slotFiles: Record<string, File[]>; onSlotFilesChange: (files: Record<string, File[]>) => void;
}) {
    const t = useTranslations("commandBar");
    const [open, setOpen] = useState(false);
    const total = Object.values(slotFiles).reduce((sum, files) => sum + files.length, 0);
    return <PillPopover open={open} onOpenChange={setOpen} width="w-96" triggerLabel={t("attach")} trigger={<><Paperclip className="size-4" />{total > 0 && <span className="text-primary">{total}</span>}</>}>
        <p className="mb-2 text-sm font-semibold">{t("imageAttachmentsTitle")}</p>
        <div className="space-y-3">{slots.map(slot => {
            const files = slotFiles[slot.id] ?? [];
            return <ReferenceUpload key={slot.id} slotId={slot.id} label={slot.label} description={slot.description} kind={slot.kind} required={slot.required} maxCount={slot.max_count ?? (slot.multiple ? 256 : 1)} allowUrl={slot.accept !== "b64_only"}
                items={files.map((file, index) => ({ id: String(index), ...(file.size === 0 ? { url: file.name } : { file }) }))}
                onAdd={items => onSlotFilesChange({ ...slotFiles, [slot.id]: [...files, ...items.map(item => item.file ?? new File([], item.url!, { type: "image/png" }))] })}
                onRemove={id => onSlotFilesChange({ ...slotFiles, [slot.id]: files.filter((_, index) => String(index) !== id) })} />;
        })}</div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("uploadLimit")}</p>
    </PillPopover>;
}

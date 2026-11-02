"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { getVideoOverrides } from "@/models/capabilities/video-helpers";
import type { AttachmentItem } from "@/features/studio/types";
import { ReferenceUpload } from "../ReferenceUpload";
import { PillPopover } from "./PillPopover";

export function AttachmentButton({ model, attachments, onAttachmentsChange }: {
    model: ModelCapabilities; attachments: AttachmentItem[]; onAttachmentsChange: (items: AttachmentItem[]) => void;
}) {
    const t = useTranslations("commandBar");
    const [open, setOpen] = useState(false);
    const overrides = getVideoOverrides(model.id);
    const roles = overrides.attachment_roles?.map(role => ({ ...role, multiple: false, max_count: 1, accept: undefined, description: undefined })) ?? model.media_slots;
    return <PillPopover open={open} onOpenChange={setOpen} width="w-96" triggerLabel={t("attach")} trigger={<><Paperclip className="size-4" />{attachments.length > 0 && <span className="text-primary">{attachments.length}</span>}</>}>
        <p className="mb-2 text-sm font-semibold">{t("attachmentsTitle")}</p>
        <div className="space-y-3">{roles.map(role => <ReferenceUpload key={role.id} slotId={role.id} label={role.label} description={role.description} kind={role.kind} required={role.required} maxCount={role.max_count ?? (role.multiple ? 256 : 1)} allowUrl={role.accept !== "b64_only"}
            items={attachments.filter(item => item.roleId === role.id)}
            onAdd={items => onAttachmentsChange([...attachments, ...items.map(item => ({ ...item, id: crypto.randomUUID(), roleId: role.id, type: item.file ? "file" as const : "url" as const, kind: role.kind }))])}
            onRemove={id => onAttachmentsChange(attachments.filter(item => item.id !== id))} />)}</div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("uploadLimit")}</p>
    </PillPopover>;
}

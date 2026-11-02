"use client";

import { ModelPicker } from "./ModelPicker";
import type { AttachmentItem } from "@/features/studio/types";

interface VideoModelPillProps {
    modelId: string;
    variantId: string;
    onModelChange: (modelId: string, variantId: string) => void;
    attachments: AttachmentItem[];
}

export function VideoModelPill({ modelId, variantId, onModelChange }: VideoModelPillProps) {
    return <ModelPicker mediaType="video" modelId={modelId}
        onModelChange={id => onModelChange(id, id === modelId ? variantId : "")} />;
}

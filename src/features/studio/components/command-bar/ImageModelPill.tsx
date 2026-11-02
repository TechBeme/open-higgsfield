"use client";

import { ModelPicker } from "./ModelPicker";
import { asImageModel } from "@/features/catalog/hooks/useRuntimeModels";
import { getEditVariant } from "@/models/capabilities/image-helpers";

interface ImageModelPillProps {
    modelId: string;
    onModelChange: (modelId: string) => void;
    slotFiles: Record<string, File[]>;
}

export function ImageModelPill({ modelId, onModelChange, slotFiles }: ImageModelPillProps) {
    const hasFiles = Object.values(slotFiles).some(files => files.length > 0);
    return <ModelPicker mediaType="image" modelId={modelId} onModelChange={onModelChange}
        filterModel={hasFiles ? model => model.media_slots.some(slot => slot.kind === "image")
            || Boolean(getEditVariant(asImageModel(model))?.slots.some(slot => slot.kind === "image")) : undefined} />;
}

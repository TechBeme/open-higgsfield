"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { VideoModelSelector } from "@/components/studio/VideoModelSelector";
import { PromptComposer } from "@/components/studio/PromptComposer";
import { AttachmentZone } from "@/components/studio/AttachmentZone";
import { SettingsPanel, defaultSettings } from "@/components/studio/SettingsPanel";
import { GenerateButton } from "@/components/studio/GenerateButton";
import { ElementsPanel } from "@/components/studio/ElementsPanel";
import { VIDEO_CAPABILITIES } from "@/models/capabilities/video";
import { getImageRoles, getVideoOverrides, getVideoField, isVideoRequired, isAudioRequired, hasAttachments } from "@/models/capabilities/video-helpers";
import { revalidateVideoTasks } from "@/hooks/useVideoTasks";
import type { SettingsValues } from "@/components/studio/SettingsPanel";
import type { AttachmentItem } from "@/components/studio/AttachmentZone";
import type { ElementState } from "@/components/studio/ElementsPanel";
import type { VideoTask } from "@/types";

const schema = z.object({
  prompt: z.string().max(2000),
});
type FormData = z.infer<typeof schema>;

interface VideoStudioProps {
  reuseTask?: VideoTask | null;
}

export function VideoStudio({ reuseTask }: VideoStudioProps) {
  const t = useTranslations("studio.video");

  const firstModelId = Object.keys(VIDEO_CAPABILITIES)[0];
  const firstModel = VIDEO_CAPABILITIES[firstModelId];

  const [modelId, setModelId] = useState<string>(reuseTask?.model_id ?? firstModelId);
  const [variantId, setVariantId] = useState<string>("");
  const [settings, setSettings] = useState<SettingsValues>(
    defaultSettings(reuseTask?.model_id ? VIDEO_CAPABILITIES[reuseTask.model_id] ?? firstModel : firstModel)
  );
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [elements, setElements] = useState<ElementState[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const model = VIDEO_CAPABILITIES[modelId] ?? firstModel;
  const overrides = getVideoOverrides(modelId);

  const {
    watch,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { prompt: "" },
  });

  const prompt = watch("prompt");

  const handleModelChange = useCallback((newModelId: string, newVariantId: string) => {
    setModelId(newModelId);
    setVariantId(newVariantId);
    const m = VIDEO_CAPABILITIES[newModelId];
    if (m) setSettings(defaultSettings(m, newVariantId));
    setElements([]);
  }, []);

  const onSubmit = async (data: FormData) => {
    setApiError(null);
    setIsSubmitting(true);

    try {
      const body = new FormData();
      body.append("model_id", modelId);
      body.append("variant_id", variantId);
      body.append("prompt", data.prompt);
      body.append("settings", JSON.stringify(settings));

      // Append attachments
      for (const att of attachments) {
        if (att.file) {
          body.append(`file_${att.roleId}`, att.file);
        } else if (att.url) {
          body.append(`url_${att.roleId}`, att.url);
        }
      }

      // Append elements
      if (model.elements && elements.length > 0) {
        body.append("elem_count", String(elements.length));
        for (let i = 0; i < elements.length; i++) {
          const elem = elements[i];
          if (elem.frontal) {
            if (elem.frontal.file) {
              body.append(`file_elem_${i}_frontal`, elem.frontal.file);
            } else if (elem.frontal.url) {
              body.append(`url_elem_${i}_frontal`, elem.frontal.url);
            }
          }
          body.append(`elem_${i}_ref_count`, String(elem.refs.length));
          for (let j = 0; j < elem.refs.length; j++) {
            const ref = elem.refs[j];
            if (ref.file) {
              body.append(`file_elem_${i}_ref_${j}`, ref.file);
            } else if (ref.url) {
              body.append(`url_elem_${i}_ref_${j}`, ref.url);
            }
          }
        }
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        body,
      });

      const json = await res.json();

      if (!res.ok) {
        setApiError(json.error ?? "Unknown error");
      } else {
        revalidateVideoTasks();
      }
    } catch {
      setApiError("Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Model cascade */}
      <VideoModelSelector
        selectedModelId={modelId}
        selectedVariantId={variantId}
        onModelChange={handleModelChange}
      />

      {/* Prompt */}
      <PromptComposer
        value={prompt}
        onChange={(v) => setValue("prompt", v, { shouldValidate: true })}
        onSubmit={() => handleSubmit(onSubmit)()}
        error={errors.prompt?.message}
        placeholder={t("promptPlaceholder")}
        maxLength={model.prompt_max ?? 2000}
        disabled={isSubmitting}
      />

      {/* Attachments — only shown if the model needs them */}
      {hasAttachments(model) && (
        <AttachmentZone
          imageRoles={getImageRoles(model)}
          attachmentRoles={overrides.attachment_roles}
          hasVideoField={!!getVideoField(model)}
          videoRequired={isVideoRequired(model)}
          requiresAudio={isAudioRequired(model)}
          items={attachments}
          onItemsChange={setAttachments}
        />
      )}

      {/* Elements (character/style reference images) */}
      {model.elements && (
        <ElementsPanel elements={elements} onChange={setElements} />
      )}

      {/* Settings */}
      <SettingsPanel
        model={model}
        variantId={variantId}
        values={settings}
        onChange={setSettings}
        hideAspectRatio={attachments.some(a => a.kind === "image")}
      />

      {/* API error */}
      <AnimatePresence>
        {apiError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2"
          >
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{apiError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <GenerateButton isSubmitting={isSubmitting} mode="video" />
    </form>
  );
}

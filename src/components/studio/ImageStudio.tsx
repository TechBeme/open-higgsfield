"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Upload } from "lucide-react";
import { ImageModelSelector } from "@/components/studio/ImageModelSelector";
import { PromptComposer } from "@/components/studio/PromptComposer";
import { GenerateButton } from "@/components/studio/GenerateButton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { IMAGE_CAPABILITIES } from "@/models/capabilities/image";
import { getEditVariant } from "@/models/capabilities/image-helpers";
import { revalidateImageTasks } from "@/hooks/useImageTasks";
import type { ImageTask } from "@/types";

const schema = z.object({
  prompt: z.string().max(2000),
});
type FormData = z.infer<typeof schema>;

interface ImageStudioProps {
  reuseTask?: ImageTask | null;
}

/* ─── Slot uploader sub-component ─── */
interface SlotUploaderProps {
  label: string;
  multiple?: boolean;
  required?: boolean;
  value: File[];
  onChange: (files: File[]) => void;
}

function SlotUploader({ label, multiple, required, value, onChange }: SlotUploaderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    onChange(multiple ? [...value, ...files] : files);
  };

  const removeFile = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <label
        className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors"
      >
        <Upload className="h-4 w-4 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">
          {multiple ? "Click to add files" : "Click to upload"}
        </span>
        <input
          type="file"
          multiple={multiple}
          accept="image/*"
          className="sr-only"
          onChange={handleChange}
        />
      </label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((f, idx) => (
            <div key={idx} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px]">
              <span className="max-w-[120px] truncate">{f.name}</span>
              <button type="button" onClick={() => removeFile(idx)} className="hover:text-destructive">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main component ─── */
export function ImageStudio({ reuseTask }: ImageStudioProps) {
  const t = useTranslations("studio.image");

  const firstModelId = Object.keys(IMAGE_CAPABILITIES)[0];
  const firstModel = IMAGE_CAPABILITIES[firstModelId];

  const [modelId, setModelId] = useState<string>(reuseTask?.model_id ?? firstModelId);
  const [slotFiles, setSlotFiles] = useState<Record<string, File[]>>({});
  const [sizeAspect, setSizeAspect] = useState<string>("");
  const [sizeResolution, setSizeResolution] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const model = IMAGE_CAPABILITIES[modelId] ?? firstModel;

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

  const handleModelChange = useCallback((id: string) => {
    setModelId((prevId) => {
      const prevModel = IMAGE_CAPABILITIES[prevId];
      const nextModel = IMAGE_CAPABILITIES[id];
      // Preserve field values for matching fields
      setFieldValues((prev) => {
        const prevFields = prevModel?.custom_fields ?? [];
        const nextFields = nextModel?.custom_fields ?? [];
        const preserved: Record<string, unknown> = {};
        for (const nf of nextFields) {
          const pf = prevFields.find((f) => f.id === nf.id && f.type === nf.type);
          if (pf && prev[nf.id] !== undefined) {
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
      return id;
    });
    setSlotFiles({});
    const m = IMAGE_CAPABILITIES[id];
    if (m?.size_ui) {
      const supported = m.size_ui.aspect_ratios.map((ar) => `${ar.w}:${ar.h}`);
      setSizeAspect((prev) => supported.includes(prev) ? prev : (m.size_ui!.default_aspect ?? ""));
      const supportedRes = m.size_ui.resolutions.map((r) => r.id);
      setSizeResolution((prev) => supportedRes.includes(prev) ? prev : (m.size_ui!.default_resolution ?? ""));
    }
  }, []);

  const setFieldValue = (id: string, val: unknown) => {
    setFieldValues((prev) => ({ ...prev, [id]: val }));
  };

  const onSubmit = async (data: FormData) => {
    setApiError(null);
    setIsSubmitting(true);

    try {
      const body = new FormData();
      body.append("model_id", modelId);
      body.append("prompt", data.prompt);

      if (model.size_ui) {
        body.append("size_aspect", sizeAspect);
        body.append("size_resolution", sizeResolution);
      }

      body.append("field_values", JSON.stringify(fieldValues));

      // Slot files
      for (const [slotId, files] of Object.entries(slotFiles)) {
        files.forEach((f) => body.append(`slot_${slotId}`, f));
      }

      const res = await fetch("/api/generate-image", {
        method: "POST",
        body,
      });

      const json = await res.json();

      if (!res.ok) {
        setApiError(json.error ?? "Unknown error");
      } else {
        revalidateImageTasks();
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
      <ImageModelSelector
        selectedModelId={modelId}
        onModelChange={handleModelChange}
      />

      {/* Prompt */}
      {model.prompt_required !== false && (
        <PromptComposer
          value={prompt}
          onChange={(v) => setValue("prompt", v, { shouldValidate: true })}
          onSubmit={() => handleSubmit(onSubmit)()}
          error={errors.prompt?.message}
          placeholder={t("promptPlaceholder")}
          disabled={isSubmitting}
        />
      )}

      {/* Slots (including edit_variant slots as optional) */}
      {(() => {
        const editVariant = getEditVariant(model);
        const allSlots = [...model.media_slots, ...(editVariant?.slots ?? []).map(s => ({ ...s, required: false }))];
        return allSlots.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("slots")}
            </p>
            {allSlots.map((slot) => (
              <SlotUploader
                key={slot.id}
                label={slot.label}
                multiple={slot.multiple}
                required={slot.required}
                value={slotFiles[slot.id] ?? []}
                onChange={(files) => setSlotFiles((prev) => ({ ...prev, [slot.id]: files }))}
              />
            ))}
          </div>
        );
      })()}

      {/* Size UI */}
      {model.size_ui && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("size")}
          </p>
          <div className="space-y-2">
            <Label className="text-xs">{t("aspectRatio")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {model.size_ui.aspect_ratios.map((ar) => (
                <button
                  key={ar.id}
                  type="button"
                  onClick={() => setSizeAspect(ar.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${sizeAspect === ar.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/50 hover:border-primary/50"
                    }`}
                >
                  {ar.w}:{ar.h}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{t("resolution")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {model.size_ui.resolutions.map((res) => (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => setSizeResolution(res.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${sizeResolution === res.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/50 hover:border-primary/50"
                    }`}
                >
                  {res.id}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Dynamic fields */}
      {model.custom_fields && model.custom_fields.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("options")}
          </p>
          {model.custom_fields.map((field) => {
            const val = fieldValues[field.id] ?? field.default ?? "";
            if (field.type === "select" && field.options) {
              return (
                <div key={field.id} className="space-y-1">
                  <Label className="text-xs">{field.label}</Label>
                  <Select
                    value={String(val)}
                    onValueChange={(v) => setFieldValue(field.id, v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((o) => (
                        <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            if (field.type === "checkbox") {
              return (
                <div key={field.id} className="flex items-center justify-between">
                  <Label className="text-xs">{field.label}</Label>
                  <Switch
                    checked={Boolean(val)}
                    onCheckedChange={(v) => setFieldValue(field.id, v)}
                  />
                </div>
              );
            }
            if (field.type === "number") {
              return (
                <div key={field.id} className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs">{field.label}</Label>
                    <span className="text-xs text-muted-foreground">{String(val)}</span>
                  </div>
                  <Slider
                    min={field.minimum ?? 0}
                    max={field.maximum ?? 100}
                    step={1}
                    value={[Number(val)]}
                    onValueChange={(v) => setFieldValue(field.id, Array.isArray(v) ? (v as number[])[0] : v)}
                  />
                </div>
              );
            }
            return (
              <div key={field.id} className="space-y-1">
                <Label className="text-xs">{field.label}</Label>
                <Input
                  className="h-8 text-xs"
                  value={String(val)}
                  onChange={(e) => setFieldValue(field.id, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      )}

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

      <GenerateButton isSubmitting={isSubmitting} mode="image" />
    </form>
  );
}

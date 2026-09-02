"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslations } from "next-intl";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { getDurations, getAspectRatios, getSizes, getVideoOverrides } from "@/models/capabilities/video-helpers";

interface SettingsPanelProps {
  model: ModelCapabilities;
  variantId: string;
  values: SettingsValues;
  onChange: (values: SettingsValues) => void;
  hideAspectRatio?: boolean;
}

export interface SettingsValues {
  duration: string;
  aspectRatio: string;
  size: string;
  cfgScale: number;
  negativePrompt: string;
  shotType: string;
  style: string;
  expandPrompt: boolean;
  seed: string;
  fieldValues: Record<string, unknown>;
}

export function defaultSettings(model: ModelCapabilities, variantId?: string): SettingsValues {
  const resolvedVariantId = variantId || (model.resolution_variant ? model.resolution_variant.options?.[0] : undefined);
  const durations = getDurations(model, resolvedVariantId);
  const ratios = getAspectRatios(model, resolvedVariantId) ?? [];
  const sizes = getSizes(model, resolvedVariantId) ?? [];

  const fieldValues: Record<string, unknown> = {};
  model.custom_fields?.forEach((f) => { fieldValues[f.id] = f.default ?? ""; });

  return {
    duration: durations[0] ?? "",
    aspectRatio: ratios[0]?.[0] ?? "",
    size: sizes[0]?.[1] ?? "",
    cfgScale: 0.5,
    negativePrompt: "",
    shotType: "single",
    style: "none",
    expandPrompt: false,
    seed: "-1",
    fieldValues,
  };
}

export function SettingsPanel({ model, variantId, values, onChange, hideAspectRatio }: SettingsPanelProps) {
  const t = useTranslations("studio.video");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const durations = getDurations(model, variantId);
  const ratios = getAspectRatios(model, variantId) ?? [];
  const sizes = getSizes(model, variantId) ?? [];
  const overrides = getVideoOverrides(model.id);

  const styleOptions = ["none", "anime", "3d", "clay", "cyberpunk", "comic"];

  function update(partial: Partial<SettingsValues>) {
    onChange({ ...values, ...partial });
  }

  function updateField(id: string, value: unknown) {
    onChange({ ...values, fieldValues: { ...values.fieldValues, [id]: value } });
  }

  return (
    <div className="space-y-4">
      {/* V2V banner */}
      {overrides.v2v_mode && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          {t("v2vBanner")}
        </div>
      )}

      {/* Duration pills */}
      {durations.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("duration")}</p>
          <div className="flex flex-wrap gap-1.5">
            {durations.map((d) => (
              <button
                key={d}
                onClick={() => update({ duration: d })}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${values.duration === d
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
                  }`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Aspect ratio pills */}
      {ratios.length > 0 && !hideAspectRatio && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("aspectRatio")}</p>
          <div className="flex flex-wrap gap-1.5">
            {ratios.map(([label, value]) => (
              <button
                key={value}
                onClick={() => update({ aspectRatio: value })}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${values.aspectRatio === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Size grid */}
      {sizes.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("size")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {sizes.map(([label, value]) => (
              <button
                key={value}
                onClick={() => update({ size: value })}
                className={`rounded-lg border px-2 py-1.5 text-[11px] text-left transition-colors ${values.size === value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Style selector (PixVerse) */}
      {model.style && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("style")}</p>
          <div className="flex flex-wrap gap-1.5">
            {styleOptions.map((s) => (
              <button
                key={s}
                onClick={() => update({ style: s })}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${values.style === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
                  }`}
              >
                {t(`styles.${s}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CFG Scale */}
      {model.cfg_scale && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">{t("cfgScale")}</p>
            <span className="text-xs font-mono text-muted-foreground">{values.cfgScale.toFixed(2)}</span>
          </div>
          <Slider
            value={[values.cfgScale]}
            min={0} max={1} step={0.01}
            onValueChange={(v) => update({ cfgScale: Array.isArray(v) ? (v as number[])[0] : (v as number) })}
            className="w-full"
          />
        </div>
      )}

      {/* Extra model fields */}
      {model.custom_fields?.map((field) => {
        const val = values.fieldValues[field.id];

        if (field.type === "select") {
          return (
            <div key={field.id}>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{field.label}</Label>
              {field.description && <p className="text-[10px] text-muted-foreground mb-1.5">{field.description}</p>}
              <Select value={String(val ?? field.default ?? "")} onValueChange={(v) => updateField(field.id, v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (field.type === "checkbox") {
          return (
            <div key={field.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <p className="text-xs font-medium">{field.label}</p>
                {field.description && <p className="text-[10px] text-muted-foreground">{field.description}</p>}
              </div>
              <Switch
                checked={Boolean(val ?? field.default)}
                onCheckedChange={(v) => updateField(field.id, v)}
              />
            </div>
          );
        }

        if (field.type === "number") {
          return (
            <div key={field.id}>
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{field.label}</Label>
              {field.description && <p className="text-[10px] text-muted-foreground mb-1.5">{field.description}</p>}
              <Input
                type="number"
                value={String(val ?? field.default ?? "")}
                min={field.minimum}
                max={field.maximum}
                onChange={(e) => updateField(field.id, e.target.value === "" ? null : Number(e.target.value))}
                className="h-8 text-xs"
              />
            </div>
          );
        }

        return null;
      })}

      {/* Advanced settings */}
      {(model.negative_prompt || model.shot_type || model.prompt_expansion) && (
        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t("advanced")}
          </button>

          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-3">
                  {/* Negative prompt */}
                  {model.negative_prompt && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">{t("negativePrompt.label")}</Label>
                      <Input
                        value={values.negativePrompt}
                        onChange={(e) => update({ negativePrompt: e.target.value })}
                        placeholder={t("negativePrompt.placeholder")}
                        className="h-8 text-xs"
                      />
                    </div>
                  )}

                  {/* Shot type */}
                  {model.shot_type && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">{t("shotType")}</Label>
                      <div className="flex gap-1.5">
                        {(["single", "multi"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => update({ shotType: s })}
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${values.shotType === s
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground"
                              }`}
                          >
                            {t(`shotTypes.${s}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expand prompt */}
                  {model.prompt_expansion && (
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <p className="text-xs font-medium">{t("expandPrompt")}</p>
                      <Switch
                        checked={values.expandPrompt}
                        onCheckedChange={(v) => update({ expandPrompt: v })}
                      />
                    </div>
                  )}

                  {/* Seed */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">{t("seed")}</Label>
                    <Input
                      value={values.seed}
                      onChange={(e) => update({ seed: e.target.value })}
                      placeholder="-1"
                      className="h-8 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">{t("seedHint")}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

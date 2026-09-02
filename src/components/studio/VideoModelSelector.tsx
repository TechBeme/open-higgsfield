"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { VIDEO_CAPABILITIES, VIDEO_CAPABILITY_GROUPS } from "@/models/capabilities/video";
import { getResolutionVariants } from "@/models/capabilities/video-helpers";
import { useTranslations } from "next-intl";

interface VideoModelSelectorProps {
  selectedModelId: string;
  selectedVariantId: string;
  onModelChange: (modelId: string, variantId: string) => void;
}

const GROUP_ORDER = ["Kling", "RunWay", "WAN", "MiniMax", "Seedance", "PixVerse", "LTX", "OmniHuman"];

export function VideoModelSelector({ selectedModelId, selectedVariantId, onModelChange }: VideoModelSelectorProps) {
  const t = useTranslations("studio.video");
  const selectedModel = VIDEO_CAPABILITIES[selectedModelId];

  // Get sorted groups
  const groups = GROUP_ORDER.filter((g) => VIDEO_CAPABILITY_GROUPS.includes(g)).concat(
    VIDEO_CAPABILITY_GROUPS.filter((g) => !GROUP_ORDER.includes(g))
  );

  // Get models for selected group
  const selectedGroup = selectedModel?.group ?? groups[0];
  const groupModels = Object.entries(VIDEO_CAPABILITIES).filter(([, m]) => m.group === selectedGroup);

  // Get unique families in this group
  const families = [...new Set(groupModels.map(([, m]) => m.family))];

  // Get models for selected family
  const selectedFamily = selectedModel?.family ?? families[0];
  const familyModels = groupModels.filter(([, m]) => m.family === selectedFamily);

  // Variants (models with same family but different variant)
  const hasMultipleVariants = familyModels.length > 1;

  // Resolution variants for selected model
  const resolutionVariants = selectedModel ? (getResolutionVariants(selectedModel) ?? []) : [];
  const hasResolutionVariants = resolutionVariants.length > 1;

  function handleGroupClick(group: string) {
    const firstModel = Object.entries(VIDEO_CAPABILITIES).find(([, m]) => m.group === group);
    if (!firstModel) return;
    const [id, model] = firstModel;
    const rv = getResolutionVariants(model);
    const varId = rv?.[0]?.id ?? "";
    onModelChange(id, varId);
  }

  function handleFamilyClick(family: string) {
    const model = groupModels.find(([, m]) => m.family === family);
    if (!model) return;
    const [id, m] = model;
    const rv = getResolutionVariants(m);
    const varId = rv?.[0]?.id ?? "";
    onModelChange(id, varId);
  }

  function handleVariantClick(modelId: string) {
    const model = VIDEO_CAPABILITIES[modelId];
    const rv = model ? getResolutionVariants(model) : undefined;
    const varId = rv?.[0]?.id ?? selectedVariantId ?? "";
    onModelChange(modelId, varId);
  }

  function handleResolutionClick(variantId: string) {
    onModelChange(selectedModelId, variantId);
  }

  return (
    <div className="space-y-3">
      {/* Step 1: Provider / Group */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("selectProvider")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((group) => (
            <button
              key={group}
              onClick={() => handleGroupClick(group)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-200 ${selectedGroup === group
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-muted text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
            >
              {group}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Family */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedGroup}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
        >
          <div className="flex items-center gap-1 mb-1.5">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t("selectModel")}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {families.map((family) => {
              const modelEntry = groupModels.find(([, m]) => m.family === family);
              if (!modelEntry) return null;
              return (
                <button
                  key={family}
                  onClick={() => handleFamilyClick(family)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 ${selectedFamily === family
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                >
                  {family}
                </button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Step 2b: Variants (e.g., Pro/Standard within same family) */}
      {hasMultipleVariants && (
        <AnimatePresence mode="wait">
          <motion.div
            key={`${selectedGroup}-${selectedFamily}-variants`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex flex-wrap gap-1.5 pl-4">
              {familyModels.map(([id, m]) => (
                <button
                  key={id}
                  onClick={() => handleVariantClick(id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-all duration-200 ${selectedModelId === id
                    ? "border-primary/70 bg-primary/10 text-primary font-semibold"
                    : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {m.variant || m.label}
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Step 3: Resolution variants */}
      {hasResolutionVariants && (
        <AnimatePresence mode="wait">
          <motion.div
            key={`${selectedModelId}-resolutions`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center gap-1 mb-1.5">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <ChevronRight className="h-3 w-3 text-muted-foreground -ml-2" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("selectVariant")}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {resolutionVariants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleResolutionClick(v.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-all duration-200 ${selectedVariantId === v.id
                    ? "border-primary/70 bg-primary/10 text-primary font-semibold"
                    : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

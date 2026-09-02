"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { IMAGE_CAPABILITIES_LIST, IMAGE_CAPABILITY_GROUPS, getImageCapabilitiesByGroup } from "@/models/capabilities/image";
import type { ImageModelCapability } from "@/models/capabilities/image";
import { useTranslations } from "next-intl";

const GROUP_ORDER = ["Flux", "Seedream", "Z-Image"];
const CATEGORY_COLORS: Record<string, string> = {
  Generate: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  Edit: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Transform: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

interface ImageModelSelectorProps {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
}

export function ImageModelSelector({ selectedModelId, onModelChange }: ImageModelSelectorProps) {
  const t = useTranslations("studio.image");
  const selectedModel = IMAGE_CAPABILITIES_LIST.find((m) => m.id === selectedModelId);

  const groups = GROUP_ORDER.filter((g) => IMAGE_CAPABILITY_GROUPS.includes(g)).concat(
    IMAGE_CAPABILITY_GROUPS.filter((g) => !GROUP_ORDER.includes(g))
  );

  const selectedGroup = selectedModel?.group ?? groups[0];
  const groupModels = getImageCapabilitiesByGroup(selectedGroup);

  function handleGroupClick(group: string) {
    const first = getImageCapabilitiesByGroup(group)[0];
    if (first) onModelChange(first.id);
  }

  return (
    <div className="space-y-3">
      {/* Step 1: Group */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("selectGroup")}
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

      {/* Step 2: Model */}
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
            {groupModels
              .sort((a, b) => (b.sort_key ?? 0) - (a.sort_key ?? 0))
              .map((m: ImageModelCapability) => (
                <button
                  key={m.id}
                  onClick={() => onModelChange(m.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 ${selectedModelId === m.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                >
                  {m.label}
                  {m.category && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${CATEGORY_COLORS[m.category] ?? "bg-muted text-muted-foreground"}`}>
                      {m.category}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

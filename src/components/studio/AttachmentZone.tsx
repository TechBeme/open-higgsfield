"use client";

import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Link2, X, Image as ImageIcon, Video, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type { AttachmentRole, ImageRole } from "@/models/capabilities/video-helpers";

export interface AttachmentItem {
  id: string;
  roleId: string;
  type: "file" | "url";
  file?: File;
  url?: string;
  previewUrl?: string;
  kind: "image" | "video" | "audio";
}

interface AttachmentZoneProps {
  imageRoles?: ImageRole[];
  attachmentRoles?: AttachmentRole[];
  hasVideoField?: boolean;
  videoRequired?: boolean;
  requiresAudio?: boolean;
  items: AttachmentItem[];
  onItemsChange: (items: AttachmentItem[]) => void;
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "video") return <Video className="h-3.5 w-3.5" />;
  if (kind === "audio") return <Music className="h-3.5 w-3.5" />;
  return <ImageIcon className="h-3.5 w-3.5" />;
}

interface RoleSlotProps {
  roleId: string;
  label: string;
  kind: "image" | "video" | "audio";
  required?: boolean;
  items: AttachmentItem[];
  onAdd: (item: AttachmentItem) => void;
  onRemove: (id: string) => void;
}

function RoleSlot({ roleId, label, kind, required, items, onAdd, onRemove }: RoleSlotProps) {
  const t = useTranslations("studio.video");
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlValue, setUrlValue] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const myItems = items.filter((i) => i.roleId === roleId);

  const accept =
    kind === "image" ? "image/*"
      : kind === "video" ? "video/*"
        : "audio/*";

  const addFile = useCallback((file: File) => {
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : undefined;
    onAdd({ id: shortId(), roleId, type: "file", file, previewUrl, kind });
  }, [kind, onAdd, roleId]);

  function addUrl() {
    const url = urlValue.trim();
    if (!url) return;
    onAdd({ id: shortId(), roleId, type: "url", url, kind });
    setUrlValue("");
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      kind === "image" ? f.type.startsWith("image/")
        : kind === "video" ? f.type.startsWith("video/")
          : f.type.startsWith("audio/")
    );
    files.forEach(addFile);
  }, [addFile, kind]);

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <KindIcon kind={kind} />
        <span className="text-xs font-medium">{label}</span>
        {required && <span className="text-[10px] text-destructive">*</span>}
      </div>

      {/* Chips */}
      {myItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence>
            {myItems.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1 rounded-full border bg-background pl-1 pr-2 py-0.5 text-xs"
              >
                {item.previewUrl ? (
                  <Image src={item.previewUrl} alt="" width={20} height={20} className="h-5 w-5 rounded-full object-cover" unoptimized />
                ) : (
                  <KindIcon kind={item.kind} />
                )}
                <span className="max-w-[80px] truncate">
                  {item.file?.name ?? item.url?.split("/").pop() ?? "file"}
                </span>
                <button
                  onClick={() => onRemove(item.id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Tabs defaultValue="upload">
        <TabsList className="h-6 text-[10px] gap-0 p-0.5">
          <TabsTrigger value="upload" className="h-5 px-2 text-[10px]">{t("uploadFile")}</TabsTrigger>
          <TabsTrigger value="url" className="h-5 px-2 text-[10px]">URL</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-1.5">
          <div
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-3 cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50"}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <Upload className="h-4 w-4 text-muted-foreground mb-1" />
            <span className="text-[10px] text-muted-foreground">{t("dragHint")}</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) Array.from(e.target.files).forEach(addFile);
              e.target.value = "";
            }}
          />
        </TabsContent>

        <TabsContent value="url" className="mt-1.5">
          <div className="flex gap-1.5">
            <Input
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder={t("urlPlaceholder")}
              className="h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") addUrl();
              }}
            />
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={addUrl}>
              <Link2 className="h-3 w-3" />
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function AttachmentZone({
  imageRoles = [],
  attachmentRoles = [],
  hasVideoField = false,
  videoRequired = false,
  requiresAudio = false,
  items,
  onItemsChange,
}: AttachmentZoneProps) {
  const t = useTranslations("studio.video");
  const tCommon = useTranslations("common");

  function handleAdd(item: AttachmentItem) {
    onItemsChange([...items, item]);
  }

  function handleRemove(id: string) {
    onItemsChange(items.filter((i) => i.id !== id));
  }

  const slots: { roleId: string; label: string; kind: "image" | "video" | "audio"; required?: boolean }[] = [];

  if (imageRoles.length > 0) {
    imageRoles.forEach((r) => slots.push({ roleId: r.id, label: r.label, kind: "image" }));
  } else {
    // Default single image slot if model has image_field
    slots.push({ roleId: "__image__", label: tCommon("image"), kind: "image" });
  }

  if (hasVideoField) {
    slots.push({ roleId: "__video__", label: tCommon("referenceVideo"), kind: "video", required: videoRequired });
  }

  if (requiresAudio) {
    slots.push({ roleId: "__audio__", label: tCommon("audio"), kind: "audio", required: true });
  }

  if (attachmentRoles.length > 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("attachments")}</p>
        {attachmentRoles.map((role) => (
          <RoleSlot
            key={role.id}
            roleId={role.id}
            label={role.label}
            kind={role.kind}
            required={role.required}
            items={items}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("attachments")}</p>
      {slots.map((s) => (
        <RoleSlot
          key={s.roleId}
          roleId={s.roleId}
          label={s.label}
          kind={s.kind}
          required={s.required}
          items={items}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

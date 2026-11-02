"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileAudio, Image as ImageIcon, Link2, Upload, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModelCopy } from "@/i18n/use-model-copy";
import { FileThumbnail } from "./FileThumbnail";

export interface ReferenceItem { id: string; file?: File; url?: string; }

export function ReferenceUpload({ slotId, label: rawLabel, description, kind, required, maxCount, allowUrl = true, items, onAdd, onRemove }: {
    slotId: string; label: string; description?: string; kind: "image" | "video" | "audio"; required?: boolean;
    maxCount: number; allowUrl?: boolean; items: ReferenceItem[];
    onAdd: (items: Omit<ReferenceItem, "id">[]) => void; onRemove: (id: string) => void;
}) {
    const t = useTranslations("commandBar");
    const { slotLabel, description: translateDescription } = useModelCopy();
    const label = slotLabel(slotId, rawLabel);
    const id = useId();
    const fileRef = useRef<HTMLInputElement>(null);
    const urlRef = useRef<HTMLInputElement>(null);
    const [url, setUrl] = useState("");
    const [showUrl, setShowUrl] = useState(false);
    const [error, setError] = useState("");
    const Icon = kind === "video" ? Video : kind === "audio" ? FileAudio : ImageIcon;
    const remaining = Math.max(0, maxCount - items.length);

    function addUrl() {
        try {
            const parsed = new URL(url.trim());
            if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname.includes(".")) throw new Error();
            onAdd([{ url: parsed.href }]); setUrl(""); setShowUrl(false); setError("");
        } catch { setError(t("invalidUrl")); urlRef.current?.focus(); }
    }

    return <section aria-labelledby={id} className="min-w-0 space-y-3 rounded-xl border border-white/15 bg-white/[.025] p-3">
        <div className="flex flex-wrap items-center gap-2"><Icon className="size-4 text-muted-foreground" /><h3 id={id} className="min-w-0 flex-1 text-sm font-medium">{label}</h3><span className={`text-[11px] ${required ? "text-amber-200" : "text-muted-foreground"}`}>{t(required ? "required" : "optional")}</span></div>
        {description && <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{translateDescription(description)}</p>}
        {items.map(item => <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-black/20 pl-2 text-xs">
            {item.file && kind === "image" && <FileThumbnail file={item.file} className="size-8 shrink-0 rounded-md object-cover" />}
            {item.url && <Link2 className="size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate" title={item.file?.name ?? item.url}>{item.file?.name ?? t("urlReference")}</span>
            <Button type="button" variant="ghost" size="icon" aria-label={t("removeAttachment", { name: item.file?.name ?? label })} onClick={() => onRemove(item.id)}><X /></Button>
        </div>)}
        {remaining > 0 && <div className="flex gap-2"><Button type="button" variant="outline" className="flex-1 border-dashed" onClick={() => fileRef.current?.click()}><Upload />{t("upload")}</Button>{allowUrl && <Button type="button" variant="outline" aria-expanded={showUrl} onClick={() => { setShowUrl(!showUrl); setError(""); }}><Link2 />{t("url")}</Button>}</div>}
        {showUrl && remaining > 0 && <div><div className="flex gap-2"><Input ref={urlRef} type="url" aria-label={`${t("referenceUrl")} - ${label}`} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} value={url} onChange={event => { setUrl(event.target.value); setError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); addUrl(); } }} placeholder={t("urlPlaceholder")} className="min-w-0 flex-1" /><Button type="button" disabled={!url.trim()} onClick={addUrl}>{t("add")}</Button></div>{error && <p role="alert" id={`${id}-error`} className="mt-2 text-xs text-destructive">{error}</p>}</div>}
        <input ref={fileRef} type="file" aria-label={`${t("upload")} - ${label}`} multiple={maxCount > 1} accept={`${kind}/*`} hidden onChange={event => {
            const files = Array.from(event.target.files ?? []).filter(file => file.type.startsWith(`${kind}/`)).slice(0, remaining);
            if (files.length) onAdd(files.map(file => ({ file })));
            event.target.value = "";
        }} />
    </section>;
}

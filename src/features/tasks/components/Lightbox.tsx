"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface PreviewItem { url: string; downloadUrl: string; model: string; prompt?: string; mediaType: "image" | "video"; }

export function Lightbox({ items, index, onClose, onNext, onPrev, returnFocus }: {
    items: PreviewItem[]; index: number; onClose: () => void; onNext: () => void; onPrev: () => void;
    returnFocus: React.RefObject<HTMLElement | null>;
}) {
    const t = useTranslations("tasks");
    const [muted, setMuted] = useState(true);
    const item = items[index];
    const isVideo = item.mediaType === "video";
    return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent finalFocus={returnFocus} closeLabel={t("close")} onKeyDownCapture={event => {
            if (items.length < 2 || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLVideoElement) return;
            if (event.key === "ArrowRight") { event.preventDefault(); onNext(); }
            if (event.key === "ArrowLeft") { event.preventDefault(); onPrev(); }
        }} className="flex max-h-[94dvh] w-[calc(100%-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-2xl bg-[#101214] p-0 sm:max-w-6xl">
            <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-4 pr-14 sm:px-6 sm:pr-16"><div className="min-w-0"><DialogTitle className="truncate text-sm font-semibold">{item.model || t("previewTitle")}</DialogTitle><DialogDescription className="mt-1 text-xs">{t("previewPosition", { current: index + 1, total: items.length })}</DialogDescription></div><div className="flex shrink-0 gap-1">{isVideo && <Button type="button" variant="ghost" size="icon" aria-label={t(muted ? "unmute" : "mute")} onClick={() => setMuted(!muted)}>{muted ? <VolumeX /> : <Volume2 />}</Button>}<a href={item.downloadUrl} download aria-label={t(isVideo ? "downloadVideo" : "downloadImage")} className={buttonVariants({ variant: "ghost", size: "icon" })}><Download className="size-4" /></a></div></div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40">
                {isVideo ? <video key={item.url} src={item.url} className="max-h-[62dvh] min-h-40 w-full object-contain" playsInline muted={muted} controls preload="metadata" />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={item.url} alt={t("imageAlt", { index: index + 1 })} className="max-h-[62dvh] min-h-40 w-full object-contain" />}
            </div>
            <div className="flex items-center gap-3 border-t border-white/10 p-4 sm:px-6">{items.length > 1 && <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t("previous")} onClick={onPrev}><ChevronLeft /></Button>}<div className="min-w-0 flex-1"><p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.prompt || item.model}</p></div>{items.length > 1 && <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t("next")} onClick={onNext}><ChevronRight /></Button>}</div>
        </DialogContent>
    </Dialog>;
}

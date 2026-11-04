"use client";

import { useRef, useState } from "react";
import { ImageViewport } from "./ImageViewport";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, ClipboardCopy, Copy, Download, ImagePlus, Trash2, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface PreviewItem { url: string; downloadUrl: string; model: string; prompt?: string; mediaType: "image" | "video"; }
/** What the open preview can do with its item; each action closes the preview except copying and downloading. */
export interface LightboxActions {
    onReusePrompt?: (item: PreviewItem) => void;
    onSendImage?: (item: PreviewItem, target: "reference" | "start" | "end") => void;
    onDelete?: (item: PreviewItem) => void;
}

// Labels stay visible on wide screens; narrower dialogs keep the icons and expose the label to assistive tech.
const label = "max-lg:sr-only";

export function Lightbox({ items, index, onClose, onNext, onPrev, returnFocus, actions = {} }: {
    items: PreviewItem[]; index: number; onClose: () => void; onNext: () => void; onPrev: () => void;
    returnFocus: React.RefObject<HTMLElement | null>; actions?: LightboxActions;
}) {
    const t = useTranslations("tasks");
    const [muted, setMuted] = useState(true);
    const [copied, setCopied] = useState<{ url: string; ok: boolean } | null>(null);
    const menuHost = useRef<HTMLDivElement>(null);
    const item = items[index];
    const isVideo = item.mediaType === "video";
    const { onReusePrompt, onSendImage, onDelete } = actions;
    const copyState = copied?.url === item.url ? copied : null;
    const then = (run: () => void) => { onClose(); run(); };
    function copyPrompt() {
        if (!item.prompt) return;
        const url = item.url;
        const done = (ok: boolean) => { setCopied({ url, ok }); setTimeout(() => setCopied(current => current?.url === url ? null : current), 2000); };
        try { navigator.clipboard.writeText(item.prompt).then(() => done(true), () => done(false)); } catch { done(false); }
    }
    return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent finalFocus={returnFocus} closeLabel={t("close")} onKeyDown={event => {
            if (items.length < 2 || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLVideoElement || (event.target as HTMLElement).closest('[role="menu"]')) return;
            if (event.key === "ArrowRight") { event.preventDefault(); onNext(); }
            if (event.key === "ArrowLeft") { event.preventDefault(); onPrev(); }
        }} className="flex max-h-[94dvh] w-[calc(100%-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-2xl bg-[#101214] p-0 sm:max-w-6xl">
            <div ref={menuHost} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/10 px-4 py-3 pr-14 sm:flex-nowrap sm:px-6 sm:pr-16">
                <div className="min-w-0 max-sm:w-full"><DialogTitle className="truncate text-sm font-semibold">{item.model || t("previewTitle")}</DialogTitle><DialogDescription className="mt-1 text-xs">{t("previewPosition", { current: index + 1, total: items.length })}</DialogDescription></div>
                <div role="toolbar" aria-label={t("previewActions")} className="flex shrink-0 items-center gap-0.5 max-sm:-ml-2.5 sm:gap-1">
                    {!isVideo && onSendImage && <Button type="button" variant="ghost" size="sm" title={t("useAsReference")} onClick={() => then(() => onSendImage(item, "reference"))}><ImagePlus /><span className={label}>{t("reference")}</span></Button>}
                    {!isVideo && onSendImage && <DropdownMenu>
                        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" title={t("animate")} />}><Clapperboard /><span className={label}>{t("animate")}</span><ChevronDown className="opacity-70" /></DropdownMenuTrigger>
                        <DropdownMenuContent container={menuHost} align="end" className="w-44 p-1.5">
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="px-2 py-1 text-[11px] text-muted-foreground">{t("framePlacement")}</DropdownMenuLabel>
                                <DropdownMenuItem className="min-h-9" onClick={() => then(() => onSendImage(item, "start"))}>{t("startFrame")}</DropdownMenuItem>
                                <DropdownMenuItem className="min-h-9" onClick={() => then(() => onSendImage(item, "end"))}>{t("endFrame")}</DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>}
                    {item.prompt && onReusePrompt && <Button type="button" variant="ghost" size="sm" title={t("reusePrompt")} onClick={() => then(() => onReusePrompt(item))}><Copy /><span className={label}>{t("reusePrompt")}</span></Button>}
                    {item.prompt && <Button type="button" variant="ghost" size="sm" title={t("copyPrompt")} onClick={copyPrompt}>
                        {copyState?.ok ? <Check className="text-primary" /> : <ClipboardCopy />}<span className={label}>{copyState ? t(copyState.ok ? "promptCopied" : "copyFailed") : t("copyPrompt")}</span>
                    </Button>}
                    {isVideo && <Button type="button" variant="ghost" size="icon-sm" aria-label={t(muted ? "unmute" : "mute")} onClick={() => setMuted(!muted)}>{muted ? <VolumeX /> : <Volume2 />}</Button>}
                    <a href={item.downloadUrl} download aria-label={t(isVideo ? "downloadVideo" : "downloadImage")} title={t(isVideo ? "downloadVideo" : "downloadImage")} className={buttonVariants({ variant: "ghost", size: "sm" })}><Download /><span aria-hidden="true" className="max-lg:hidden">{t("download")}</span></a>
                    {onDelete && <Button type="button" variant="ghost" size="icon-sm" aria-label={t("delete")} title={t("delete")} className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(item)}><Trash2 /></Button>}
                </div>
            </div>
            <p role="status" aria-live="polite" className="sr-only">{copyState ? t(copyState.ok ? "promptCopied" : "copyFailed") : ""}</p>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40">
                {isVideo ? <video key={item.url} src={item.url} className="max-h-[62dvh] min-h-40 w-full object-contain" playsInline muted={muted} controls preload="metadata" />
                    : <ImageViewport key={item.url} src={item.url} alt={t("imageAlt", { index: index + 1 })} />}
            </div>
            <div className="flex items-center gap-3 border-t border-white/10 p-4 sm:px-6">{items.length > 1 && <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t("previous")} onClick={onPrev}><ChevronLeft /></Button>}<div className="min-w-0 flex-1"><p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{item.prompt || item.model}</p></div>{items.length > 1 && <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t("next")} onClick={onNext}><ChevronRight /></Button>}</div>
        </DialogContent>
    </Dialog>;
}

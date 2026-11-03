"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff, Maximize, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface View { scale: number; x: number; y: number }
const initial: View = { scale: 1, x: 0, y: 0 };

/** Pointer capture keeps panning and two-finger pinch gestures within the preview. */
export function ImageViewport({ src, alt }: { src: string; alt: string }) {
    const t = useTranslations("tasks");
    const viewport = useRef<HTMLDivElement>(null);
    const current = useRef(initial);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const [view, setView] = useState(initial);
    const [failed, setFailed] = useState(false);
    function update(next: View) {
        const scale = Math.min(5, Math.max(1, next.scale));
        const width = viewport.current?.clientWidth ?? 0;
        const height = viewport.current?.clientHeight ?? 0;
        const x = Math.max(-width * (scale - 1) / 2, Math.min(width * (scale - 1) / 2, next.x));
        const y = Math.max(-height * (scale - 1) / 2, Math.min(height * (scale - 1) / 2, next.y));
        current.current = { scale, x, y };
        setView(current.current);
    }
    function zoom(factor: number) { update({ ...current.current, scale: current.current.scale * factor }); }
    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            update({ ...current.current, scale: current.current.scale * Math.exp(-event.deltaY * .002) });
        };
        element.addEventListener("wheel", wheel, { passive: false });
        return () => element.removeEventListener("wheel", wheel);
    }, []);

    return <div className="min-h-0 w-full">
        <div ref={viewport} role="region" aria-label={t("zoomRegion")} tabIndex={0} data-image-viewport data-zoom={view.scale.toFixed(2)}
            className={`relative flex h-[48dvh] min-h-40 touch-none items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:h-[60dvh] ${view.scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
            onKeyDown={event => {
                if (["+", "=", "-", "0"].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation();
                    if (event.key === "0") update(initial); else zoom(event.key === "-" ? 1 / 1.25 : 1.25);
                } else if (current.current.scale > 1 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation();
                    update({ ...current.current, x: current.current.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0), y: current.current.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) });
                }
            }}
            onDoubleClick={() => update(current.current.scale > 1 ? initial : { scale: 2, x: 0, y: 0 })}
            onPointerDown={event => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            }}
            onPointerMove={event => {
                if (!pointers.current.has(event.pointerId)) return;
                const before = [...pointers.current.values()];
                const previous = pointers.current.get(event.pointerId)!;
                pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const after = [...pointers.current.values()];
                if (before.length === 2) {
                    const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                    const oldDistance = distance(before);
                    if (oldDistance > 0) update({ ...current.current, scale: current.current.scale * distance(after) / oldDistance });
                } else update({ ...current.current, x: current.current.x + event.clientX - previous.x, y: current.current.y + event.clientY - previous.y });
            }}
            onPointerUp={event => pointers.current.delete(event.pointerId)} onPointerCancel={event => pointers.current.delete(event.pointerId)} onLostPointerCapture={event => pointers.current.delete(event.pointerId)}>
            {failed ? <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><ImageOff className="size-5" />{t("previewFailed")}</div>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={src} alt={alt} referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className="h-full w-full select-none object-contain" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />}
        </div>
        <div role="group" aria-label={t("zoomControls")} className="flex items-center justify-center gap-2 border-t border-white/10 bg-black/20 px-3 py-2">
            <Button type="button" variant="ghost" size="icon" disabled={failed || view.scale <= 1} aria-label={t("zoomOut")} onClick={() => zoom(1 / 1.25)}><Minus /></Button>
            <span aria-live="polite" className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(view.scale * 100)}%</span>
            <Button type="button" variant="ghost" size="icon" disabled={failed || view.scale >= 5} aria-label={t("zoomIn")} onClick={() => zoom(1.25)}><Plus /></Button>
            <Button type="button" variant="ghost" disabled={failed} onClick={() => update(initial)}><Maximize />{t("zoomReset")}</Button>
        </div>
    </div>;
}

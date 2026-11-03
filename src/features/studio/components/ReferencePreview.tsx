"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { Lightbox } from "@/features/tasks/components/Lightbox";

export function ReferencePreview(props: { file?: File; url?: string; kind?: string; className?: string }) {
    return <ReferenceImage key={props.url ?? `${props.file?.name}-${props.file?.lastModified}`} {...props} />;
}

function ReferenceImage({ file, url, kind = "image", className = "size-[50px]" }: { file?: File; url?: string; kind?: string; className?: string }) {
    const t = useTranslations("commandBar");
    const image = useRef<HTMLImageElement>(null);
    const opener = useRef<HTMLButtonElement>(null);
    const source = useRef(url ?? "");
    const [preview, setPreview] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!file || kind !== "image") return;
        const objectUrl = URL.createObjectURL(file);
        source.current = objectUrl;
        if (image.current) image.current.src = objectUrl;
        return () => URL.revokeObjectURL(objectUrl);
    }, [file, kind]);
    if (kind !== "image") return <div className={`${className} grid shrink-0 place-items-center rounded-lg border border-white/15 bg-white/5`}><Paperclip aria-hidden="true" className="size-5 text-muted-foreground" /></div>;
    return <>
        <button ref={opener} type="button" aria-label={t("previewReference", { name: file?.name ?? t("urlReference") })} onClick={() => { if (source.current) setPreview(source.current); }} title={file?.name ?? url}
            className={`${className} relative grid shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-lg border border-white/15 bg-white/5 hover:border-primary/60`}>
            {failed ? <ImageOff aria-label={t("previewUnavailable")} className="size-5 text-muted-foreground" />
                // eslint-disable-next-line @next/next/no-img-element
                : <img ref={image} src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />}
        </button>
        {preview && <Lightbox items={[{ url: preview, downloadUrl: preview, model: t("referencePreview"), prompt: file?.name ?? url, mediaType: "image" }]} index={0} onClose={() => setPreview(null)} onNext={() => {}} onPrev={() => {}} returnFocus={opener} />}
    </>;
}

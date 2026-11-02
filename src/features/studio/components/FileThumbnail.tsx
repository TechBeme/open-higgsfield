"use client";

import { useEffect, useRef } from "react";

export function FileThumbnail({ file, className }: { file: File; className: string }) {
    const image = useRef<HTMLImageElement>(null);
    useEffect(() => {
        const url = URL.createObjectURL(file);
        if (image.current) image.current.src = url;
        return () => URL.revokeObjectURL(url);
    }, [file]);

    // Local blob previews need no image optimization; the effect owns their URL lifetime.
    // eslint-disable-next-line @next/next/no-img-element
    return <img ref={image} alt="" className={className} />;
}

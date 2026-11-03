import "server-only";

import sharp from "sharp";
import { withAbort } from "./safe-url";
import { assertInputFileSize, IMAGE_MAX_PIXELS } from "./transfer";

/** Render vector-provider results to PNG; never serve active SVG as workspace HTML. */
export async function rasterizeVectorOutput(data: Buffer, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    assertInputFileSize(data.length, "image/svg+xml");
    // Keep XML entities/includes out of the decoder. Passing only a buffer also
    // gives librsvg no base URI, so external file references cannot resolve.
    if (data.includes(0) || /<!\s*(?:DOCTYPE|ENTITY)\b|<\s*(?:\w+:)?include\b/i.test(data.toString("utf8"))) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
    const image = sharp(data, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "error", unlimited: false }).timeout({ seconds: 10 });
    const abort = () => image.destroy();
    signal.addEventListener("abort", abort, { once: true });
    try {
        const metadata = await withAbort(image.metadata(), signal);
        if (metadata.format !== "svg" || !metadata.width || !metadata.height || metadata.width * metadata.height > IMAGE_MAX_PIXELS) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
        const png = await withAbort(image.png().toBuffer(), signal);
        assertInputFileSize(png.length, "image/png");
        return png;
    } finally { signal.removeEventListener("abort", abort); image.destroy(); }
}

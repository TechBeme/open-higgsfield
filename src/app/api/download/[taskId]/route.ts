import { NextRequest, NextResponse } from "next/server";
import { getTask, initStore } from "@/lib/task-store";
import path from "path";
import fs from "fs";
import mime from "mime-types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  await initStore();
  const task = getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const isImage = task.media_type === "image";
  const paths: string[] = ((task as unknown as Record<string, unknown>).result_paths as string[] | undefined) ?? [];
  const urls: string[] = ((task as unknown as Record<string, unknown>).result_urls as string[] | undefined) ?? [];

  const dataUrlResponse = (value: string, attachment: boolean) => {
    const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
    if (!match) return null;
    const mimeType = match[1];
    const buf = Buffer.from(match[2], "base64");
    const extension = mime.extension(mimeType) || "bin";
    return new NextResponse(buf, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${taskId}.${extension}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  };

  if (isImage) {
    const indexParam = req.nextUrl.searchParams.get("index");
    if (indexParam !== null) {
      const idx = Number(indexParam);
      if (!Number.isInteger(idx) || idx < 0 || idx >= Math.max(paths.length, urls.length)) {
        return NextResponse.json({ error: "Invalid image index" }, { status: 400 });
      }
      const imagePath = paths[idx];
      if (imagePath && fs.existsSync(imagePath)) {
        const buf = fs.readFileSync(imagePath);
        const mimeType = mime.lookup(imagePath) || "image/png";
        const filename = path.basename(imagePath);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": mimeType,
            "Content-Disposition": `inline; filename="${filename}"`,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      return dataUrlResponse(urls[idx] ?? "", false)
        ?? NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // If multiple images → zip, if single → direct download
    if (paths.length === 1) {
      if (!fs.existsSync(paths[0])) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      const buf = fs.readFileSync(paths[0]);
      const mimeType = mime.lookup(paths[0]) || "image/png";
      const filename = path.basename(paths[0]);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }
    if (paths.length === 0 && urls.length === 1) {
      return dataUrlResponse(urls[0], true)
        ?? NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (paths.length > 1) {
      // Return JSON list of download URLs for multi-image
      const urls = paths.map(
        (_p, i) => `/api/download/${taskId}?index=${i}`
      );
      return NextResponse.json({ urls });
    }
    return NextResponse.json({ error: "No images found" }, { status: 404 });
  }

  // Video
  const videoPath: string | undefined = (task as unknown as Record<string, unknown>).video_path as string | undefined;
  if (!videoPath || !fs.existsSync(videoPath)) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const videoMime = mime.lookup(videoPath) || "video/mp4";
  const rangeHeader = req.headers.get("range");

  // Support Range requests for proper video streaming / seeking
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(videoPath, { start, end });
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });
    return new Response(readable, {
      status: 206,
      headers: {
        "Content-Type": videoMime,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": String(chunkSize),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const buf = fs.readFileSync(videoPath);
  const disposition = inline ? "inline" : `attachment; filename="video_${taskId}${path.extname(videoPath) || ".mp4"}"`;
  return new NextResponse(buf, {
    headers: {
      "Content-Type": videoMime,
      "Content-Disposition": disposition,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
    },
  });
}

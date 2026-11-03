import { NextRequest, NextResponse } from "next/server";
import { guardWorkspaceRequest } from "@/server/security/workspace-access";
import { readBoundedJson, requestFailure } from "@/server/http/request-limits";
import { mutateGallery } from "@/server/tasks/store";
import { parseGalleryMutation } from "@/lib/gallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    let mutation: ReturnType<typeof parseGalleryMutation>;
    try { mutation = parseGalleryMutation(await readBoundedJson(request, 160_000)); }
    catch (error) { return error instanceof Error && error.message === "ERR_GALLERY_INVALID_REQUEST"
        ? NextResponse.json({ error: error.message }, { status: 400 }) : requestFailure(error); }
    try {
        const rankBase = await mutateGallery(mutation.action, mutation.mediaType, mutation.items);
        return NextResponse.json({ ok: true, items: mutation.items, rankBase }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        const code = error instanceof Error ? error.message : "";
        return NextResponse.json({ error: ["ERR_GALLERY_CONFLICT", "ERR_GALLERY_INVALID_REQUEST"].includes(code) ? code : "ERR_TASK_STORAGE_UNAVAILABLE" },
            { status: code === "ERR_GALLERY_CONFLICT" ? 409 : code === "ERR_GALLERY_INVALID_REQUEST" ? 400 : 503 });
    }
}

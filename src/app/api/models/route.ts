import { NextResponse } from "next/server";
import { VIDEO_CAPABILITIES, VIDEO_CAPABILITY_GROUPS } from "@/models/capabilities/video";

export async function GET() {
    return NextResponse.json({
        models: VIDEO_CAPABILITIES,
        groups: VIDEO_CAPABILITY_GROUPS,
    });
}

import { NextResponse } from "next/server";
import { IMAGE_CAPABILITIES_LIST, IMAGE_CAPABILITY_GROUPS } from "@/models/capabilities/image";

export async function GET() {
    return NextResponse.json({
        models: IMAGE_CAPABILITIES_LIST,
        groups: IMAGE_CAPABILITY_GROUPS,
    });
}

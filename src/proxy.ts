import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { applyWorkspaceHeaders, guardSchedulerRequest, guardWorkspaceRequest } from "@/lib/workspace-access";

const localize = createMiddleware(routing);

export default function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    if (pathname === "/api/health") return NextResponse.next();
    const denial = pathname === "/api/internal/process-tasks"
        ? guardSchedulerRequest(request) : guardWorkspaceRequest(request);
    if (denial) return denial;
    const response = pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.includes(".")
        ? NextResponse.next() : localize(request);
    return applyWorkspaceHeaders(response);
}

export const config = {
    matcher: ["/((?!_next/static/|_next/webpack-hmr$).*)"],
};

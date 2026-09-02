import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

export const config = {
    // Match all routes except API routes, static files, and Next.js internals
    matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

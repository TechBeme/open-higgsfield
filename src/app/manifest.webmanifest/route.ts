import { getTranslations } from "next-intl/server";
import { defaultLocale } from "@/i18n/locales";
import { localizedManifest } from "@/i18n/metadata";

// Keep the old URL available without overriding each page's localized manifest link.
export async function GET() {
    const t = await getTranslations({ locale: defaultLocale, namespace: "metadata" });
    return Response.json(localizedManifest(defaultLocale, t), {
        headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, no-store" },
    });
}

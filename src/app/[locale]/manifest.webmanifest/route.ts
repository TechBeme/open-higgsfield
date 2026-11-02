import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { locales } from "@/i18n/locales";
import { localizedManifest } from "@/i18n/metadata";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    if (!hasLocale(locales, locale)) return new Response(null, { status: 404 });
    const t = await getTranslations({ locale, namespace: "metadata" });
    return Response.json(localizedManifest(locale, t), {
        headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, no-store" },
    });
}

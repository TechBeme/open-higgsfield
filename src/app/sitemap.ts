import type { MetadataRoute } from "next";
import { locales } from "@/i18n/locales";

export default function sitemap(): MetadataRoute.Sitemap {
    const languages = Object.fromEntries(locales.map(locale => [locale, `https://openhiggs.techbe.me/${locale}`]));
    return locales.map(locale => ({ url: languages[locale], changeFrequency: "weekly", priority: 1, alternates: { languages } }));
}

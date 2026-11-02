import type { MetadataRoute } from "next";
import type { AppLocale } from "./locales";

export function localizedManifest(locale: AppLocale, t: (key: string) => string): MetadataRoute.Manifest {
    return {
        id: "/", name: t("appName"), short_name: "Open-Higgsfield", description: t("description"),
        lang: locale, start_url: `/${locale}`, scope: "/", display: "standalone",
        background_color: "#060606", theme_color: "#d5ff47",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    };
}

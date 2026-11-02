export const locales = ["en", "pt-BR", "es"] as const;
export type AppLocale = typeof locales[number];
export const defaultLocale: AppLocale = "pt-BR";
export const localeLabels: Record<AppLocale, string> = { en: "EN", "pt-BR": "PT", es: "ES" };
export const openGraphLocales: Record<AppLocale, string> = { en: "en_US", "pt-BR": "pt_BR", es: "es_ES" };

"use client";

import { Check, Cloud, Image as ImageIcon, Languages } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MotionConfig } from "framer-motion";
import { useRef } from "react";
import { Link as LocaleLink, usePathname as useLocalePathname } from "@/i18n/navigation";
import { locales, localeLabels, type AppLocale } from "@/i18n/locales";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
    const header = useRef<HTMLElement>(null);
    const pathname = usePathname();
    const localePathname = useLocalePathname();
    const params = useSearchParams();
    const locale = useLocale();
    const t = useTranslations("workspace");
    const languages = useTranslations("languages");
    const inSettings = pathname.includes("/settings");
    const destinations = [
        { label: t("studio"), href: `/${locale}`, icon: ImageIcon, active: !inSettings },
        { label: t("providers"), href: `/${locale}/settings`, icon: Cloud, active: inSettings },
    ];
    const languageUrl = `${localePathname}${params.size ? `?${params}` : ""}`;

    return <MotionConfig reducedMotion="user">
        <div className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background">
            <a href="#workspace-content" className="sr-only z-[100] rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3">{t("skip")}</a>
            <header ref={header} data-workspace-header className="shrink-0 border-b border-white/[.08] bg-[#0b0c0d]">
                <div className="mx-auto grid h-[72px] max-w-[1600px] grid-cols-[minmax(32px,1fr)_auto_minmax(32px,1fr)] items-center gap-1 px-3 sm:gap-3 sm:px-6 lg:px-8">
                    <Link href={`/${locale}`} aria-label={t("home")} className="flex w-fit items-center gap-2 rounded-lg">
                        <Image src="/icon.svg" width={40} height={40} alt="" className="size-8 md:size-10" priority />
                        <span className="hidden text-sm font-semibold tracking-tight text-white lg:block">Open<span className="text-primary">Higgsfield</span></span>
                    </Link>
                    <nav aria-label={t("navigation")} className="flex gap-1 rounded-2xl border border-white/10 bg-white/[.025] p-1">
                        {destinations.map(({ label, href, icon: Icon, active }) => <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex h-10 items-center justify-center gap-2 rounded-xl px-2.5 text-xs font-semibold transition-colors sm:h-11 sm:min-w-32 sm:px-5 sm:text-sm ${active ? "bg-primary/[.12] text-primary ring-1 ring-inset ring-primary/25" : "text-muted-foreground hover:bg-white/[.05] hover:text-white"}`}>
                            <Icon aria-hidden="true" className="hidden size-4 min-[370px]:block" />{label}
                        </Link>)}
                    </nav>
                    <div className="flex justify-end">
                        <DropdownMenu><DropdownMenuTrigger aria-label={t("language")} title={t("language")} className="flex min-h-10 items-center gap-1 rounded-xl px-1.5 text-xs font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground sm:px-3"><Languages aria-hidden="true" className="hidden size-4 sm:block" />{localeLabels[locale as AppLocale]}</DropdownMenuTrigger>
                            <DropdownMenuContent container={header} align="end" className="w-44 p-1.5">
                                {locales.map(code => <DropdownMenuItem key={code} render={<LocaleLink href={languageUrl} locale={code} />} className="min-h-11 rounded-lg px-3" aria-current={locale === code ? "true" : undefined}>{languages(code)}{locale === code && <Check aria-hidden="true" className="ml-auto size-4 text-primary" />}</DropdownMenuItem>)}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </header>
            <main id="workspace-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 outline-none">{children}</main>
        </div>
    </MotionConfig>;
}

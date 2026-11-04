"use client";

import { Check, Cloud, Image as ImageIcon, Languages } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MotionConfig } from "framer-motion";
import { useRef, useState } from "react";
import { ToolbarSlotContext } from "./toolbar-slot";
import { Link as LocaleLink, usePathname as useLocalePathname } from "@/i18n/navigation";
import { locales, localeLabels, type AppLocale } from "@/i18n/locales";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
    const header = useRef<HTMLElement>(null);
    const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
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
            <header ref={header} data-workspace-header className="relative shrink-0 border-b border-white/[.06] bg-[#0b0c0d]">
                <div className="flex h-12 items-center gap-1.5 px-2 sm:gap-3 sm:px-4">
                    <Link href={`/${locale}`} aria-label={t("home")} className="flex shrink-0 items-center gap-2 rounded-lg">
                        <Image src="/icon.svg" width={28} height={28} alt="" className="size-7" priority />
                        <span className="hidden text-sm font-semibold tracking-tight text-white xl:block">Open<span className="text-primary">Higgsfield</span></span>
                    </Link>
                    <nav aria-label={t("navigation")} className="flex shrink-0 gap-0.5 rounded-xl bg-white/[.04] p-0.5">
                        {destinations.map(({ label, href, icon: Icon, active }) => <Link key={href} href={href} aria-current={active ? "page" : undefined} title={label} className={`flex h-8 min-w-9 items-center justify-center gap-1.5 rounded-[10px] px-2 text-xs font-semibold transition-colors sm:px-3 ${active ? "bg-white/[.1] text-white" : "text-muted-foreground hover:bg-white/[.05] hover:text-white"}`}>
                            <Icon aria-hidden="true" className={`size-4 ${active ? "text-primary" : ""}`} /><span className="sr-only sm:not-sr-only">{label}</span>
                        </Link>)}
                    </nav>
                    <div ref={setToolbarSlot} data-workspace-toolbar className="flex min-w-0 flex-1 items-center justify-end gap-1" />
                    <div className="flex shrink-0 justify-end">
                        <DropdownMenu><DropdownMenuTrigger aria-label={t("language")} title={t("language")} className="flex h-8 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground sm:px-2"><Languages aria-hidden="true" className="hidden size-4 sm:block" />{localeLabels[locale as AppLocale]}</DropdownMenuTrigger>
                            <DropdownMenuContent container={header} align="end" className="w-44 p-1.5">
                                {locales.map(code => <DropdownMenuItem key={code} render={<LocaleLink href={languageUrl} locale={code} />} className="min-h-11 rounded-lg px-3" aria-current={locale === code ? "true" : undefined}>{languages(code)}{locale === code && <Check aria-hidden="true" className="ml-auto size-4 text-primary" />}</DropdownMenuItem>)}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </header>
            <main id="workspace-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 outline-none"><ToolbarSlotContext.Provider value={toolbarSlot}>{children}</ToolbarSlotContext.Provider></main>
        </div>
    </MotionConfig>;
}

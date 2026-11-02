"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const t = useTranslations("errorPages");
    const locale = useLocale();
    return <div className="flex h-full flex-col items-center justify-center gap-5 px-5 text-center">
        <h1 className="font-display text-3xl">{t("errorTitle")}</h1>
        <p className="max-w-md text-muted-foreground">{t("errorHint")}</p>
        <div className="flex flex-wrap justify-center gap-3"><Button onClick={reset}>{t("retry")}</Button><Link href={`/${locale}`} className={buttonVariants({ variant: "outline" })}>{t("home")}</Link></div>
    </div>;
}

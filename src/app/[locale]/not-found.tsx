import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";

export default async function NotFound() {
    const locale = await getLocale();
    const t = await getTranslations("errorPages");
    return <div className="flex h-full flex-col items-center justify-center gap-5 px-5 text-center">
        <h1 className="font-display text-3xl">{t("notFoundTitle")}</h1>
        <p className="max-w-md text-muted-foreground">{t("notFoundHint")}</p>
        <Link href={`/${locale}`} className={buttonVariants()}>{t("home")}</Link>
    </div>;
}

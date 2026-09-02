import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/app/globals.css";

const manrope = Manrope({
    subsets: ["latin"],
    variable: "--font-manrope",
    weight: ["400", "500", "600", "700", "800"],
});

const spaceGrotesk = Space_Grotesk({
    subsets: ["latin"],
    variable: "--font-space-grotesk",
    weight: ["500", "700"],
});

export const metadata: Metadata = {
    metadataBase: new URL("https://openhiggs.techbe.me"),
    title: {
        default: "Open-Higgsfield - Open-Source Higgsfield Alternative",
        template: "%s | Open-Higgsfield",
    },
    description: "The open-source Higgsfield alternative for AI image and video generation with Freepik, Gemini, Vertex AI and Vercel AI Gateway.",
    keywords: [
        "AI image generator",
        "AI video generator",
        "open source AI studio",
        "Higgsfield alternative",
        "open source Higgsfield",
        "Open-Higgsfield",
        "Gemini image generation",
        "Veo video generation",
        "Vertex AI",
        "Vercel AI Gateway",
        "Freepik API",
        "Flux image generator",
        "Kling video generator",
    ],
    authors: [{ name: "TechBe", url: "https://techbe.me" }],
    creator: "TechBe",
    applicationName: "Open-Higgsfield",
    alternates: {
        canonical: "/",
        languages: {
            "en": "/en",
            "pt-BR": "/pt-BR",
        },
    },
    openGraph: {
        type: "website",
        url: "https://openhiggs.techbe.me",
        siteName: "Open-Higgsfield",
        title: "Open-Higgsfield - Open-Source Higgsfield Alternative",
        description: "Generate AI images and videos across multiple providers from one free, self-hostable studio.",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Open-Higgsfield AI image and video studio" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Open-Higgsfield - Open-Source Higgsfield Alternative",
        description: "Generate AI images and videos across multiple providers from one free, self-hostable studio.",
        images: ["/og-image.png"],
    },
    icons: { icon: "/icon.svg" },
};

export default async function LocaleLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    const messages = await getMessages();

    return (
        <html lang={locale} className="dark">
            <body className={`${manrope.variable} ${spaceGrotesk.variable}`}>
                <NextIntlClientProvider messages={messages}>
                    <TooltipProvider>{children}</TooltipProvider>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}

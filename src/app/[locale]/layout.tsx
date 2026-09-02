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
    metadataBase: new URL("https://flow.techbe.me"),
    title: {
        default: "Flow - Open Source AI Image & Video Studio",
        template: "%s | Flow",
    },
    description: "Generate AI images and videos with Freepik, Gemini, Google Vertex AI and Vercel AI Gateway from one open-source studio.",
    keywords: [
        "AI image generator",
        "AI video generator",
        "open source AI studio",
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
    applicationName: "Flow",
    alternates: {
        canonical: "/",
        languages: {
            "en": "/en",
            "pt-BR": "/pt-BR",
        },
    },
    openGraph: {
        type: "website",
        url: "https://flow.techbe.me",
        siteName: "Flow",
        title: "Flow - Open Source AI Image & Video Studio",
        description: "One interface for multi-provider AI image and video generation.",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Flow AI image and video studio" }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Flow - Open Source AI Image & Video Studio",
        description: "One interface for multi-provider AI image and video generation.",
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

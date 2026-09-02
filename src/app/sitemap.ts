import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: "https://flow.techbe.me/en", changeFrequency: "weekly", priority: 1 },
        { url: "https://flow.techbe.me/pt-BR", changeFrequency: "weekly", priority: 0.9 },
    ];
}

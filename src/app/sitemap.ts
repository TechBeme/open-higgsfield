import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: "https://open-higgsfield.techbe.me/en", changeFrequency: "weekly", priority: 1 },
        { url: "https://open-higgsfield.techbe.me/pt-BR", changeFrequency: "weekly", priority: 0.9 },
    ];
}

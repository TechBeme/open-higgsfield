import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: "*", allow: "/", disallow: "/api/" },
        sitemap: "https://openhiggs.techbe.me/sitemap.xml",
        host: "https://openhiggs.techbe.me",
    };
}

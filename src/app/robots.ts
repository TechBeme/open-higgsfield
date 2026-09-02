import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: { userAgent: "*", allow: "/", disallow: "/api/" },
        sitemap: "https://open-higgsfield.techbe.me/sitemap.xml",
        host: "https://open-higgsfield.techbe.me",
    };
}

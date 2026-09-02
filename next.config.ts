import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false,
  serverExternalPackages: ["formidable", "sharp"],
};

export default withNextIntl(nextConfig);

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  distDir: process.env.E2E_TEST_SERVER === "1" && process.env.E2E_PRODUCTION !== "1" ? ".next-e2e" : ".next",
  output: process.env.VERCEL ? undefined : "standalone",
  agentRules: false,
  serverExternalPackages: ["formidable", "sharp"],
};

export default withNextIntl(nextConfig);

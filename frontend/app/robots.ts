import type { MetadataRoute } from "next";

import { siteOrigin } from "@/lib/api/server";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    // Only the public website is meant for search engines; the rest needs a sign-in anyway.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/portal", "/platform", "/onboarding", "/invitations"] },
    sitemap: new URL("/sitemap.xml", origin).toString(),
  };
}

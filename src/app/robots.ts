import type { MetadataRoute } from "next";

/** Painel interno: nenhum robô deve rastrear. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

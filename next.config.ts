import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Há um package-lock.json perdido em C:\Users\User. Sem fixar a raiz, o
  // Turbopack sobe demais e escolhe a pasta errada como raiz do projeto.
  turbopack: { root: path.resolve(".") },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Painel interno: fora da busca e fora de iframes de outros sites.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

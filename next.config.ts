import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Os testes e2e contra o build de produção (PAUTA_PROD=1, playwright.config.ts) usam
  // a pasta .next-e2e, para não sobrescrever o .next de outro next start aberto.
  distDir: process.env.PAUTA_DIST_DIR || ".next",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // O Tailwind 4 é processado pelo loader do Turbopack (@tailwindcss/turbopack),
  // como o create-next-app 16.4 cria; por isso não existe postcss.config.mjs.
  // Consequência: um build com webpack (next build --webpack) não processaria o Tailwind.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Carrega o .env.local do mesmo jeito que o Next.js. Os testes das próximas
// etapas usam a SUPABASE_SECRET_KEY para criar e apagar usuários de teste;
// ela fica só aqui, no processo dos testes, e nunca vai para o navegador.
loadEnvConfig(process.cwd());

// Outro endereço quando a porta 3000 já está com outro servidor (ex.: outra conversa):
// PAUTA_URL=http://localhost:3100 npx playwright test ...
const ENDERECO = process.env.PAUTA_URL ?? "http://localhost:3000";
const PORTA = new URL(ENDERECO).port || "3000";

// PAUTA_PROD=1: roda contra o build de produção (next build + next start), que abre
// cada tela de 30% a 60% mais rápido que o next dev, sem compilar na primeira visita
// (medido em 10/11/2026). O build vai para a pasta .next-e2e (PAUTA_DIST_DIR, lida no
// next.config.ts), para não sobrescrever o .next de outro next start aberto.
// Depois de mudar o código, o build precisa ser refeito: com PAUTA_PROD=1 e sem
// servidor aberto na porta, o próprio Playwright faz o build de novo.
const PRODUCAO = process.env.PAUTA_PROD === "1";

export default defineConfig({
  testDir: "./e2e",
  // Um teste por vez: todos usam o mesmo banco compartilhado do Supabase.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // O npm run dev compila cada tela na primeira visita (passo 4.6: a ida para
  // /fotos levou 5 s com o servidor recém-aberto), e 5 s de espera, o padrão, não
  // bastavam. Um erro de verdade continua falhando, só demora mais para avisar.
  expect: { timeout: 15_000 },
  use: {
    baseURL: ENDERECO,
    trace: "on-first-retry",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    // O PAUTA é pensado primeiro para o celular (RNF09).
    // Largura de 390 px, a mesma das telas de celular do protótipo.
    { name: "celular", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "computador", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: PRODUCAO ? `npx next build && npx next start -p ${PORTA}` : `npx next dev -p ${PORTA}`,
    // WHATSAPP_DESLIGADO: o servidor dos testes lê o .env.local; sem isto, com as chaves da
    // Meta lá, os avisos das contas de teste iriam para a Meta de verdade (números
    // inventados). O envio é testado com a Meta simulada, em e2e/whatsapp.spec.ts.
    env: { WHATSAPP_DESLIGADO: "1", ...(PRODUCAO ? { PAUTA_DIST_DIR: ".next-e2e" } : {}) },
    url: ENDERECO,
    // Reaproveita o servidor que já estiver aberto no endereço (dev ou produção).
    reuseExistingServer: !process.env.CI,
    // O build de produção leva alguns minutos.
    timeout: PRODUCAO ? 600_000 : 120_000,
  },
});

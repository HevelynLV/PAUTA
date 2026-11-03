import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { apagarContas, clienteAdmin, contaPorEmail, criarConta, entrarComo, tornarAdmin } from "./apoio/supabase";

// RF06, passo 5.3: o corretor autônomo se cadastra pela tela pública com o próprio
// CRECI (F ou J), assina sem imobiliária e fica pendente até o admin conferir o
// CRECI e ativar. Ativo, abre o catálogo. Não convida corretores: convite é só da
// imobiliária.

const PREFIXO = "e2e-autonomo-";
const ORIGEM = "http://localhost:3000";
const unico = () => String(Math.floor(1_000_000 + Math.random() * 8_999_999));

let cookiesDoAdmin: Awaited<ReturnType<typeof entrarComo>>["cookies"];

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const emailAdmin = `${PREFIXO}admin-${unico()}@exemplo.com`;
  await tornarAdmin(await criarConta(emailAdmin, { tipo: "proprietario", nome: "Admin Autônomo", telefone: "48999990070" }));
  cookiesDoAdmin = (await entrarComo(emailAdmin)).cookies;
});

test.afterAll(() => apagarContas(PREFIXO));

const linha = (pagina: Page, nome: string) =>
  pagina.getByRole("listitem").or(pagina.getByRole("row")).filter({ hasText: nome });

test("autônomo se cadastra com o próprio CRECI, o admin ativa e ele abre o catálogo", async ({ page, browser }) => {
  const numero = unico();
  const creci = `${numero}-F`;
  const nome = `Thiago Autônomo ${test.info().project.name}`;
  const email = `${PREFIXO}thiago-${numero}@exemplo.com`;

  // Pela tela pública: "Corretor autônomo" (chip no celular, cartão no computador).
  await page.goto("/cadastro/imobiliaria");
  await page.getByRole("link", { name: "Corretor autônomo" }).click();
  await expect(page).toHaveURL(/\/cadastro\/autonomo$/);
  // Com o cacheComponents, o Next guarda a página anterior (imobiliária) montada e
  // escondida (<Activity>), e o getByLabel acha campos escondidos: só o formulário
  // visível conta.
  const form = page.locator("form").filter({ visible: true });
  // Autônomo não tem nome de imobiliária.
  await expect(form.getByLabel("Nome da imobiliária")).toHaveCount(0);

  await form.getByLabel("Seu CRECI").fill(`${numero.slice(0, 3)}.${numero.slice(3)}-f`);
  await form.getByLabel("Nome completo").fill(nome);
  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Telefone com DDD").fill("48 99301-5520");
  await form.getByLabel("Senha").fill("senha-e2e-123");
  await form.getByRole("button", { name: "Criar conta" }).click();

  // Pendente: espera a conferência do CRECI (gravado sem os pontos) e não abre o catálogo.
  await expect(page).toHaveURL(/\/aguardando-ativacao$/);
  await expect(page.getByText("Sua conta está com a assinatura")).toBeVisible();
  await expect(page.getByText(`Conferência do CRECI ${creci} SC`)).toBeVisible();
  await page.goto("/assinante");
  await expect(page).toHaveURL(/\/aguardando-ativacao$/);

  // Assina sem imobiliária: o assinante é ele mesmo, do tipo autônomo.
  const conta = await contaPorEmail(email);
  const { data: perfil } = await clienteAdmin()
    .from("perfis")
    .select("tipo, assinantes!perfis_assinante_id_fkey(tipo, nome, creci_normalizado, status, responsavel_id)")
    .eq("id", conta!.id)
    .single();
  expect(perfil).toMatchObject({
    tipo: "autonomo",
    assinantes: { tipo: "autonomo", nome, creci_normalizado: `${numero}F`, status: "pendente", responsavel_id: conta!.id },
  });

  // O admin confere o CRECI e ativa.
  const contextoAdmin = await browser.newContext({ baseURL: ORIGEM });
  await contextoAdmin.addCookies(cookiesDoAdmin);
  const doAdmin = await contextoAdmin.newPage();
  await doAdmin.goto("/admin/assinantes");
  const item = linha(doAdmin, nome);
  await expect(item).toContainText("Corretor autônomo");
  await expect(item.getByText(`CRECI ${creci} SC`)).toBeVisible();
  await item.getByRole("button", { name: "Ativar" }).click();
  await expect(item).toHaveCount(0);
  await contextoAdmin.close();

  // Ativado, ele abre o catálogo e a conta mostra que é autônomo.
  await page.goto("/assinante");
  await expect(page).toHaveURL(/\/assinante$/);
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible();
  await page.goto("/aguardando-ativacao");
  await expect(page).toHaveURL(/\/assinante$/);
  await page.goto("/assinante/conta");
  await expect(page.getByText("Corretor autônomo", { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test("autônomo ativo não cria convite: convidar corretores é só da imobiliária", async () => {
  const numero = unico();
  const email = `${PREFIXO}convite-${numero}@exemplo.com`;
  const id = await criarConta(email, { tipo: "autonomo", nome: "Paula Autônoma", telefone: "48993015521", creci: `${numero}-J` });
  await clienteAdmin().from("assinantes").update({ status: "ativo" }).eq("responsavel_id", id);
  const { data: perfil } = await clienteAdmin().from("perfis").select("assinante_id").eq("id", id).single();

  // Pela API, com a sessão dele, como alguém faria fora da tela.
  const { cliente } = await entrarComo(email);
  const { error } = await cliente.from("convites").insert({
    assinante_id: perfil!.assinante_id,
    token_hash: createHash("sha256").update(`codigo-${numero}`).digest("hex"),
  });
  expect(error?.code).toBe("42501");
  const { count } = await clienteAdmin()
    .from("convites")
    .select("id", { count: "exact", head: true })
    .eq("assinante_id", perfil!.assinante_id);
  expect(count).toBe(0);
});

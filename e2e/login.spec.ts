import { expect, test, type Page } from "@playwright/test";

import {
  apagarContas,
  criarConta,
  linkDeRecuperacao,
  mudarAssinatura,
  SENHA_TESTE,
  tornarAdmin,
} from "./apoio/supabase";

// Login, saída e recuperação de senha (RF03), passo 3.4. As contas são criadas
// já confirmadas pela chave secreta (sem e-mail) e apagadas no fim.
//
// O Supabase limita logins por endereço (cerca de 30 a cada 5 minutos): o teste
// que entra com todos os tipos roda só no celular. Entrar não depende da tela.

const PREFIXO = "e2e-login-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const dono = (nome: string) => ({ tipo: "proprietario", nome, telefone: "48999990000" });
const autonomo = (nome: string, creci: string) => ({ tipo: "autonomo", nome, telefone: "48999990001", creci });

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  await criarConta(email("prop"), dono("Marina Login"));
  await criarConta(email("senha"), dono("Paula Senha"));
  await tornarAdmin(await criarConta(email("admin"), dono("Admin Login")));
  await criarConta(email("pendente"), {
    tipo: "imobiliaria", nome: "Rafael Pendente", telefone: "48999990002", nome_imobiliaria: "Maré Pendente", creci: "88801-J",
  });
  await mudarAssinatura(await criarConta(email("ativo"), autonomo("Thiago Ativo", "88802-F")), "ativo");
  await mudarAssinatura(await criarConta(email("vencido"), autonomo("Vera Vencida", "88803-F")), "vencido");
  await mudarAssinatura(await criarConta(email("bloqueado"), autonomo("Bruno Bloqueado", "88804-F")), "ativo", true);
});

test.afterAll(() => apagarContas(PREFIXO));

async function entrar(page: Page, endereco: string, senha = SENHA_TESTE) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(endereco);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("cada tipo entra e cai na tela certa", async ({ page, context }, info) => {
  test.skip(info.project.name !== "celular", "roda uma vez só, pelo limite de logins do Supabase");

  const casos: [string, RegExp, string][] = [
    ["prop", /\/proprietario$/, "Olá, Marina Login"],
    ["admin", /\/admin$/, "Imóveis para aprovar"],
    ["ativo", /\/assinante$/, "Thiago Ativo"],
    ["pendente", /\/aguardando-ativacao$/, "Cadastro recebido, Rafael"],
    ["vencido", /\/acesso-suspenso$/, "A mensalidade da sua assinatura venceu."],
    ["bloqueado", /\/acesso-suspenso$/, "A equipe PAUTA bloqueou o acesso da sua assinatura."],
  ];
  for (const [conta, url, texto] of casos) {
    await context.clearCookies();
    await entrar(page, email(conta));
    await expect(page, conta).toHaveURL(url);
    await expect(page.getByText(texto).filter({ visible: true }).first(), conta).toBeVisible();
  }
});

test("senha errada mostra uma mensagem só, sem dizer se o e-mail existe", async ({ page }) => {
  await entrar(page, email("prop"), "senha-errada-123");
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByLabel("E-mail")).toHaveValue(email("prop"));

  await entrar(page, email("ninguem"), "senha-errada-123");
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});

test("sair encerra a sessão", async ({ page }) => {
  await entrar(page, email("pendente"));
  await expect(page).toHaveURL(/\/aguardando-ativacao$/);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/aguardando-ativacao");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("pedido de senha nova responde igual, tenha o e-mail conta ou não", async ({ page }) => {
  // E-mail sem conta: o Supabase não manda nada (nenhum e-mail volta).
  await page.goto("/recuperar-senha");
  await page.getByLabel("E-mail").fill(email("ninguem"));
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByRole("heading", { name: "Confira seu e-mail" })).toBeVisible();
  await expect(page.getByText(`Se houver uma conta com ${email("ninguem")}`)).toBeVisible();
});

test("link de recuperação cria a senha nova", async ({ page }, info) => {
  test.skip(info.project.name !== "celular", "muda a senha da conta: roda uma vez só");

  await page.goto(await linkDeRecuperacao(email("senha")));
  await expect(page).toHaveURL(/\/redefinir-senha$/);

  await page.getByLabel("Senha nova", { exact: true }).fill("senha-nova-456");
  await page.getByLabel("Repita a senha nova").fill("senha-diferente");
  await page.getByRole("button", { name: "Salvar senha nova" }).click();
  await expect(page.getByText("As duas senhas estão diferentes.")).toBeVisible();

  await page.getByLabel("Senha nova", { exact: true }).fill("senha-nova-456");
  await page.getByLabel("Repita a senha nova").fill("senha-nova-456");
  await page.getByRole("button", { name: "Salvar senha nova" }).click();
  await expect(page.getByRole("heading", { name: "Senha alterada" })).toBeVisible();

  // O link vale uma vez só.
  await page.goto("/redefinir-senha");
  await expect(page.getByRole("heading", { name: "Link vencido" })).toBeVisible();

  await entrar(page, email("senha"), "senha-nova-456");
  await expect(page).toHaveURL(/\/proprietario$/);
});

test("quem só está logado não troca a senha sem o link", async ({ page }) => {
  await entrar(page, email("prop"));
  await expect(page).toHaveURL(/\/proprietario$/);
  await page.goto("/redefinir-senha");
  await expect(page.getByRole("heading", { name: "Link vencido" })).toBeVisible();
  await expect(page.getByLabel("Senha nova", { exact: true })).toHaveCount(0);
});

test("link forjado não abre sessão nem leva para fora do PAUTA", async ({ page }) => {
  await page.goto("/auth/confirmar?token_hash=forjado&type=recovery&proximo=//exemplo.com");
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/redefinir-senha$/);
  await expect(page.getByRole("heading", { name: "Link vencido" })).toBeVisible();

  // TAB escondido (%09): o navegador o apaga e "/\t/exemplo.com" viraria outro site.
  await page.goto("/auth/confirmar?token_hash=forjado&type=recovery&proximo=/%09/exemplo.com");
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/redefinir-senha$/);
});

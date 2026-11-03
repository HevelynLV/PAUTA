import { expect, test } from "@playwright/test";

import { apagarContas, contaPorEmail, criarConta, perfilPorEmail } from "./apoio/supabase";

// Cadastro pelo app (RF01, RF02), passo 3.3. Cada teste cria as próprias contas
// (e-mails @exemplo.com com o prefixo abaixo) e elas são apagadas no fim.

const PREFIXO = "e2e-cadastro-";

// Número único por teste, para e-mail e CRECI não repetirem entre execuções.
const unico = () => String(Date.now()).slice(-7);

test.beforeAll(() => apagarContas(PREFIXO));
test.afterAll(() => apagarContas(PREFIXO));

test("proprietário se cadastra e cai na própria área", async ({ page }) => {
  const email = `${PREFIXO}prop-${unico()}@exemplo.com`;

  await page.goto("/cadastro");
  await page.getByLabel("Nome completo").fill("Marina Teste E2E");
  await page.getByLabel("E-mail").fill(email);
  // Com o 0 na frente e com máscara: o banco guarda só os números, sem o 0.
  await page.getByLabel("Telefone com DDD").fill("0 (48) 99812-4410");
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/proprietario$/);
  await expect(page.getByText("Olá, Marina Teste E2E")).toBeVisible();

  const perfil = await perfilPorEmail(email);
  expect(perfil).toMatchObject({ tipo: "proprietario", telefone: "48998124410", assinantes: null });
});

test("imobiliária se cadastra e fica aguardando a ativação", async ({ page }) => {
  const numero = unico();
  const email = `${PREFIXO}imob-${numero}@exemplo.com`;

  await page.goto("/cadastro/imobiliaria");
  await page.getByLabel("Nome da imobiliária").fill("Maré Imóveis E2E");
  await page.getByLabel("CRECI da imobiliária").fill(`${numero}-j`);
  await page.getByLabel("Nome do responsável").fill("Rafael Teste E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Telefone com DDD").fill("48 99654-2201");
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/aguardando-ativacao$/);
  await expect(page.getByRole("heading", { name: "Cadastro recebido, Rafael" })).toBeVisible();
  await expect(page.getByText("A Maré Imóveis E2E está com a assinatura")).toBeVisible();

  const perfil = await perfilPorEmail(email);
  expect(perfil).toMatchObject({
    tipo: "imobiliaria",
    assinantes: { tipo: "imobiliaria", nome: "Maré Imóveis E2E", creci: `${numero}-J`, status: "pendente" },
  });

  // Pendente não abre o catálogo, nem digitando o endereço.
  await page.goto("/assinante");
  await expect(page).toHaveURL(/\/aguardando-ativacao$/);
});

test("CRECI repetido, mesmo escrito de outro jeito, dá mensagem clara", async ({ page }) => {
  const numero = unico();
  await criarConta(`${PREFIXO}dono-creci-${numero}@exemplo.com`, {
    tipo: "imobiliaria",
    nome: "Dona do CRECI",
    telefone: "48999990000",
    nome_imobiliaria: "Imobiliária Que Chegou Antes",
    creci: `${numero}-J`,
  });

  const email = `${PREFIXO}autonomo-${numero}@exemplo.com`;
  await page.goto("/cadastro/autonomo");
  // Com ponto, minúscula e "SC" no fim: é o mesmo CRECI.
  await page.getByLabel("Seu CRECI").fill(`${numero.slice(0, 3)}.${numero.slice(3)}-j SC`);
  await page.getByLabel("Nome completo").fill("Thiago Teste E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Telefone com DDD").fill("48 99111-2233");
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByText("Este CRECI já está cadastrado no PAUTA.")).toBeVisible();
  await expect(page).toHaveURL(/\/cadastro\/autonomo$/);
  // O que foi digitado continua no formulário (menos a senha).
  await expect(page.getByLabel("Nome completo")).toHaveValue("Thiago Teste E2E");
  // E a conta não foi criada.
  expect(await contaPorEmail(email)).toBeNull();
});

// Decisão de 28/10/2026: CRECI com a letra; imobiliária só com J, autônomo com J ou F.
test("CRECI sem letra, ou com F na imobiliária, é recusado no campo, sem criar conta", async ({ page }) => {
  const numero = unico();
  const email = `${PREFIXO}letra-${numero}@exemplo.com`;

  await page.goto("/cadastro/imobiliaria");
  await page.getByLabel("Nome da imobiliária").fill("Maré Sem Letra E2E");
  await page.getByLabel("Nome do responsável").fill("Rafael Teste E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Telefone com DDD").fill("48 99654-2201");

  await page.getByLabel("CRECI da imobiliária").fill(numero);
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Falta a letra: escreva o CRECI com o J, ex.: 12345-J.")).toBeVisible();

  await page.getByLabel("CRECI da imobiliária").fill(`${numero}-F`);
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Use o CRECI da imobiliária, com a letra J")).toBeVisible();
  expect(await contaPorEmail(email)).toBeNull();

  // O autônomo pode usar F.
  await page.goto("/cadastro/autonomo");
  await page.getByLabel("Seu CRECI").fill(numero);
  await page.getByLabel("Nome completo").fill("Thiago Teste E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Telefone com DDD").fill("48 99111-2233");
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Falta a letra: escreva o CRECI com o F ou o J, ex.: 12345-F.")).toBeVisible();
  expect(await contaPorEmail(email)).toBeNull();

  await page.getByLabel("Seu CRECI").fill(`${numero}-f`);
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/aguardando-ativacao$/);
  expect(await perfilPorEmail(email)).toMatchObject({
    tipo: "autonomo",
    assinantes: { tipo: "autonomo", creci: `${numero}-F`, status: "pendente" },
  });
});

test("campos vazios ou errados mostram o erro no campo, sem criar conta", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByLabel("Telefone com DDD").fill("9999-0000");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByText("Escreva o nome (de 2 a 120 letras).")).toBeVisible();
  await expect(page.getByText("Confira o e-mail.")).toBeVisible();
  await expect(page.getByText("Escreva o telefone com DDD, ex.: (48) 99812-4410.")).toBeVisible();
  await expect(page.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
  await expect(page).toHaveURL(/\/cadastro$/);
});

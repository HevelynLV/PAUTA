import { expect, test } from "@playwright/test";

import { apagarContas, clienteAdmin, contaPorEmail, criarConta, documentoDeTeste, perfilPorEmail } from "./apoio/supabase";

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
  const cnpj = documentoDeTeste("cnpj");
  // Com a máscara de costume: o banco guarda só os números.
  await page.getByLabel("CNPJ da imobiliária").fill(
    `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`,
  );
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
  // O CNPJ fica em dados_de_cobranca (que os corretores não leem) e sai do metadata.
  const conta = await contaPorEmail(email);
  expect(await documentoDe(conta!.id)).toBe(cnpj);
  expect(conta!.user_metadata).not.toHaveProperty("cpf_cnpj");

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
  await page.getByLabel("Seu CPF ou CNPJ").fill(documentoDeTeste("cpf"));
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
  await page.getByLabel("CNPJ da imobiliária").fill(documentoDeTeste("cnpj"));
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
  await page.getByLabel("Seu CPF ou CNPJ").fill(documentoDeTeste("cpf"));
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

// Decisão de 19/11/2026: CPF ou CNPJ de quem paga, conferido pelos dígitos; imobiliária
// só com CNPJ; o mesmo documento não entra duas vezes.
test("CPF ou CNPJ errado, CPF na imobiliária ou documento repetido são recusados no campo", async ({ page }) => {
  const numero = unico();
  const email = `${PREFIXO}doc-${numero}@exemplo.com`;
  const cpf = documentoDeTeste("cpf");
  const doisDigitosTrocados = `${cpf.slice(0, 9)}${(Number(cpf[9]) + 1) % 10}${cpf[10]}`;

  await page.goto("/cadastro/imobiliaria");
  await page.getByLabel("Nome da imobiliária").fill("Maré Documento E2E");
  await page.getByLabel("CRECI da imobiliária").fill(`${numero}-J`);
  await page.getByLabel("Nome do responsável").fill("Rafael Teste E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Telefone com DDD").fill("48 99654-2201");

  await page.getByLabel("CNPJ da imobiliária").fill(cpf);
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Use o CNPJ da imobiliária. CPF é de pessoa física.")).toBeVisible();

  await page.getByLabel("CNPJ da imobiliária").fill("12.345.678/0001-00");
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Confira o CNPJ, ex.: 12.345.678/0001-95.")).toBeVisible();
  expect(await contaPorEmail(email)).toBeNull();

  // Autônomo: CPF com dígito errado; depois, o CPF de outra conta.
  await criarConta(`${PREFIXO}dono-doc-${numero}@exemplo.com`, {
    tipo: "autonomo",
    nome: "Dono do CPF",
    telefone: "48999990000",
    creci: `${numero}-F`,
    cpf_cnpj: cpf,
  });
  await page.goto("/cadastro/autonomo");
  const form = page.locator("form").filter({ visible: true });
  await form.getByLabel("Seu CRECI").fill(`${numero.slice(1)}9-F`);
  await form.getByLabel("Nome completo").fill("Thiago Teste E2E");
  await form.getByLabel("E-mail").fill(email);
  await form.getByLabel("Telefone com DDD").fill("48 99111-2233");
  await form.getByLabel("Seu CPF ou CNPJ").fill(doisDigitosTrocados);
  await form.getByLabel("Senha").fill("senha-e2e-123");
  await form.getByRole("button", { name: "Criar conta" }).click();
  await expect(form.getByText("Confira o CPF ou o CNPJ, ex.: 123.456.789-09.")).toBeVisible();

  await form.getByLabel("Seu CPF ou CNPJ").fill(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`);
  await form.getByLabel("Senha").fill("senha-e2e-123");
  await form.getByRole("button", { name: "Criar conta" }).click();
  await expect(form.getByText("Este CPF ou CNPJ já está cadastrado no PAUTA.")).toBeVisible();
  expect(await contaPorEmail(email)).toBeNull();
});

test("campos vazios ou errados mostram o erro no campo, sem criar conta", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByLabel("Telefone com DDD").fill("9999-0000");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByText("Escreva o nome (de 2 a 120 letras).")).toBeVisible();
  await expect(page.getByText("Confira o e-mail.")).toBeVisible();
  await expect(page.getByText("Escreva um celular com DDD, ex.: (48) 99812-4410.")).toBeVisible();
  await expect(page.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
  await expect(page).toHaveURL(/\/cadastro$/);
});

// Decisão de 05/11/2026: só celular, porque os avisos vão por WhatsApp.
test("o telefone mostra o modelo, formata ao digitar e só aceita celular", async ({ page }) => {
  await page.goto("/cadastro");
  const telefone = page.getByLabel("Telefone com DDD");
  await expect(telefone).toHaveAttribute("placeholder", "(48) 99812-4410");
  await expect(page.getByLabel("E-mail")).toHaveAttribute("placeholder", /@/);

  await telefone.pressSequentially("48998124410999");
  await expect(telefone).toHaveValue("(48) 99812-4410");

  // Colado do WhatsApp, com o 55 do Brasil.
  await telefone.fill("+55 48 99812-4410");
  await expect(telefone).toHaveValue("(48) 99812-4410");

  // Telefone fixo: 10 dígitos, ou 11 sem o 9 depois do DDD.
  for (const fixo of ["(48) 3222-1234", "48 32221-2345"]) {
    await telefone.fill(fixo);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page.getByText("Escreva um celular com DDD, ex.: (48) 99812-4410.")).toBeVisible();
    await expect(page).toHaveURL(/\/cadastro$/);
  }
});

async function documentoDe(contaId: string) {
  const { data: perfil } = await clienteAdmin().from("perfis").select("assinante_id").eq("id", contaId).single();
  const { data } = await clienteAdmin()
    .from("dados_de_cobranca")
    .select("cpf_cnpj")
    .eq("assinante_id", perfil!.assinante_id)
    .maybeSingle();
  return data?.cpf_cnpj ?? null;
}

import { expect, test, type Browser, type Request } from "@playwright/test";

import {
  apagarContas,
  clienteAdmin,
  contaPorEmail,
  cookiesDeSessao,
  criarConta,
  mudarAssinatura,
  perfilPorEmail,
  tornarAdmin,
} from "./apoio/supabase";

// RF04, RNF02: cada tipo de usuário só abre a própria área, nem digitando o
// endereço, nem chamando a Server Action de outra área direto. Passo 3.5.
//
// Cada conta entra uma vez só (cookiesDeSessao) e os testes reaproveitam a
// sessão, por causa do limite de logins do Supabase.

const PREFIXO = "e2e-areas-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";

type Conta = "prop" | "admin" | "imob" | "pendente";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof cookiesDeSessao>>>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  await criarConta(email("prop"), { tipo: "proprietario", nome: "Marina Areas", telefone: "48999990000" });
  await tornarAdmin(await criarConta(email("admin"), { tipo: "proprietario", nome: "Admin Areas", telefone: "48999990001" }));
  await mudarAssinatura(
    await criarConta(email("imob"), {
      tipo: "imobiliaria", nome: "Rafael Areas", telefone: "48999990002", nome_imobiliaria: "Maré Areas", creci: "77701-J",
    }),
    "ativo",
  );
  await criarConta(email("pendente"), {
    tipo: "autonomo", nome: "Paulo Pendente", telefone: "48999990003", creci: "77702-F",
  });
  for (const conta of ["prop", "admin", "imob", "pendente"] as Conta[]) {
    sessoes[conta] = await cookiesDeSessao(email(conta));
  }
});

test.afterAll(() => apagarContas(PREFIXO));

async function contextoDe(browser: Browser, conta?: Conta) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  if (conta) await contexto.addCookies(sessoes[conta]);
  return contexto;
}

// Endereço digitado → para onde cada tipo vai parar.
const casos: [Conta | "visitante", string, RegExp][] = [
  ["visitante", "/proprietario", /\/entrar$/],
  ["visitante", "/assinante/conta", /\/entrar$/],
  ["visitante", "/admin", /\/entrar$/],
  ["prop", "/proprietario/conta", /\/proprietario\/conta$/],
  ["prop", "/assinante", /\/proprietario$/],
  ["prop", "/assinante/conta", /\/proprietario$/],
  ["prop", "/admin", /\/proprietario$/],
  ["imob", "/assinante/conta", /\/assinante\/conta$/],
  ["imob", "/proprietario", /\/assinante$/],
  ["imob", "/proprietario/conta", /\/assinante$/],
  ["imob", "/admin", /\/assinante$/],
  ["admin", "/admin", /\/admin$/],
  ["admin", "/proprietario/conta", /\/admin$/],
  ["admin", "/assinante", /\/admin$/],
  ["pendente", "/assinante/conta", /\/aguardando-ativacao$/],
  ["pendente", "/proprietario", /\/aguardando-ativacao$/],
  // Quem já está logado não volta para entrar nem cadastra outra conta.
  ["prop", "/entrar", /\/proprietario$/],
  ["imob", "/cadastro", /\/assinante$/],
  ["admin", "/cadastro/imobiliaria", /\/admin$/],
];

for (const [conta, endereco, destino] of casos) {
  test(`${conta} abrindo ${endereco}`, async ({ browser }) => {
    const contexto = await contextoDe(browser, conta === "visitante" ? undefined : conta);
    const pagina = await contexto.newPage();
    await pagina.goto(endereco);
    await expect(pagina).toHaveURL(destino);
    await contexto.close();
  });
}

test("Minha conta salva nome e telefone, e o e-mail não muda pela tela", async ({ browser }) => {
  const contexto = await contextoDe(browser, "prop");
  const pagina = await contexto.newPage();
  await pagina.goto("/proprietario/conta");

  await expect(pagina.getByLabel("E-mail")).toHaveValue(email("prop"));
  await expect(pagina.getByLabel("E-mail")).toHaveAttribute("readonly", "");
  await expect(pagina.getByLabel("Telefone com DDD")).toHaveValue("(48) 99999-0000");

  await pagina.getByLabel("Telefone com DDD").fill("x");
  await pagina.getByRole("button", { name: "Salvar dados" }).click();
  await expect(pagina.getByText("Escreva um celular com DDD, ex.: (48) 99812-4410.")).toBeVisible();

  await pagina.getByLabel("Nome completo").fill("Marina Areas Nova");
  await pagina.getByLabel("Telefone com DDD").fill("0 (48) 99123-4567");
  await pagina.getByRole("button", { name: "Salvar dados" }).click();
  await expect(pagina.getByText("Dados salvos.")).toBeVisible();
  expect(await perfilPorEmail(email("prop"))).toMatchObject({ nome: "Marina Areas Nova", telefone: "48991234567" });

  // Volta como estava, para os outros testes.
  await mudarNome("prop", "Marina Areas", "48999990000");
  await contexto.close();
});

async function mudarNome(conta: Conta, nome: string, telefone?: string) {
  const id = (await contaPorEmail(email(conta)))!.id;
  await clienteAdmin().from("perfis").update({ nome, ...(telefone && { telefone }) }).eq("id", id);
}

// Grava a requisição real que a tela "Minha conta" de uma área manda ao salvar,
// para depois mandar a MESMA requisição com a sessão de outro tipo de usuário,
// como alguém faria chamando a action direto, sem passar pela página.
async function gravarAction(browser: Browser, conta: Conta, endereco: string, nomeNovo: string) {
  const contexto = await contextoDe(browser, conta);
  const pagina = await contexto.newPage();
  await pagina.goto(endereco);
  await pagina.getByLabel("Nome completo").fill(nomeNovo);

  // Cancela o envio: só queremos a requisição, sem mudar o nome de quem gravou.
  let gravada: Request | undefined;
  await pagina.route(endereco, async (rota) => {
    if (rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await pagina.getByRole("button", { name: "Salvar dados" }).click();
  await expect.poll(() => gravada).toBeDefined();

  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  const corpo = gravada!.postDataBuffer()!;
  await contexto.close();
  return { endereco, cabecalhos, corpo };
}

async function chamarAction(
  browser: Browser,
  conta: Conta | undefined,
  { endereco, cabecalhos, corpo }: Awaited<ReturnType<typeof gravarAction>>,
) {
  const contexto = await contextoDe(browser, conta);
  const resposta = await contexto.request.post(endereco, { headers: cabecalhos, data: corpo, maxRedirects: 0 });
  await contexto.close();
  return resposta;
}

test("a action de outra área, chamada direto, não muda nada", async ({ browser }) => {
  const nomeInvasor = "Nome Trocado Por Fora";
  const actionProprietario = await gravarAction(browser, "prop", "/proprietario/conta", nomeInvasor);
  const actionAssinante = await gravarAction(browser, "imob", "/assinante/conta", nomeInvasor);

  // Antes: a própria action, chamada direto pelo dono da sessão, funciona.
  // Prova que a requisição gravada é válida (senão o teste abaixo não provaria nada).
  await chamarAction(browser, "prop", actionProprietario);
  expect((await perfilPorEmail(email("prop")))?.nome).toBe(nomeInvasor);
  await mudarNome("prop", "Marina Areas");

  // Assinante, admin e visitante chamando a action do proprietário.
  for (const conta of ["imob", "admin", undefined] as const) {
    await chamarAction(browser, conta, actionProprietario);
  }
  // Proprietário, admin, assinante pendente e visitante chamando a do assinante.
  for (const conta of ["prop", "admin", "pendente", undefined] as const) {
    await chamarAction(browser, conta, actionAssinante);
  }

  for (const [conta, nome] of [
    ["prop", "Marina Areas"],
    ["imob", "Rafael Areas"],
    ["admin", "Admin Areas"],
    ["pendente", "Paulo Pendente"],
  ] as const) {
    expect((await perfilPorEmail(email(conta)))?.nome, conta).toBe(nome);
  }
});

// Por último, porque encerra a sessão do admin. No celular ele não tem Minha
// conta: o "Sair" fica no topo do painel (auditoria da Etapa 3).
test("admin sai pelo painel no celular", async ({ browser }, info) => {
  test.skip(info.project.name !== "celular", "no computador o Sair fica no menu lateral");
  const contexto = await contextoDe(browser, "admin");
  const pagina = await contexto.newPage();
  await pagina.goto("/admin");
  await pagina.getByRole("main").getByRole("button", { name: "Sair" }).click();
  await expect(pagina).toHaveURL(`${ORIGEM}/`);
  await pagina.goto("/admin");
  await expect(pagina).toHaveURL(/\/entrar$/);
  await contexto.close();
});

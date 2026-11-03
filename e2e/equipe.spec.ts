import { createHash } from "node:crypto";

import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { apagarContas, clienteAdmin, contaPorEmail, criarConta, entrarComo, mudarAssinatura } from "./apoio/supabase";

// RF05, passo 5.4: o responsável pela imobiliária convida corretores por e-mail
// ou por link; o corretor cria a conta pelo convite e já entra vinculado e ativo.
// O convite vale uma vez, por 7 dias, e o de e-mail só para aquele e-mail. O
// responsável cancela convites e remove corretores (decisão de 28/10/2026): o
// removido perde o acesso na hora.

const PREFIXO = "e2e-equipe-";
const ORIGEM = "http://localhost:3000";
const unico = () => String(Math.floor(1_000_000 + Math.random() * 8_999_999));
const email = (nome: string) => `${PREFIXO}${nome}-${unico()}@exemplo.com`;

type Sessao = Awaited<ReturnType<typeof entrarComo>>;
type Imobiliaria = { id: string; email: string; nome: string; assinanteId: string; sessao: Sessao };

let imobA: Imobiliaria;
let imobB: Imobiliaria;

async function criarImobiliaria(nome: string): Promise<Imobiliaria> {
  const emailDela = email("resp");
  const id = await criarConta(emailDela, {
    tipo: "imobiliaria", nome: `Responsável ${nome}`, telefone: "48996542201", nome_imobiliaria: nome, creci: `${unico()}-J`,
  });
  await mudarAssinatura(id, "ativo");
  const { data } = await clienteAdmin().from("perfis").select("assinante_id").eq("id", id).single();
  return { id, email: emailDela, nome, assinanteId: data!.assinante_id, sessao: await entrarComo(emailDela) };
}

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  imobA = await criarImobiliaria(`Maré Equipe ${unico()}`);
  imobB = await criarImobiliaria(`Ilha Equipe ${unico()}`);
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaCom(browser: Browser, sessao?: Sessao) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  if (sessao) await contexto.addCookies(sessao.cookies);
  return contexto.newPage();
}

// Corretor que entrou pelo convite (convite gravado com a chave secreta, como o
// banco faria), para os testes que não são do convite em si.
async function criarCorretor(imob: Imobiliaria, nome: string) {
  const codigo = `${unico()}${unico()}`.padEnd(64, "0");
  const { error } = await clienteAdmin().from("convites").insert({
    assinante_id: imob.assinanteId,
    token_hash: createHash("sha256").update(codigo).digest("hex"),
    criado_por: imob.id,
  });
  if (error) throw new Error(`criarCorretor: ${error.message}`);
  const emailDele = email("corretor");
  const id = await criarConta(emailDele, { tipo: "corretor", nome, telefone: "48991207788", convite: codigo });
  return { id, email: emailDele };
}

// Abre a Equipe e cria um convite; devolve o link mostrado na tela.
async function convidar(pagina: Page, emailDoCorretor: string | null) {
  await pagina.goto("/assinante/equipe");
  if (emailDoCorretor) {
    await pagina.getByLabel("E-mail do corretor").fill(emailDoCorretor);
    await pagina.getByRole("button", { name: "Enviar convite" }).click();
    await expect(pagina.getByRole("status")).toContainText(`Convite criado para ${emailDoCorretor}`);
  } else {
    await pagina.getByRole("button", { name: /^Copiar link/ }).click();
    await expect(pagina.getByRole("status")).toContainText("Link de convite");
  }
  const link = await pagina.getByLabel("Link do convite").inputValue();
  expect(link).toMatch(/\/convite\/[0-9a-f]{64}$/);
  return new URL(link).pathname;
}

async function aceitar(pagina: Page, caminho: string, dados: { nome: string; email?: string }) {
  await pagina.goto(caminho);
  await pagina.getByLabel("Nome completo").fill(dados.nome);
  if (dados.email) await pagina.getByLabel("E-mail").fill(dados.email);
  await pagina.getByLabel("Telefone com DDD").fill("48 99120-7788");
  await pagina.getByLabel("Senha").fill("senha-e2e-123");
  await pagina.getByRole("button", { name: "Aceitar convite e entrar" }).click();
}

const linha = (pagina: Page, texto: string) => pagina.getByRole("listitem").filter({ hasText: texto });

test("convite por e-mail: o corretor cria a conta pelo link e entra vinculado e ativo", async ({ browser }) => {
  const doResponsavel = await paginaCom(browser, imobA.sessao);
  // Chega pela Minha conta, como no protótipo.
  await doResponsavel.goto("/assinante/conta");
  await doResponsavel.getByRole("link", { name: /Equipe e convites/ }).click();
  await expect(doResponsavel).toHaveURL(/\/assinante\/equipe$/);

  const emailDoCorretor = email("camila");
  const caminho = await convidar(doResponsavel, emailDoCorretor);
  await expect(linha(doResponsavel, emailDoCorretor)).toContainText("Aguardando");

  const doCorretor = await paginaCom(browser);
  await doCorretor.goto(caminho);
  // O nome aparece no cartão (celular) ou no painel (computador): só o visível conta.
  await expect(doCorretor.getByText(imobA.nome).filter({ visible: true }).first()).toBeVisible();
  await expect(doCorretor.getByText(`convite de Responsável ${imobA.nome}`).filter({ visible: true }).first()).toBeVisible();
  // Convite por e-mail: o campo vem preenchido e fixo.
  await expect(doCorretor.getByLabel("E-mail")).toHaveValue(emailDoCorretor);
  await expect(doCorretor.getByLabel("E-mail")).toHaveAttribute("readonly", "");
  await aceitar(doCorretor, caminho, { nome: "Camila Equipe" });
  await expect(doCorretor).toHaveURL(/\/assinante$/);
  await expect(doCorretor.getByRole("heading", { name: "Catálogo" })).toBeVisible();

  const conta = await contaPorEmail(emailDoCorretor);
  const { data: perfil } = await clienteAdmin().from("perfis").select("tipo, assinante_id, removido_em").eq("id", conta!.id).single();
  expect(perfil).toEqual({ tipo: "corretor", assinante_id: imobA.assinanteId, removido_em: null });

  // Na Equipe, o convite sai da lista e a Camila entra como ativa.
  await doResponsavel.reload();
  await expect(linha(doResponsavel, "Camila Equipe")).toContainText("Ativo");
  await expect(linha(doResponsavel, emailDoCorretor)).toHaveCount(0);
  await doResponsavel.context().close();
  await doCorretor.context().close();
});

test("convite por link vale para uma pessoa só: já usado não serve", async ({ browser }) => {
  const doResponsavel = await paginaCom(browser, imobA.sessao);
  const caminho = await convidar(doResponsavel, null);
  await expect(linha(doResponsavel, "Convite por link").first()).toBeVisible();
  await doResponsavel.context().close();

  const primeiro = await paginaCom(browser);
  await aceitar(primeiro, caminho, { nome: "Bruno Link", email: email("bruno") });
  await expect(primeiro).toHaveURL(/\/assinante$/);
  await primeiro.context().close();

  const segundo = await paginaCom(browser);
  await segundo.goto(caminho);
  await expect(segundo.getByRole("heading", { name: "Este convite não vale mais" })).toBeVisible();
  await expect(segundo.getByText("Este convite já foi usado.")).toBeVisible();
  await segundo.context().close();
});

test("convite vencido, cancelado ou para outro e-mail não serve", async ({ browser }) => {
  const doResponsavel = await paginaCom(browser, imobA.sessao);

  // Vencido: o banco marca 7 dias; aqui a validade é posta no passado.
  const emailVencido = email("vencido");
  const caminhoVencido = await convidar(doResponsavel, emailVencido);
  await clienteAdmin().from("convites").update({ expira_em: new Date(Date.now() - 60_000).toISOString() }).eq("email", emailVencido);

  // Cancelado pelo responsável.
  const caminhoCancelado = await convidar(doResponsavel, null);
  await doResponsavel.reload();
  const linhaDoLink = linha(doResponsavel, "Convite por link").first();
  // count() não espera a página: antes, espera a lista aparecer.
  await expect(linhaDoLink).toBeVisible();
  const antes = await linha(doResponsavel, "Convite por link").count();
  await linhaDoLink.getByRole("button", { name: "Cancelar" }).click();
  await expect(linha(doResponsavel, "Convite por link")).toHaveCount(antes - 1);

  // Para outro e-mail: quem tirar o "somente leitura" do campo e trocar o e-mail
  // é barrado no servidor.
  const emailCerto = email("certo");
  const caminhoComEmail = await convidar(doResponsavel, emailCerto);
  await doResponsavel.context().close();

  const visitante = await paginaCom(browser);
  await visitante.goto(caminhoVencido);
  await expect(visitante.getByText("Este convite venceu")).toBeVisible();
  await visitante.goto(caminhoCancelado);
  await expect(visitante.getByText("Convite inválido ou cancelado.")).toBeVisible();

  const outroEmail = email("outro");
  await visitante.goto(caminhoComEmail);
  await visitante.getByLabel("E-mail").evaluate((campo) => campo.removeAttribute("readonly"));
  await visitante.getByLabel("Nome completo").fill("Outra Pessoa");
  await visitante.getByLabel("E-mail").fill(outroEmail);
  await visitante.getByLabel("Telefone com DDD").fill("48 99120-7788");
  await visitante.getByLabel("Senha").fill("senha-e2e-123");
  await visitante.getByRole("button", { name: "Aceitar convite e entrar" }).click();
  await expect(visitante.getByText(`Este convite é para ${emailCerto}. Use esse e-mail.`)).toBeVisible();
  expect(await contaPorEmail(outroEmail)).toBeNull();
  await visitante.context().close();
});

test("convite para e-mail que já tem conta dá mensagem clara", async ({ browser }) => {
  const doResponsavel = await paginaCom(browser, imobA.sessao);
  await doResponsavel.goto("/assinante/equipe");
  await doResponsavel.getByLabel("E-mail do corretor").fill(imobB.email.toUpperCase());
  await doResponsavel.getByRole("button", { name: "Enviar convite" }).click();
  await expect(doResponsavel.getByText("Este e-mail já tem conta no PAUTA.")).toBeVisible();
  await expect(doResponsavel.getByRole("status")).toHaveCount(0);
  await doResponsavel.context().close();
});

test("o responsável remove o corretor, que perde o acesso na hora; outros não removem", async ({ browser }) => {
  const nome = `Diego Remover ${test.info().project.name}`;
  const removido = await criarCorretor(imobA, nome);
  const colega = await criarCorretor(imobA, `Colega ${test.info().project.name}`);

  const sessaoRemovido = await entrarComo(removido.email);
  const doRemovido = await paginaCom(browser, sessaoRemovido);
  await doRemovido.goto("/assinante");
  await expect(doRemovido).toHaveURL(/\/assinante$/);

  // Corretor comum e responsável de outra imobiliária, pela API: barrados.
  const sessaoColega = await entrarComo(colega.email);
  const { error: doColega } = await sessaoColega.cliente.rpc("remover_corretor", { p_corretor: removido.id });
  expect(doColega?.code).toBe("42501");
  const { error: daOutra } = await imobB.sessao.cliente.rpc("remover_corretor", { p_corretor: removido.id });
  expect(daOutra?.code).toBe("P0001");
  // E o corretor comum não abre a Equipe.
  const paginaDoColega = await paginaCom(browser, sessaoColega);
  await paginaDoColega.goto("/assinante/equipe");
  await expect(paginaDoColega).toHaveURL(/\/assinante$/);
  await paginaDoColega.context().close();

  const doResponsavel = await paginaCom(browser, imobA.sessao);
  await doResponsavel.goto("/assinante/equipe");
  await linha(doResponsavel, nome).getByRole("button", { name: "Remover" }).click();
  const janela = doResponsavel.getByRole("dialog", { name: `Remover ${nome} da equipe?` });
  await janela.getByRole("button", { name: "Remover" }).click();
  await expect(janela).toBeHidden();
  await expect(linha(doResponsavel, nome)).toContainText("Removido");
  await expect(linha(doResponsavel, nome).getByRole("button", { name: "Remover" })).toHaveCount(0);
  await doResponsavel.context().close();

  // O removido, já logado, perde o acesso na próxima página. A conta continua.
  await doRemovido.goto("/assinante");
  await expect(doRemovido).toHaveURL(/\/acesso-suspenso$/);
  await expect(doRemovido.getByRole("heading", { name: "Você não faz mais parte da equipe" })).toBeVisible();
  expect(await contaPorEmail(removido.email)).not.toBeNull();
  await doRemovido.context().close();
});

test("convite de imobiliária bloqueada não serve enquanto ela está bloqueada", async ({ browser }) => {
  const imobC = await criarImobiliaria(`Norte Equipe ${unico()}`);
  const doResponsavel = await paginaCom(browser, imobC.sessao);
  const caminho = await convidar(doResponsavel, null);
  await doResponsavel.context().close();

  await mudarAssinatura(imobC.id, "ativo", true);
  const visitante = await paginaCom(browser);
  await visitante.goto(caminho);
  await expect(visitante.getByText("A imobiliária deste convite está sem acesso ao PAUTA agora.")).toBeVisible();
  await expect(visitante.getByRole("button", { name: "Aceitar convite e entrar" })).toHaveCount(0);

  // Desbloqueada, o mesmo link volta a valer (não foi gasto).
  await mudarAssinatura(imobC.id, "ativo");
  await visitante.goto(caminho);
  await expect(visitante.getByRole("button", { name: "Aceitar convite e entrar" })).toBeVisible();
  await visitante.context().close();
});

test("o corretor não convida nem remove chamando as actions direto", async ({ browser }) => {
  const nome = `Alvo Action ${test.info().project.name}`;
  const alvo = await criarCorretor(imobA, nome);
  const colega = await criarCorretor(imobA, `Colega Action ${test.info().project.name}`);
  const sessaoColega = await entrarComo(colega.email);

  // Grava as requisições do "Copiar link" e do "Remover" na tela do responsável,
  // sem deixá-las chegar. Para a tela, é como a conexão cair: ela mostra o aviso
  // e continua de pé.
  const pagina = await paginaCom(browser, imobA.sessao);
  await pagina.goto("/assinante/equipe");
  const gravadas: Request[] = [];
  await pagina.route("**/assinante/equipe**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravadas.push(rota.request());
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await pagina.getByRole("button", { name: /^Copiar link/ }).click();
  await expect.poll(() => gravadas.length).toBe(1);
  await expect(pagina.getByText("Não foi possível falar com o PAUTA.").first()).toBeVisible();
  await linha(pagina, nome).getByRole("button", { name: "Remover" }).click();
  const janela = pagina.getByRole("dialog", { name: `Remover ${nome} da equipe?` });
  await janela.getByRole("button", { name: "Remover" }).click();
  await expect.poll(() => gravadas.length).toBe(2);
  await expect(janela.getByText("Não foi possível falar com o PAUTA.")).toBeVisible();
  const [convidarGravada, removerGravada] = await Promise.all(
    gravadas.map(async (requisicao) => ({
      endereco: requisicao.url(),
      corpo: requisicao.postDataBuffer()!,
      cabecalhos: Object.fromEntries(
        Object.entries(await requisicao.allHeaders()).filter(([chave]) => !chave.startsWith(":") && chave !== "cookie"),
      ),
    })),
  );
  await pagina.context().close();

  const chamar = async (cookies: Sessao["cookies"], gravada: typeof convidarGravada) => {
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    await contexto.addCookies(cookies);
    await contexto.request.post(gravada.endereco, { headers: gravada.cabecalhos, data: gravada.corpo, maxRedirects: 0 });
    await contexto.close();
  };
  const convitesDaA = async () =>
    (await clienteAdmin().from("convites").select("id", { count: "exact", head: true }).eq("assinante_id", imobA.assinanteId)).count;
  const removidoEm = async () =>
    (await clienteAdmin().from("perfis").select("removido_em").eq("id", alvo.id).single()).data!.removido_em;

  // O corretor manda as duas requisições: nada muda.
  const antes = await convitesDaA();
  await chamar(sessaoColega.cookies, convidarGravada);
  await chamar(sessaoColega.cookies, removerGravada);
  expect(await convitesDaA()).toBe(antes);
  expect(await removidoEm()).toBeNull();

  // O responsável manda as mesmas requisições: valem (prova que elas funcionam).
  await chamar(imobA.sessao.cookies, convidarGravada);
  await chamar(imobA.sessao.cookies, removerGravada);
  expect(await convitesDaA()).toBe(antes! + 1);
  expect(await removidoEm()).not.toBeNull();
});

test("o corretor perde o acesso quando a imobiliária vence e volta quando ela paga", async ({ browser }) => {
  const imobC = await criarImobiliaria(`Sul Equipe ${unico()}`);
  const corretor = await criarCorretor(imobC, "Elisa Vencida");
  const doCorretor = await paginaCom(browser, await entrarComo(corretor.email));
  await doCorretor.goto("/assinante");
  await expect(doCorretor).toHaveURL(/\/assinante$/);

  await mudarAssinatura(imobC.id, "vencido");
  await doCorretor.goto("/assinante");
  await expect(doCorretor).toHaveURL(/\/acesso-suspenso$/);
  await expect(doCorretor.getByText(`A mensalidade da ${imobC.nome} venceu.`)).toBeVisible();

  await mudarAssinatura(imobC.id, "ativo");
  await doCorretor.goto("/assinante");
  await expect(doCorretor).toHaveURL(/\/assinante$/);
  await doCorretor.context().close();
});

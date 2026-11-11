import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { apagarContas, assinaturaDoContrato, clienteAdmin, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// Conferência do contrato pelo admin (RF26, RF32, RNF05): a fila, os três itens, aprovar
// com valor final e comissão, recusar com motivo e a tela que ficou velha. O envio pelo
// corretor está no contratos-envio.spec.ts; as barreiras do banco, no testar_rls.sql.
//
// O banco é compartilhado: a fila pode ter contratos de outros testes, por isso cada teste
// abre o próprio contrato pelo ?id=. Os imóveis de teste usam preços 7.778.xxx.

test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-contrato-conf-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
const PDF = new TextEncoder().encode("%PDF-1.7\nContrato de teste do PAUTA\n%%EOF\n");

type Conta = "adm" | "ana";
const sessoes = {} as Record<Conta | "beto" | "dono", Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta | "beto" | "dono", string>;
let tipo: number;
let bairro: number;
let preco = 7_778_000;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona da Venda", telefone: "48999990040" });
  ids.ana = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana Corretora", telefone: "48999990041", creci: `${unico()}-F` });
  ids.beto = await criarConta(email("beto"), { tipo: "autonomo", nome: "Beto Corretor", telefone: "48999990042", creci: `${unico()}-F` });
  ids.adm = await criarConta(email("adm"), { tipo: "proprietario", nome: "Equipe PAUTA", telefone: "48999990043" });
  await mudarAssinatura(ids.ana, "ativo");
  await mudarAssinatura(ids.beto, "ativo");
  await tornarAdmin(ids.adm);
  for (const conta of ["dono", "ana", "beto", "adm"] as const) sessoes[conta] = await entrarComo(email(conta));
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId } = test.info().project.use;
  const contexto = await browser.newContext({
    baseURL: ORIGEM, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId,
  });
  await contexto.addCookies(sessoes[conta].cookies);
  return contexto.newPage();
}

// Imóvel com a proposta aceita da Ana (R$ 7.000.000) e o contrato dela em análise. Com
// outraAceita, o Beto também tem proposta aceita no mesmo imóvel.
async function contratoEmAnalise(titulo: string, { outraAceita = false } = {}) {
  const agora = Date.now();
  preco += 1;
  const { data: imovel, error } = await clienteAdmin()
    .from("imoveis")
    .insert({
      proprietario_id: ids.dono,
      titulo,
      descricao: "Casa de teste.",
      tipo_id: tipo,
      endereco: "Rua da Venda, 20",
      bairro_id: bairro,
      preco,
      quartos: 3,
      banheiros: 2,
      vagas: 1,
      area: 150,
      status: "disponivel",
      termo_versao: "2026-10-provisorio",
      termo_aceito_em: new Date(agora).toISOString(),
      exclusividade_inicio: new Date(agora).toISOString(),
      exclusividade_fim: new Date(agora + 180 * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;

  const propor = async (conta: "ana" | "beto", valor: number) => {
    const { data, error: erro } = await sessoes[conta].cliente.rpc("enviar_proposta", {
      p_imovel: imovel.id,
      p_valor: valor,
      p_forma: "a_vista",
      p_condicoes: "Escritura em 60 dias",
    });
    if (erro) throw erro;
    const { error: erroAceite } = await sessoes.dono.cliente.rpc("aceitar_proposta", { p_proposta: data });
    if (erroAceite) throw erroAceite;
    return data as string;
  };
  const proposta = await propor("ana", 7_000_000);
  const outra = outraAceita ? await propor("beto", 6_900_000) : undefined;

  const caminho = `${proposta}/${crypto.randomUUID()}.pdf`;
  const balde = sessoes.ana.cliente.storage.from("contratos");
  const { data: link, error: erroLink } = await balde.createSignedUploadUrl(caminho);
  if (erroLink) throw erroLink;
  const envio = await balde.uploadToSignedUrl(caminho, link.token, new Blob([PDF], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (envio.error) throw envio.error;
  const { data: contrato, error: erroContrato } = await sessoes.ana.cliente.rpc("enviar_contrato", {
    p_proposta: proposta,
    p_caminho: caminho,
    p_nome: "contrato-assinado.pdf",
    p_assinatura: await assinaturaDoContrato(proposta, caminho, ids.ana),
  });
  if (erroContrato) throw erroContrato;
  return { imovel: imovel.id as string, proposta, outra, contrato: contrato as string };
}

const admin = clienteAdmin;
const statusDo = async (contrato: string) => (await admin().from("contratos").select("status, motivo_recusa").eq("id", contrato).single()).data;
const vendaDo = async (imovel: string) =>
  (await admin().from("vendas").select("valor_final, comissao_valor, comissao_paga_em").eq("imovel_id", imovel).maybeSingle()).data;

async function marcarItens(page: Page) {
  for (const item of ["Assinado por vendedor", "Valor e imóvel batem", "Cláusula da comissão"]) {
    await page.getByRole("checkbox", { name: new RegExp(item) }).check();
  }
}

const janela = (page: Page, nome: string) => page.getByRole("dialog", { name: nome });

test("o admin confere, ajusta o valor final e registra a venda numa operação só", async ({ browser }) => {
  const titulo = "Casa conferida e vendida";
  const { imovel, outra, contrato } = await contratoEmAnalise(titulo, { outraAceita: true });
  const page = await paginaDe(browser, "adm");

  // O painel leva à fila.
  await page.goto("/admin");
  await page.getByRole("link", { name: /Contratos para conferir/ }).click();
  await expect(page).toHaveURL(/\/admin\/contratos/);

  await page.goto(`/admin/contratos?id=${contrato}`);
  const principal = page.getByRole("main");
  await expect(principal.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(principal).toContainText("Proprietário: Dona da Venda");
  await expect(principal).toContainText("Ana Corretora");
  await expect(principal).toContainText("contrato-assinado.pdf");
  await expect(principal).toContainText("Beto Corretor, R$ 6.900.000, aceita");

  // Aprovar só libera com os três itens marcados.
  const aprovar = page.getByRole("button", { name: "Aprovar", exact: true });
  await expect(aprovar).toBeDisabled();
  await marcarItens(page);
  await aprovar.click();

  const folha = janela(page, "Aprovar e registrar a venda");
  await expect(folha).toContainText("1 outra proposta em aberto é recusada");
  await expect(folha.getByLabel("Valor final do contrato (R$)")).toHaveValue("7.000.000");

  // Comissão maior que o valor final: a action recusa e a janela mostra.
  await folha.getByLabel("Valor final do contrato (R$)").fill("6.950.000");
  await folha.getByLabel(/Comissão do PAUTA/).fill("7.000.000");
  await folha.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(folha.getByRole("alert")).toHaveText("A comissão precisa ser maior que zero e não pode passar do valor final.");
  expect((await statusDo(contrato))?.status).toBe("em_analise");

  await folha.getByLabel(/Comissão do PAUTA/).fill("69.500");
  await folha.getByRole("checkbox", { name: "A comissão já foi paga" }).check();
  await folha.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(page.getByRole("status")).toHaveText("Venda registrada");

  // A tela Vendido (AdmVendido): valor final, o que mudou e a comissão.
  const vendido = page.getByRole("main");
  await expect(vendido).toContainText("vendida por R$ 6.950.000");
  await expect(vendido).toContainText("pelo corretor Ana Corretora");
  await expect(vendido).toContainText("A proposta de Beto Corretor (R$ 6.900.000) foi recusada");
  await expect(vendido).toContainText("R$ 69.500");
  await expect(vendido.getByText(/^Paga em /)).toBeVisible();

  expect((await statusDo(contrato))?.status).toBe("aprovado");
  expect(await vendaDo(imovel)).toMatchObject({ valor_final: 6_950_000, comissao_valor: 69_500 });
  expect((await vendaDo(imovel))?.comissao_paga_em).not.toBeNull();
  expect((await admin().from("imoveis").select("status").eq("id", imovel).single()).data?.status).toBe("vendido");
  expect((await admin().from("propostas").select("status").eq("id", outra!).single()).data?.status).toBe("recusada");

  // Conferido, sai da fila.
  await page.getByRole("button", { name: "Próximo da fila" }).click();
  await expect(page.getByRole("main")).not.toContainText(titulo);
});

test("recusar exige motivo, devolve o contrato e o imóvel segue em negociação", async ({ browser }) => {
  const titulo = "Casa com contrato devolvido";
  const { imovel, contrato } = await contratoEmAnalise(titulo);
  const page = await paginaDe(browser, "adm");
  await page.goto(`/admin/contratos?id=${contrato}`);

  // Recusar não depende dos três itens.
  await page.getByRole("button", { name: "Recusar", exact: true }).click();
  const folha = janela(page, "Recusar contrato");
  await folha.getByLabel("Motivo (o corretor vai ler)").fill("   ");
  await folha.getByRole("button", { name: "Recusar contrato" }).click();
  await expect(folha).toContainText("Escreva o motivo");
  expect((await statusDo(contrato))?.status).toBe("em_analise");

  await folha.getByLabel("Motivo (o corretor vai ler)").fill("Falta a cláusula da comissão do PAUTA.");
  await folha.getByRole("button", { name: "Recusar contrato" }).click();
  await expect(page.getByRole("status")).toHaveText("Contrato devolvido");
  await expect(page.getByRole("main")).toContainText("Ana Corretora vê o motivo em Negociações");

  expect(await statusDo(contrato)).toEqual({ status: "recusado", motivo_recusa: "Falta a cláusula da comissão do PAUTA." });
  expect((await admin().from("imoveis").select("status").eq("id", imovel).single()).data?.status).toBe("disponivel");
  expect(await vendaDo(imovel)).toBeNull();
});

test("tela velha: contrato conferido por outra pessoa não é aprovado de novo", async ({ browser }) => {
  const titulo = "Casa conferida em outra tela";
  const { imovel, contrato } = await contratoEmAnalise(titulo);
  const page = await paginaDe(browser, "adm");
  await page.goto(`/admin/contratos?id=${contrato}`);
  await marcarItens(page);

  const { error } = await sessoes.adm.cliente.rpc("recusar_contrato", { p_contrato: contrato, p_motivo: "Recusado em outra tela" });
  expect(error).toBeNull();

  await page.getByRole("button", { name: "Aprovar", exact: true }).click();
  await janela(page, "Aprovar e registrar a venda").getByLabel(/Comissão do PAUTA/).fill("70.000");
  await janela(page, "Aprovar e registrar a venda").getByRole("button", { name: "Confirmar venda" }).click();
  // A tela recarrega: o contrato aparece como já conferido, sem os botões.
  await expect(page.getByRole("status")).toHaveText("Contrato já conferido");
  await expect(page.getByRole("main")).toContainText("Motivo: Recusado em outra tela");
  await expect(page.getByRole("button", { name: "Aprovar", exact: true })).toHaveCount(0);
  expect((await statusDo(contrato))?.status).toBe("recusado");
  expect(await vendaDo(imovel)).toBeNull();
});

test("corretor sem acesso: a tela avisa e o contrato pode ser aprovado", async ({ browser }) => {
  const titulo = "Casa de corretor bloqueado";
  const { contrato } = await contratoEmAnalise(titulo);
  await mudarAssinatura(ids.ana, "ativo", true);
  try {
    const page = await paginaDe(browser, "adm");
    await page.goto(`/admin/contratos?id=${contrato}`);
    await expect(page.getByRole("main")).toContainText("O corretor está sem acesso ao PAUTA");
    await marcarItens(page);
    await page.getByRole("button", { name: "Aprovar", exact: true }).click();
    await janela(page, "Aprovar e registrar a venda").getByLabel(/Comissão do PAUTA/).fill("70.000");
    await janela(page, "Aprovar e registrar a venda").getByRole("button", { name: "Confirmar venda" }).click();
    await expect(page.getByRole("status")).toHaveText("Venda registrada");
    expect((await statusDo(contrato))?.status).toBe("aprovado");
  } finally {
    await mudarAssinatura(ids.ana, "ativo");
  }
});

// Clica, deixa a tela mandar a Server Action e guarda a requisição, sem deixá-la chegar.
async function gravarAction(page: Page, clicar: () => Promise<void>) {
  let gravada: Request | undefined;
  await page.route("**/admin/contratos**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await clicar();
  await expect.poll(() => gravada).toBeDefined();
  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  return { url: new URL(gravada!.url()).pathname, cabecalhos, corpo: gravada!.postData()! };
}

test("o corretor não aprova contrato nem chamando a action do admin direto", async ({ browser }) => {
  const titulo = "Casa da action do admin";
  const { imovel, contrato } = await contratoEmAnalise(titulo);
  const page = await paginaDe(browser, "adm");
  await page.goto(`/admin/contratos?id=${contrato}`);
  await marcarItens(page);
  await page.getByRole("button", { name: "Aprovar", exact: true }).click();
  await janela(page, "Aprovar e registrar a venda").getByLabel(/Comissão do PAUTA/).fill("70.000");
  const acao = await gravarAction(page, () => janela(page, "Aprovar e registrar a venda").getByRole("button", { name: "Confirmar venda" }).click());

  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes.ana.cookies);
  await contexto.request.post(acao.url, { headers: acao.cabecalhos, data: acao.corpo, maxRedirects: 0 });
  await contexto.close();

  expect((await statusDo(contrato))?.status).toBe("em_analise");
  expect(await vendaDo(imovel)).toBeNull();

  // O corretor também não abre a tela.
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/admin/contratos?id=${contrato}`);
  await expect(ana).not.toHaveURL(/\/admin\//);
});

test("a comissão aparece no painel, é marcada como paga e pode ser desfeita", async ({ browser }) => {
  const titulo = "Casa da comissão a receber";
  const { imovel, contrato } = await contratoEmAnalise(titulo);
  const { error } = await sessoes.adm.cliente.rpc("aprovar_contrato", {
    p_contrato: contrato,
    p_valor_final: 7_000_000,
    p_comissao: 70_000,
    p_comissao_paga: false,
  });
  expect(error).toBeNull();

  const page = await paginaDe(browser, "adm");
  // O link antigo do contrato abre a tela Vendido, com a comissão a receber.
  await page.goto(`/admin/contratos?id=${contrato}`);
  await expect(page.getByRole("status")).toHaveText("Venda registrada");
  await expect(page.getByRole("main").getByText("A receber", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Voltar ao painel" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const linha = page.getByRole("listitem").filter({ hasText: titulo });
  await expect(linha).toContainText("Comissão: R$ 70.000");
  await expect(linha.getByText("A receber", { exact: true })).toBeVisible();
  await linha.getByRole("button", { name: "Marcar como paga" }).click();
  await expect(linha.getByText(/^Paga em /)).toBeVisible();
  expect((await vendaDo(imovel))?.comissao_paga_em).not.toBeNull();

  await linha.getByRole("button", { name: "Desfazer" }).click();
  await expect(linha.getByText("A receber", { exact: true })).toBeVisible();
  expect((await vendaDo(imovel))?.comissao_paga_em).toBeNull();
});

import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// Envio do contrato pela tela de Negociações (RF25, RNF08): a janela, as actions e o que o
// corretor vê depois. O bucket pela API está no contratos-api.spec.ts; as barreiras do
// banco, no testar_rls.sql.
//
// Os imóveis de teste usam preços 7.777.xxx.

test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-contrato-envio-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = "http://localhost:3000";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
const NEGOCIACOES = "/assinante/negociacoes";
const PDF = Buffer.from("%PDF-1.7\nContrato de teste do PAUTA\n%%EOF\n");

type Conta = "ana" | "beto";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta | "dono", string>;
let adm: Awaited<ReturnType<typeof entrarComo>>["cliente"];
let tipo: number;
let bairro: number;
let preco = 7_777_000;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona do Contrato", telefone: "48999990060" });
  ids.ana = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana Corretora", telefone: "48999990061", creci: `${unico()}-F` });
  ids.beto = await criarConta(email("beto"), { tipo: "autonomo", nome: "Beto Corretor", telefone: "48999990062", creci: `${unico()}-F` });
  await mudarAssinatura(ids.ana, "ativo");
  await mudarAssinatura(ids.beto, "ativo");
  sessoes.ana = await entrarComo(email("ana"));
  sessoes.beto = await entrarComo(email("beto"));
  const admId = await criarConta(email("adm"), { tipo: "proprietario", nome: "Admin", telefone: "48999990063" });
  await tornarAdmin(admId);
  adm = (await entrarComo(email("adm"))).cliente;
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

// Imóvel disponível com uma proposta da Ana, aceita salvo pedido em contrário.
async function novaProposta(titulo: string, status = "aceita") {
  const agora = Date.now();
  preco += 1;
  const admin = clienteAdmin();
  const { data: imovel, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: ids.dono,
      titulo,
      descricao: "Casa de teste.",
      tipo_id: tipo,
      endereco: "Rua do Contrato, 10",
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
  const { data: proposta, error: erroProposta } = await admin
    .from("propostas")
    .insert({
      imovel_id: imovel.id,
      corretor_id: ids.ana,
      valor: 7_000_000,
      forma_pagamento: "a_vista",
      condicoes: "Escritura em 60 dias",
      status,
      respondida_em: status === "aguardando" ? null : new Date(agora).toISOString(),
    })
    .select("id")
    .single();
  if (erroProposta) throw erroProposta;
  return proposta.id as string;
}

const contratosDa = async (proposta: string) =>
  (await clienteAdmin().from("contratos").select("id, status, nome_arquivo, tamanho_bytes").eq("proposta_id", proposta).order("enviado_em")).data ?? [];
const arquivosDa = async (proposta: string) => (await clienteAdmin().storage.from("contratos").list(proposta)).data ?? [];

const cartao = (page: Page, titulo: string) => page.getByRole("listitem").filter({ hasText: titulo });
const janela = (page: Page) => page.getByRole("dialog");
const seletor = (page: Page) => janela(page).locator('input[type="file"]');
const anexo = (name: string, buffer: Buffer = PDF, mimeType = "application/pdf") => ({ name, mimeType, buffer });

async function abrirJanela(page: Page, titulo: string, botao = "Enviar contrato assinado") {
  await page.goto(NEGOCIACOES);
  await cartao(page, titulo).getByRole("button", { name: botao }).click();
  await expect(janela(page)).toBeVisible();
}

async function enviarPelaTela(page: Page, nome = "contrato-assinado.pdf") {
  await seletor(page).setInputFiles(anexo(nome));
  await janela(page).getByRole("button", { name: "Enviar para conferência" }).click();
  await expect(janela(page).getByRole("heading", { name: "Contrato em análise" })).toBeVisible();
}

// Deixa passar as actions anteriores e guarda a de número `posicao`, sem deixá-la chegar.
async function gravarAction(page: Page, posicao: number, clicar: () => Promise<void>) {
  let vistas = 0;
  let gravada: Request | undefined;
  await page.route(`**${NEGOCIACOES}**`, async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"] && ++vistas === posicao) {
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

async function chamarAction(browser: Browser, conta: Conta, acao: Awaited<ReturnType<typeof gravarAction>>) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta].cookies);
  const resposta = await contexto.request.post(acao.url, { headers: acao.cabecalhos, data: acao.corpo, maxRedirects: 0 });
  const texto = await resposta.text();
  await contexto.close();
  return texto;
}

test("o corretor envia o PDF pela janela, vê em análise e não retira mais a proposta", async ({ browser }) => {
  const titulo = "Casa contrato enviado";
  const proposta = await novaProposta(titulo);
  const ana = await paginaDe(browser, "ana");

  await ana.goto(NEGOCIACOES);
  await expect(cartao(ana, titulo)).toContainText("Colha as assinaturas fora do PAUTA");
  await expect(cartao(ana, titulo).getByRole("button", { name: "Retirar proposta" })).toBeVisible();

  await abrirJanela(ana, titulo);
  await expect(janela(ana)).toContainText(titulo);
  await expect(janela(ana).getByRole("button", { name: "Anexe o PDF para enviar" })).toBeDisabled();
  await seletor(ana).setInputFiles(anexo("contrato-assinado.pdf"));
  await expect(janela(ana)).toContainText("contrato-assinado.pdf");
  await janela(ana).getByRole("button", { name: "Trocar" }).click();
  await enviarPelaTela(ana);
  await janela(ana).getByRole("button", { name: "Ver minhas negociações" }).click();

  expect(await contratosDa(proposta)).toMatchObject([{ status: "em_analise", nome_arquivo: "contrato-assinado.pdf", tamanho_bytes: PDF.length }]);

  await ana.reload();
  const linha = cartao(ana, titulo);
  await expect(linha.getByText("Em análise pela equipe")).toBeVisible();
  await expect(linha.getByText("Contrato em análise", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(linha.getByRole("button", { name: "Retirar proposta" })).toHaveCount(0);
  await expect(linha.getByRole("button", { name: "Enviar contrato assinado" })).toHaveCount(0);
});

test("a tela recusa o que não é PDF e o que passa de 20 MB, sem falar com o servidor", async ({ browser }) => {
  const titulo = "Casa contrato arquivo errado";
  const proposta = await novaProposta(titulo);
  const ana = await paginaDe(browser, "ana");
  await abrirJanela(ana, titulo);

  await seletor(ana).setInputFiles(anexo("foto.png", PDF, "image/png"));
  await expect(janela(ana).getByRole("alert")).toHaveText("Escolha um arquivo PDF.");

  await seletor(ana).setInputFiles(anexo("grande.pdf", Buffer.alloc(20 * 1024 * 1024 + 1)));
  await expect(janela(ana).getByRole("alert")).toHaveText("Envie um PDF de até 20 MB.");
  await expect(janela(ana).getByRole("button", { name: "Anexe o PDF para enviar" })).toBeDisabled();
  expect(await arquivosDa(proposta)).toEqual([]);
});

test("arquivo declarado como PDF com outro conteúdo é recusado e apagado", async ({ browser }) => {
  const titulo = "Casa contrato falso";
  const proposta = await novaProposta(titulo);
  const ana = await paginaDe(browser, "ana");
  await abrirJanela(ana, titulo);

  await seletor(ana).setInputFiles(anexo("falso.pdf", Buffer.from("isto não é um pdf")));
  await janela(ana).getByRole("button", { name: "Enviar para conferência" }).click();
  await expect(janela(ana).getByRole("alert")).toHaveText("Este arquivo não é um PDF. Escolha o PDF do contrato.");

  expect(await contratosDa(proposta)).toEqual([]);
  await expect.poll(() => arquivosDa(proposta)).toEqual([]);
});

test("o PDF com a marca depois do começo do arquivo é aceito", async ({ browser }) => {
  const titulo = "Casa contrato marca adiante";
  const proposta = await novaProposta(titulo);
  const ana = await paginaDe(browser, "ana");
  await abrirJanela(ana, titulo);

  await seletor(ana).setInputFiles(anexo("gerado.pdf", Buffer.concat([Buffer.from("\n\n  "), PDF])));
  await janela(ana).getByRole("button", { name: "Enviar para conferência" }).click();
  await expect(janela(ana).getByRole("heading", { name: "Contrato em análise" })).toBeVisible();
  expect(await contratosDa(proposta)).toHaveLength(1);
});

test("proposta sem aceite não mostra o envio, e a action é barrada mesmo chamada direto", async ({ browser }) => {
  const titulo = "Casa contrato sem aceite";
  const semAceite = await novaProposta(titulo, "aguardando");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(NEGOCIACOES);
  await expect(cartao(ana, titulo).getByRole("button", { name: "Retirar proposta" })).toBeVisible();
  await expect(cartao(ana, titulo).getByRole("button", { name: "Enviar contrato assinado" })).toHaveCount(0);

  // A action gravada numa proposta aceita, que depois deixa de estar aceita.
  const tituloAceita = "Casa contrato aceite desfeito";
  const proposta = await novaProposta(tituloAceita);
  await abrirJanela(ana, tituloAceita);
  await seletor(ana).setInputFiles(anexo("contrato.pdf"));
  const pedir = await gravarAction(ana, 1, () => janela(ana).getByRole("button", { name: "Enviar para conferência" }).click());
  expect(await chamarAction(browser, "ana", pedir)).toContain('"token"');

  await clienteAdmin().from("propostas").update({ status: "aguardando", respondida_em: null }).eq("id", proposta);
  const barrada = await chamarAction(browser, "ana", pedir);
  expect(barrada).not.toContain('"token"');
  expect(barrada).toContain("não recebe contrato");
  expect(await contratosDa(proposta)).toEqual([]);
  expect(await contratosDa(semAceite)).toEqual([]);
});

test("outro corretor não registra o arquivo enviado pelo dono da proposta", async ({ browser }) => {
  const titulo = "Casa contrato de outro";
  const proposta = await novaProposta(titulo);
  const ana = await paginaDe(browser, "ana");
  await abrirJanela(ana, titulo);
  await seletor(ana).setInputFiles(anexo("contrato.pdf"));

  // A primeira action (pedir o link) passa e o arquivo sobe; a segunda (registrar) fica gravada.
  const confirmar = await gravarAction(ana, 2, () => janela(ana).getByRole("button", { name: "Enviar para conferência" }).click());
  await chamarAction(browser, "beto", confirmar);
  expect(await contratosDa(proposta)).toEqual([]);
  expect(await arquivosDa(proposta)).toHaveLength(1);

  // A mesma chamada, feita por quem pode, passa: o que barrou foi a conta.
  await chamarAction(browser, "ana", confirmar);
  expect(await contratosDa(proposta)).toMatchObject([{ status: "em_analise" }]);
});

test("contrato recusado mostra o motivo, deixa retirar e pode ser reenviado", async ({ browser }) => {
  const titulo = "Casa contrato recusado";
  const proposta = await novaProposta(titulo);
  const ana = await paginaDe(browser, "ana");
  await abrirJanela(ana, titulo);
  await enviarPelaTela(ana, "primeiro.pdf");

  const [{ id }] = await contratosDa(proposta);
  const { error } = await adm.rpc("recusar_contrato", { p_contrato: id, p_motivo: "Falta a assinatura do comprador" });
  expect(error).toBeNull();

  await ana.goto(NEGOCIACOES);
  const linha = cartao(ana, titulo);
  await expect(linha.getByText("Motivo do admin: Falta a assinatura do comprador")).toBeVisible();
  await expect(linha.getByText("Contrato recusado", { exact: true })).toBeVisible();
  await expect(linha.getByRole("button", { name: "Retirar proposta" })).toBeVisible();

  await abrirJanela(ana, titulo, "Reenviar contrato");
  await enviarPelaTela(ana, "segundo.pdf");
  expect((await contratosDa(proposta)).map((contrato) => [contrato.status, contrato.nome_arquivo])).toEqual([
    ["recusado", "primeiro.pdf"],
    ["em_analise", "segundo.pdf"],
  ]);
});

test("o corretor abre o próprio PDF e, aprovado, vê o imóvel vendido", async ({ browser }) => {
  const titulo = "Casa contrato aprovado";
  const proposta = await novaProposta(titulo);
  const ana = await paginaDe(browser, "ana");
  await abrirJanela(ana, titulo);
  await enviarPelaTela(ana);

  await ana.reload();
  // A resposta do Storage diz que o link funcionou, abra o navegador o PDF ou baixe o arquivo.
  const resposta = ana.context().waitForEvent("response", (r) => r.url().includes("/object/sign/contratos/"));
  await cartao(ana, titulo).getByRole("button", { name: "Ver contrato" }).click();
  expect((await resposta).ok()).toBe(true);

  const [{ id }] = await contratosDa(proposta);
  const { error } = await adm.rpc("aprovar_contrato", { p_contrato: id, p_valor_final: 7_000_000, p_comissao: 70_000, p_comissao_paga: false });
  expect(error).toBeNull();

  await ana.goto(NEGOCIACOES);
  const linha = cartao(ana, titulo);
  await expect(linha.getByText("Vendido", { exact: true })).toBeVisible();
  await expect(linha.getByText("Contrato aprovado pela equipe.")).toBeVisible();
  await expect(linha.getByRole("button", { name: "Retirar proposta" })).toHaveCount(0);
  await expect(linha.getByRole("button", { name: "Ver contrato" })).toBeVisible();
});

import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { diaDe, instanteDe, somarDias } from "../src/lib/horariosDeVisita";
import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura } from "./apoio/supabase";

// Propostas, Etapa 8 (RF20, RF23, RF24, RNF07): o corretor envia pela página do imóvel,
// o proprietário aceita, recusa ou desfaz o aceite na página do imóvel, e o catálogo
// mostra "Em negociação" com pelo menos uma aceita. As barreiras completas estão no
// testar_rls.sql; aqui ficam as telas e as actions.
//
// O banco é compartilhado: os imóveis de teste usam preços 7.774.xxx.

// Os fluxos abrem várias sessões e telas: não cabem nos 30 s do padrão.
test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-proposta-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = "http://localhost:3000";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
const TELEFONE_DA_DONA = "48999990090";

type Conta = "dono" | "outraDona" | "ana" | "beto" | "cida" | "bloqueado";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;
let tipo: number;
let bairro: number;
let preco = 7_774_000;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona Proposta", telefone: TELEFONE_DA_DONA });
  ids.outraDona = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Dona", telefone: "48999990091" });
  ids.ana = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana Corretora", telefone: "48999990092", creci: `${unico()}-F` });
  ids.beto = await criarConta(email("beto"), { tipo: "autonomo", nome: "Beto Corretor", telefone: "48999990093", creci: `${unico()}-F` });
  ids.cida = await criarConta(email("cida"), { tipo: "autonomo", nome: "Cida Corretora", telefone: "48999990094", creci: `${unico()}-F` });
  ids.bloqueado = await criarConta(email("bloqueado"), { tipo: "autonomo", nome: "Bia Bloqueada", telefone: "48999990095", creci: `${unico()}-F` });
  await mudarAssinatura(ids.ana, "ativo");
  await mudarAssinatura(ids.beto, "ativo");
  await mudarAssinatura(ids.cida, "ativo");
  await mudarAssinatura(ids.bloqueado, "ativo", true);
  for (const [conta, nome] of [["dono", "dono"], ["outraDona", "outra"], ["ana", "ana"], ["beto", "beto"], ["cida", "cida"], ["bloqueado", "bloqueado"]] as [Conta, string][]) {
    sessoes[conta] = await entrarComo(email(nome));
  }
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

async function criarImovel(titulo: string, status = "disponivel") {
  const agora = Date.now();
  preco += 1;
  const { data, error } = await clienteAdmin()
    .from("imoveis")
    .insert({
      proprietario_id: ids.dono,
      titulo,
      descricao: "Casa de teste das propostas.",
      tipo_id: tipo,
      endereco: "Rua das Propostas, 10",
      bairro_id: bairro,
      preco,
      quartos: 3,
      banheiros: 2,
      vagas: 1,
      area: 150,
      status,
      termo_versao: "2026-10-provisorio",
      termo_aceito_em: new Date(agora).toISOString(),
      exclusividade_inicio: new Date(agora).toISOString(),
      exclusividade_fim: new Date(agora + 180 * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// Grava a proposta direto, para montar a situação de cada teste.
async function criarProposta(imovelId: string, corretor: Conta, status = "aguardando", extras: Record<string, unknown> = {}) {
  const { data, error } = await clienteAdmin()
    .from("propostas")
    .insert({
      imovel_id: imovelId,
      corretor_id: ids[corretor],
      valor: 7_000_000,
      forma_pagamento: "a_vista",
      condicoes: "Escritura em 60 dias",
      status,
      respondida_em: status === "aguardando" ? null : new Date().toISOString(),
      ...extras,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

const propostasDoImovel = async (imovelId: string) =>
  (await clienteAdmin().from("propostas").select("id, status, valor, corretor_id").eq("imovel_id", imovelId)).data ?? [];

const janela = (page: Page) => page.getByRole("dialog", { name: /Enviar proposta|Proposta enviada/ });
const botaoEnviar = (page: Page) => page.getByRole("button", { name: "Enviar proposta" });
const cartao = (page: Page, texto: string) => page.getByRole("listitem").filter({ hasText: texto });

// No celular as propostas ficam numa aba; no site, ao lado das visitas.
const paginaDasPropostas = (imovelId: string) => `/proprietario/imoveis/${imovelId}?aba=propostas`;

async function preencher(page: Page, dados: { valor: string; forma?: string; condicoes: string; comprador?: string }) {
  await janela(page).getByLabel("Valor da proposta (R$)").fill(dados.valor);
  if (dados.forma) await janela(page).getByLabel("Forma de pagamento").selectOption({ label: dados.forma });
  await janela(page).getByLabel("Condições").fill(dados.condicoes);
  if (dados.comprador) await janela(page).getByLabel("Nome do comprador (opcional)").fill(dados.comprador);
}

async function enviarPelaTela(page: Page, imovelId: string, dados: Parameters<typeof preencher>[1]) {
  await page.goto(`/assinante/imoveis/${imovelId}`);
  await botaoEnviar(page).first().click();
  await preencher(page, dados);
  await janela(page).getByRole("button", { name: "Enviar proposta" }).click();
  await expect(janela(page).getByRole("heading", { name: "Proposta enviada" })).toBeVisible();
}

// Clica, deixa a tela mandar a Server Action e guarda a requisição, sem deixá-la chegar.
async function gravarAction(page: Page, padrao: string, clicar: () => Promise<void>) {
  let gravada: Request | undefined;
  await page.route(padrao, async (rota) => {
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

async function chamarAction(browser: Browser, conta: Conta, acao: Awaited<ReturnType<typeof gravarAction>>, corpo = acao.corpo) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta].cookies);
  await contexto.request.post(acao.url, { headers: acao.cabecalhos, data: corpo, maxRedirects: 0 });
  await contexto.close();
}

test("duas propostas aceitas deixam o imóvel em negociação, até a última deixar de valer", async ({ browser }) => {
  const titulo = "Casa fluxo de proposta";
  const imovel = await criarImovel(titulo);

  // Os corretores enviam pela tela.
  const ana = await paginaDe(browser, "ana");
  await enviarPelaTela(ana, imovel, { valor: "7.500.000", forma: "Financiamento", condicoes: "Entrada de 40%", comprador: "Lucas Prado" });
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Aguardando resposta");
  await expect(cartao(ana, titulo)).toContainText("R$ 7.500.000");
  await expect(cartao(ana, titulo)).toContainText("Financiamento");
  await expect(cartao(ana, titulo)).toContainText("Lucas Prado");

  const beto = await paginaDe(browser, "beto");
  await enviarPelaTela(beto, imovel, { valor: "7.600.000", condicoes: "Escritura em 30 dias" });

  // Proposta sem resposta não muda o selo.
  const cida = await paginaDe(browser, "cida");
  const selo = async (status: string) => {
    await cida.goto(`/assinante/imoveis/${imovel}`);
    await expect(cida.getByRole("main").getByText(status, { exact: true })).toBeVisible();
  };
  await selo("Disponível");

  // A dona vê os dados dos corretores e aceita as duas.
  const dono = await paginaDe(browser, "dono");
  await dono.goto(paginaDasPropostas(imovel));
  const daAna = cartao(dono, "Ana Corretora");
  const doBeto = cartao(dono, "Beto Corretor");
  await expect(daAna).toContainText("R$ 7.500.000");
  await expect(daAna).toContainText("Entrada de 40%");
  await expect(daAna).toContainText("Comprador: Lucas Prado");
  await expect(daAna).toContainText("Corretor autônomo · CRECI");
  await expect(daAna).toContainText("(48) 99999-0092");
  await expect(daAna).toContainText(email("ana"));

  await daAna.getByRole("button", { name: "Aceitar" }).click();
  await expect(daAna).toContainText("Aceita");
  await selo("Em negociação");

  await doBeto.getByRole("button", { name: "Aceitar" }).click();
  await expect(doBeto).toContainText("Aceita");
  await selo("Em negociação");

  // Na lista da dona e no filtro do catálogo.
  await dono.goto("/proprietario");
  await expect(cartao(dono, titulo)).toContainText("Em negociação");
  await expect(cartao(dono, titulo)).toContainText("2 propostas");
  await cida.goto(`/assinante?preco_min=${preco}&preco_max=${preco}&status=negociacao`);
  await expect(cida.getByRole("main")).toContainText(titulo);

  // Ana vê a resposta.
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Aceita pelo proprietário em");

  // Desfazer uma mantém o selo; desfazer a última tira.
  await dono.goto(paginaDasPropostas(imovel));
  await daAna.getByRole("button", { name: "Desfazer aceite" }).click();
  await expect(daAna).toContainText("Nova");
  await selo("Em negociação");
  await doBeto.getByRole("button", { name: "Desfazer aceite" }).click();
  await expect(doBeto).toContainText("Nova");
  await selo("Disponível");

  expect((await propostasDoImovel(imovel)).map((proposta) => proposta.status)).toEqual(["aguardando", "aguardando"]);
});

test("depois de recusada, o corretor envia outra", async ({ browser }) => {
  const titulo = "Casa proposta recusada";
  const imovel = await criarImovel(titulo);
  await criarProposta(imovel, "ana");

  const dono = await paginaDe(browser, "dono");
  await dono.goto(paginaDasPropostas(imovel));
  await cartao(dono, "Ana Corretora").getByRole("button", { name: "Recusar" }).click();
  await expect(cartao(dono, "Ana Corretora")).toContainText("Recusada");
  await expect(cartao(dono, "Ana Corretora").getByRole("button")).toHaveCount(0);

  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await expect(ana.getByText("Sua última proposta foi recusada. Você pode enviar outra.")).toBeVisible();

  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Recusada");
  await cartao(ana, titulo).getByRole("link", { name: "Enviar outra proposta" }).click();
  await expect(janela(ana).getByRole("heading", { name: "Enviar proposta" })).toBeVisible();
  await preencher(ana, { valor: "7.200.000", condicoes: "Agora com sinal de 20%" });
  await janela(ana).getByRole("button", { name: "Enviar proposta" }).click();
  await expect(janela(ana).getByRole("heading", { name: "Proposta enviada" })).toBeVisible();
  expect((await propostasDoImovel(imovel)).map((proposta) => proposta.status).sort()).toEqual(["aguardando", "recusada"]);

  // Com a nova em aberto, a recusada não oferece enviar outra.
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo).filter({ hasText: "Aguardando resposta" })).toBeVisible();
  await expect(cartao(ana, titulo).getByRole("link", { name: "Enviar outra proposta" })).toHaveCount(0);
});

test("com proposta em aberto o botão some; retirar libera outra e tira a negociação", async ({ browser }) => {
  const titulo = "Casa proposta retirada";
  const imovel = await criarImovel(titulo);
  await criarProposta(imovel, "ana", "aceita");

  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await expect(ana.getByText("Sua proposta neste imóvel")).toBeVisible();
  await expect(botaoEnviar(ana)).toHaveCount(0);
  await expect(ana.getByRole("main").getByText("Em negociação", { exact: true })).toBeVisible();

  await ana.goto("/assinante/negociacoes");
  const linha = cartao(ana, titulo);
  await linha.getByRole("button", { name: "Retirar proposta" }).click();
  const confirmar = ana.getByRole("dialog", { name: "Retirar a proposta?" });
  await expect(confirmar).toContainText("mesmo já aceita pelo proprietário");
  await confirmar.getByRole("button", { name: "Retirar proposta" }).click();
  await expect(linha).toContainText("Retirada");
  await expect(linha.getByRole("button", { name: "Retirar proposta" })).toHaveCount(0);
  await expect(linha.getByRole("link", { name: "Enviar outra proposta" })).toBeVisible();

  await ana.goto(`/assinante/imoveis/${imovel}`);
  await expect(ana.getByRole("main").getByText("Disponível", { exact: true })).toBeVisible();
  await expect(botaoEnviar(ana).first()).toBeVisible();

  const dono = await paginaDe(browser, "dono");
  await dono.goto(paginaDasPropostas(imovel));
  await expect(cartao(dono, "Ana Corretora")).toContainText("Retirada");
});

test("a janela confere o valor, mostra a diferença do preço e não fecha com erro", async ({ browser }) => {
  const imovel = await criarImovel("Casa valor da proposta");
  const precoDoImovel = preco;
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await botaoEnviar(ana).first().click();

  await preencher(ana, { valor: "abc", condicoes: "Condições" });
  await janela(ana).getByRole("button", { name: "Enviar proposta" }).click();
  await expect(janela(ana).getByRole("alert")).toContainText("Escreva o valor em reais");

  await preencher(ana, { valor: "1.000.000", condicoes: "   " });
  await expect(janela(ana)).toContainText("abaixo do preço pedido.");
  await janela(ana).getByRole("button", { name: "Enviar proposta" }).click();
  await expect(janela(ana).getByRole("alert")).toContainText("Escreva as condições");

  await janela(ana).getByLabel("Valor da proposta (R$)").fill(precoDoImovel.toLocaleString("pt-BR"));
  await expect(janela(ana)).toContainText("Igual ao preço pedido.");
  await janela(ana).getByLabel("Valor da proposta (R$)").fill("9.000.000");
  await expect(janela(ana)).toContainText("acima do preço pedido.");

  expect(await propostasDoImovel(imovel)).toHaveLength(0);
});

test("a visita confirmada leva à proposta, já com a janela aberta", async ({ browser }) => {
  const titulo = "Casa visita e proposta";
  const imovel = await criarImovel(titulo);
  const { error } = await clienteAdmin().from("visitas").insert({
    imovel_id: imovel,
    corretor_id: ids.ana,
    horario: instanteDe(somarDias(diaDe(new Date()), 2), "09:00"),
    status: "confirmada",
  });
  if (error) throw error;

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/negociacoes?aba=visitas");
  await cartao(ana, titulo).getByRole("link", { name: "Enviar proposta" }).click();
  await expect(janela(ana).getByRole("heading", { name: "Enviar proposta" })).toBeVisible();

  await criarProposta(imovel, "ana");
  await ana.goto("/assinante/negociacoes?aba=visitas");
  await expect(cartao(ana, titulo)).toBeVisible();
  await expect(cartao(ana, titulo).getByRole("link", { name: "Enviar proposta" })).toHaveCount(0);
});

test("imóvel vendido: a proposta fica como histórico, sem link e sem ações", async ({ browser }) => {
  const titulo = "Casa proposta vendida";
  const imovel = await criarImovel(titulo, "vendido");
  await criarProposta(imovel, "ana", "aceita");
  await criarProposta(imovel, "beto");

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Aceita");
  await expect(cartao(ana, titulo).getByRole("link", { name: titulo })).toHaveCount(0);
  await expect(cartao(ana, titulo).getByRole("button", { name: "Retirar proposta" })).toHaveCount(0);

  const dono = await paginaDe(browser, "dono");
  await dono.goto(paginaDasPropostas(imovel));
  await expect(dono.getByRole("main").getByText("Vendido", { exact: true })).toBeVisible();
  await expect(cartao(dono, "Ana Corretora").getByRole("button")).toHaveCount(0);
  await expect(cartao(dono, "Beto Corretor").getByRole("button", { name: "Aceitar" })).toHaveCount(0);
  await expect(cartao(dono, "Beto Corretor").getByRole("button", { name: "Recusar" })).toBeVisible();
});

test("nada da proposta chega a outro corretor, nem o contato da dona ao corretor", async ({ browser }) => {
  const titulo = "Casa proposta sigilosa";
  const imovel = await criarImovel(titulo);
  await criarProposta(imovel, "ana", "aceita", { nome_comprador: "Comprador Sigiloso" });

  // O outro corretor só vê o selo.
  const beto = await paginaDe(browser, "beto");
  const paginaDoBeto = await (await beto.goto(`/assinante/imoveis/${imovel}`))!.text();
  await expect(beto.getByRole("main").getByText("Em negociação", { exact: true })).toBeVisible();
  expect(paginaDoBeto).not.toContain("Comprador Sigiloso");
  expect(paginaDoBeto).not.toContain("Ana Corretora");
  await beto.goto("/assinante/negociacoes");
  await expect(beto.getByRole("main")).not.toContainText(titulo);
  const lido = await sessoes.beto.cliente.from("propostas").select("id").eq("imovel_id", imovel);
  expect(lido.data).toEqual([]);

  // O corretor da proposta não recebe o contato da dona, que não quis mostrar.
  const ana = await paginaDe(browser, "ana");
  const negociacoes = await (await ana.goto("/assinante/negociacoes"))!.text();
  expect(negociacoes).toContain(titulo);
  expect(negociacoes).not.toContain(TELEFONE_DA_DONA);
  expect(negociacoes).not.toContain(email("dono"));

  // A outra proprietária não vê nem pela tela nem pelo banco.
  const outra = await paginaDe(browser, "outraDona");
  const paginaDaOutra = await outra.goto(`/proprietario/imoveis/${imovel}`);
  await expect(outra.getByText("Página não encontrada")).toBeVisible();
  expect(await paginaDaOutra!.text()).not.toContain("Ana Corretora");
  const recebidas = await sessoes.outraDona.cliente.rpc("propostas_recebidas", { p_imovel: imovel });
  expect(recebidas.data).toEqual([]);
});

test("corretor bloqueado não envia, nem pela tela nem pela API", async ({ browser }) => {
  const imovel = await criarImovel("Casa proposta bloqueada");
  const bloqueado = await paginaDe(browser, "bloqueado");
  await bloqueado.goto(`/assinante/imoveis/${imovel}`);
  await expect(bloqueado).toHaveURL(/\/acesso-suspenso$/);
  await bloqueado.goto("/assinante/negociacoes");
  await expect(bloqueado).toHaveURL(/\/acesso-suspenso$/);
  const resposta = await sessoes.bloqueado.cliente.rpc("enviar_proposta", {
    p_imovel: imovel,
    p_valor: 1000,
    p_forma: "a_vista",
    p_condicoes: "Condições",
  });
  expect(resposta.error?.code).toBe("42501");
  expect(await propostasDoImovel(imovel)).toHaveLength(0);
});

test("action de proposta chamada por outro tipo não faz nada", async ({ browser }) => {
  const imovel = await criarImovel("Casa action da proposta");
  await criarProposta(imovel, "ana");

  const dono = await paginaDe(browser, "dono");
  await dono.goto(paginaDasPropostas(imovel));
  const aceitar = await gravarAction(dono, "**/proprietario/**", () =>
    cartao(dono, "Ana Corretora").getByRole("button", { name: "Aceitar" }).click(),
  );
  await dono.close();

  await chamarAction(browser, "ana", aceitar);
  expect((await propostasDoImovel(imovel))[0].status).toBe("aguardando");
  await chamarAction(browser, "outraDona", aceitar);
  expect((await propostasDoImovel(imovel))[0].status).toBe("aguardando");

  // A dona manda a requisição como gravada: vale (prova que ela estava certa).
  await chamarAction(browser, "dono", aceitar);
  expect((await propostasDoImovel(imovel))[0].status).toBe("aceita");
});

test("enviarProposta chamada direto respeita o tipo e confere os campos", async ({ browser }) => {
  const imovel = await criarImovel("Casa action do corretor");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await botaoEnviar(ana).first().click();
  await preencher(ana, { valor: "7.000.000", condicoes: "Condições de teste" });
  const enviar = await gravarAction(ana, "**/assinante/imoveis/**", () =>
    janela(ana).getByRole("button", { name: "Enviar proposta" }).click(),
  );
  await ana.close();
  expect(enviar.corpo).toContain("7.000.000");

  await chamarAction(browser, "dono", enviar);
  expect(await propostasDoImovel(imovel)).toHaveLength(0);
  await chamarAction(browser, "ana", enviar, enviar.corpo.replace("7.000.000", "abc"));
  expect(await propostasDoImovel(imovel)).toHaveLength(0);
  await chamarAction(browser, "ana", enviar, enviar.corpo.replace("a_vista", "fiado"));
  expect(await propostasDoImovel(imovel)).toHaveLength(0);

  await chamarAction(browser, "ana", enviar);
  expect(await propostasDoImovel(imovel)).toHaveLength(1);
});

test("textos longos não esticam as páginas", async ({ browser }) => {
  const titulo = "Casa proposta longa";
  const imovel = await criarImovel(titulo);
  const longa = "x".repeat(900);
  await criarProposta(imovel, "ana", "aguardando", { condicoes: longa, nome_comprador: "y".repeat(120) });

  const semEstourar = async (page: Page) => {
    const largura = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(largura).toBeLessThanOrEqual(0);
  };
  const dono = await paginaDe(browser, "dono");
  await dono.goto(paginaDasPropostas(imovel));
  await expect(cartao(dono, "Ana Corretora")).toBeVisible();
  await semEstourar(dono);

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toBeVisible();
  await semEstourar(ana);
});

test("as abas de Negociações ficam na URL, e a lista vazia explica o que fazer", async ({ browser }) => {
  const cida = await paginaDe(browser, "cida");
  await cida.goto("/assinante/negociacoes");
  await expect(cida.getByRole("link", { name: /^Propostas/ })).toHaveAttribute("aria-current", "page");
  await expect(cida.getByText("Você ainda não enviou propostas")).toBeVisible();
  await cida.getByRole("link", { name: /^Visitas/ }).click();
  await expect(cida).toHaveURL(/aba=visitas/);
  await expect(cida.getByText("Você ainda não agendou visitas")).toBeVisible();
});

test("no celular, os dois botões ficam no rodapé sem precisar rolar", async ({ browser }, info) => {
  test.skip(info.project.name !== "celular", "o rodapé fixo é só do celular");
  const imovel = await criarImovel("Casa rodapé da proposta");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await expect(ana.getByRole("button", { name: "Agendar visita" })).toBeInViewport();
  await expect(botaoEnviar(ana)).toBeInViewport();
});

import { expect, test, type Browser, type Page } from "@playwright/test";

import { diaDe, diaEMes, instanteDe, nomeDoDia, somarDias } from "../src/lib/horariosDeVisita";
import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura } from "./apoio/supabase";

// Visitas, Etapa 7 (RF21, RF22, RNF07): o corretor agenda no calendário da página do
// imóvel, o proprietário responde na aba Visitas e o corretor vê a resposta em
// Negociações. Horário confirmado aparece fechado para todos, sem dizer quem marcou.
//
// O banco é compartilhado: os imóveis de teste usam preços 7.773.xxx.

// O fluxo inteiro abre três sessões e várias telas: não cabe nos 30 s do padrão.
test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-visita-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = "http://localhost:3000";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));

type Conta = "dono" | "outraDona" | "ana" | "beto" | "bloqueado";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;
let tipo: number;
let bairro: number;
let preco = 7_773_000;

const dia = somarDias(diaDe(new Date()), 2);

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona Visita", telefone: "48999990080" });
  ids.outraDona = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Dona", telefone: "48999990081" });
  ids.ana = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana Corretora", telefone: "48999990082", creci: `${unico()}-F` });
  ids.beto = await criarConta(email("beto"), { tipo: "autonomo", nome: "Beto Corretor", telefone: "48999990083", creci: `${unico()}-F` });
  ids.bloqueado = await criarConta(email("bloqueado"), { tipo: "autonomo", nome: "Bia Bloqueada", telefone: "48999990084", creci: `${unico()}-F` });
  await mudarAssinatura(ids.ana, "ativo");
  await mudarAssinatura(ids.beto, "ativo");
  await mudarAssinatura(ids.bloqueado, "ativo", true);
  sessoes.dono = await entrarComo(email("dono"));
  sessoes.outraDona = await entrarComo(email("outra"));
  sessoes.ana = await entrarComo(email("ana"));
  sessoes.beto = await entrarComo(email("beto"));
  sessoes.bloqueado = await entrarComo(email("bloqueado"));
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

async function criarImovel(titulo: string) {
  const agora = Date.now();
  preco += 1;
  const { data, error } = await clienteAdmin()
    .from("imoveis")
    .insert({
      proprietario_id: ids.dono,
      titulo,
      descricao: "Casa de teste das visitas.",
      tipo_id: tipo,
      endereco: "Rua das Visitas, 10",
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
  return data.id as string;
}

// Grava a visita direto, para montar a situação de cada teste.
async function criarVisita(imovelId: string, corretor: Conta, horario: string, status = "pendente") {
  const { error } = await clienteAdmin()
    .from("visitas")
    .insert({ imovel_id: imovelId, corretor_id: ids[corretor], horario, status });
  if (error) throw error;
}

function abrirCalendario(page: Page) {
  return page.getByRole("button", { name: "Agendar visita" }).click();
}

const janela = (page: Page) => page.getByRole("dialog", { name: /Agendar visita|Pedido enviado/ });
const nomeDoDiaNoCalendario = `${nomeDoDia(dia)}, ${diaEMes(dia)}`;
const cartao = (page: Page, titulo: string) => page.getByRole("listitem").filter({ hasText: titulo });

test("o corretor agenda, o proprietário confirma e o corretor vê a resposta", async ({ browser }) => {
  const titulo = "Casa fluxo de visita";
  const imovel = await criarImovel(titulo);

  // Corretor: agenda pelo calendário.
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await janela(ana).getByRole("button", { name: "14:00", exact: true }).click();
  await janela(ana).getByRole("textbox", { name: /Recado/ }).fill("Vou com um casal de clientes.");
  await janela(ana).getByRole("button", { name: new RegExp(`às 14:00$`) }).click();
  await expect(janela(ana).getByRole("heading", { name: "Pedido enviado" })).toBeVisible();
  await janela(ana).getByRole("button", { name: "Fechar" }).click();

  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Aguardando");
  await expect(cartao(ana, titulo)).toContainText(`${diaEMes(dia)} às 14:00`);

  // Proprietário: vê o pedido na lista, na aba e os dados do corretor.
  const dono = await paginaDe(browser, "dono");
  await dono.goto("/proprietario");
  await expect(cartao(dono, titulo)).toContainText("1 visita para confirmar");
  await dono.getByRole("link", { name: /^Visitas/ }).click();
  await expect(dono).toHaveURL(/\/proprietario\/visitas/);
  const pedido = dono.getByRole("listitem").filter({ hasText: "Ana Corretora" }).filter({ hasText: titulo });
  await expect(pedido).toContainText("Para confirmar");
  await expect(pedido).toContainText("Corretor autônomo · CRECI");
  await expect(pedido).toContainText("(48) 99999-0082");
  await expect(pedido).toContainText(email("ana"));
  await expect(pedido).toContainText("Vou com um casal de clientes.");

  await pedido.getByRole("button", { name: "Confirmar" }).click();
  await expect(pedido).toContainText("Confirmada");

  // A mesma visita aparece na página do imóvel.
  await dono.goto(`/proprietario/imoveis/${imovel}`);
  await expect(dono.getByRole("listitem").filter({ hasText: "Ana Corretora" })).toContainText("Confirmada");

  // Corretor: vê a resposta.
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Confirmada");

  // Outro corretor: o horário está fechado, e nada diz quem marcou.
  const beto = await paginaDe(browser, "beto");
  await beto.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(beto);
  await janela(beto).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await expect(janela(beto).getByRole("button", { name: "14:00, ocupado" })).toBeDisabled();
  await expect(janela(beto).getByRole("button", { name: "15:30", exact: true })).toBeEnabled();
  const html = await (await beto.request.get(`/assinante/imoveis/${imovel}`)).text();
  const dados = await (await beto.request.get(`/assinante/imoveis/${imovel}`, { headers: { RSC: "1" } })).text();
  for (const resposta of [html, dados]) {
    expect(resposta).not.toContain("Ana Corretora");
    expect(resposta).not.toContain(email("ana"));
  }
});

test("dois corretores pedem o mesmo horário: confirmar um recusa o outro", async ({ browser }) => {
  const titulo = "Casa dois pedidos";
  const imovel = await criarImovel(titulo);
  const horario = instanteDe(dia, "10:00");
  await criarVisita(imovel, "ana", horario);
  await criarVisita(imovel, "beto", horario);

  // Pedido dos outros não fecha o horário: um terceiro ainda veria livre.
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await expect(janela(ana).getByRole("button", { name: "10:00, você já pediu" })).toBeDisabled();
  await ana.close();

  const dono = await paginaDe(browser, "dono");
  await dono.goto(`/proprietario/imoveis/${imovel}`);
  const daAna = dono.getByRole("listitem").filter({ hasText: "Ana Corretora" });
  await expect(daAna).toContainText("Outro corretor pediu este horário");
  await daAna.getByRole("button", { name: "Confirmar" }).click();
  await expect(daAna).toContainText("Confirmada");
  await expect(dono.getByRole("listitem").filter({ hasText: "Beto Corretor" })).toContainText("Recusada");

  const beto = await paginaDe(browser, "beto");
  await beto.goto("/assinante/negociacoes");
  await expect(cartao(beto, titulo)).toContainText("Recusada");
});

test("o corretor pede vários horários no mesmo imóvel", async ({ browser }) => {
  const titulo = "Casa vários horários";
  const imovel = await criarImovel(titulo);
  await criarVisita(imovel, "ana", instanteDe(dia, "09:00"));

  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await janela(ana).getByRole("button", { name: "11:00", exact: true }).click();
  await janela(ana).getByRole("button", { name: /às 11:00$/ }).click();
  await expect(janela(ana).getByRole("heading", { name: "Pedido enviado" })).toBeVisible();
  await janela(ana).getByRole("button", { name: "Fechar" }).click();
  await expect(ana.getByRole("main").getByRole("listitem").filter({ hasText: /às (09|11):00/ })).toHaveCount(2);
});

test("horário ocupado no último instante mostra a mensagem certa", async ({ browser }) => {
  const imovel = await criarImovel("Casa disputada");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await janela(ana).getByRole("button", { name: "15:30", exact: true }).click();

  // Outro corretor foi confirmado depois de a tela abrir.
  await criarVisita(imovel, "beto", instanteDe(dia, "15:30"), "confirmada");
  await janela(ana).getByRole("button", { name: /às 15:30$/ }).click();
  await expect(janela(ana).getByRole("alert")).toContainText("acabou de ser ocupado");
});

test("recusar deixa o horário livre", async ({ browser }) => {
  const titulo = "Casa recusa";
  const imovel = await criarImovel(titulo);
  await criarVisita(imovel, "ana", instanteDe(dia, "11:00"));

  const dono = await paginaDe(browser, "dono");
  await dono.goto(`/proprietario/imoveis/${imovel}`);
  const pedido = dono.getByRole("listitem").filter({ hasText: "Ana Corretora" });
  await pedido.getByRole("button", { name: "Recusar" }).click();
  await expect(pedido).toContainText("Recusada");

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Recusada");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await expect(janela(ana).getByRole("button", { name: "11:00", exact: true })).toBeEnabled();
});

test("corretor e proprietário cancelam, e o horário reabre", async ({ browser }) => {
  const titulo = "Casa cancelada";
  const imovel = await criarImovel(titulo);
  await criarVisita(imovel, "ana", instanteDe(dia, "09:00"), "confirmada");
  await criarVisita(imovel, "beto", instanteDe(dia, "10:00"), "confirmada");

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/negociacoes");
  await cartao(ana, titulo).getByRole("button", { name: "Cancelar visita" }).click();
  await ana.getByRole("dialog", { name: "Cancelar a visita?" }).getByRole("button", { name: "Cancelar visita" }).click();
  await expect(cartao(ana, titulo)).toContainText("Cancelada");

  const dono = await paginaDe(browser, "dono");
  await dono.goto(`/proprietario/imoveis/${imovel}`);
  const doBeto = dono.getByRole("listitem").filter({ hasText: "Beto Corretor" });
  await doBeto.getByRole("button", { name: "Cancelar visita" }).click();
  await dono.getByRole("dialog", { name: "Cancelar a visita?" }).getByRole("button", { name: "Cancelar visita" }).click();
  await expect(doBeto).toContainText("Cancelada");

  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await expect(janela(ana).getByRole("button", { name: "09:00", exact: true })).toBeEnabled();
  await expect(janela(ana).getByRole("button", { name: "10:00", exact: true })).toBeEnabled();
});

test("a agenda mostra a semana e filtra pelo dia", async ({ browser }) => {
  const titulo = "Casa agenda";
  const imovel = await criarImovel(titulo);
  await criarVisita(imovel, "beto", instanteDe(dia, "17:00"), "confirmada");

  const dono = await paginaDe(browser, "dono");
  await dono.goto(`/proprietario/visitas?semana=${dia}`);
  if (test.info().project.name === "celular") {
    await dono.getByRole("link", { name: new RegExp(`^${nomeDoDia(dia)}, ${diaEMes(dia)}, `) }).click();
    await expect(dono.getByRole("heading", { name: `Visitas de ${nomeDoDia(dia).toLowerCase()}, ${diaEMes(dia)}` })).toBeVisible();
    await expect(cartao(dono, titulo)).toContainText("Beto Corretor");
    expect(await dono.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } else {
    const grade = dono.getByRole("table", { name: "Agenda da semana" });
    await expect(grade.getByRole("link", { name: /Beto Corretor/ }).first()).toBeVisible();
    await grade.getByRole("link", { name: /Casa agenda/ }).click();
    await expect(dono.getByRole("heading", { name: `Visitas de ${nomeDoDia(dia).toLowerCase()}, ${diaEMes(dia)}` })).toBeVisible();
  }
});

test("pedido sem resposta cujo horário passou aparece como Horário passou", async ({ browser }) => {
  const titulo = "Casa horário passado";
  const imovel = await criarImovel(titulo);
  await criarVisita(imovel, "ana", new Date(Date.now() - 3_600_000).toISOString());

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/negociacoes");
  await expect(cartao(ana, titulo)).toContainText("Horário passou");
  await expect(cartao(ana, titulo).getByRole("button", { name: "Cancelar visita" })).toHaveCount(0);
});

test("outra proprietária e corretor bloqueado não têm acesso", async ({ browser }) => {
  const titulo = "Casa protegida";
  const imovel = await criarImovel(titulo);
  await criarVisita(imovel, "ana", instanteDe(dia, "09:00"));
  const { data: visita } = await clienteAdmin().from("visitas").select("id").eq("imovel_id", imovel).single();

  const outra = await paginaDe(browser, "outraDona");
  await outra.goto("/proprietario/visitas");
  await expect(outra.getByText("Próximas visitas")).toBeVisible();
  await expect(outra.getByRole("main")).not.toContainText(titulo);
  await expect(outra.getByRole("main")).not.toContainText("Ana Corretora");

  // Chamando o banco direto, com a sessão dela.
  const resposta = await sessoes.outraDona.cliente.rpc("confirmar_visita", { p_visita: visita!.id });
  expect(resposta.error?.hint).toBe("visita_nao_encontrada");

  // O bloqueado não pede nem pela tela nem pela API.
  const bloqueado = await paginaDe(browser, "bloqueado");
  await bloqueado.goto(`/assinante/imoveis/${imovel}`);
  await expect(bloqueado).toHaveURL(/\/acesso-suspenso$/);
  await bloqueado.goto("/assinante/negociacoes");
  await expect(bloqueado).toHaveURL(/\/acesso-suspenso$/);
  const pedido = await sessoes.bloqueado.cliente.rpc("pedir_visita", { p_imovel: imovel, p_horario: instanteDe(dia, "10:00") });
  expect(pedido.error?.code).toBe("42501");
});

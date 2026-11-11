import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { diaDe, diaEMes, inicioDaSemana, instanteDe, mesDe, nomeDoDia, somarDias } from "../src/lib/horariosDeVisita";
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
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));

type Conta = "dono" | "outraDona" | "ana" | "beto" | "cida" | "dani" | "bloqueado";
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
  ids.cida = await criarConta(email("cida"), { tipo: "autonomo", nome: "Cida Corretora", telefone: "48999990085", creci: `${unico()}-F` });
  ids.dani = await criarConta(email("dani"), { tipo: "autonomo", nome: "Dani Corretora", telefone: "48999990086", creci: `${unico()}-F` });
  ids.bloqueado = await criarConta(email("bloqueado"), { tipo: "autonomo", nome: "Bia Bloqueada", telefone: "48999990084", creci: `${unico()}-F` });
  await mudarAssinatura(ids.ana, "ativo");
  await mudarAssinatura(ids.beto, "ativo");
  await mudarAssinatura(ids.cida, "ativo");
  await mudarAssinatura(ids.dani, "ativo");
  await mudarAssinatura(ids.bloqueado, "ativo", true);
  sessoes.dono = await entrarComo(email("dono"));
  sessoes.outraDona = await entrarComo(email("outra"));
  sessoes.ana = await entrarComo(email("ana"));
  sessoes.beto = await entrarComo(email("beto"));
  sessoes.cida = await entrarComo(email("cida"));
  sessoes.dani = await entrarComo(email("dani"));
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
async function criarVisita(imovelId: string, corretor: Conta, horario: string, status = "pendente", recado?: string) {
  const { error } = await clienteAdmin()
    .from("visitas")
    .insert({ imovel_id: imovelId, corretor_id: ids[corretor], horario, status, recado });
  if (error) throw error;
}

function abrirCalendario(page: Page) {
  return page.getByRole("button", { name: "Agendar visita" }).click();
}

const janela = (page: Page) => page.getByRole("dialog", { name: /Agendar visita|Pedido enviado/ });
const nomeDoDiaNoCalendario = `${nomeDoDia(dia)}, ${diaEMes(dia)}`;
const cartao = (page: Page, titulo: string) => page.getByRole("listitem").filter({ hasText: titulo });

const visitasDoImovel = async (imovelId: string) =>
  (await clienteAdmin().from("visitas").select("status, horario, corretor_id").eq("imovel_id", imovelId)).data ?? [];

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

  await ana.goto("/assinante/negociacoes?aba=visitas");
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
  await ana.goto("/assinante/negociacoes?aba=visitas");
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
    // Prova que a resposta é a página do imóvel, e não um redirecionamento.
    expect(resposta).toContain(titulo);
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

  // Pedido dos outros não fecha o horário: quem não pediu ainda vê livre.
  const cida = await paginaDe(browser, "cida");
  await cida.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(cida);
  await janela(cida).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await expect(janela(cida).getByRole("button", { name: "10:00", exact: true })).toBeEnabled();
  await cida.close();

  // Quem pediu vê o próprio pedido.
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
  await beto.goto("/assinante/negociacoes?aba=visitas");
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
  // O calendário se atualiza: o horário fecha e deixa de estar escolhido.
  await expect(janela(ana).getByRole("button", { name: "15:30, ocupado" })).toBeDisabled();
  await expect(janela(ana).getByRole("button", { name: "Pedir visita" })).toBeVisible();
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
  await ana.goto("/assinante/negociacoes?aba=visitas");
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
  await ana.goto("/assinante/negociacoes?aba=visitas");
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

// Decisão de 05/11/2026: pular para qualquer semana sem clicar semana a semana.
test("o calendário da agenda leva a qualquer mês e dia, e marca os dias com visita", async ({ browser }) => {
  const imovel = await criarImovel("Casa calendário");
  await criarVisita(imovel, "beto", instanteDe(dia, "14:00"), "confirmada");

  const dono = await paginaDe(browser, "dono");
  await dono.goto("/proprietario/visitas");
  const calendario = dono.getByRole("dialog", { name: "Escolher semana" });
  const tituloDoMes = calendario.getByRole("button", { name: "Escolher mês e ano" });

  // O dia com visita tem a marca no nome lido pelo leitor de tela.
  await dono.getByRole("button", { name: /^Abrir calendário/ }).click();
  await expect(calendario).toBeVisible();
  if (mesDe(dia) !== mesDe(diaDe(new Date()))) await calendario.getByRole("button", { name: "Próximo mês" }).click();
  await expect(calendario.getByRole("link", { name: `${nomeDoDia(dia)}, ${diaEMes(dia)}, com visita` })).toBeVisible();

  // Pela lista de meses, vai para março do ano que vem.
  const ano = Number(dia.slice(0, 4)) + 1;
  await tituloDoMes.click();
  await calendario.getByRole("button", { name: "Próximo ano" }).click();
  await calendario.getByRole("button", { name: "Março", exact: true }).click();
  await expect(tituloDoMes).toHaveText(`Março de ${ano}`);

  const destino = `${ano}-03-15`;
  await calendario.getByRole("link", { name: new RegExp(`, ${diaEMes(destino)}$`) }).click();
  await expect(calendario).toBeHidden();
  await expect(dono).toHaveURL(new RegExp(`semana=${inicioDaSemana(destino)}&dia=${destino}$`));
  await expect(dono.getByRole("heading", { name: new RegExp(`Visitas de .*${diaEMes(destino)}`) })).toBeVisible();

  // Reabre no mês do dia escolhido, e Esc fecha sem navegar.
  await dono.getByRole("button", { name: /^Abrir calendário/ }).click();
  await expect(tituloDoMes).toHaveText(`Março de ${ano}`);
  await dono.keyboard.press("Escape");
  await expect(calendario).toBeHidden();
  await expect(dono).toHaveURL(new RegExp(`dia=${destino}$`));
  expect(await dono.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(dono.viewportSize()!.width);
});

test("pedido sem resposta cujo horário passou aparece como Horário passou", async ({ browser }) => {
  const titulo = "Casa horário passado";
  const imovel = await criarImovel(titulo);
  await criarVisita(imovel, "ana", new Date(Date.now() - 3_600_000).toISOString());

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/negociacoes?aba=visitas");
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

test("as telas de visita barram os outros tipos e quem não entrou", async ({ browser }) => {
  const ana = await paginaDe(browser, "ana");
  await ana.goto("/proprietario/visitas");
  await expect(ana).toHaveURL(/\/assinante$/);

  const dono = await paginaDe(browser, "dono");
  await dono.goto("/assinante/negociacoes");
  await expect(dono).toHaveURL(/\/proprietario$/);

  const contexto = await browser.newContext({ baseURL: ORIGEM });
  const visitante = await contexto.newPage();
  await visitante.goto("/proprietario/visitas");
  await expect(visitante).toHaveURL(/\/entrar/);
  await visitante.goto("/assinante/negociacoes");
  await expect(visitante).toHaveURL(/\/entrar/);
  await contexto.close();
});

test("action de visita chamada por outro tipo não faz nada", async ({ browser }) => {
  const imovel = await criarImovel("Casa action do dono");
  await criarVisita(imovel, "ana", instanteDe(dia, "09:00"));

  const dono = await paginaDe(browser, "dono");
  await dono.goto(`/proprietario/imoveis/${imovel}`);
  const confirmar = await gravarAction(dono, "**/proprietario/**", () =>
    dono.getByRole("listitem").filter({ hasText: "Ana Corretora" }).getByRole("button", { name: "Confirmar" }).click(),
  );
  await dono.close();

  await chamarAction(browser, "ana", confirmar);
  expect((await visitasDoImovel(imovel))[0].status).toBe("pendente");
  await chamarAction(browser, "outraDona", confirmar);
  expect((await visitasDoImovel(imovel))[0].status).toBe("pendente");

  // A dona manda a requisição como gravada: vale (prova que ela estava certa).
  await chamarAction(browser, "dono", confirmar);
  expect((await visitasDoImovel(imovel))[0].status).toBe("confirmada");
});

test("pedirVisita chamada direto respeita tipo, dias e horários", async ({ browser }) => {
  const imovel = await criarImovel("Casa action do corretor");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await janela(ana).getByRole("button", { name: "14:00", exact: true }).click();
  const pedir = await gravarAction(ana, "**/assinante/imoveis/**", () =>
    janela(ana).getByRole("button", { name: /às 14:00$/ }).click(),
  );
  await ana.close();
  expect(pedir.corpo).toContain("14:00");

  await chamarAction(browser, "dono", pedir);
  expect(await visitasDoImovel(imovel)).toHaveLength(0);
  await chamarAction(browser, "ana", pedir, pedir.corpo.replace("14:00", "14:17"));
  expect(await visitasDoImovel(imovel)).toHaveLength(0);
  await chamarAction(browser, "ana", pedir, pedir.corpo.replace(dia, somarDias(diaDe(new Date()), 30)));
  expect(await visitasDoImovel(imovel)).toHaveLength(0);

  await chamarAction(browser, "ana", pedir);
  expect(await visitasDoImovel(imovel)).toHaveLength(1);
});

test("o banco só aceita horário de minuto cheio e até 15 dias", async () => {
  const imovel = await criarImovel("Casa horários estranhos");
  await criarVisita(imovel, "beto", instanteDe(dia, "09:00"), "confirmada");
  const segundoDepois = new Date(new Date(instanteDe(dia, "09:00")).getTime() + 1000).toISOString();
  for (const horario of ["infinity", "2099-01-01T03:17:00Z", `${somarDias(diaDe(new Date()), 16)}T10:00:00-03:00`, segundoDepois]) {
    const { error } = await sessoes.ana.cliente.rpc("pedir_visita", { p_imovel: imovel, p_horario: horario });
    expect(error?.hint, horario).toBe("horario_invalido");
  }
  expect(await visitasDoImovel(imovel)).toHaveLength(1);
});

test("recado com palavra longa não estica a página do proprietário", async ({ browser }) => {
  const imovel = await criarImovel("Casa recado longo");
  await criarVisita(imovel, "ana", instanteDe(dia, "10:00"), "pendente", `http://exemplo.com/${"a".repeat(300)}`);
  const dono = await paginaDe(browser, "dono");
  await dono.goto(`/proprietario/imoveis/${imovel}`);
  await expect(dono.getByText("http://exemplo.com/")).toBeVisible();
  const medida = () => dono.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await medida()).toBe(0);
  await dono.goto(`/proprietario/visitas?dia=${dia}`);
  await expect(dono.getByText("http://exemplo.com/")).toBeVisible();
  expect(await medida()).toBe(0);
});

test("a agenda aguenta endereços fora do normal", async ({ browser }) => {
  const imovel = await criarImovel("Casa endereços");
  await criarVisita(imovel, "ana", instanteDe(dia, "11:00"));
  const dono = await paginaDe(browser, "dono");
  for (const busca of ["semana=9999-12-31", "semana=0000-01-03", "dia=9999-12-31"]) {
    await dono.goto(`/proprietario/visitas?${busca}`);
    await expect(dono.getByRole("main").getByRole("link", { name: "Hoje" }), busca).toBeVisible();
  }
  // Dia fora da semana da URL: vale o dia, e a visita dele aparece.
  await dono.goto(`/proprietario/visitas?semana=${somarDias(dia, -28)}&dia=${dia}`);
  await expect(dono.getByRole("listitem").filter({ hasText: "Casa endereços" })).toBeVisible();
});

test("a visita confirmada do corretor aparece como dele no calendário", async ({ browser }) => {
  const imovel = await criarImovel("Casa minha confirmada");
  await criarVisita(imovel, "ana", instanteDe(dia, "09:00"), "confirmada");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await expect(janela(ana).getByRole("button", { name: "09:00, você já pediu" })).toBeDisabled();
});

test("Esc não fecha a janela durante o envio, e o foco vai para Fechar no fim", async ({ browser }) => {
  const imovel = await criarImovel("Casa envio lento");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await ana.route("**/assinante/imoveis/**", async (rota) => {
    if (rota.request().method() === "POST") await new Promise((pronto) => setTimeout(pronto, 1500));
    await rota.continue();
  });
  await abrirCalendario(ana);
  await janela(ana).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await janela(ana).getByRole("button", { name: "14:00", exact: true }).click();
  await janela(ana).getByRole("button", { name: /às 14:00$/ }).click();
  await expect(janela(ana).getByRole("button", { name: "Enviando…" })).toBeVisible();
  await ana.keyboard.press("Escape");
  await expect(janela(ana)).toBeVisible();
  await expect(janela(ana).getByRole("heading", { name: "Pedido enviado" })).toBeVisible();
  await expect(janela(ana).getByRole("button", { name: "Fechar" })).toBeFocused();
});

test("corretor bloqueado no meio do fluxo vai para a tela certa, sem aviso de internet", async ({ browser }) => {
  const imovel = await criarImovel("Casa bloqueio no meio");
  const dani = await paginaDe(browser, "dani");
  await dani.goto(`/assinante/imoveis/${imovel}`);
  await abrirCalendario(dani);
  await janela(dani).getByRole("button", { name: nomeDoDiaNoCalendario }).click();
  await janela(dani).getByRole("button", { name: "14:00", exact: true }).click();
  await dani.evaluate(() => {
    new MutationObserver(() => {
      if (document.body.innerText.includes("Confira a internet")) document.documentElement.dataset.viuInternet = "sim";
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await mudarAssinatura(ids.dani, "ativo", true);
  await janela(dani).getByRole("button", { name: /às 14:00$/ }).click();
  await expect(dani).toHaveURL(/\/acesso-suspenso$/);
  expect(await dani.evaluate(() => document.documentElement.dataset.viuInternet)).toBeUndefined();
  await mudarAssinatura(ids.dani, "ativo");
});

test("no celular, Agendar visita fica no rodapé sem precisar rolar", async ({ browser }) => {
  test.skip(test.info().project.name !== "celular", "o rodapé é só do celular");
  const imovel = await criarImovel("Casa rodapé");
  const ana = await paginaDe(browser, "ana");
  await ana.goto(`/assinante/imoveis/${imovel}`);
  await expect(ana.getByRole("button", { name: "Agendar visita" })).toBeInViewport();
  // O fim da página não fica escondido atrás do rodapé.
  await ana.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const aviso = await ana.getByText("Outros corretores podem estar trabalhando").boundingBox();
  const botao = await ana.getByRole("button", { name: "Agendar visita" }).boundingBox();
  expect(aviso!.y + aviso!.height).toBeLessThanOrEqual(botao!.y);
});

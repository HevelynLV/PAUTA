import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { diaDe, instanteDe, somarDias } from "../src/lib/horariosDeVisita";
import { apagarContas, clienteAdmin, contaPorEmail, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// Avisos, Etapa 10 (RF29): os eventos acontecem pelas funções do banco, com a sessão de
// quem age (como as telas fariam), e o aviso aparece na lista de quem recebe, com o
// número no menu. Quem recebe o quê, um por um, está no testar_rls.sql (seções 20 e 21);
// aqui ficam as telas: a lista, o "visto", o link, o "imóvel novo", a chave do WhatsApp
// e a paginação.
//
// O banco é compartilhado: os imóveis de teste usam preços 7.775.xxx.

test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-aviso-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));

type Conta = "dono" | "outraDona" | "ana" | "beto" | "cida" | "admin";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;
let tipo: number;
let bairro: number;
let preco = 7_775_000;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona Aviso", telefone: "48999990070" });
  ids.outraDona = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Dona Aviso", telefone: "48999990071" });
  ids.ana = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana Avisada", telefone: "48999990072", creci: `${unico()}-F` });
  // Beto aceitou o WhatsApp no cadastro (a caixa manda whatsapp: "true").
  ids.beto = await criarConta(email("beto"), {
    tipo: "autonomo",
    nome: "Beto Avisado",
    telefone: "48999990073",
    creci: `${unico()}-F`,
    whatsapp: "true",
  });
  ids.cida = await criarConta(email("cida"), { tipo: "autonomo", nome: "Cida Pendente", telefone: "48999990074", creci: `${unico()}-F` });
  ids.admin = await criarConta(email("admin"), { tipo: "proprietario", nome: "Admin Avisos", telefone: "48999990075" });
  await tornarAdmin(ids.admin);
  await mudarAssinatura(ids.ana, "ativo");
  await mudarAssinatura(ids.beto, "ativo");
  // Cida fica pendente: não vê o "imóvel novo".
  for (const [conta, nome] of [["dono", "dono"], ["outraDona", "outra"], ["ana", "ana"], ["beto", "beto"], ["cida", "cida"], ["admin", "admin"]] as [Conta, string][]) {
    sessoes[conta] = await entrarComo(email(nome));
  }
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId } = test.info().project.use;
  const contexto = await browser.newContext({
    baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId,
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
      descricao: "Casa de teste dos avisos.",
      tipo_id: tipo,
      endereco: "Rua dos Avisos, 10",
      bairro_id: bairro,
      preco,
      quartos: 3,
      banheiros: 2,
      vagas: 1,
      area: 150,
      status,
      termo_versao: "2026-10-provisorio",
      termo_aceito_em: new Date(agora).toISOString(),
      ...(status === "disponivel" && {
        exclusividade_inicio: new Date(agora).toISOString(),
        exclusividade_fim: new Date(agora + 180 * 86_400_000).toISOString(),
      }),
    })
    .select("id, versao")
    .single();
  if (error) throw error;
  return data as { id: string; versao: number };
}

// Marca como visto tudo o que a conta já tem, como a tela faz: pela data do aviso mais
// novo (a hora do banco, não a desta máquina).
async function marcarTudoVisto(conta: Conta) {
  const { data } = await sessoes[conta].cliente.rpc("meus_avisos", { p_antes: null, p_limite: 1 });
  const maisNovo = (data as { criado_em: string }[] | null)?.[0];
  if (maisNovo) {
    const { error } = await sessoes[conta].cliente.rpc("marcar_avisos_vistos", { p_ate: maisNovo.criado_em });
    if (error) throw error;
  }
}

// O item Avisos do menu visível (de baixo no celular, lateral no computador).
const itemAvisos = (pagina: Page) => pagina.getByRole("link", { name: /^Avisos/ });

test("pedido de visita: a dona vê o número no menu, o aviso destacado e o link do imóvel", async ({ browser }) => {
  const imovel = await criarImovel("Casa do aviso de visita");
  await marcarTudoVisto("dono");
  const amanha = somarDias(diaDe(new Date()), 1);
  const { error } = await sessoes.ana.cliente.rpc("pedir_visita", { p_imovel: imovel.id, p_horario: instanteDe(amanha, "10:00") });
  expect(error).toBeNull();

  const dona = await paginaDe(browser, "dono");
  await dona.goto("/proprietario");
  await expect(itemAvisos(dona)).toHaveText(/1$/);

  await itemAvisos(dona).click();
  await expect(dona).toHaveURL(/\/proprietario\/avisos$/);
  await expect(dona.getByRole("heading", { name: "Hoje" })).toBeVisible();
  const aviso = dona.getByRole("link", { name: /Pedido de visita/ }).first();
  await expect(aviso).toContainText("Ana Avisada");
  await expect(aviso).toContainText("“Casa do aviso de visita”");
  await expect(aviso).toContainText("10:00");
  // Segue destacado nesta visita, mas o número do menu some (já foi visto).
  await expect(aviso).toHaveAttribute("data-novo", "sim");
  await expect(itemAvisos(dona)).toHaveText(/^Avisos$/);

  // Recarregou: não é mais novo.
  await dona.reload();
  await expect(dona.getByRole("link", { name: /Pedido de visita/ }).first()).not.toHaveAttribute("data-novo", "sim");

  await dona.getByRole("link", { name: /Pedido de visita/ }).first().click();
  await expect(dona).toHaveURL(new RegExp(`/proprietario/imoveis/${imovel.id}$`));
  await dona.context().close();

  // A dona confirma: a corretora recebe com o endereço.
  const { data: visita } = await clienteAdmin().from("visitas").select("id").eq("imovel_id", imovel.id).single();
  expect((await sessoes.dono.cliente.rpc("confirmar_visita", { p_visita: visita!.id })).error).toBeNull();
  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/avisos");
  const confirmada = ana.getByRole("link", { name: /Visita confirmada/ }).first();
  await expect(confirmada).toContainText("“Casa do aviso de visita”, Rua dos Avisos, 10");
  await expect(confirmada).toHaveAttribute("href", "/assinante/negociacoes?aba=visitas");
  await ana.context().close();
});

test("proposta aceita: o corretor vê o que fazer e o aviso leva às Negociações", async ({ browser }) => {
  const imovel = await criarImovel("Casa do aviso de proposta");
  const { data: proposta, error } = await sessoes.beto.cliente.rpc("enviar_proposta", {
    p_imovel: imovel.id,
    p_valor: 7_000_000,
    p_forma: "a_vista",
    p_condicoes: "Escritura em 60 dias",
  });
  expect(error).toBeNull();
  expect((await sessoes.dono.cliente.rpc("aceitar_proposta", { p_proposta: proposta })).error).toBeNull();

  const beto = await paginaDe(browser, "beto");
  await beto.goto("/assinante/avisos");
  const aviso = beto.getByRole("link", { name: /Proposta aceita/ }).first();
  await expect(aviso).toContainText("R$ 7.000.000");
  await expect(aviso).toContainText("Envie o contrato assinado.");
  if (test.info().project.name === "celular") await expect(aviso).toContainText("Toque para enviar o contrato");
  await aviso.click();
  await expect(beto).toHaveURL(/\/assinante\/negociacoes$/);
  await beto.context().close();

  // Nenhum dado do comprador nem contato do dono vai no aviso.
  const { data: avisos } = await clienteAdmin().from("avisos").select("dados").eq("imovel_id", imovel.id);
  for (const { dados } of avisos ?? []) {
    expect(JSON.stringify(dados)).not.toMatch(/48999990070|@exemplo\.com|comprador/);
  }
});

test("imóvel novo no catálogo: chega ao assinante ativo e não ao pendente", async ({ browser }) => {
  const titulo = `Casa nova do aviso ${unico()}`;
  const imovel = await criarImovel(titulo, "pendente");
  expect((await sessoes.admin.cliente.rpc("aprovar_imovel", { p_imovel: imovel.id, p_versao: imovel.versao })).error).toBeNull();

  const ana = await paginaDe(browser, "ana");
  await ana.goto("/assinante/avisos");
  const aviso = ana.getByRole("link", { name: new RegExp(`Imóvel novo no catálogo.*${titulo}`) });
  await expect(aviso).toContainText("Campeche");
  await expect(aviso).toHaveAttribute("href", `/assinante/imoveis/${imovel.id}`);
  await ana.context().close();

  // Pendente não abre a área; pela API, a lista dela não traz o imóvel novo.
  const { data } = await sessoes.cida.cliente.rpc("meus_avisos", { p_antes: null, p_limite: 100 });
  expect((data as { imovel_id: string }[]).some((item) => item.imovel_id === imovel.id)).toBe(false);

  // A dona recebe "aprovado", com o fim da exclusividade.
  const dona = await paginaDe(browser, "dono");
  await dona.goto("/proprietario/avisos");
  await expect(dona.getByRole("link", { name: /Imóvel aprovado/ }).first()).toContainText("A exclusividade vai até");
  await dona.context().close();
});

test("WhatsApp: o aceite do cadastro chega à conta, e a chave liga e desliga", async ({ browser }) => {
  // O banco copiou o aceite para o perfil e tirou a chave dos dados do cadastro.
  expect((await contaPorEmail(email("beto")))?.user_metadata.whatsapp).toBeUndefined();
  const beto = await paginaDe(browser, "beto");
  await beto.goto("/assinante/conta");
  await expect(beto.getByRole("switch", { name: "Receber avisos no WhatsApp" })).toHaveAttribute("aria-checked", "true");
  await beto.goto("/assinante/avisos");
  const frase = test.info().project.name === "celular" ? "Também no seu WhatsApp" : "Os mesmos avisos chegam no seu WhatsApp";
  await expect(beto.getByText(frase)).toBeVisible();
  await beto.context().close();

  const dona = await paginaDe(browser, "outraDona");
  await dona.goto("/proprietario/avisos");
  await dona.getByRole("link", { name: "Receber também no WhatsApp" }).click();
  await expect(dona).toHaveURL(/\/proprietario\/conta$/);
  const chave = dona.getByRole("switch", { name: "Receber avisos no WhatsApp" });
  await expect(chave).toHaveAttribute("aria-checked", "false");
  await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "true");
  const perfil = async () =>
    (await clienteAdmin().from("perfis").select("whatsapp_aceito, whatsapp_aceito_em").eq("id", ids.outraDona).single()).data!;
  await expect.poll(async () => (await perfil()).whatsapp_aceito).toBe(true);
  expect((await perfil()).whatsapp_aceito_em).not.toBeNull();

  await dona.reload();
  await expect(chave).toHaveAttribute("aria-checked", "true");
  await chave.click();
  await expect(chave).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await perfil()).whatsapp_aceito).toBe(false);
  await dona.context().close();
});

// Grava a chamada de uma Server Action feita pela tela (sem deixar chegar ao servidor), para
// mandá-la de novo como outra conta ou com outro corpo, como alguém mudando a requisição.
async function gravarAction(page: Page, padrao: string, agir: () => Promise<unknown>) {
  let gravada: Request | undefined;
  await page.route(padrao, async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await agir();
  await expect.poll(() => gravada).toBeDefined();
  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  return { url: new URL(gravada!.url()).pathname, cabecalhos, corpo: gravada!.postData()! };
}

async function chamarAction(browser: Browser, conta: Conta, acao: Awaited<ReturnType<typeof gravarAction>>, corpo = acao.corpo) {
  const contexto = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await contexto.addCookies(sessoes[conta].cookies);
  await contexto.request.post(acao.url, { headers: acao.cabecalhos, data: corpo, maxRedirects: 0 });
  await contexto.close();
}

const perfilDe = async (conta: Conta) =>
  (await clienteAdmin().from("perfis").select("whatsapp_aceito, avisos_vistos_ate").eq("id", ids[conta]).single()).data!;

test("as actions dos avisos chamadas direto: o admin e a entrada inválida não mudam nada", async ({ browser }) => {
  // Chave do WhatsApp: a dona liga pela tela; a chamada é gravada e mandada de novo.
  const dona = await paginaDe(browser, "dono");
  await dona.goto("/proprietario/conta");
  const chave = dona.getByRole("switch", { name: "Receber avisos no WhatsApp" });
  await expect(chave).toHaveAttribute("aria-checked", "false");
  const ligar = await gravarAction(dona, "**/proprietario/conta**", () => chave.click());
  expect(ligar.corpo).toContain("true");

  await chamarAction(browser, "admin", ligar);
  expect((await perfilDe("admin")).whatsapp_aceito).toBe(false);
  for (const errado of ['"sim"', "1", "null"]) {
    await chamarAction(browser, "dono", ligar, ligar.corpo.replace("true", errado));
    expect((await perfilDe("dono")).whatsapp_aceito).toBe(false);
  }
  // A dona manda como gravada: vale (prova que a chamada estava certa). Depois, desliga.
  await chamarAction(browser, "dono", ligar);
  expect((await perfilDe("dono")).whatsapp_aceito).toBe(true);
  await chamarAction(browser, "dono", ligar, ligar.corpo.replace("true", "false"));
  expect((await perfilDe("dono")).whatsapp_aceito).toBe(false);

  // "Visto": a tela marca sozinha ao abrir com aviso novo; a chamada é gravada.
  const { error } = await clienteAdmin()
    .from("avisos")
    .insert({
      destinatario_id: ids.dono,
      tipo: "visita_pedida",
      dados: { titulo: "Casa das actions" },
      link: "/proprietario",
      whatsapp: "desligado",
    });
  if (error) throw error;
  const antes = (await perfilDe("dono")).avisos_vistos_ate;
  const marcar = await gravarAction(dona, "**/proprietario/avisos**", () => dona.goto("/proprietario/avisos"));
  await dona.context().close();
  const data = /"(\d{4}-[^"]+)"/.exec(marcar.corpo)![1];

  await chamarAction(browser, "admin", marcar);
  expect((await perfilDe("admin")).avisos_vistos_ate).toBeNull();
  for (const errado of ["amanhã", "2026-13-45T99:99:99Z", "2999-01-01T00:00:00+00:00"]) {
    await chamarAction(browser, "dono", marcar, marcar.corpo.replace(data, errado));
    const visto = (await perfilDe("dono")).avisos_vistos_ate;
    // Nada muda, ou, na data do futuro, o banco não passa de agora.
    if (visto !== antes) expect(Date.parse(visto!)).toBeLessThanOrEqual(Date.now() + 60_000);
  }
  await chamarAction(browser, "dono", marcar);
  expect(Date.parse((await perfilDe("dono")).avisos_vistos_ate!)).toBeGreaterThanOrEqual(Date.parse(data) - 1);
});

test("lista longa: 30 por página e os anteriores pela URL", async ({ browser }) => {
  // Avisos gravados direto (a API não deixa), só para montar a lista.
  const linhas = Array.from({ length: 32 }, (_, i) => ({
    destinatario_id: ids.outraDona,
    tipo: "visita_cancelada_pelo_corretor",
    dados: { titulo: `Imóvel ${String(i + 1).padStart(2, "0")}`, corretor: "Corretor Teste", horario: new Date().toISOString() },
    link: "/proprietario",
    criado_em: new Date(Date.now() - (40 - i) * 86_400_000).toISOString(),
    whatsapp: "desligado",
  }));
  const { error } = await clienteAdmin().from("avisos").insert(linhas);
  expect(error).toBeNull();

  const dona = await paginaDe(browser, "outraDona");
  await dona.goto("/proprietario/avisos");
  await expect(dona.getByRole("heading", { name: "Antes" })).toBeVisible();
  await expect(dona.getByRole("link", { name: /Visita cancelada/ })).toHaveCount(30);
  await expect(dona.getByRole("link", { name: /“Imóvel 32”/ })).toBeVisible();

  await dona.getByRole("link", { name: "Ver avisos anteriores" }).click();
  await expect(dona).toHaveURL(/\?antes=\d+$/);
  await expect(dona.getByRole("link", { name: /Visita cancelada/ })).toHaveCount(2);
  await expect(dona.getByRole("link", { name: /“Imóvel 01”/ })).toBeVisible();
  await expect(dona.getByRole("link", { name: "Ver avisos anteriores" })).toHaveCount(0);
  await dona.getByRole("link", { name: "Ver os mais recentes" }).click();
  await expect(dona).toHaveURL(/\/proprietario\/avisos$/);

  // Lixo na URL vira a primeira página.
  await dona.goto("/proprietario/avisos?antes=abc");
  await expect(dona.getByRole("link", { name: /Visita cancelada/ })).toHaveCount(30);
  await dona.context().close();
});

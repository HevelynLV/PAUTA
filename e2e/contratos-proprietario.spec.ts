import { expect, test, type Browser, type Page } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// O que o proprietário vê do contrato e da venda (RF25, RF26, RNF08): o selo e o aviso em
// Meus imóveis e na página do imóvel, "Ver contrato" na aba Propostas, sem "Desfazer
// aceite" com o contrato em análise, e a venda sem a comissão. O envio está no
// contratos-envio.spec.ts e a conferência no contratos-conferencia.spec.ts.
//
// Os imóveis de teste usam preços 7.779.xxx.

test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-contrato-dono-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = "http://localhost:3000";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
const PDF = new TextEncoder().encode("%PDF-1.7\nContrato de teste do PAUTA\n%%EOF\n");

type Conta = "adm" | "ana" | "dono";
const sessoes = {} as Record<Conta | "beto", Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta | "beto", string>;
let tipo: number;
let bairro: number;
let preco = 7_779_000;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona da Venda", telefone: "48999990110" });
  ids.ana = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana Corretora", telefone: "48999990111", creci: `${unico()}-F` });
  ids.beto = await criarConta(email("beto"), { tipo: "autonomo", nome: "Beto Corretor", telefone: "48999990112", creci: `${unico()}-F` });
  ids.adm = await criarConta(email("adm"), { tipo: "proprietario", nome: "Equipe PAUTA", telefone: "48999990113" });
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
  });
  if (erroContrato) throw erroContrato;
  return { imovel: imovel.id as string, proposta, outra, contrato: contrato as string };
}


const paginaDasPropostas = (imovel: string) => `/proprietario/imoveis/${imovel}?aba=propostas`;
const cartaoDoImovel = (page: Page, titulo: string) => page.getByRole("listitem").filter({ hasText: titulo });
const propostaDa = (page: Page, corretor: string) => page.getByRole("listitem").filter({ hasText: corretor });

test("com o contrato em análise, o dono vê o selo, abre o PDF e não desfaz o aceite", async ({ browser }) => {
  const titulo = "Casa do dono com contrato";
  const { imovel } = await contratoEmAnalise(titulo, { outraAceita: true });
  const page = await paginaDe(browser, "dono");

  await page.goto("/proprietario");
  const cartao = cartaoDoImovel(page, titulo);
  await expect(cartao.getByText("Contrato em análise", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(cartao).toContainText("Contrato enviado por Ana Corretora em");

  await page.goto(paginaDasPropostas(imovel));
  await expect(page.getByRole("main").getByText(/^Contrato enviado por Ana Corretora em/)).toBeVisible();
  const daAna = propostaDa(page, "Ana Corretora");
  await expect(daAna.getByText("Contrato em análise", { exact: true })).toBeVisible();
  await expect(daAna).toContainText("A equipe PAUTA está conferindo.");
  await expect(daAna.getByRole("button", { name: "Desfazer aceite" })).toHaveCount(0);
  // A outra proposta aceita, sem contrato, ainda pode ter o aceite desfeito.
  await expect(propostaDa(page, "Beto Corretor").getByRole("button", { name: "Desfazer aceite" })).toBeVisible();

  const resposta = page.context().waitForEvent("response", (r) => r.url().includes("/object/sign/contratos/"));
  await daAna.getByRole("button", { name: "Ver contrato" }).click();
  expect((await resposta).ok()).toBe(true);
});

test("contrato devolvido volta a deixar desfazer o aceite", async ({ browser }) => {
  const titulo = "Casa do dono com contrato devolvido";
  const { imovel, contrato } = await contratoEmAnalise(titulo);
  const { error } = await sessoes.adm.cliente.rpc("recusar_contrato", { p_contrato: contrato, p_motivo: "Falta assinatura" });
  expect(error).toBeNull();

  const page = await paginaDe(browser, "dono");
  await page.goto("/proprietario");
  await expect(cartaoDoImovel(page, titulo).getByText("Em negociação", { exact: true }).filter({ visible: true })).toBeVisible();

  await page.goto(paginaDasPropostas(imovel));
  const daAna = propostaDa(page, "Ana Corretora");
  await expect(daAna).toContainText("devolveu o contrato ao corretor");
  await expect(daAna.getByRole("button", { name: "Desfazer aceite" })).toBeVisible();
});

test("vendido: o dono vê o valor final e a data, nunca a comissão", async ({ browser }) => {
  const titulo = "Casa do dono vendida";
  const { imovel, contrato } = await contratoEmAnalise(titulo);
  const { error } = await sessoes.adm.cliente.rpc("aprovar_contrato", {
    p_contrato: contrato,
    p_valor_final: 6_950_000,
    p_comissao: 69_500,
    p_comissao_paga: false,
  });
  expect(error).toBeNull();

  const page = await paginaDe(browser, "dono");
  await page.goto("/proprietario");
  const cartao = cartaoDoImovel(page, titulo);
  await expect(cartao.getByText("Vendido", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(cartao).toContainText("Vendida por R$ 6.950.000 em");

  await page.goto(paginaDasPropostas(imovel));
  const principal = page.getByRole("main");
  await expect(principal).toContainText("Vendida por R$ 6.950.000 em");
  await expect(propostaDa(page, "Ana Corretora").getByText("Vendida", { exact: true })).toBeVisible();
  await expect(propostaDa(page, "Ana Corretora")).toContainText("Contrato aprovado pela equipe PAUTA.");
  await expect(principal).not.toContainText("69.500");
  await expect(principal).not.toContainText("Comissão");
});

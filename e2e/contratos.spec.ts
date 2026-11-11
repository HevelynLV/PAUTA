import { expect, test, type Browser, type Page } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// O fluxo inteiro da Etapa 9, só pelas telas (RF25, RF26, RF32, RNF05): proposta enviada e
// aceita, contrato enviado, devolvido com motivo, reenviado e aprovado, até o imóvel sair
// do catálogo como vendido. Cada parte tem os próprios testes de detalhe
// (contratos-envio, contratos-conferencia e contratos-proprietario); aqui é a costura.
//
// Os imóveis de teste usam preços 7.780.xxx.

test.describe.configure({ timeout: 240_000 });

const PREFIXO = "e2e-contrato-fluxo-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
const PDF = Buffer.from("%PDF-1.7\nContrato de teste do PAUTA\n%%EOF\n");

type Conta = "dono" | "ana" | "beto" | "adm";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;
let preco = 7_780_000;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona do Fluxo", telefone: "48999990120" });
  ids.ana = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana Corretora", telefone: "48999990121", creci: `${unico()}-F` });
  ids.beto = await criarConta(email("beto"), { tipo: "autonomo", nome: "Beto Corretor", telefone: "48999990122", creci: `${unico()}-F` });
  ids.adm = await criarConta(email("adm"), { tipo: "proprietario", nome: "Equipe PAUTA", telefone: "48999990123" });
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

// O imóvel já aprovado, com foto: o cadastro e a aprovação têm os testes da Etapa 4.
async function imovelNoCatalogo(titulo: string) {
  const admin = clienteAdmin();
  const tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  const bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;
  const agora = Date.now();
  preco += 1;
  const { data, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: ids.dono,
      titulo,
      descricao: "Casa de teste do fluxo.",
      tipo_id: tipo,
      endereco: "Rua do Fluxo, 30",
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

async function enviarProposta(page: Page, imovel: string, valor: string) {
  await page.goto(`/assinante/imoveis/${imovel}`);
  await page.getByRole("button", { name: "Enviar proposta" }).first().click();
  const janela = page.getByRole("dialog", { name: /Enviar proposta|Proposta enviada/ });
  await janela.getByLabel("Valor da proposta (R$)").fill(valor);
  await janela.getByLabel("Condições").fill("Escritura em 60 dias");
  await janela.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(janela.getByRole("heading", { name: "Proposta enviada" })).toBeVisible();
}

async function enviarContrato(page: Page, titulo: string, botao: string, nome: string) {
  await page.goto("/assinante/negociacoes");
  await page.getByRole("listitem").filter({ hasText: titulo }).getByRole("button", { name: botao }).click();
  const janela = page.getByRole("dialog");
  await janela.locator('input[type="file"]').setInputFiles({ name: nome, mimeType: "application/pdf", buffer: PDF });
  await janela.getByRole("button", { name: "Enviar para conferência" }).click();
  await expect(janela.getByRole("heading", { name: "Contrato em análise" })).toBeVisible();
}

async function marcarItens(page: Page) {
  for (const item of ["Assinado por vendedor", "Valor e imóvel batem", "Cláusula da comissão"]) {
    await page.getByRole("checkbox", { name: new RegExp(item) }).check();
  }
}

const seloNoCatalogo = async (page: Page, imovel: string, texto: string) => {
  await page.goto(`/assinante/imoveis/${imovel}`);
  await expect(page.getByRole("main").getByText(texto, { exact: true }).first()).toBeVisible();
};

test("do contrato enviado ao vendido: devolvido com motivo, reenviado e aprovado numa operação só", async ({ browser }) => {
  const titulo = "Casa do fluxo do contrato";
  const imovel = await imovelNoCatalogo(titulo);
  const [ana, beto, dono, adm] = await Promise.all((["ana", "beto", "dono", "adm"] as const).map((conta) => paginaDe(browser, conta)));

  // Os dois corretores propõem; a dona aceita as duas.
  await enviarProposta(ana, imovel, "7.500.000");
  await enviarProposta(beto, imovel, "7.400.000");
  await dono.goto(`/proprietario/imoveis/${imovel}?aba=propostas`);
  for (const corretor of ["Ana Corretora", "Beto Corretor"]) {
    await dono.getByRole("listitem").filter({ hasText: corretor }).getByRole("button", { name: "Aceitar" }).click();
    await expect(dono.getByRole("listitem").filter({ hasText: corretor }).getByRole("button", { name: "Desfazer aceite" })).toBeVisible();
  }
  await seloNoCatalogo(beto, imovel, "Em negociação");

  // A Ana envia o contrato; o admin devolve com motivo.
  await enviarContrato(ana, titulo, "Enviar contrato assinado", "primeira-versao.pdf");
  await dono.reload();
  await expect(dono.getByRole("main").getByText("Contrato em análise", { exact: true }).first()).toBeVisible();

  await adm.goto("/admin/contratos");
  const contrato = (await clienteAdmin().from("contratos").select("id").eq("nome_arquivo", "primeira-versao.pdf").eq("enviado_por", ids.ana).single()).data!.id;
  await adm.goto(`/admin/contratos?id=${contrato}`);
  await adm.getByRole("button", { name: "Recusar", exact: true }).click();
  await adm.getByLabel("Motivo (o corretor vai ler)").fill("Falta a assinatura do comprador.");
  await adm.getByRole("button", { name: "Recusar contrato" }).click();
  await expect(adm.getByRole("status")).toHaveText("Contrato devolvido");

  // O imóvel segue em negociação, e a Ana vê o motivo e reenvia.
  await seloNoCatalogo(beto, imovel, "Em negociação");
  await ana.goto("/assinante/negociacoes");
  await expect(ana.getByRole("listitem").filter({ hasText: titulo })).toContainText("Motivo do admin: Falta a assinatura do comprador.");
  await enviarContrato(ana, titulo, "Reenviar contrato", "segunda-versao.pdf");

  // O admin aprova a segunda versão: vendido, a proposta do Beto recusada, tudo de uma vez.
  const segundo = (await clienteAdmin().from("contratos").select("id").eq("nome_arquivo", "segunda-versao.pdf").eq("enviado_por", ids.ana).single()).data!.id;
  await adm.goto(`/admin/contratos?id=${segundo}`);
  await expect(adm.getByRole("main")).toContainText("Beto Corretor, R$ 7.400.000, aceita");
  await marcarItens(adm);
  await adm.getByRole("button", { name: "Aprovar", exact: true }).click();
  await adm.getByLabel(/Comissão do PAUTA/).fill("75.000");
  await adm.getByRole("button", { name: "Confirmar venda" }).click();
  await expect(adm.getByRole("main")).toContainText("vendida por R$ 7.500.000");
  await expect(adm.getByRole("main")).toContainText("A proposta de Beto Corretor (R$ 7.400.000) foi recusada");

  // Fora do catálogo para todos os corretores.
  await beto.goto(`/assinante/imoveis/${imovel}`);
  await expect(beto.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  await beto.goto("/assinante/negociacoes");
  await expect(beto.getByRole("listitem").filter({ hasText: titulo }).getByText("Recusada", { exact: true })).toBeVisible();

  // A Ana vê vendido; a dona vê o valor final.
  await ana.goto("/assinante/negociacoes");
  await expect(ana.getByRole("listitem").filter({ hasText: titulo }).getByText("Vendido", { exact: true })).toBeVisible();
  await dono.goto("/proprietario");
  await expect(dono.getByRole("listitem").filter({ hasText: titulo })).toContainText("Vendida por R$ 7.500.000 em");

  const { data: venda } = await clienteAdmin().from("vendas").select("valor_final, comissao_valor").eq("imovel_id", imovel).single();
  expect(venda).toEqual({ valor_final: 7_500_000, comissao_valor: 75_000 });
});

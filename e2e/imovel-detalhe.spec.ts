import { expect, test, type Browser, type Page } from "@playwright/test";

import { pngDeTeste } from "./apoio/imagens";
import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura } from "./apoio/supabase";

// Detalhe do imóvel para o corretor, passo 6.3 (RF18 a RF20, RNF06): galeria,
// dados, endereço, status e o contato do proprietário só quando ele escolheu
// mostrar. O contato escondido não pode chegar ao navegador de jeito nenhum: nem
// no HTML, nem nos dados que o Next manda ao navegar (o que a aba Network mostra).
//
// O banco é compartilhado: os imóveis de teste usam preços 7.772.xxx.

const PREFIXO = "e2e-detalhe-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = "http://localhost:3000";
const BALDE = "fotos-imoveis";
const FAIXA = "preco_min=7772000&preco_max=7772999";
const TELEFONE_DO_DONO = "48999990070";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));

type Conta = "dono" | "ativo" | "bloqueado";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;
const imoveis = {} as Record<"escondido" | "divulgado" | "vendido", string>;

// Tudo o que identifica o contato do dono, como poderia aparecer na resposta.
const pedacosDoContato = [TELEFONE_DO_DONO, "99999-0070", "999990070", email("dono")];

async function porFoto(imovelId: string, nome: string, ordem: number) {
  // Imagem de verdade: a galeria troca de endereço quando a foto não abre.
  const imagem = pngDeTeste(8, 6, [90, 140, 130]);
  const balde = sessoes.dono.cliente.storage.from(BALDE);
  for (const arquivo of [`${nome}.jpg`, `${nome}-mini.jpg`]) {
    const { error } = await balde.upload(`${imovelId}/${arquivo}`, imagem, { contentType: "image/jpeg" });
    if (error) throw error;
  }
  const { error } = await clienteAdmin().from("fotos_imovel").insert({ imovel_id: imovelId, caminho: `${imovelId}/${nome}.jpg`, ordem });
  if (error) throw error;
}

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  const tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  const bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona Detalhe", telefone: TELEFONE_DO_DONO });
  ids.ativo = await criarConta(email("ativo"), {
    tipo: "autonomo", nome: "Corretora Detalhe", telefone: "48999990071", creci: `${unico()}-F`,
  });
  ids.bloqueado = await criarConta(email("bloqueado"), {
    tipo: "autonomo", nome: "Bloqueado Detalhe", telefone: "48999990072", creci: `${unico()}-F`,
  });
  await mudarAssinatura(ids.ativo, "ativo");
  await mudarAssinatura(ids.bloqueado, "ativo", true);
  sessoes.dono = await entrarComo(email("dono"));
  sessoes.ativo = await entrarComo(email("ativo"));
  sessoes.bloqueado = await entrarComo(email("bloqueado"));

  const agora = Date.now();
  const linha = (titulo: string, preco: number, mostrarContato: boolean, status = "disponivel") => ({
    proprietario_id: ids.dono,
    titulo,
    descricao: "Casa térrea a 300 m da praia.\nQuintal com piscina.",
    tipo_id: tipo,
    endereco: "Rua das Gaivotas, 210",
    bairro_id: bairro,
    preco,
    quartos: 4,
    banheiros: 3,
    vagas: 2,
    area: 220,
    mostrar_contato: mostrarContato,
    status,
    termo_versao: "2026-10-provisorio",
    termo_aceito_em: new Date(agora).toISOString(),
    exclusividade_inicio: new Date(agora).toISOString(),
    exclusividade_fim: new Date(agora + 180 * 86_400_000).toISOString(),
  });
  const { data, error } = await admin
    .from("imoveis")
    .insert([
      linha("Casa detalhe com contato escondido", 7_772_100, false),
      linha("Casa detalhe com contato divulgado", 7_772_200, true),
      linha("Casa detalhe vendida", 7_772_300, true, "vendido"),
    ])
    .select("id");
  if (error) throw error;
  [imoveis.escondido, imoveis.divulgado, imoveis.vendido] = data.map((l) => l.id as string);
  await porFoto(imoveis.escondido, "fachada", 1);
  await porFoto(imoveis.escondido, "sala", 2);
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

// O que o servidor manda ao navegador para a página do imóvel, como a aba Network
// mostra: o HTML (quem abre pelo endereço) e os dados do Next (quem chega por um
// link, pedido com o cabeçalho RSC). Pedidos com a sessão do corretor.
async function respostasDoServidor(page: Page, imovelId: string) {
  const caminho = `/assinante/imoveis/${imovelId}`;
  const html = await (await page.request.get(caminho)).text();
  const dados = await (await page.request.get(caminho, { headers: { RSC: "1" } })).text();
  return { html, dados };
}

test("o corretor abre o imóvel pelo catálogo e vê fotos, dados, endereço e status, sem o botão da Etapa 8", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}`);
  await page.getByRole("link", { name: /Casa detalhe com contato escondido/ }).click();
  await expect(page).toHaveURL(new RegExp(`/assinante/imoveis/${imoveis.escondido}\\?${FAIXA}$`));

  await expect(page.getByRole("heading", { level: 1, name: "Casa detalhe com contato escondido" })).toBeVisible();
  const principal = page.getByRole("main");
  await expect(principal.getByText("R$ 7.772.100").filter({ visible: true })).toBeVisible();
  await expect(principal.getByText("Rua das Gaivotas, 210 · Campeche · Florianópolis").filter({ visible: true })).toBeVisible();
  await expect(principal.getByText("Disponível").filter({ visible: true })).toBeVisible();
  // Nada da página passa da largura do celular.
  if (test.info().project.name === "celular") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await expect(principal.getByText("Exclusivo PAUTA").filter({ visible: true })).toBeVisible();
  await expect(principal.getByText("Quintal com piscina.", { exact: false }).filter({ visible: true })).toBeVisible();
  for (const [valor, rotulo] of [["4", "quartos"], ["3", "banheiros"], ["2", "vagas"], ["220 m²", "área"]]) {
    await expect(principal.getByRole("definition").filter({ hasText: new RegExp(`^${valor}$`) }).first(), rotulo).toBeVisible();
  }
  // A visita entrou na Etapa 7 (e2e/visitas.spec.ts); a proposta entra na Etapa 8.
  await expect(page.getByRole("button", { name: "Agendar visita" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar proposta" })).toHaveCount(0);

  // Volta ao catálogo (no celular, o botão por cima da foto; no computador, o caminho).
  const voltar = test.info().project.name === "celular"
    ? page.getByRole("link", { name: "Voltar ao catálogo" })
    : page.getByRole("navigation", { name: "Caminho" }).getByRole("link", { name: "Catálogo" });
  await voltar.click();
  await expect(page).toHaveURL(new RegExp(`/assinante\\?${FAIXA}$`));
});

test("galeria: a foto abre grande em tela cheia, com Próxima e Fechar", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante/imoveis/${imoveis.escondido}`);
  const titulo = "Casa detalhe com contato escondido";

  if (test.info().project.name === "celular") {
    await expect(page.getByText("1 / 2")).toBeVisible();
    await page.getByRole("button", { name: `Foto 1 de 2: ${titulo}. Abrir a foto grande` }).click();
  } else {
    await page.getByRole("button", { name: "Ver as 2 fotos" }).click();
  }

  const janela = page.getByRole("dialog", { name: `Fotos: ${titulo}` });
  await expect(janela).toBeVisible();
  await expect(janela.getByText("1 / 2")).toBeVisible();
  // A tela cheia carrega a foto grande (não a miniatura).
  await expect(janela.getByRole("img")).toHaveAttribute("src", /\/fachada\.jpg\?/);
  await janela.getByRole("button", { name: "Próxima foto" }).click();
  await expect(janela.getByText("2 / 2")).toBeVisible();
  await expect(janela.getByRole("img")).toHaveAttribute("src", /\/sala\.jpg\?/);
  await page.keyboard.press("ArrowRight");
  await expect(janela.getByText("1 / 2")).toBeVisible();
  await janela.getByRole("button", { name: "Fechar as fotos" }).click();
  await expect(janela).toBeHidden();
});

// Abre a tela cheia na primeira foto, no celular ou no computador.
async function abrirFotos(page: Page) {
  const titulo = "Casa detalhe com contato escondido";
  if (test.info().project.name === "celular") {
    await page.getByRole("button", { name: `Foto 1 de 2: ${titulo}. Abrir a foto grande` }).click();
  } else {
    await page.getByRole("button", { name: "Ver as 2 fotos" }).click();
  }
  return page.getByRole("dialog", { name: `Fotos: ${titulo}` });
}

test("galeria: se a foto grande não abre, mostra a miniatura", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.route(/\/fachada\.jpg\?/, (rota) => rota.abort());
  await page.goto(`/assinante/imoveis/${imoveis.escondido}`);
  const janela = await abrirFotos(page);
  await expect(janela.getByRole("img")).toHaveAttribute("src", /\/fachada-mini\.jpg\?/);
});

test("galeria: se nenhum link abre (página aberta há muito tempo), avisa em vez de ficar vazia", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.route(/\/fachada(-mini)?\.jpg\?/, (rota) => rota.abort());
  await page.goto(`/assinante/imoveis/${imoveis.escondido}`);
  const janela = await abrirFotos(page);
  await expect(janela.getByText("Esta foto não abriu. Atualize a página e tente de novo.")).toBeVisible();
  await janela.getByRole("button", { name: "Próxima foto" }).click();
  await expect(janela.getByRole("img")).toHaveAttribute("src", /\/sala\.jpg\?/);
});

test("contato escondido: o cartão aparece e nada do contato chega ao navegador (HTML, dados do Next e API)", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  // Entrando direto pelo endereço (HTML) e chegando pelo catálogo (dados do Next).
  await page.goto(`/assinante/imoveis/${imoveis.escondido}`);
  await expect(page.getByText("Contato do proprietário não divulgado").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ligar|WhatsApp|E-mail/ })).toHaveCount(0);
  await page.goto(`/assinante?${FAIXA}`);
  await page.getByRole("link", { name: /Casa detalhe com contato escondido/ }).click();
  await expect(page.getByText("Contato do proprietário não divulgado").filter({ visible: true })).toBeVisible();

  const { html, dados } = await respostasDoServidor(page, imoveis.escondido);
  for (const [nome, corpo] of [["HTML", html], ["dados do Next", dados]]) {
    expect(corpo, nome).toContain("Contato do proprietário não divulgado");
    for (const pedaco of pedacosDoContato) expect(corpo, `${nome}: ${pedaco}`).not.toContain(pedaco);
  }

  // Pela API, com a sessão do corretor, também não vem.
  const { data, error } = await sessoes.ativo.cliente.rpc("contato_do_proprietario", { p_imovel: imoveis.escondido });
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test("contato divulgado: ligar, WhatsApp e e-mail do proprietário", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}`);
  await page.getByRole("link", { name: /Casa detalhe com contato divulgado/ }).click();
  await expect(page.getByText("Contato do proprietário", { exact: true }).filter({ visible: true })).toBeVisible();
  // Prova de que o mesmo jeito de conferir acha o contato quando ele vem (senão o
  // teste do escondido passaria sem conferir nada).
  const { html, dados } = await respostasDoServidor(page, imoveis.divulgado);
  for (const corpo of [html, dados]) {
    expect(corpo).toContain(TELEFONE_DO_DONO);
    expect(corpo).toContain(email("dono"));
  }
  await expect(page.getByRole("link", { name: /^Ligar/ })).toHaveAttribute("href", `tel:+55${TELEFONE_DO_DONO}`);
  await expect(page.getByRole("link", { name: /^WhatsApp/ })).toHaveAttribute("href", `https://wa.me/55${TELEFONE_DO_DONO}`);
  await expect(page.getByRole("link", { name: /^E-mail/ })).toHaveAttribute("href", `mailto:${email("dono")}`);
  await expect(page.getByRole("link", { name: /^Ligar/ })).toContainText("(48) 99999-0070");
  await expect(page.getByText("Contato do proprietário não divulgado")).toHaveCount(0);
  // Imóvel sem fotos: o quadro vazio, sem contador.
  await expect(page.getByText("1 / 0")).toHaveCount(0);
});

test("imóvel vendido e endereço inventado mostram Página não encontrada", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  for (const id of [imoveis.vendido, "00000000-0000-4000-a000-000000000000", "nao-e-um-id"]) {
    await page.goto(`/assinante/imoveis/${id}`);
    await expect(page.getByRole("heading", { name: "Página não encontrada" }), id).toBeVisible();
    await expect(page.getByText("Casa detalhe vendida")).toHaveCount(0);
  }
});

test("assinante bloqueado e proprietário não abrem o detalhe", async ({ browser }) => {
  const bloqueado = await paginaDe(browser, "bloqueado");
  await bloqueado.goto(`/assinante/imoveis/${imoveis.divulgado}`);
  await expect(bloqueado).toHaveURL(/\/acesso-suspenso$/);
  const { data } = await sessoes.bloqueado.cliente.rpc("contato_do_proprietario", { p_imovel: imoveis.divulgado });
  expect(data).toEqual([]);

  const dono = await paginaDe(browser, "dono");
  await dono.goto(`/assinante/imoveis/${imoveis.divulgado}`);
  await expect(dono).toHaveURL(/\/proprietario$/);
});

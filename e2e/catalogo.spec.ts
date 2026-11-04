import { expect, test, type Browser, type Page } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura } from "./apoio/supabase";

// Catálogo do assinante, passo 6.2 (RF18, RF19, RF20): cards com a capa, filtros
// na URL (tipo, bairros, preço, quartos e status), páginas de 12, assinante
// bloqueado sem catálogo e o banco servindo só as colunas do corretor.
//
// O banco é compartilhado: os imóveis de teste usam preços que ninguém mais usa
// (7.770.xxx e 7.771.xxx), e cada busca do teste filtra por essa faixa.

const PREFIXO = "e2e-catalogo-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = "http://localhost:3000";
const BALDE = "fotos-imoveis";
const FAIXA = "preco_min=7770000&preco_max=7770999";
const FAIXA_PAGINAS = "preco_min=7771000&preco_max=7771999";
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));

type Conta = "dono" | "ativo" | "bloqueado";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;
const imoveis = {} as Record<"casa" | "apartamento" | "terreno" | "vendido" | "pendente", string>;
const listas = { tipos: new Map<string, number>(), bairros: new Map<string, number>() };

type NovoImovel = {
  titulo: string;
  tipo: string;
  bairro: string;
  preco: number;
  quartos: number;
  status?: "disponivel" | "pendente" | "vendido";
  emNegociacao?: boolean;
  // Entrou no catálogo há n minutos (a lista mostra o mais recente primeiro).
  haMinutos?: number;
};

function linhaDoImovel(novo: NovoImovel) {
  const agora = Date.now();
  const status = novo.status ?? "disponivel";
  const aprovado = status !== "pendente";
  return {
    proprietario_id: ids.dono,
    titulo: novo.titulo,
    tipo_id: listas.tipos.get(novo.tipo)!,
    endereco: "Rua das Gaivotas, 210",
    bairro_id: listas.bairros.get(novo.bairro)!,
    preco: novo.preco,
    quartos: novo.quartos,
    vagas: 2,
    area: 220,
    status,
    tem_proposta_aceita: novo.emNegociacao ?? false,
    termo_versao: "2026-10-provisorio",
    termo_aceito_em: new Date(agora).toISOString(),
    ...(aprovado && {
      exclusividade_inicio: new Date(agora - (novo.haMinutos ?? 0) * 60_000).toISOString(),
      exclusividade_fim: new Date(agora + 180 * 86_400_000).toISOString(),
    }),
  };
}

async function criarImoveis(novos: NovoImovel[]) {
  const { data, error } = await clienteAdmin().from("imoveis").insert(novos.map(linhaDoImovel)).select("id");
  if (error) throw error;
  return data.map((linha) => linha.id as string);
}

// Foto enviada pelo dono (como pela tela: grande e miniatura) e gravada no banco.
async function porFoto(imovelId: string, nome: string, ordem: number) {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const balde = sessoes.dono.cliente.storage.from(BALDE);
  for (const arquivo of [`${nome}.jpg`, `${nome}-mini.jpg`]) {
    const { error } = await balde.upload(`${imovelId}/${arquivo}`, jpeg, { contentType: "image/jpeg" });
    if (error) throw error;
  }
  const { error } = await clienteAdmin().from("fotos_imovel").insert({ imovel_id: imovelId, caminho: `${imovelId}/${nome}.jpg`, ordem });
  if (error) throw error;
}

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  for (const { id, nome } of (await admin.from("tipos_imovel").select("id, nome")).data ?? []) listas.tipos.set(nome, id);
  for (const { id, nome } of (await admin.from("bairros").select("id, nome")).data ?? []) listas.bairros.set(nome, id);

  ids.dono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dono Catálogo", telefone: "48999990060" });
  ids.ativo = await criarConta(email("ativo"), {
    tipo: "autonomo", nome: "Rafael Catálogo", telefone: "48999990061", creci: `${unico()}-F`,
  });
  ids.bloqueado = await criarConta(email("bloqueado"), {
    tipo: "autonomo", nome: "Bloqueado Catálogo", telefone: "48999990062", creci: `${unico()}-F`,
  });
  await mudarAssinatura(ids.ativo, "ativo");
  await mudarAssinatura(ids.bloqueado, "ativo", true);
  sessoes.dono = await entrarComo(email("dono"));
  sessoes.ativo = await entrarComo(email("ativo"));
  sessoes.bloqueado = await entrarComo(email("bloqueado"));

  [imoveis.casa, imoveis.apartamento, imoveis.terreno, imoveis.vendido, imoveis.pendente] = await criarImoveis([
    { titulo: "Casa catálogo no Campeche", tipo: "Casa", bairro: "Campeche", preco: 7_770_100, quartos: 4, haMinutos: 1 },
    { titulo: "Apartamento catálogo na Lagoa", tipo: "Apartamento", bairro: "Lagoa da Conceição", preco: 7_770_200, quartos: 2, emNegociacao: true, haMinutos: 2 },
    { titulo: "Terreno catálogo no Campeche", tipo: "Terreno", bairro: "Campeche", preco: 7_770_300, quartos: 0, haMinutos: 3 },
    { titulo: "Casa catálogo vendida", tipo: "Casa", bairro: "Campeche", preco: 7_770_400, quartos: 3, status: "vendido" },
    { titulo: "Casa catálogo pendente", tipo: "Casa", bairro: "Campeche", preco: 7_770_500, quartos: 3, status: "pendente" },
  ]);
  await porFoto(imoveis.casa, "fachada", 1);
  await porFoto(imoveis.casa, "sala", 2);

  // 13 imóveis para as páginas: 12 na primeira, 1 na segunda.
  await criarImoveis(
    Array.from({ length: 13 }, (_, i) => ({
      titulo: `Página catálogo ${String(i + 1).padStart(2, "0")}`,
      tipo: "Apartamento",
      bairro: "Centro",
      preco: 7_771_001 + i,
      quartos: 1,
      haMinutos: i + 1,
    })),
  );
});

test.afterAll(() => apagarContas(PREFIXO));

// Navegador novo com a sessão da conta, do tamanho do projeto (celular ou computador).
async function paginaDe(browser: Browser, conta: Conta) {
  const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId } = test.info().project.use;
  const contexto = await browser.newContext({
    baseURL: ORIGEM, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId,
  });
  await contexto.addCookies(sessoes[conta].cookies);
  return contexto.newPage();
}

const cards = (page: Page) => page.getByRole("region", { name: "Imóveis" }).getByRole("listitem");
const titulosNaTela = async (page: Page) => (await cards(page).locator("b").allTextContents()).map((t) => t.trim());

test("assinante ativo vê os cards com capa, status e número de fotos; vendido e pendente não aparecem", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}`);

  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  // Mais recente no catálogo primeiro.
  expect(await titulosNaTela(page)).toEqual([
    "Casa catálogo no Campeche",
    "Apartamento catálogo na Lagoa",
    "Terreno catálogo no Campeche",
  ]);

  const casa = cards(page).filter({ hasText: "Casa catálogo no Campeche" });
  await expect(casa.getByText("Disponível")).toBeVisible();
  await expect(casa.getByText("2 fotos")).toBeVisible();
  await expect(casa.getByText("R$ 7.770.100")).toBeVisible();
  await expect(casa.getByText("4 quartos")).toBeVisible();
  await expect(casa.getByRole("link")).toHaveAttribute("href", `/assinante/imoveis/${imoveis.casa}?${FAIXA}`);
  // A capa é a miniatura da foto 1, com link temporário do bucket privado; com
  // carregamento preguiçoso fora do topo e na hora nos primeiros cards.
  const capa = casa.locator("img");
  await expect(capa).toHaveAttribute("src", new RegExp(`/storage/v1/object/sign/${BALDE}/${imoveis.casa}/fachada-mini\\.jpg\\?token=`));
  await expect(capa).toHaveAttribute("loading", "eager");

  const apartamento = cards(page).filter({ hasText: "Apartamento catálogo na Lagoa" });
  await expect(apartamento.getByText("Em negociação")).toBeVisible();
  await expect(apartamento.getByText("0 fotos")).toBeVisible();
  // Terreno sem quartos: o resumo não mostra "0 quartos".
  await expect(cards(page).filter({ hasText: "Terreno catálogo" }).getByText(/quarto/)).toHaveCount(0);

  await expect(page.getByText("Casa catálogo vendida")).toHaveCount(0);
  await expect(page.getByText("Casa catálogo pendente")).toHaveCount(0);
});

test("chips de tipo e status mudam a URL e a lista, sem perder os outros filtros", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}`);
  await expect(cards(page)).toHaveCount(3);

  await page.getByRole("group", { name: "Filtrar por status" }).getByRole("link", { name: "Em negociação" }).click();
  await expect(page).toHaveURL(/status=negociacao/);
  await expect(page).toHaveURL(/preco_min=7770000/);
  await expect(cards(page)).toHaveCount(1);
  expect(await titulosNaTela(page)).toEqual(["Apartamento catálogo na Lagoa"]);

  await page.getByRole("group", { name: "Filtrar por status" }).getByRole("link", { name: "Disponível" }).click();
  await expect(cards(page)).toHaveCount(2);

  await page.getByRole("group", { name: "Filtrar por status" }).getByRole("link", { name: "Todos os status" }).click();
  await page.getByRole("group", { name: "Filtrar por tipo" }).getByRole("link", { name: "Casa", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tipo=${listas.tipos.get("Casa")}`));
  await expect(cards(page)).toHaveCount(1);
  expect(await titulosNaTela(page)).toEqual(["Casa catálogo no Campeche"]);
  await expect(page.getByRole("group", { name: "Filtrar por tipo" }).getByRole("link", { name: "Casa", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await page.getByRole("group", { name: "Filtrar por tipo" }).getByRole("link", { name: "Terreno" }).click();
  await page.getByRole("group", { name: "Filtrar por status" }).getByRole("link", { name: "Em negociação" }).click();
  await expect(page.getByText("Nenhum imóvel com esses filtros.")).toBeVisible();
});

test("celular: a folha de filtros escolhe vários bairros, preço e quartos, e a URL leva a busca", async ({ browser }) => {
  test.skip(test.info().project.name !== "celular", "no computador os filtros ficam na coluna, sem folha");
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}`);
  await expect(cards(page)).toHaveCount(3);
  // Nada da página passa da largura do celular.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.getByRole("button", { name: "Filtros" }).click();
  const folha = page.getByRole("dialog", { name: "Filtros" });
  await expect(folha).toBeVisible();
  // O preço da URL já aparece no campo, escrito como a pessoa digitaria.
  await expect(folha.getByLabel("Preço mín.")).toHaveValue("7.770.000");

  // Procurar sem acento acha "Lagoa da Conceição"; o bairro que não bate some da vista.
  await folha.getByLabel("Procurar bairro").fill("conceicao");
  await expect(folha.getByLabel("Campeche")).toBeHidden();
  await folha.getByLabel("Lagoa da Conceição").check();
  await folha.getByLabel("Procurar bairro").fill("campe");
  await folha.getByLabel("Campeche").check();
  await expect(folha.getByText("2 marcados")).toBeVisible();
  await folha.getByLabel("Quartos").selectOption("2");
  await folha.getByRole("button", { name: "Ver imóveis" }).click();

  await expect(folha).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`bairro=${listas.bairros.get("Lagoa da Conceição")}`));
  await expect(page).toHaveURL(new RegExp(`bairro=${listas.bairros.get("Campeche")}`));
  await expect(page).toHaveURL(/quartos=2/);
  // Com 2+ quartos, o terreno (sem quartos) sai; a casa (4) e o apartamento (2) ficam.
  expect(await titulosNaTela(page)).toEqual(["Casa catálogo no Campeche", "Apartamento catálogo na Lagoa"]);
  // Bairros, preço (que já vinha na URL) e quartos.
  await expect(page.getByRole("button", { name: "Filtros (3)" })).toBeVisible();

  // A mesma URL, aberta por outra pessoa (outro navegador), mostra a mesma busca.
  const compartilhada = await paginaDe(browser, "ativo");
  await compartilhada.goto(page.url());
  expect(await titulosNaTela(compartilhada)).toEqual(["Casa catálogo no Campeche", "Apartamento catálogo na Lagoa"]);

  // Limpar tira bairros, preço e quartos.
  await page.getByRole("button", { name: "Filtros (3)" }).click();
  await page.getByRole("dialog", { name: "Filtros" }).getByRole("link", { name: "Limpar bairros, preço e quartos" }).click();
  await expect(page).toHaveURL(/\/assinante$/);

  // Campo vazio (preço e quartos sem nada) não vai para a URL, e o tipo escolhido
  // no chip vai junto com o formulário.
  await page.goto(`/assinante?tipo=${listas.tipos.get("Apartamento")}`);
  await page.getByRole("button", { name: "Filtros" }).click();
  await page.getByRole("dialog", { name: "Filtros" }).getByLabel("Lagoa da Conceição").check();
  await page.getByRole("dialog", { name: "Filtros" }).getByRole("button", { name: "Ver imóveis" }).click();
  await expect(page).toHaveURL(new RegExp(`bairro=${listas.bairros.get("Lagoa da Conceição")}`));
  expect(new URL(page.url()).search).toBe(
    `?tipo=${listas.tipos.get("Apartamento")}&bairro=${listas.bairros.get("Lagoa da Conceição")}`,
  );
});

test("computador: os filtros ficam na coluna ao lado da lista", async ({ browser }) => {
  test.skip(test.info().project.name !== "computador", "no celular a folha é testada acima");
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}`);
  const coluna = page.getByRole("complementary", { name: "Filtros" });
  await expect(coluna.getByLabel("Lagoa da Conceição")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filtros" })).toBeHidden();
  // Em tela baixa, a coluna cabe na tela e rola por dentro: "Ver imóveis" não some.
  await page.setViewportSize({ width: 1280, height: 600 });
  await expect.poll(() => coluna.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(600 - 64);
  expect(await coluna.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await coluna.getByLabel("Lagoa da Conceição").check();
  await coluna.getByRole("button", { name: "Ver imóveis" }).click();
  await expect(page).toHaveURL(new RegExp(`bairro=${listas.bairros.get("Lagoa da Conceição")}`));
  expect(await titulosNaTela(page)).toEqual(["Apartamento catálogo na Lagoa"]);
  await expect(page.getByText("1 imóvel exclusivo em Florianópolis")).toBeVisible();
});

test("páginas de 12: Próxima e Anterior, com a página na URL", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA_PAGINAS}`);
  await expect(cards(page)).toHaveCount(12);
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await expect(page.getByRole("link", { name: "Anterior" })).toHaveCount(0);

  await page.getByRole("link", { name: "Próxima" }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await expect(cards(page)).toHaveCount(1);
  expect(await titulosNaTela(page)).toEqual(["Página catálogo 13"]);

  await page.getByRole("link", { name: "Anterior" }).click();
  await expect(cards(page)).toHaveCount(12);
  await expect(page).not.toHaveURL(/pagina=/);

  // Página que não existe mais (ex.: link antigo): cai na primeira, com os filtros.
  await page.goto(`/assinante?${FAIXA_PAGINAS}&pagina=9`);
  await expect(page).not.toHaveURL(/pagina=/);
  await expect(page).toHaveURL(new RegExp(FAIXA_PAGINAS));
  await expect(cards(page)).toHaveCount(12);
});

test("voltar do imóvel cai nos mesmos filtros e na mesma página", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA_PAGINAS}&pagina=2`);
  await page.getByRole("link", { name: /Página catálogo 13/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Página catálogo 13" })).toBeVisible();
  const voltar = test.info().project.name === "celular"
    ? page.getByRole("link", { name: "Voltar ao catálogo" })
    : page.getByRole("navigation", { name: "Caminho" }).getByRole("link", { name: "Catálogo" });
  await voltar.click();
  await expect(page).toHaveURL(new RegExp(`/assinante\\?${FAIXA_PAGINAS}&pagina=2$`));
  await expect(cards(page)).toHaveCount(1);
});

test("detalhe do terreno não mostra o que é zero", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante/imoveis/${imoveis.terreno}`);
  await expect(page.getByRole("heading", { level: 1, name: "Terreno catálogo no Campeche" })).toBeVisible();
  await expect(page.getByRole("term")).toHaveText(["vagas", "área"]);
});

test("celular: a folha segura o foco, devolve ao fechar, e Enter na procura não envia", async ({ browser }) => {
  test.skip(test.info().project.name !== "celular", "no computador os filtros ficam na coluna, sem folha");
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}`);
  const botao = page.getByRole("button", { name: "Filtros" });
  await botao.click();
  const folha = page.getByRole("dialog", { name: "Filtros" });
  await expect(folha).toBeVisible();

  const procura = folha.getByLabel("Procurar bairro");
  await procura.fill("campe");
  await procura.press("Enter");
  await expect(folha).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?${FAIXA}$`));

  // Do primeiro botão, Shift+Tab vai ao último da folha, e Tab volta ao primeiro.
  const fechar = folha.getByRole("button", { name: "Fechar" });
  await fechar.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(folha.getByRole("link", { name: "Limpar bairros, preço e quartos" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(fechar).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(folha).toBeHidden();
  await expect(botao).toBeFocused();
});

test("filtros inválidos na URL são ignorados, sem erro", async ({ browser }) => {
  const page = await paginaDe(browser, "ativo");
  await page.goto(`/assinante?${FAIXA}&tipo=abc&bairro=-1&bairro=x&quartos=9&status=vendido&pagina=0`);
  await expect(cards(page)).toHaveCount(3);
  // Mínimo maior que o máximo: os dois trocam de lugar.
  await page.goto("/assinante?preco_min=7770999&preco_max=7770000");
  await expect(cards(page)).toHaveCount(3);
});

test("assinante bloqueado não abre o catálogo nem recebe imóveis pela API", async ({ browser }) => {
  const page = await paginaDe(browser, "bloqueado");
  await page.goto("/assinante");
  await expect(page).toHaveURL(/\/acesso-suspenso$/);

  const { cliente } = sessoes.bloqueado;
  const { data: lista, error } = await cliente.rpc("catalogo", { p_preco_min: 7_770_000, p_preco_max: 7_770_999 });
  expect(error).toBeNull();
  expect(lista).toEqual([]);
  const { data: detalhe } = await cliente.rpc("imovel_do_catalogo", { p_imovel: imoveis.casa });
  expect(detalhe).toEqual([]);
  const { data: fotos } = await cliente.from("fotos_imovel").select("id").eq("imovel_id", imoveis.casa);
  expect(fotos).toEqual([]);
  // Nem o arquivo: o Storage não dá link para quem está sem acesso.
  const { data: link } = await cliente.storage.from(BALDE).createSignedUrl(`${imoveis.casa}/fachada.jpg`, 60);
  expect(link).toBeNull();
});

test("foto de imóvel vendido não chega ao assinante ativo, nem o registro nem o arquivo", async () => {
  const admin = clienteAdmin();
  const caminho = `${imoveis.vendido}/fachada.jpg`;
  const { error: erroEnvio } = await admin.storage
    .from(BALDE)
    .upload(caminho, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: "image/jpeg" });
  expect(erroEnvio).toBeNull();
  const { error } = await admin.from("fotos_imovel").insert({ imovel_id: imoveis.vendido, caminho, ordem: 1 });
  expect(error).toBeNull();

  const { cliente } = sessoes.ativo;
  const { data: fotos } = await cliente.from("fotos_imovel").select("id").eq("imovel_id", imoveis.vendido);
  expect(fotos).toEqual([]);
  const { data: link } = await cliente.storage.from(BALDE).createSignedUrl(caminho, 60);
  expect(link).toBeNull();
});

test("API: o assinante ativo não lê a tabela imoveis e o catálogo não traz colunas internas", async () => {
  const { cliente } = sessoes.ativo;
  // Pendência da auditoria da Etapa 2: antes, dava para ler proprietario_id,
  // exclusividade_fim e outras colunas direto.
  const { data: direto } = await cliente.from("imoveis").select("id, proprietario_id, exclusividade_fim").eq("id", imoveis.casa);
  expect(direto).toEqual([]);

  const { data: lista, error } = await cliente.rpc("catalogo", { p_preco_min: 7_770_000, p_preco_max: 7_770_999 });
  expect(error).toBeNull();
  expect(lista).toHaveLength(3);
  const colunas = Object.keys(lista![0]);
  for (const interna of ["proprietario_id", "exclusividade_inicio", "exclusividade_fim", "termo_versao", "captado_pelo_admin", "versao", "mostrar_contato", "telefone", "email"]) {
    expect(colunas).not.toContain(interna);
  }

  // As fotos do imóvel do catálogo continuam visíveis, e as do pendente não.
  const { data: fotos } = await cliente.from("fotos_imovel").select("id").eq("imovel_id", imoveis.casa);
  expect(fotos).toHaveLength(2);
  const { data: link } = await cliente.storage.from(BALDE).createSignedUrl(`${imoveis.casa}/fachada.jpg`, 60);
  expect(link?.signedUrl).toBeTruthy();
  const { data: pendente } = await cliente.rpc("imovel_do_catalogo", { p_imovel: imoveis.pendente });
  expect(pendente).toEqual([]);
});

import { expect, test, type Browser, type Request } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo } from "./apoio/supabase";

// "Meus imóveis", passo 4.4: a lista com o status de cada imóvel, apagar só em
// rascunho, pendente ou reprovado, com os arquivos das fotos (RF12), e a escolha
// de mostrar o contato na página do imóvel (RF13).

const PREFIXO = "e2e-lista-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";
const BALDE = "fotos-imoveis";

type Conta = "dona" | "outra";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  ids.dona = await criarConta(email("dona"), { tipo: "proprietario", nome: "Marina Lista", telefone: "48999990030" });
  ids.outra = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Lista", telefone: "48999990031" });
  sessoes.dona = await entrarComo(email("dona"));
  sessoes.outra = await entrarComo(email("outra"));
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta].cookies);
  return contexto.newPage();
}

type Status = "rascunho" | "pendente" | "reprovado" | "disponivel" | "vendido";

// Imóvel criado direto no banco, no status pedido.
async function criarImovel(titulo: string, status: Status, dono: Conta = "dona") {
  const admin = clienteAdmin();
  const agora = new Date().toISOString();
  const fim = new Date(Date.UTC(2027, 3, 13, 15)).toISOString(); // 13/04/2027
  const aprovado = status === "disponivel" || status === "vendido";
  const { data, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: ids[dono],
      titulo,
      tipo_id: (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id,
      endereco: "Rua das Gaivotas, 210",
      bairro_id: (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id,
      preco: 1890000,
      quartos: 4,
      area: 220,
      status,
      ...(status === "reprovado" && { motivo_reprovacao: "Fotos escuras" }),
      ...(status !== "rascunho" && { termo_versao: "2026-10-provisorio", termo_aceito_em: agora }),
      ...(aprovado && { exclusividade_inicio: agora, exclusividade_fim: fim }),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// Foto enviada pela dona (como pela tela: grande e miniatura) e gravada no banco.
async function porFoto(imovelId: string, nome: string, ordem: number) {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const balde = sessoes.dona.cliente.storage.from(BALDE);
  for (const arquivo of [`${nome}.jpg`, `${nome}-mini.jpg`]) {
    const { error } = await balde.upload(`${imovelId}/${arquivo}`, jpeg, { contentType: "image/jpeg" });
    if (error) throw error;
  }
  await clienteAdmin().from("fotos_imovel").insert({ imovel_id: imovelId, caminho: `${imovelId}/${nome}.jpg`, ordem });
}

async function existe(imovelId: string) {
  const { data } = await clienteAdmin().from("imoveis").select("id").eq("id", imovelId).maybeSingle();
  return data !== null;
}

async function arquivos(imovelId: string) {
  const { data } = await clienteAdmin().storage.from(BALDE).list(imovelId, { limit: 100 });
  return data?.length ?? 0;
}

test("a lista mostra cada imóvel com o status, e Apagar só onde pode", async ({ browser }) => {
  const sufixo = test.info().project.name;
  const titulos = {
    rascunho: `Rascunho ${sufixo}`,
    pendente: `Pendente ${sufixo}`,
    reprovado: `Reprovado ${sufixo}`,
    disponivel: `Disponível ${sufixo}`,
    vendido: `Vendido ${sufixo}`,
  };
  for (const [status, titulo] of Object.entries(titulos)) await criarImovel(titulo, status as Status);
  await criarImovel(`Da outra ${sufixo}`, "pendente", "outra");

  const pagina = await paginaDe(browser, "dona");
  await pagina.goto("/proprietario");
  const cartao = (titulo: string) => pagina.getByRole("listitem").filter({ hasText: titulo });

  await expect(cartao(titulos.rascunho)).toContainText("Cadastro não terminado");
  await expect(cartao(titulos.rascunho)).toContainText("Continuar o cadastro");
  await expect(cartao(titulos.pendente)).toContainText("Aguardando aprovação");
  await expect(cartao(titulos.reprovado)).toContainText("Motivo: Fotos escuras");
  await expect(cartao(titulos.disponivel)).toContainText("Exclusividade até 13/04/2027");
  await expect(cartao(titulos.vendido)).toContainText("Vendido");
  // O imóvel da outra proprietária não aparece.
  await expect(pagina.getByText(`Da outra ${sufixo}`)).toHaveCount(0);

  for (const status of ["rascunho", "pendente", "reprovado"] as const) {
    await expect(cartao(titulos[status]).getByRole("button", { name: "Apagar" }), status).toBeVisible();
  }
  for (const status of ["disponivel", "vendido"] as const) {
    await expect(cartao(titulos[status]).getByRole("button", { name: "Apagar" }), status).toHaveCount(0);
  }

  // O rascunho continua o cadastro; os outros abrem a página do imóvel.
  await cartao(titulos.rascunho).getByRole("link").click();
  await expect(pagina).toHaveURL(/\/fotos$/);
  await pagina.context().close();
});

test("apagar imóvel pendente apaga também os arquivos das fotos", async ({ browser }) => {
  const titulo = `Para apagar ${test.info().project.name}`;
  const imovelId = await criarImovel(titulo, "pendente");
  await porFoto(imovelId, "a", 1);
  await porFoto(imovelId, "b", 2);
  expect(await arquivos(imovelId)).toBe(4);

  const pagina = await paginaDe(browser, "dona");
  await pagina.goto("/proprietario");
  await pagina.getByRole("listitem").filter({ hasText: titulo }).getByRole("button", { name: "Apagar" }).click();
  const janela = pagina.getByRole("dialog", { name: "Apagar imóvel?" });
  await expect(janela).toContainText(`O imóvel “${titulo}” e as 2 fotos dele serão apagados.`);

  // Cancelar não apaga.
  await janela.getByRole("button", { name: "Cancelar" }).click();
  await expect(janela).toBeHidden();
  expect(await existe(imovelId)).toBe(true);

  await pagina.getByRole("listitem").filter({ hasText: titulo }).getByRole("button", { name: "Apagar" }).click();
  await janela.getByRole("button", { name: "Apagar" }).click();
  await expect(pagina).toHaveURL(/\/proprietario\?apagado=1$/);
  await expect(pagina.getByText("O imóvel e as fotos dele foram apagados.")).toBeVisible();
  await expect(pagina.getByText(titulo)).toHaveCount(0);

  expect(await existe(imovelId)).toBe(false);
  expect(await arquivos(imovelId)).toBe(0);
  await pagina.context().close();
});

test("imóvel aprovado não é apagado, nem chamando a action direto; outra pessoa também não apaga", async ({ browser }) => {
  const sufixo = test.info().project.name;
  const pendente = await criarImovel(`Pendente gravado ${sufixo}`, "pendente");
  const disponivel = await criarImovel(`Aprovado ${sufixo}`, "disponivel");
  await porFoto(disponivel, "capa", 1);

  // Grava a requisição que a tela manda ao confirmar o apagar do pendente.
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto("/proprietario");
  let gravada: Request | undefined;
  await pagina.route("**/proprietario**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await pagina.getByRole("listitem").filter({ hasText: `Pendente gravado ${sufixo}` }).getByRole("button", { name: "Apagar" }).click();
  await pagina.getByRole("dialog").getByRole("button", { name: "Apagar" }).click();
  await expect.poll(() => gravada).toBeDefined();
  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  const corpo = gravada!.postData()!;
  expect(corpo).toContain(pendente);
  await pagina.context().close();

  const chamar = async (conta: Conta, dados: string) => {
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    await contexto.addCookies(sessoes[conta].cookies);
    await contexto.request.post("/proprietario", { headers: cabecalhos, data: dados, maxRedirects: 0 });
    await contexto.close();
  };

  // A dona troca o id pelo do imóvel aprovado: nada some, nem os arquivos.
  await chamar("dona", corpo.replace(pendente, disponivel));
  expect(await existe(disponivel)).toBe(true);
  expect(await arquivos(disponivel)).toBe(2);

  // A outra proprietária manda a requisição do pendente da dona: nada some.
  await chamar("outra", corpo);
  expect(await existe(pendente)).toBe(true);

  // A dona manda a requisição como gravada: apaga (prova que ela vale).
  await chamar("dona", corpo);
  expect(await existe(pendente)).toBe(false);
});

test("a dona liga o contato na página do imóvel; outra pessoa não abre a página", async ({ browser }) => {
  const titulo = `Contato ${test.info().project.name}`;
  const imovelId = await criarImovel(titulo, "disponivel");

  const pagina = await paginaDe(browser, "dona");
  await pagina.goto(`/proprietario/imoveis/${imovelId}`);
  await expect(pagina.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(pagina.getByText("Exclusividade PAUTA até 13/04/2027")).toBeVisible();

  const interruptor = pagina.getByRole("switch", { name: "Mostrar meu contato aos corretores" });
  await expect(interruptor).toHaveAttribute("aria-checked", "false");
  await interruptor.click();
  await expect(pagina.getByText("Corretores veem seu telefone e e-mail.")).toBeVisible();
  await expect
    .poll(async () => (await clienteAdmin().from("imoveis").select("mostrar_contato").eq("id", imovelId).single()).data?.mostrar_contato)
    .toBe(true);

  // Imóvel disponível: a troca fica registrada para o admin (RNF11).
  const { data: edicoes } = await clienteAdmin().from("edicoes_imovel").select("campo, valor_antigo, valor_novo").eq("imovel_id", imovelId);
  expect(edicoes).toEqual([{ campo: "mostrar_contato", valor_antigo: "false", valor_novo: "true" }]);

  // Recarregada, a página mostra o que ficou gravado.
  await pagina.reload();
  await expect(pagina.getByRole("switch", { name: "Mostrar meu contato aos corretores" })).toHaveAttribute("aria-checked", "true");
  await pagina.context().close();

  const daOutra = await paginaDe(browser, "outra");
  await daOutra.goto(`/proprietario/imoveis/${imovelId}`);
  await expect(daOutra.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  await expect(daOutra.getByText(titulo)).toHaveCount(0);
  await daOutra.context().close();
});

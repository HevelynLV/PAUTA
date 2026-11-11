import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, tornarAdmin } from "./apoio/supabase";

// RF14, passo 4.5: o admin aprova ou reprova o imóvel do proprietário. A aprovação
// falha se o imóvel mudou depois que a tela foi aberta (a versão do imóvel sobe a
// cada mudança e vai junto com o "Aprovar"); reprovar exige motivo, que o dono vê.

const PREFIXO = "e2e-aprovar-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";

type Conta = "dona" | "admin";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  ids.dona = await criarConta(email("dona"), { tipo: "proprietario", nome: "Marina Aprovar", telefone: "48999990050" });
  ids.admin = await criarConta(email("admin"), { tipo: "proprietario", nome: "Admin Aprovar", telefone: "48999990051" });
  await tornarAdmin(ids.admin);
  sessoes.dona = await entrarComo(email("dona"));
  sessoes.admin = await entrarComo(email("admin"));
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta].cookies);
  return contexto.newPage();
}

// Imóvel pendente da dona, com uma foto enviada por ela (como pela tela).
async function criarPendente(titulo: string) {
  const admin = clienteAdmin();
  const { data, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: ids.dona,
      titulo,
      tipo_id: (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id,
      endereco: "Rua das Gaivotas, 210",
      bairro_id: (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id,
      preco: 1890000,
      quartos: 4,
      banheiros: 3,
      vagas: 2,
      area: 220,
      status: "pendente",
      termo_versao: "2026-10-provisorio",
      termo_aceito_em: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const balde = sessoes.dona.cliente.storage.from("fotos-imoveis");
  await balde.upload(`${data.id}/capa.jpg`, jpeg, { contentType: "image/jpeg" });
  await balde.upload(`${data.id}/capa-mini.jpg`, jpeg, { contentType: "image/jpeg" });
  await admin.from("fotos_imovel").insert({ imovel_id: data.id, caminho: `${data.id}/capa.jpg`, ordem: 1 });
  return data.id as string;
}

async function imovel(id: string) {
  const { data } = await clienteAdmin()
    .from("imoveis")
    .select("status, motivo_reprovacao, exclusividade_inicio, exclusividade_fim")
    .eq("id", id)
    .single();
  return data!;
}

// "Aprovar" no celular, "Aprovar e publicar" no computador.
const botaoAprovar = (pagina: Page) => pagina.getByRole("button", { name: /^Aprovar( e publicar)?$/ });

test("admin aprova: o imóvel fica disponível, com 6 meses de exclusividade", async ({ browser }) => {
  const titulo = `Casa para aprovar ${test.info().project.name}`;
  const id = await criarPendente(titulo);
  const pagina = await paginaDe(browser, "admin");
  await pagina.goto(`/admin/imoveis?id=${id}`);

  await expect(pagina.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(pagina.getByText("Rua das Gaivotas, 210 · Campeche · Casa")).toBeVisible();
  await expect(pagina.getByText("(48) 99999-0050")).toBeVisible();
  await expect(pagina.getByText(/Termo de exclusividade aceito em .* \(versão 2026-10-provisorio\)/)).toBeVisible();
  await expect(pagina.getByRole("link", { name: "Capa: abrir a foto grande" })).toBeVisible();

  await botaoAprovar(pagina).click();
  await expect(pagina.getByRole("status")).toHaveText("Imóvel aprovado");

  const depois = await imovel(id);
  expect(depois.status).toBe("disponivel");
  const inicio = new Date(depois.exclusividade_inicio!);
  const fim = new Date(depois.exclusividade_fim!);
  const seisMeses = new Date(inicio);
  seisMeses.setUTCMonth(seisMeses.getUTCMonth() + 6);
  expect(Math.abs(fim.getTime() - seisMeses.getTime())).toBeLessThan(2 * 864e5);
  await expect(pagina.getByText(`A exclusividade vai até ${fim.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`)).toBeVisible();

  // Saiu da fila.
  await pagina.getByRole("button", { name: "Próximo da fila" }).click();
  await expect(pagina.getByRole("link", { name: new RegExp(titulo) })).toHaveCount(0);
  await pagina.context().close();
});

test("aprovação falha se a dona mudou o preço depois que o admin abriu a tela", async ({ browser }) => {
  const titulo = `Casa que mudou ${test.info().project.name}`;
  const id = await criarPendente(titulo);
  const pagina = await paginaDe(browser, "admin");
  await pagina.goto(`/admin/imoveis?id=${id}`);
  await expect(pagina.getByText("R$ 1.890.000", { exact: true })).toBeVisible();

  // A dona edita o pendente (pode, decisão de 26/10/2026) com a tela do admin aberta.
  const { error } = await sessoes.dona.cliente.from("imoveis").update({ preco: 1750000 }).eq("id", id);
  expect(error).toBeNull();

  await botaoAprovar(pagina).click();
  await expect(pagina.getByText(/O imóvel mudou depois que você abriu esta tela/)).toBeVisible();
  // A tela recarregou com o preço novo, e nada foi aprovado.
  await expect(pagina.getByText("R$ 1.750.000", { exact: true })).toBeVisible();
  expect((await imovel(id)).status).toBe("pendente");

  // Conferido o dado novo, aprovar passa.
  await botaoAprovar(pagina).click();
  await expect(pagina.getByRole("status")).toHaveText("Imóvel aprovado");
  expect((await imovel(id)).status).toBe("disponivel");
  await pagina.context().close();
});

test("admin reprova com motivo, e a dona vê o motivo em Meus imóveis", async ({ browser }) => {
  const titulo = `Casa para reprovar ${test.info().project.name}`;
  const id = await criarPendente(titulo);
  const pagina = await paginaDe(browser, "admin");
  await pagina.goto(`/admin/imoveis?id=${id}`);

  await pagina.getByRole("button", { name: "Reprovar" }).click();
  const folha = pagina.getByRole("dialog", { name: "Reprovar imóvel" });
  await folha.getByRole("button", { name: "Reprovar" }).click();
  await expect(folha.getByText("Escreva o motivo, para o proprietário saber o que corrigir.")).toBeVisible();
  expect((await imovel(id)).status).toBe("pendente");

  const motivo = "As fotos estão escuras e não mostram a área externa.";
  await folha.getByLabel("Motivo (o proprietário vai ler)").fill(motivo);
  await folha.getByRole("button", { name: "Reprovar" }).click();
  await expect(pagina.getByRole("status")).toHaveText("Imóvel reprovado");
  expect(await imovel(id)).toMatchObject({ status: "reprovado", motivo_reprovacao: motivo });
  await pagina.context().close();

  const daDona = await paginaDe(browser, "dona");
  await daDona.goto("/proprietario");
  await expect(daDona.getByRole("listitem").filter({ hasText: titulo })).toContainText(`Motivo: ${motivo}`);
  await daDona.context().close();
});

test("a dona não abre a tela do admin nem aprova chamando a action direto", async ({ browser }) => {
  const id = await criarPendente(`Casa da action ${test.info().project.name}`);

  const daDona = await paginaDe(browser, "dona");
  await daDona.goto("/admin/imoveis");
  await expect(daDona).toHaveURL(/\/proprietario$/);
  await daDona.context().close();

  // Grava a requisição do "Aprovar" na tela do admin, sem deixá-la chegar.
  const pagina = await paginaDe(browser, "admin");
  await pagina.goto(`/admin/imoveis?id=${id}`);
  let gravada: Request | undefined;
  await pagina.route("**/admin/imoveis**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await botaoAprovar(pagina).click();
  await expect.poll(() => gravada).toBeDefined();
  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  const corpo = gravada!.postDataBuffer()!;
  const endereco = gravada!.url();
  await pagina.context().close();

  const chamar = async (conta: Conta) => {
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    await contexto.addCookies(sessoes[conta].cookies);
    await contexto.request.post(endereco, { headers: cabecalhos, data: corpo, maxRedirects: 0 });
    await contexto.close();
  };

  await chamar("dona");
  expect((await imovel(id)).status).toBe("pendente");
  // O admin manda a mesma requisição: aprova (prova que ela vale).
  await chamar("admin");
  expect((await imovel(id)).status).toBe("disponivel");
});

test("o painel do admin mostra quantos imóveis esperam aprovação", async ({ browser }) => {
  await criarPendente(`Casa do painel ${test.info().project.name}`);
  const { count } = await clienteAdmin().from("imoveis").select("id", { count: "exact", head: true }).eq("status", "pendente");

  const pagina = await paginaDe(browser, "admin");
  await pagina.goto("/admin");
  const tile = pagina.getByRole("link", { name: /Imóveis para aprovar/ });
  await expect(tile).toContainText(String(count));
  await tile.click();
  await expect(pagina).toHaveURL(/\/admin\/imoveis$/);
  await pagina.context().close();
});

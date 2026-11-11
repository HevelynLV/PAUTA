import { expect, test, type Browser, type Request } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, tornarAdmin } from "./apoio/supabase";

// Passo 4.6: editar imóvel já enviado. Disponível vale na hora e fica registrado
// (RF10, RNF11), e o admin revisa (RF17). Reprovado: salvar não reenvia; o
// reenvio é um passo explícito (RF11). Pendente: edita sem registro.

const PREFIXO = "e2e-editar-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";

type Conta = "dona" | "outra" | "admin";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  ids.dona = await criarConta(email("dona"), { tipo: "proprietario", nome: "Marina Editar", telefone: "48999990060" });
  ids.outra = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Editar", telefone: "48999990061" });
  ids.admin = await criarConta(email("admin"), { tipo: "proprietario", nome: "Admin Editar", telefone: "48999990062" });
  await tornarAdmin(ids.admin);
  for (const conta of ["dona", "outra", "admin"] as Conta[]) sessoes[conta] = await entrarComo(email(conta));
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta].cookies);
  return contexto.newPage();
}

// Imóvel da dona no status pedido, com fotos enviadas por ela (como pela tela).
async function criarImovel(titulo: string, status: "pendente" | "reprovado" | "disponivel", fotos = 1) {
  const admin = clienteAdmin();
  const agora = new Date().toISOString();
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
      area: 220,
      status,
      termo_versao: "2026-10-provisorio",
      termo_aceito_em: agora,
      ...(status === "reprovado" && { motivo_reprovacao: "Fotos escuras" }),
      ...(status === "disponivel" && { exclusividade_inicio: agora, exclusividade_fim: "2027-04-13T15:00:00Z" }),
    })
    .select("id")
    .single();
  if (error) throw error;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const balde = sessoes.dona.cliente.storage.from("fotos-imoveis");
  for (let ordem = 1; ordem <= fotos; ordem++) {
    await balde.upload(`${data.id}/foto-${ordem}.jpg`, jpeg, { contentType: "image/jpeg" });
    await balde.upload(`${data.id}/foto-${ordem}-mini.jpg`, jpeg, { contentType: "image/jpeg" });
    await admin.from("fotos_imovel").insert({ imovel_id: data.id, caminho: `${data.id}/foto-${ordem}.jpg`, ordem });
  }
  return data.id as string;
}

async function imovel(id: string) {
  const { data } = await clienteAdmin().from("imoveis").select("titulo, preco, status, motivo_reprovacao").eq("id", id).single();
  return data!;
}

async function edicoes(id: string) {
  const { data } = await clienteAdmin()
    .from("edicoes_imovel")
    .select("id, campo, valor_antigo, valor_novo, revisado_em, revisado_por")
    .eq("imovel_id", id)
    .order("id");
  return data ?? [];
}

test("disponível: a edição vale na hora, mostra o que mudou e o admin revisa", async ({ browser }) => {
  const titulo = `Disponível editado ${test.info().project.name}`;
  const id = await criarImovel(titulo, "disponivel");

  const pagina = await paginaDe(browser, "dona");
  await pagina.goto(`/proprietario/imoveis/${id}`);
  await pagina.getByRole("link", { name: "Editar", exact: true }).click();
  await expect(pagina).toHaveURL(new RegExp(`/${id}/editar$`));
  await expect(pagina.getByText("As mudanças valem na hora, sem nova aprovação")).toBeVisible();

  await pagina.getByLabel("Preço (R$)").fill("1.850.000");
  await expect(pagina.getByText("Antes: 1.890.000")).toBeVisible();
  await pagina.getByRole("button", { name: "Salvar alterações" }).click();

  await expect(pagina.getByRole("status")).toHaveText("Alterações salvas");
  await expect(pagina.getByText("As mudanças já aparecem no catálogo para os corretores.")).toBeVisible();
  await expect(pagina.getByText("R$ 1.890.000", { exact: true })).toBeVisible();
  await expect(pagina.getByText("R$ 1.850.000", { exact: true })).toBeVisible();
  await pagina.context().close();

  expect(await imovel(id)).toMatchObject({ preco: 1850000, status: "disponivel" });
  const registro = await edicoes(id);
  expect(registro.map((e) => e.campo)).toEqual(["preco"]);

  // O admin vê a edição, legível, e marca como revisada.
  const doAdmin = await paginaDe(browser, "admin");
  await doAdmin.goto("/admin/edicoes");
  const linha = doAdmin.locator(test.info().project.name === "celular" ? "li" : "tr").filter({ hasText: titulo });
  await expect(linha).toContainText("Preço");
  await expect(linha).toContainText("R$ 1.890.000");
  await expect(linha).toContainText("R$ 1.850.000");
  await expect(linha).toContainText("Marina Editar");
  await linha.getByRole("button", { name: "Marcar como revisada" }).click();
  await expect(linha).toContainText("Revisada");
  await expect(linha.getByRole("button", { name: "Marcar como revisada" })).toHaveCount(0);
  await doAdmin.context().close();

  const [revisada] = await edicoes(id);
  expect(revisada.revisado_por).toBe(ids.admin);
  expect(revisada.revisado_em).not.toBeNull();
});

test("fotos na edição: tirar foto do disponível fica registrado, e a última foto não sai", async ({ browser }) => {
  const id = await criarImovel(`Disponível com fotos ${test.info().project.name}`, "disponivel", 2);
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto(`/proprietario/imoveis/${id}/editar`);
  await pagina.getByRole("link", { name: "Mudar fotos" }).click();
  await expect(pagina.getByText("As mudanças nas fotos valem na hora")).toBeVisible();
  await expect(pagina.getByRole("button", { name: /Adicionar fotos|Arraste as fotos/ })).toBeEnabled();

  await pagina.getByRole("button", { name: "Tirar foto 2" }).click();
  await expect(pagina.getByText("1 de 20")).toBeVisible();
  expect((await edicoes(id)).map((e) => e.campo)).toEqual(["fotos"]);

  await pagina.getByRole("button", { name: "Tirar capa" }).click();
  await expect(pagina.getByText("O imóvel precisa de pelo menos uma foto. Envie outra antes de tirar esta.")).toBeVisible();
  const { count } = await clienteAdmin().from("fotos_imovel").select("id", { count: "exact", head: true }).eq("imovel_id", id);
  expect(count).toBe(1);
  await pagina.context().close();
});

test("reprovado: salvar não reenvia; Reenviar manda de volta para a fila", async ({ browser }) => {
  const id = await criarImovel(`Reprovado ${test.info().project.name}`, "reprovado");
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto("/proprietario");
  await pagina.getByRole("listitem").filter({ hasText: `Reprovado ${test.info().project.name}` }).getByRole("link", { name: "Reenviar" }).click();
  await expect(pagina.getByText("Motivo da equipe PAUTA: Fotos escuras")).toBeVisible();

  const novo = `Reprovado corrigido ${test.info().project.name}`;
  await pagina.getByLabel("Título do anúncio").fill(novo);
  await pagina.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(pagina.getByText("Mudanças salvas. O imóvel continua reprovado até você reenviar.")).toBeVisible();
  expect(await imovel(id)).toMatchObject({ titulo: novo, status: "reprovado" });
  // Reprovado não está no catálogo: a edição não vai para o registro.
  expect(await edicoes(id)).toEqual([]);

  await pagina.getByRole("button", { name: "Reenviar para aprovação" }).click();
  await expect(pagina.getByRole("status")).toHaveText("Imóvel reenviado");
  expect(await imovel(id)).toMatchObject({ status: "pendente", motivo_reprovacao: null });
  await pagina.context().close();
});

test("pendente: a dona corrige antes da análise, sem registro de edição", async ({ browser }) => {
  const id = await criarImovel(`Pendente editado ${test.info().project.name}`, "pendente");
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto(`/proprietario/imoveis/${id}/editar`);
  await expect(pagina.getByText("Este imóvel está aguardando aprovação")).toBeVisible();
  await pagina.getByLabel("Preço (R$)").fill("1.700.000");
  await pagina.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(pagina.getByText("A equipe PAUTA vai conferir a versão nova antes de aprovar.")).toBeVisible();
  expect(await imovel(id)).toMatchObject({ preco: 1700000, status: "pendente" });
  expect(await edicoes(id)).toEqual([]);
  await pagina.context().close();
});

test("outra proprietária não abre a edição nem edita chamando a action direto", async ({ browser }) => {
  const sufixo = test.info().project.name;
  const id = await criarImovel(`Da Marina ${sufixo}`, "disponivel");

  const daOutra = await paginaDe(browser, "outra");
  await daOutra.goto(`/proprietario/imoveis/${id}/editar`);
  await expect(daOutra.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  await daOutra.context().close();

  // Grava o "Salvar alterações" da dona, sem deixar chegar.
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto(`/proprietario/imoveis/${id}/editar`);
  await pagina.getByLabel("Título do anúncio").fill(`Trocado por fora ${sufixo}`);
  let gravada: Request | undefined;
  await pagina.route("**/editar", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await pagina.getByRole("button", { name: "Salvar alterações" }).click();
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

  await chamar("outra");
  expect((await imovel(id)).titulo).toBe(`Da Marina ${sufixo}`);
  await chamar("dona");
  expect((await imovel(id)).titulo).toBe(`Trocado por fora ${sufixo}`);
});

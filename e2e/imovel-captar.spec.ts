import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { pngDeTeste } from "./apoio/imagens";
import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// RF08, passo 4.7 (decisões de 27/10/2026): o admin capta o imóvel para um dono
// que já tem conta, com dados e fotos. O imóvel fica fora do catálogo até o dono
// aceitar o termo; os 6 meses de exclusividade contam do aceite.

const PREFIXO = "e2e-captar-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";

type Conta = "dona" | "outra" | "admin";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta | "corretor", string>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  ids.dona = await criarConta(email("dona"), { tipo: "proprietario", nome: "Marina Captar", telefone: "48999990080" });
  ids.outra = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Captar", telefone: "48999990081" });
  ids.admin = await criarConta(email("admin"), { tipo: "proprietario", nome: "Admin Captar", telefone: "48999990082" });
  await tornarAdmin(ids.admin);
  ids.corretor = await criarConta(email("corretor"), {
    tipo: "autonomo", nome: "Thiago Captar", telefone: "48999990083", creci: "77731-F",
  });
  await mudarAssinatura(ids.corretor, "ativo");
  for (const conta of ["dona", "outra", "admin"] as Conta[]) sessoes[conta] = await entrarComo(email(conta));
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta].cookies);
  return contexto.newPage();
}

async function imovel(id: string) {
  const { data } = await clienteAdmin()
    .from("imoveis")
    .select("status, captado_pelo_admin, proprietario_id, termo_versao, exclusividade_inicio, exclusividade_fim")
    .eq("id", id)
    .maybeSingle();
  return data;
}

// Captado direto pela função do banco, com a sessão do admin, e uma foto enviada por ele.
async function captarPelaApi(titulo: string) {
  const admin = sessoes.admin.cliente;
  const lista = clienteAdmin();
  const { data, error } = await admin.rpc("captar_imovel", {
    p_dono: ids.dona,
    p_titulo: titulo,
    p_descricao: "",
    p_tipo_id: (await lista.from("tipos_imovel").select("id").eq("nome", "Cobertura").single()).data!.id,
    p_endereco: "Rua das Ostras, 50",
    p_bairro_id: (await lista.from("bairros").select("id").eq("nome", "Jurerê").single()).data!.id,
    p_preco: 3200000,
    p_quartos: 3,
    p_banheiros: 3,
    p_vagas: 2,
    p_area: 210,
  });
  if (error) throw error;
  const id = data as string;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await admin.storage.from("fotos-imoveis").upload(`${id}/capa.jpg`, jpeg, { contentType: "image/jpeg" });
  await admin.storage.from("fotos-imoveis").upload(`${id}/capa-mini.jpg`, jpeg, { contentType: "image/jpeg" });
  await admin.from("fotos_imovel").insert({ imovel_id: id, caminho: `${id}/capa.jpg`, ordem: 1 });
  return id;
}

async function esperarPronta(pagina: Page) {
  await expect(pagina.getByRole("button", { name: /Adicionar fotos|Arraste as fotos/ })).toBeEnabled();
}

test("admin capta para a dona; o imóvel só entra no catálogo quando ela aceita o termo", async ({ browser }) => {
  test.setTimeout(90_000);
  const titulo = `Cobertura em Jurerê ${test.info().project.name}`;

  const doAdmin = await paginaDe(browser, "admin");
  await doAdmin.goto("/admin/imoveis/captar");
  await doAdmin.getByLabel("Buscar proprietário").fill("Marina Captar");
  await doAdmin.getByRole("button", { name: "Buscar" }).click();
  await doAdmin.getByRole("button", { name: /Marina Captar/ }).click();
  await doAdmin.getByLabel("Título do anúncio").fill(titulo);
  await doAdmin.getByLabel("Tipo").selectOption({ label: "Cobertura" });
  await doAdmin.getByLabel("Preço (R$)").fill("3.200.000");
  await doAdmin.getByLabel("Endereço").fill("Rua das Ostras, 50");
  await doAdmin.getByLabel("Bairro").selectOption({ label: "Jurerê" });
  await doAdmin.getByLabel("Área m²").fill("210");
  await doAdmin.getByRole("button", { name: "Continuar para as fotos" }).click();
  await expect(doAdmin).toHaveURL(/\/admin\/imoveis\/captar\/[0-9a-f-]{36}$/);
  const id = doAdmin.url().split("/").at(-1)!;

  expect(await imovel(id)).toMatchObject({ status: "captado", captado_pelo_admin: true, proprietario_id: ids.dona, termo_versao: null });

  await esperarPronta(doAdmin);
  await doAdmin.getByTestId("entrada-de-fotos").setInputFiles({ name: "capa.png", mimeType: "image/png", buffer: pngDeTeste(300, 200, [20, 90, 90]) });
  await expect(doAdmin.getByText("1 de 20")).toBeVisible({ timeout: 30_000 });
  await doAdmin.getByRole("link", { name: "Concluir" }).click();
  await expect(doAdmin.getByRole("listitem").filter({ hasText: titulo })).toContainText("1 foto");
  await doAdmin.context().close();

  // O corretor ativo não vê o captado (fora do catálogo).
  const corretor = await entrarComo(email("corretor"));
  // O assinante só vê imóveis pelas funções do catálogo (Etapa 6).
  const { data: visto } = await corretor.cliente.rpc("imovel_do_catalogo", { p_imovel: id });
  expect(visto).toEqual([]);

  // A dona vê, lê e aceita.
  const daDona = await paginaDe(browser, "dona");
  await daDona.goto("/proprietario");
  const cartao = daDona.getByRole("listitem").filter({ hasText: titulo });
  await expect(cartao).toContainText("Aguardando seu aceite");
  await expect(cartao.getByRole("button", { name: "Apagar" })).toHaveCount(0);
  await cartao.getByRole("link").first().click();
  await expect(daDona).toHaveURL(new RegExp(`/${id}/aceitar$`));
  await expect(daDona.getByText("A equipe PAUTA cadastrou este imóvel para você.")).toBeVisible();
  await daDona.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();
  await daDona.getByRole("button", { name: "Aceitar e publicar" }).click();
  await expect(daDona).toHaveURL(new RegExp(`/${id}\\?publicado=1$`));
  await expect(daDona.getByText("Termo aceito. O imóvel já está no catálogo")).toBeVisible();
  await daDona.context().close();

  const depois = (await imovel(id))!;
  expect(depois).toMatchObject({ status: "disponivel", termo_versao: "2026-10-provisorio" });
  const inicio = new Date(depois.exclusividade_inicio!);
  expect(Date.now() - inicio.getTime()).toBeLessThan(5 * 60_000);
  const seisMeses = new Date(inicio);
  seisMeses.setUTCMonth(seisMeses.getUTCMonth() + 6);
  expect(Math.abs(new Date(depois.exclusividade_fim!).getTime() - seisMeses.getTime())).toBeLessThan(2 * 864e5);
  // Agora o corretor ativo vê.
  const { data: vistoDepois } = await corretor.cliente.rpc("imovel_do_catalogo", { p_imovel: id });
  expect(vistoDepois).toHaveLength(1);
});

test("se o admin muda o captado enquanto a dona lê o termo, o aceite é barrado e a tela mostra os dados novos", async ({ browser }) => {
  const id = await captarPelaApi(`Captado que muda ${test.info().project.name}`);

  const daDona = await paginaDe(browser, "dona");
  await daDona.goto(`/proprietario/imoveis/${id}/aceitar`);
  await expect(daDona.getByText("R$ 3.200.000")).toBeVisible();
  await expect(daDona.getByRole("button", { name: "Aceite o termo para continuar" })).toBeDisabled();
  await daDona.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();

  // O admin muda o preço com a tela da dona aberta.
  const { error } = await sessoes.admin.cliente.from("imoveis").update({ preco: 2900000 }).eq("id", id);
  expect(error).toBeNull();

  await daDona.getByRole("button", { name: "Aceitar e publicar" }).click();
  await expect(daDona.getByRole("alert").filter({ hasText: "A equipe PAUTA mudou este imóvel enquanto você lia." })).toBeVisible();
  await expect(daDona.getByText("R$ 2.900.000")).toBeVisible();
  expect((await imovel(id))!.status).toBe("captado");

  // Com os dados novos na tela, o aceite tem que ser marcado de novo, e aí vale.
  await expect(daDona.getByLabel("Li e aceito o termo de exclusividade de 6 meses.")).not.toBeChecked();
  await daDona.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();
  await daDona.getByRole("button", { name: "Aceitar e publicar" }).click();
  await expect(daDona).toHaveURL(new RegExp(`/${id}\\?publicado=1$`));
  expect((await imovel(id))!.status).toBe("disponivel");
  await daDona.context().close();
});

test("a busca só acha proprietário; o admin apaga o captado com as fotos", async ({ browser }) => {
  const titulo = `Captado para apagar ${test.info().project.name}`;
  const id = await captarPelaApi(titulo);

  const doAdmin = await paginaDe(browser, "admin");
  await doAdmin.goto("/admin/imoveis/captar");
  await doAdmin.getByLabel("Buscar proprietário").fill("Thiago Captar");
  await doAdmin.getByRole("button", { name: "Buscar" }).click();
  await expect(doAdmin.getByText("Nenhum proprietário encontrado. O dono precisa se cadastrar no app antes.")).toBeVisible();

  await doAdmin.goto("/admin/imoveis/captados");
  await doAdmin.getByRole("listitem").filter({ hasText: titulo }).getByRole("button", { name: "Apagar" }).click();
  await doAdmin.getByRole("dialog").getByRole("button", { name: "Apagar" }).click();
  await expect(doAdmin).toHaveURL(/\/admin\/imoveis\/captados\?apagado=1$/);
  await expect(doAdmin.getByText(titulo)).toHaveCount(0);
  await doAdmin.context().close();

  expect(await imovel(id)).toBeNull();
  const { data: arquivos } = await clienteAdmin().storage.from("fotos-imoveis").list(id);
  expect(arquivos ?? []).toHaveLength(0);
});

test("outra proprietária não abre o aceite nem aceita chamando a action direto; a dona não abre a captação", async ({ browser }) => {
  const sufixo = test.info().project.name;
  const id = await captarPelaApi(`Captado da action ${sufixo}`);

  const daDona = await paginaDe(browser, "dona");
  await daDona.goto("/admin/imoveis/captar");
  await expect(daDona).toHaveURL(/\/proprietario$/);

  // Grava o "Aceitar e publicar" da dona, sem deixar chegar.
  await daDona.goto(`/proprietario/imoveis/${id}/aceitar`);
  await daDona.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();
  let gravada: Request | undefined;
  await daDona.route("**/aceitar", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await daDona.getByRole("button", { name: "Aceitar e publicar" }).click();
  await expect.poll(() => gravada).toBeDefined();
  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  const corpo = gravada!.postDataBuffer()!;
  const endereco = gravada!.url();
  await daDona.context().close();

  const daOutra = await paginaDe(browser, "outra");
  await daOutra.goto(`/proprietario/imoveis/${id}/aceitar`);
  await expect(daOutra.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  await daOutra.context().close();

  const chamar = async (conta: Conta) => {
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    await contexto.addCookies(sessoes[conta].cookies);
    await contexto.request.post(endereco, { headers: cabecalhos, data: corpo, maxRedirects: 0 });
    await contexto.close();
  };
  await chamar("outra");
  expect((await imovel(id))!.status).toBe("captado");
  await chamar("dona");
  expect((await imovel(id))!.status).toBe("disponivel");
});

import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { apagarContas, clienteAdmin, cookiesDeSessao, criarConta } from "./apoio/supabase";

// RF07: cadastro do imóvel pelo proprietário, passo 4.2. O imóvel nasce em
// rascunho (passo 1), e o aceite do termo (passo 3) o manda para a aprovação.
// O envio das fotos pela tela (passo 2) está no e2e/imovel-fotos.spec.ts: aqui a foto entra direto no banco.

const PREFIXO = "e2e-imovel-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";

type Conta = "dona" | "outra";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof cookiesDeSessao>>>;
const ids = {} as Record<Conta, string>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  ids.dona = await criarConta(email("dona"), { tipo: "proprietario", nome: "Marina Imóvel", telefone: "48999990010" });
  ids.outra = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Dona", telefone: "48999990011" });
  sessoes.dona = await cookiesDeSessao(email("dona"));
  sessoes.outra = await cookiesDeSessao(email("outra"));
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta]);
  return contexto.newPage();
}

async function imoveisDa(conta: Conta) {
  const { data, error } = await clienteAdmin()
    .from("imoveis")
    .select("id, titulo, status, preco, area, quartos, mostrar_contato, termo_versao, termo_aceito_em, bairros(nome)")
    .eq("proprietario_id", ids[conta]);
  if (error) throw error;
  return data;
}

// Põe uma foto no imóvel direto no banco (o envio pela tela está no imovel-fotos.spec.ts).
async function porFoto(imovelId: string) {
  const { error } = await clienteAdmin()
    .from("fotos_imovel")
    .insert({ imovel_id: imovelId, caminho: `${imovelId}/foto-1.jpg`, ordem: 1 });
  if (error) throw error;
}

async function preencherDados(pagina: Page, titulo: string) {
  await pagina.getByLabel("Título do anúncio").fill(titulo);
  await pagina.getByLabel("Tipo").selectOption({ label: "Casa" });
  await pagina.getByLabel("Preço (R$)").fill("1.890.000");
  await pagina.getByLabel("Endereço").fill("Rua das Gaivotas, 210");
  await pagina.getByLabel("Bairro").selectOption({ label: "Campeche" });
  await pagina.getByLabel("Quartos").fill("4");
  await pagina.getByLabel("Banheiros").fill("3");
  await pagina.getByLabel("Vagas").fill("2");
  await pagina.getByLabel("Área m²").fill("220,5");
  await pagina.getByLabel("Descrição").fill("Casa térrea a 300 m da praia.");
}

test("proprietária cadastra o imóvel, aceita o termo e ele fica pendente", async ({ browser }) => {
  const titulo = `Casa no Campeche ${test.info().project.name}`;
  const pagina = await paginaDe(browser, "dona");

  // Passo 1: dados. O imóvel nasce em rascunho.
  await pagina.goto("/proprietario/imoveis/novo");
  await preencherDados(pagina, titulo);
  await pagina.getByRole("button", { name: "Continuar para as fotos" }).click();
  await expect(pagina).toHaveURL(/\/proprietario\/imoveis\/[0-9a-f-]{36}\/fotos$/);
  const imovelId = pagina.url().split("/").at(-2)!;

  let [imovel] = (await imoveisDa("dona")).filter((i) => i.id === imovelId);
  expect(imovel).toMatchObject({ titulo, status: "rascunho", preco: 1890000, area: 220.5, quartos: 4, termo_versao: null });

  // Passo 2: a foto entra direto no banco.
  await porFoto(imovelId);
  // Sem foto a tela não mostra o "Continuar": recarrega para ela ver a foto nova.
  await pagina.reload();
  await pagina.getByRole("link", { name: "Continuar para o termo" }).click();
  await expect(pagina).toHaveURL(new RegExp(`/${imovelId}/termo$`));

  // Passo 3: sem o aceite, o botão não envia.
  await expect(pagina.getByText("Versão provisória")).toBeVisible();
  await expect(pagina.getByRole("button", { name: "Aceite o termo para enviar" })).toBeDisabled();
  await pagina.getByRole("switch", { name: "Mostrar meu contato aos corretores" }).click();
  await pagina.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();
  await pagina.getByRole("button", { name: "Enviar para aprovação" }).click();

  await expect(pagina).toHaveURL(new RegExp(`/${imovelId}/enviado$`));
  await expect(pagina.getByRole("heading", { name: "Imóvel enviado" })).toBeVisible();
  await expect(pagina.getByText("Aguardando aprovação")).toBeVisible();

  [imovel] = (await imoveisDa("dona")).filter((i) => i.id === imovelId);
  expect(imovel).toMatchObject({ status: "pendente", termo_versao: "2026-10-provisorio", mostrar_contato: true });
  expect(imovel.termo_aceito_em).not.toBeNull();

  // Depois de enviado, o passo do termo não abre de novo.
  await pagina.goto(`/proprietario/imoveis/${imovelId}/termo`);
  await expect(pagina).toHaveURL(/\/proprietario$/);
  await pagina.context().close();
});

test("dados errados mostram a mensagem no campo e não criam imóvel", async ({ browser }) => {
  const antes = (await imoveisDa("dona")).length;
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto("/proprietario/imoveis/novo");

  await pagina.getByLabel("Título do anúncio").fill("Ca");
  await pagina.getByLabel("Preço (R$)").fill("abc");
  await pagina.getByLabel("Área m²").fill("12.5");
  await pagina.getByRole("button", { name: "Continuar para as fotos" }).click();

  await expect(pagina.getByText("Escreva o título (de 3 a 120 letras).")).toBeVisible();
  await expect(pagina.getByText("Escolha o tipo do imóvel.")).toBeVisible();
  await expect(pagina.getByText("Escreva o preço em reais, ex.: 1.890.000.")).toBeVisible();
  await expect(pagina.getByText("Escolha o bairro.")).toBeVisible();
  await expect(pagina.getByText("Escreva a área em m², ex.: 220.")).toBeVisible();
  // O que foi digitado continua lá.
  await expect(pagina.getByLabel("Título do anúncio")).toHaveValue("Ca");
  await expect(pagina).toHaveURL(/\/imoveis\/novo$/);
  expect((await imoveisDa("dona")).length).toBe(antes);
  await pagina.context().close();
});

test("rascunho sem foto não vai para a aprovação", async ({ browser }) => {
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto("/proprietario/imoveis/novo");
  await preencherDados(pagina, `Sem foto ${test.info().project.name}`);
  await pagina.getByRole("button", { name: "Continuar para as fotos" }).click();
  await expect(pagina).toHaveURL(/\/fotos$/);
  const imovelId = pagina.url().split("/").at(-2)!;

  await pagina.goto(`/proprietario/imoveis/${imovelId}/termo`);
  await pagina.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();
  await pagina.getByRole("button", { name: "Enviar para aprovação" }).click();

  await expect(pagina.getByText("Envie pelo menos uma foto antes de mandar para a aprovação.")).toBeVisible();
  const [imovel] = (await imoveisDa("dona")).filter((i) => i.id === imovelId);
  expect(imovel.status).toBe("rascunho");
  await pagina.context().close();
});

// Grava a requisição real que a tela manda ao clicar no botão, sem deixar que ela
// chegue ao servidor, para depois mandá-la com a sessão de outra pessoa (como
// alguém faria chamando a action direto, sem passar pela página).
async function gravarAction(pagina: Page, botao: string) {
  let gravada: Request | undefined;
  await pagina.route("**/proprietario/imoveis/**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await pagina.getByRole("button", { name: botao }).click();
  await expect.poll(() => gravada).toBeDefined();
  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  return { endereco: gravada!.url(), cabecalhos, corpo: gravada!.postDataBuffer()! };
}

async function chamarAction(browser: Browser, conta: Conta, { endereco, cabecalhos, corpo }: Awaited<ReturnType<typeof gravarAction>>) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta]);
  await contexto.request.post(endereco, { headers: cabecalhos, data: corpo, maxRedirects: 0 });
  await contexto.close();
}

test("outra proprietária não abre o rascunho nem muda ele chamando as actions direto", async ({ browser }) => {
  const admin = clienteAdmin();
  const { data, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: ids.dona,
      titulo: "Rascunho da Marina",
      tipo_id: (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id,
      endereco: "Rua A, 1",
      bairro_id: (await admin.from("bairros").select("id").eq("nome", "Centro").single()).data!.id,
      preco: 500000,
      area: 70,
    })
    .select("id")
    .single();
  if (error) throw error;
  await porFoto(data.id);
  const imovelAtual = async () => (await imoveisDa("dona")).find((i) => i.id === data.id)!;

  // As telas do rascunho dão "não encontrada" para outra pessoa, sem nada do
  // imóvel. (O status fica 200: a página já estava em streaming quando o banco
  // respondeu que o imóvel não é dela.)
  const daOutra = await paginaDe(browser, "outra");
  for (const passo of ["dados", "fotos", "termo"]) {
    await daOutra.goto(`/proprietario/imoveis/${data.id}/${passo}`);
    await expect(daOutra.getByRole("heading", { name: "Página não encontrada" }), passo).toBeVisible();
    await expect(daOutra.getByText("Rascunho da Marina"), passo).toHaveCount(0);
    await expect(daOutra.getByLabel("Título do anúncio"), passo).toHaveCount(0);
  }
  await daOutra.context().close();

  // Grava as duas actions na tela da dona.
  const daDona = await paginaDe(browser, "dona");
  await daDona.goto(`/proprietario/imoveis/${data.id}/dados`);
  await daDona.getByLabel("Título do anúncio").fill("Título trocado por fora");
  const salvar = await gravarAction(daDona, "Continuar para as fotos");
  await daDona.goto(`/proprietario/imoveis/${data.id}/termo`);
  await daDona.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();
  const enviar = await gravarAction(daDona, "Enviar para aprovação");
  await daDona.context().close();

  // A outra proprietária manda as mesmas requisições: nada muda.
  await chamarAction(browser, "outra", salvar);
  await chamarAction(browser, "outra", enviar);
  expect(await imovelAtual()).toMatchObject({ titulo: "Rascunho da Marina", status: "rascunho" });

  // A dona manda as mesmas requisições: funcionam (prova que as gravadas valem).
  await chamarAction(browser, "dona", salvar);
  await chamarAction(browser, "dona", enviar);
  expect(await imovelAtual()).toMatchObject({ titulo: "Título trocado por fora", status: "pendente" });
});

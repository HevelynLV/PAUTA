import { expect, test, type Browser, type Page } from "@playwright/test";

import { pngDeTeste } from "./apoio/imagens";
import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura } from "./apoio/supabase";

// RF09: fotos do imóvel, passo 4.3. O navegador reduz e converte cada foto para
// JPEG (grande e miniatura) e manda direto para o bucket privado "fotos-imoveis".
// Quem apaga arquivo no Storage também é testado aqui, pela API, como o app e um
// atacante fariam (o testar_rls.sql testa as mesmas regras direto no banco).

const PREFIXO = "e2e-fotos-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const ORIGEM = process.env.PAUTA_URL ?? "http://localhost:3000";
const BALDE = "fotos-imoveis";

type Conta = "dona" | "outra" | "corretor";
const sessoes = {} as Record<Conta, Awaited<ReturnType<typeof entrarComo>>>;
const ids = {} as Record<Conta, string>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  ids.dona = await criarConta(email("dona"), { tipo: "proprietario", nome: "Marina Fotos", telefone: "48999990020" });
  ids.outra = await criarConta(email("outra"), { tipo: "proprietario", nome: "Outra Fotos", telefone: "48999990021" });
  ids.corretor = await criarConta(email("corretor"), {
    tipo: "autonomo", nome: "Thiago Fotos", telefone: "48999990022", creci: "77721-F",
  });
  await mudarAssinatura(ids.corretor, "ativo");
  for (const conta of ["dona", "outra", "corretor"] as Conta[]) sessoes[conta] = await entrarComo(email(conta));
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaDe(browser: Browser, conta: Conta) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(sessoes[conta].cookies);
  return contexto.newPage();
}

// Imóvel da dona criado direto no banco, no status pedido.
async function criarImovel(status: "rascunho" | "disponivel") {
  const admin = clienteAdmin();
  const disponivel = status === "disponivel";
  const { data, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: ids.dona,
      titulo: `Casa ${status}`,
      tipo_id: (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id,
      endereco: "Rua das Gaivotas, 210",
      bairro_id: (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id,
      preco: 1890000,
      area: 220,
      ...(disponivel && {
        status: "disponivel",
        termo_versao: "2026-10-provisorio",
        termo_aceito_em: new Date().toISOString(),
        exclusividade_inicio: new Date().toISOString(),
        exclusividade_fim: new Date(Date.now() + 180 * 864e5).toISOString(),
      }),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function fotosNoBanco(imovelId: string) {
  const { data } = await clienteAdmin().from("fotos_imovel").select("id, caminho, ordem").eq("imovel_id", imovelId).order("ordem");
  return data ?? [];
}

async function arquivosNoBalde(imovelId: string) {
  const { data } = await clienteAdmin().storage.from(BALDE).list(imovelId, { limit: 100 });
  return data ?? [];
}

// O botão de escolher fotos só liga quando a página está pronta para responder.
async function esperarPronta(pagina: Page) {
  await expect(pagina.getByRole("button", { name: /Adicionar fotos|Arraste as fotos/ })).toBeEnabled();
}

const foto = (nome: string, cor: [number, number, number], largura = 300, altura = 200) => ({
  name: nome,
  mimeType: "image/png",
  buffer: pngDeTeste(largura, altura, cor),
});

test("proprietária envia fotos, muda a ordem, tira uma e envia o imóvel", async ({ browser }) => {
  // Reduzir e enviar fotos leva alguns segundos, mais ainda no celular emulado.
  test.setTimeout(90_000);
  const imovelId = await criarImovel("rascunho");
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto(`/proprietario/imoveis/${imovelId}/fotos`);
  await esperarPronta(pagina);

  // Sem foto, não segue para o termo.
  await expect(pagina.getByText("Envie pelo menos uma foto")).toBeVisible();
  await expect(pagina.getByRole("link", { name: "Continuar para o termo" })).toHaveCount(0);

  // Uma das fotos é maior que 2.000 px: o navegador reduz antes de enviar.
  await pagina.getByTestId("entrada-de-fotos").setInputFiles([
    foto("vermelha.png", [200, 40, 40], 3000, 2000),
    foto("verde.png", [40, 200, 40]),
    foto("azul.png", [40, 40, 200]),
  ]);
  await expect(pagina.getByText("3 de 20")).toBeVisible({ timeout: 30_000 });
  await expect(pagina.getByRole("img", { name: "Capa" })).toBeVisible();

  const antes = await fotosNoBanco(imovelId);
  expect(antes.map((f) => f.ordem)).toEqual([1, 2, 3]);
  const arquivos = await arquivosNoBalde(imovelId);
  // Grande e miniatura de cada foto, todas em JPEG; a miniatura é menor.
  expect(arquivos).toHaveLength(6);
  expect(arquivos.every((a) => a.metadata?.mimetype === "image/jpeg")).toBe(true);
  const tamanho = (nome: string) => arquivos.find((a) => a.name === nome)!.metadata!.size as number;
  const capa = antes[0].caminho.split("/")[1];
  expect(tamanho(capa.replace(".jpg", "-mini.jpg"))).toBeLessThan(tamanho(capa));

  // A capa desce: a segunda foto vira a capa.
  await pagina.getByRole("button", { name: "Descer capa" }).click();
  await expect.poll(async () => (await fotosNoBanco(imovelId)).map((f) => f.id)).toEqual([antes[1].id, antes[0].id, antes[2].id]);

  // Tira a terceira: a ordem volta a ser 1, 2 e os arquivos dela saem do balde.
  await pagina.getByRole("button", { name: "Tirar foto 3" }).click();
  await expect(pagina.getByText("2 de 20")).toBeVisible();
  expect((await fotosNoBanco(imovelId)).map((f) => [f.id, f.ordem])).toEqual([
    [antes[1].id, 1],
    [antes[0].id, 2],
  ]);
  expect(await arquivosNoBalde(imovelId)).toHaveLength(4);

  // Segue o cadastro até o fim.
  await pagina.getByRole("link", { name: "Continuar para o termo" }).click();
  await pagina.getByLabel("Li e aceito o termo de exclusividade de 6 meses.").check();
  await pagina.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(pagina.getByRole("heading", { name: "Imóvel enviado" })).toBeVisible({ timeout: 15_000 });
  await pagina.context().close();
});

test("arquivo que não é foto, foto grande demais e foto a mais são recusados", async ({ browser }) => {
  const imovelId = await criarImovel("rascunho");
  const pagina = await paginaDe(browser, "dona");
  await pagina.goto(`/proprietario/imoveis/${imovelId}/fotos`);
  await esperarPronta(pagina);
  const entrada = pagina.getByTestId("entrada-de-fotos");

  await entrada.setInputFiles({ name: "contrato.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await expect(pagina.getByText("Escolha fotos JPG, PNG ou WebP.")).toBeVisible();

  await entrada.setInputFiles({ name: "enorme.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(pagina.getByText("Cada foto pode ter até 10 MB.")).toBeVisible();

  await entrada.setInputFiles(Array.from({ length: 21 }, (_, i) => foto(`foto-${i}.png`, [i * 10, 100, 100], 4, 4)));
  await expect(pagina.getByText("Cada imóvel tem no máximo 20 fotos. Dá para enviar mais 20.")).toBeVisible();

  expect(await fotosNoBanco(imovelId)).toHaveLength(0);
  expect(await arquivosNoBalde(imovelId)).toHaveLength(0);
  await pagina.context().close();
});

test("pela API do Storage: só JPEG entra, ninguém apaga nem troca foto registrada, e a dona apaga arquivo solto", async () => {
  const imovelId = await criarImovel("disponivel");
  const caminho = `${imovelId}/foto-da-dona.jpg`;
  const miniatura = `${imovelId}/foto-da-dona-mini.jpg`;
  const solto = `${imovelId}/solto.jpg`;
  const admin = clienteAdmin().storage.from(BALDE);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await admin.upload(caminho, jpeg, { contentType: "image/jpeg" });
  await admin.upload(solto, jpeg, { contentType: "image/jpeg" });
  // A foto está registrada no imóvel (a miniatura dela ainda não chegou ao balde).
  const { error: erroFoto } = await clienteAdmin().from("fotos_imovel").insert({ imovel_id: imovelId, caminho, ordem: 1 });
  expect(erroFoto).toBeNull();
  const versaoAntes = (await clienteAdmin().from("imoveis").select("versao").eq("id", imovelId).single()).data!.versao;

  // O balde recusa o que não é JPEG, mesmo da dona.
  const png = await sessoes.dona.cliente.storage
    .from(BALDE)
    .upload(`${imovelId}/nao-jpeg.png`, pngDeTeste(4, 4, [0, 0, 0]), { contentType: "image/png" });
  expect(png.error).not.toBeNull();

  // O corretor ativo vê a foto do imóvel disponível...
  const link = await sessoes.corretor.cliente.storage.from(BALDE).createSignedUrl(caminho, 60);
  expect(link.error).toBeNull();
  // ...mas nem ele nem outra proprietária apagam (o Storage responde sem apagar nada).
  await sessoes.corretor.cliente.storage.from(BALDE).remove([caminho]);
  await sessoes.outra.cliente.storage.from(BALDE).remove([caminho]);
  expect((await admin.exists(caminho)).data).toBe(true);

  // Outra proprietária também não envia arquivo para a pasta do imóvel da dona.
  const intrusa = await sessoes.outra.cliente.storage.from(BALDE).upload(`${imovelId}/intrusa.jpg`, jpeg, { contentType: "image/jpeg" });
  expect(intrusa.error).not.toBeNull();

  // A dona também não apaga o arquivo de uma foto registrada (a troca não passaria
  // pelo registro de edições nem subiria a versão do imóvel)...
  await sessoes.dona.cliente.storage.from(BALDE).remove([caminho]);
  expect((await admin.exists(caminho)).data).toBe(true);
  // ...nem sobrescreve, nem envia a miniatura de uma foto registrada.
  const troca = await sessoes.dona.cliente.storage.from(BALDE).upload(caminho, jpeg, { contentType: "image/jpeg", upsert: true });
  expect(troca.error).not.toBeNull();
  const mini = await sessoes.dona.cliente.storage.from(BALDE).upload(miniatura, jpeg, { contentType: "image/jpeg" });
  expect(mini.error).not.toBeNull();
  expect((await admin.exists(miniatura)).data).toBe(false);
  expect((await clienteAdmin().from("imoveis").select("versao").eq("id", imovelId).single()).data!.versao).toBe(versaoAntes);

  // Arquivo sem foto registrada (ex.: o que sobra depois de tirar a foto) a dona apaga.
  await sessoes.dona.cliente.storage.from(BALDE).remove([solto]);
  expect((await admin.exists(solto)).data).toBe(false);
});

test("outra proprietária não recebe links de envio para o imóvel da dona", async ({ browser }) => {
  const imovelId = await criarImovel("rascunho");

  // Grava a requisição que a tela da dona manda ao pedir os links (sem deixá-la chegar).
  const daDona = await paginaDe(browser, "dona");
  await daDona.goto(`/proprietario/imoveis/${imovelId}/fotos`);
  await esperarPronta(daDona);
  let corpo: Buffer | undefined;
  let cabecalhos: Record<string, string> = {};
  await daDona.route(`**/proprietario/imoveis/${imovelId}/fotos`, async (rota) => {
    const requisicao = rota.request();
    if (requisicao.method() === "POST" && requisicao.headers()["next-action"] && !corpo) {
      corpo = requisicao.postDataBuffer()!;
      cabecalhos = Object.fromEntries(
        Object.entries(await requisicao.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
      );
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await daDona.getByTestId("entrada-de-fotos").setInputFiles(foto("casa.png", [10, 10, 10]));
  await expect.poll(() => corpo).toBeDefined();
  await daDona.context().close();

  const enviar = async (conta: Conta) => {
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    await contexto.addCookies(sessoes[conta].cookies);
    const resposta = await contexto.request.post(`/proprietario/imoveis/${imovelId}/fotos`, { headers: cabecalhos, data: corpo });
    const texto = await resposta.text();
    await contexto.close();
    return texto;
  };

  // A dona recebe os links (prova que a requisição gravada vale)...
  expect(await enviar("dona")).toContain('"token"');
  // ...a outra proprietária, não.
  const daOutra = await enviar("outra");
  expect(daOutra).not.toContain('"token"');
  expect(daOutra).toContain("Este imóvel não aceita fotos agora.");
});

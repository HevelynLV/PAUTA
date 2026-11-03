import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { apagarContas, clienteAdmin, contaPorEmail, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// RF15 e RF16, passo 5.2: o admin confere o CRECI à mão e ativa, bloqueia ou
// desbloqueia (o bloqueio vale na hora, também para os corretores da
// imobiliária) e exclui imobiliária ou autônomo pendente com o usuário,
// liberando o CRECI. Assinante que já foi ativado não é excluído.

const PREFIXO = "e2e-assinantes-";
const ORIGEM = "http://localhost:3000";

// E-mail e CRECI únicos por teste e por tela (celular e computador rodam os dois).
const unico = () => String(Math.floor(1_000_000 + Math.random() * 8_999_999));
const email = (nome: string) => `${PREFIXO}${nome}-${unico()}@exemplo.com`;

let sessaoAdmin: Awaited<ReturnType<typeof entrarComo>>;

test.beforeAll(async () => {
  await apagarContas(PREFIXO);
  const emailAdmin = email("admin");
  await tornarAdmin(await criarConta(emailAdmin, { tipo: "proprietario", nome: "Admin Assinantes", telefone: "48999990060" }));
  sessaoAdmin = await entrarComo(emailAdmin);
});

test.afterAll(() => apagarContas(PREFIXO));

async function paginaComCookies(browser: Browser, cookies: { name: string; value: string; domain: string; path: string }[]) {
  const contexto = await browser.newContext({ baseURL: ORIGEM });
  await contexto.addCookies(cookies);
  return contexto.newPage();
}

const paginaDoAdmin = (browser: Browser) => paginaComCookies(browser, sessaoAdmin.cookies);

async function criarImobiliaria(nome: string) {
  const creci = `${unico()}-J`;
  const emailDela = email("imob");
  const id = await criarConta(emailDela, {
    tipo: "imobiliaria", nome: `Responsável ${nome}`, telefone: "48996542201", nome_imobiliaria: nome, creci,
  });
  return { id, email: emailDela, creci };
}

async function criarAutonomo(nome: string) {
  const creci = `${unico()}-F`;
  const emailDele = email("autonomo");
  const id = await criarConta(emailDele, { tipo: "autonomo", nome, telefone: "48993015520", creci });
  return { id, email: emailDele, creci };
}

// Corretor que entrou pelo convite da imobiliária (que precisa estar ativa).
async function criarCorretor(responsavelId: string) {
  const admin = clienteAdmin();
  const { data: perfil } = await admin.from("perfis").select("assinante_id").eq("id", responsavelId).single();
  const codigo = `codigo-e2e-${unico()}-${unico()}`;
  const { error } = await admin.from("convites").insert({
    assinante_id: perfil!.assinante_id,
    token_hash: createHash("sha256").update(codigo).digest("hex"),
    criado_por: responsavelId,
  });
  if (error) throw new Error(`criarCorretor: ${error.message}`);
  const emailDele = email("corretor");
  await criarConta(emailDele, { tipo: "corretor", nome: "Corretor Assinantes", telefone: "48991112233", convite: codigo });
  return emailDele;
}

async function assinanteDe(responsavelId: string) {
  const { data } = await clienteAdmin()
    .from("assinantes")
    .select("status, bloqueado_pelo_admin")
    .eq("responsavel_id", responsavelId)
    .maybeSingle();
  return data;
}

// A mesma pergunta que o cadastro faz, sem login.
async function creciLivre(creci: string) {
  const visitante = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await visitante.rpc("creci_disponivel", { p_creci: creci });
  return data;
}

// O cartão (celular) ou a linha da tabela (computador) do assinante. A outra
// versão fica escondida e não conta para o getByRole.
const linha = (pagina: Page, nome: string) =>
  pagina.getByRole("listitem").or(pagina.getByRole("row")).filter({ hasText: nome });

test("o admin vê o pendente com o CRECI em destaque e ativa", async ({ browser }) => {
  const nome = `Maré Ativar ${test.info().project.name}`;
  const imob = await criarImobiliaria(nome);

  const pagina = await paginaDoAdmin(browser);
  await pagina.goto("/admin/assinantes");
  await expect(pagina.getByRole("link", { name: /^Pendentes \(\d+\)$/ })).toHaveAttribute("aria-current", "page");
  const item = linha(pagina, nome);
  await expect(item.getByText(`CRECI ${imob.creci} SC`)).toBeVisible();
  await expect(item.getByText("Pendente", { exact: true })).toBeVisible();
  await expect(item.getByRole("link", { name: /Conferir/ })).toHaveAttribute("href", "https://www.creci-sc.gov.br");

  await item.getByRole("button", { name: "Ativar" }).click();
  // Sai da lista de pendentes e aparece em Ativos.
  await expect(item).toHaveCount(0);
  expect(await assinanteDe(imob.id)).toEqual({ status: "ativo", bloqueado_pelo_admin: false });
  await pagina.getByRole("link", { name: "Ativos" }).click();
  await expect(linha(pagina, nome).getByText("Ativa", { exact: true })).toBeVisible();
  await pagina.context().close();

  // A imobiliária ativada abre o catálogo.
  const daImobiliaria = await paginaComCookies(browser, (await entrarComo(imob.email)).cookies);
  await daImobiliaria.goto("/assinante");
  await expect(daImobiliaria).toHaveURL(/\/assinante$/);
  await daImobiliaria.context().close();
});

test("bloquear corta o acesso na hora, também do corretor da imobiliária; desbloquear devolve", async ({ browser }) => {
  const nome = `Ilha Bloquear ${test.info().project.name}`;
  const imob = await criarImobiliaria(nome);
  await mudarAssinatura(imob.id, "ativo");
  const emailCorretor = await criarCorretor(imob.id);

  const doCorretor = await paginaComCookies(browser, (await entrarComo(emailCorretor)).cookies);
  await doCorretor.goto("/assinante");
  await expect(doCorretor).toHaveURL(/\/assinante$/);

  const pagina = await paginaDoAdmin(browser);
  await pagina.goto("/admin/assinantes?filtro=ativos");
  await expect(linha(pagina, nome)).toContainText("1 corretor");
  await linha(pagina, nome).getByRole("button", { name: /^Bloquear/ }).click();
  await expect(linha(pagina, nome)).toHaveCount(0);
  expect(await assinanteDe(imob.id)).toEqual({ status: "ativo", bloqueado_pelo_admin: true });

  // O corretor, já logado, perde o acesso na próxima página que abrir.
  await doCorretor.goto("/assinante");
  await expect(doCorretor).toHaveURL(/\/acesso-suspenso$/);

  await pagina.getByRole("link", { name: "Bloqueados" }).click();
  await expect(linha(pagina, nome).getByText("Bloqueada", { exact: true })).toBeVisible();
  await linha(pagina, nome).getByRole("button", { name: "Desbloquear" }).click();
  await expect(linha(pagina, nome)).toHaveCount(0);
  expect(await assinanteDe(imob.id)).toEqual({ status: "ativo", bloqueado_pelo_admin: false });

  await doCorretor.goto("/assinante");
  await expect(doCorretor).toHaveURL(/\/assinante$/);
  await doCorretor.context().close();
  await pagina.context().close();
});

test("excluir imobiliária e autônomo pendentes apaga o usuário e libera o CRECI", async ({ browser }) => {
  const nomeImob = `Casa Excluir ${test.info().project.name}`;
  const nomeAutonomo = `Thiago Excluir ${test.info().project.name}`;
  const imob = await criarImobiliaria(nomeImob);
  const autonomo = await criarAutonomo(nomeAutonomo);
  expect(await creciLivre(imob.creci)).toBe(false);

  const pagina = await paginaDoAdmin(browser);
  await pagina.goto("/admin/assinantes");
  for (const [nome, conta] of [[nomeImob, imob], [nomeAutonomo, autonomo]] as const) {
    await linha(pagina, nome).getByRole("button", { name: "Excluir" }).click();
    const janela = pagina.getByRole("dialog", { name: "Excluir cadastro pendente?" });
    await expect(janela).toContainText(`O CRECI ${conta.creci} e o e-mail ficam livres`);
    // Cancelar não apaga nada.
    await janela.getByRole("button", { name: "Cancelar" }).click();
    await expect(janela).toBeHidden();
    expect(await contaPorEmail(conta.email)).not.toBeNull();

    await linha(pagina, nome).getByRole("button", { name: "Excluir" }).click();
    await janela.getByRole("button", { name: "Excluir" }).click();
    await expect(linha(pagina, nome)).toHaveCount(0);
    expect(await contaPorEmail(conta.email)).toBeNull();
    expect(await creciLivre(conta.creci)).toBe(true);
  }
  await pagina.context().close();
});

test("assinante ativado no meio não é excluído", async ({ browser }) => {
  const nome = `Autônomo Ativado ${test.info().project.name}`;
  const autonomo = await criarAutonomo(nome);

  const pagina = await paginaDoAdmin(browser);
  await pagina.goto("/admin/assinantes");
  await linha(pagina, nome).getByRole("button", { name: "Excluir" }).click();
  // Outro admin ativa enquanto a janela está aberta.
  await mudarAssinatura(autonomo.id, "ativo");
  const janela = pagina.getByRole("dialog", { name: "Excluir cadastro pendente?" });
  await janela.getByRole("button", { name: "Excluir" }).click();
  await expect(janela.getByRole("alert")).toContainText("Só dá para excluir cadastro pendente");
  expect(await contaPorEmail(autonomo.email)).not.toBeNull();
  expect(await assinanteDe(autonomo.id)).toEqual({ status: "ativo", bloqueado_pelo_admin: false });
  await pagina.context().close();
});

test("quem não é admin não abre a tela nem ativa chamando a action direto", async ({ browser }) => {
  const nome = `Sul Action ${test.info().project.name}`;
  const pendente = await criarImobiliaria(nome);
  const outra = await criarImobiliaria(`Outra ${nome}`);
  await mudarAssinatura(outra.id, "ativo");
  const sessaoOutra = await entrarComo(outra.email);

  const daOutra = await paginaComCookies(browser, sessaoOutra.cookies);
  await daOutra.goto("/admin/assinantes");
  await expect(daOutra).toHaveURL(/\/assinante$/);
  await daOutra.context().close();

  // Grava a requisição do "Ativar" na tela do admin, sem deixá-la chegar.
  const pagina = await paginaDoAdmin(browser);
  await pagina.goto("/admin/assinantes");
  let gravada: Request | undefined;
  await pagina.route("**/admin/assinantes**", async (rota) => {
    if (rota.request().method() === "POST" && rota.request().headers()["next-action"]) {
      gravada = rota.request();
      await rota.abort();
    } else {
      await rota.continue();
    }
  });
  await linha(pagina, nome).getByRole("button", { name: "Ativar" }).click();
  await expect.poll(() => gravada).toBeDefined();
  const cabecalhos = Object.fromEntries(
    Object.entries(await gravada!.allHeaders()).filter(([nome]) => !nome.startsWith(":") && nome !== "cookie"),
  );
  const corpo = gravada!.postDataBuffer()!;
  const endereco = gravada!.url();
  await pagina.context().close();

  const chamar = async (cookies: typeof sessaoOutra.cookies) => {
    const contexto = await browser.newContext({ baseURL: ORIGEM });
    await contexto.addCookies(cookies);
    await contexto.request.post(endereco, { headers: cabecalhos, data: corpo, maxRedirects: 0 });
    await contexto.close();
  };

  // A imobiliária ativa manda a requisição: nada muda.
  await chamar(sessaoOutra.cookies);
  expect((await assinanteDe(pendente.id))?.status).toBe("pendente");
  // O admin manda a mesma requisição: ativa (prova que ela vale).
  await chamar(sessaoAdmin.cookies);
  expect((await assinanteDe(pendente.id))?.status).toBe("ativo");
});

test("o painel do admin mostra quantos assinantes esperam ativação", async ({ browser }) => {
  await criarAutonomo(`Autônomo Painel ${test.info().project.name}`);
  const { count } = await clienteAdmin()
    .from("assinantes")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendente")
    .eq("bloqueado_pelo_admin", false);

  const pagina = await paginaDoAdmin(browser);
  await pagina.goto("/admin");
  const tile = pagina.getByRole("link", { name: /Assinantes para ativar/ });
  await expect(tile).toContainText(String(count));
  await tile.click();
  await expect(pagina).toHaveURL(/\/admin\/assinantes\?filtro=pendentes$/);
  await pagina.context().close();
});

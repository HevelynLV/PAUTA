import { createHmac } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Apoio dos testes: cria, confere e apaga contas de teste com a chave secreta
// (SUPABASE_SECRET_KEY do .env.local, carregada pelo playwright.config.ts).
// Roda só no processo dos testes, nunca no navegador nem no app.
//
// ATENÇÃO: a chave secreta passa por cima do RLS e das regras dos gatilhos.
// Aqui ela só prepara e limpa dados de teste (e-mails @exemplo.com).

export function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !chave) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.local");
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const SENHA_TESTE = "senha-de-teste-123";

// Cria uma conta já confirmada, como o cadastro do app faria (o gatilho do banco
// cria o perfil e o assinante a partir de dados).
export async function criarConta(email: string, dados: Record<string, string>) {
  const { data, error } = await clienteAdmin().auth.admin.createUser({
    email,
    password: SENHA_TESTE,
    email_confirm: true,
    user_metadata: dados,
  });
  if (error) throw new Error(`criarConta(${email}): ${error.message}`);
  return data.user.id;
}

export async function contaPorEmail(email: string) {
  const { data, error } = await clienteAdmin().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

export async function perfilPorEmail(email: string) {
  const conta = await contaPorEmail(email);
  if (!conta) return null;
  const { data } = await clienteAdmin()
    .from("perfis")
    .select("tipo, nome, telefone, assinantes!perfis_assinante_id_fkey(tipo, nome, creci, status)")
    .eq("id", conta.id)
    .maybeSingle();
  return data;
}

// Muda a assinatura do assinante cujo responsável é a conta, como o admin ou o
// pagamento fariam (o app só faz isso na Etapa 5 e na 11).
export async function mudarAssinatura(contaId: string, status: "pendente" | "ativo" | "vencido", bloqueado = false) {
  const { error } = await clienteAdmin()
    .from("assinantes")
    .update({ status, bloqueado_pelo_admin: bloqueado })
    .eq("responsavel_id", contaId);
  if (error) throw new Error(`mudarAssinatura: ${error.message}`);
}

// O banco limita cada corretor a 10 propostas e 20 pedidos de visita por hora (migration
// 20261109234543_avisos_nos_eventos). Testes que reaproveitam o mesmo corretor em muitas
// rodadas passam os envios dele para 2 horas atrás, entre um teste e outro.
export async function esquecerEnviosRecentes(corretores: string[]) {
  if (corretores.length === 0) return; // projeto que pulou o arquivo
  const admin = clienteAdmin();
  const antes = new Date(Date.now() - 2 * 3_600_000).toISOString();
  for (const tabela of ["propostas", "visitas"] as const) {
    const { error } = await admin.from(tabela).update({ criada_em: antes }).in("corretor_id", corretores);
    if (error) throw new Error(`esquecerEnviosRecentes: ${error.message}`);
  }
}

// Troca o tipo de um proprietário para admin, como o supabase/scripts/criar_admin.sql.
export async function tornarAdmin(contaId: string) {
  const { error } = await clienteAdmin().from("perfis").update({ tipo: "admin" }).eq("id", contaId);
  if (error) throw new Error(`tornarAdmin: ${error.message}`);
}

// O mesmo link do e-mail de recuperação, sem mandar e-mail.
export async function linkDeRecuperacao(email: string) {
  const { data, error } = await clienteAdmin().auth.admin.generateLink({ type: "recovery", email });
  if (error) throw new Error(`linkDeRecuperacao: ${error.message}`);
  return `/auth/confirmar?token_hash=${data.properties.hashed_token}&type=recovery&proximo=/redefinir-senha`;
}

// Entra com a conta (como o /entrar faria) e devolve os cookies de sessão, no
// formato do Playwright (context.addCookies). Um login por conta, reaproveitado
// pelos testes: o Supabase limita os logins por endereço.
export async function cookiesDeSessao(email: string, senha = SENHA_TESTE) {
  return (await entrarComo(email, senha)).cookies;
}

// Um login só, que serve para as duas coisas: os cookies para o navegador do teste
// e o cliente do Supabase com a sessão da conta (para chamar a API direto, como
// alguém faria fora da tela, com as regras do banco e do Storage valendo).
export async function entrarComo(email: string, senha = SENHA_TESTE) {
  const guardados = new Map<string, string>();
  const cliente = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => [...guardados].map(([name, value]) => ({ name, value })),
      setAll: (lista) => lista.forEach(({ name, value }) => (value ? guardados.set(name, value) : guardados.delete(name))),
    },
  });
  const { error } = await cliente.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(`entrarComo(${email}): ${error.message}`);
  return {
    cookies: [...guardados].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })),
    cliente,
  };
}

// Vendas e contratos seguram a proposta, o imóvel e a conta (on delete restrict), e os
// PDFs não saem sozinhos: tudo isso vai antes, inclusive arquivo enviado sem registro.
async function apagarContratos(contas: string[]) {
  if (contas.length === 0) return;
  const admin = clienteAdmin();
  const { data: imoveis } = await admin.from("imoveis").select("id").in("proprietario_id", contas);
  const imovelIds = (imoveis ?? []).map((imovel) => imovel.id);
  const { data: recebidas } = await admin.from("propostas").select("id").in("imovel_id", imovelIds).limit(1000);
  const { data: enviadas } = await admin.from("propostas").select("id").in("corretor_id", contas).limit(1000);
  const ids = [...new Set([...(recebidas ?? []), ...(enviadas ?? [])].map((proposta) => proposta.id))];
  if (ids.length === 0) return;

  const { data: contratos } = await admin.from("contratos").select("id").in("proposta_id", ids);
  const contratoIds = (contratos ?? []).map((contrato) => contrato.id);
  if (contratoIds.length > 0) {
    const { error: erroVendas } = await admin.from("vendas").delete().in("contrato_id", contratoIds);
    if (erroVendas) throw new Error(`apagarContratos, vendas: ${erroVendas.message}`);
    const { error: erroContratos } = await admin.from("contratos").delete().in("id", contratoIds);
    if (erroContratos) throw new Error(`apagarContratos, contratos: ${erroContratos.message}`);
  }
  await apagarPastas("contratos", ids);
}

// Apaga os arquivos das pastas (uma por imóvel ou proposta) do bucket: lista as pastas
// ao mesmo tempo e remove tudo numa chamada só (cada ida ao Supabase leva de 0,2 a 0,5 s).
async function apagarPastas(bucket: string, pastas: string[]) {
  if (pastas.length === 0) return;
  const storage = clienteAdmin().storage.from(bucket);
  const listas = await Promise.all(
    pastas.map(async (pasta) => {
      const { data: arquivos } = await storage.list(pasta, { limit: 100 });
      return (arquivos ?? []).map((arquivo) => `${pasta}/${arquivo.name}`);
    }),
  );
  const caminhos = listas.flat();
  if (caminhos.length === 0) return;
  const { error } = await storage.remove(caminhos);
  if (error) throw new Error(`apagarPastas(${bucket}): ${error.message}`);
}

// Apaga as contas de teste cujo e-mail começa com o prefixo, todas juntas: uma chamada
// por tabela, não uma por conta (medido em 10/11/2026: o laço antigo fazia ~65 idas ao
// Supabase no visitas.spec.ts, cerca de 15 s por projeto).
// Assinante só pode ser excluído pendente (RF16): antes, volta o status para pendente.
// Os imóveis vão antes (imoveis.proprietario_id não apaga em cascata; visitas e propostas
// saem com eles), com os arquivos das fotos no Storage. Contratos e vendas seguram a
// proposta (on delete restrict) e saem antes de tudo, em apagarContratos.
export async function apagarContas(prefixo: string) {
  const admin = clienteAdmin();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const contas = data.users.filter((u) => u.email?.startsWith(prefixo));
  if (contas.length === 0) return;
  const contaIds = contas.map((conta) => conta.id);

  await apagarContratos(contaIds);

  const { data: imoveis, error: erroLista } = await admin.from("imoveis").select("id").in("proprietario_id", contaIds);
  if (erroLista) throw new Error(`apagarContas(${prefixo}), lista de imóveis: ${erroLista.message}`);
  const imovelIds = (imoveis ?? []).map((imovel) => imovel.id);
  // Os arquivos das fotos não saem sozinhos com o imóvel: apaga a pasta de cada um.
  await apagarPastas("fotos-imoveis", imovelIds);
  if (imovelIds.length > 0) {
    // O aviso "imóvel novo" é de todos os assinantes, não da conta: sem isto, ele ficaria
    // na lista de quem usa o banco compartilhado, sem o imóvel (Etapa 10).
    const { error: erroAvisos } = await admin.from("avisos").delete().in("imovel_id", imovelIds);
    if (erroAvisos) throw new Error(`apagarContas(${prefixo}), avisos: ${erroAvisos.message}`);
    const { error: erroImoveis } = await admin.from("imoveis").delete().in("id", imovelIds);
    if (erroImoveis) throw new Error(`apagarContas(${prefixo}), imóveis: ${erroImoveis.message}`);
  }
  const { error: erroAssinantes } = await admin
    .from("assinantes")
    .update({ status: "pendente", bloqueado_pelo_admin: false })
    .in("responsavel_id", contaIds);
  if (erroAssinantes) throw new Error(`apagarContas(${prefixo}), assinantes: ${erroAssinantes.message}`);

  // Corretores antes: o perfil do corretor aponta para o assinante da imobiliária,
  // que só sai depois que nenhum perfil aponta mais para ele.
  const { data: corretores } = await admin.from("perfis").select("id").eq("tipo", "corretor").in("id", contaIds);
  const ehCorretor = new Set((corretores ?? []).map((perfil) => perfil.id));
  const apagar = async (lista: typeof contas) => {
    const erros = await Promise.all(lista.map(async (conta) => ({ conta, erro: (await admin.auth.admin.deleteUser(conta.id)).error })));
    const falha = erros.find(({ erro }) => erro);
    if (falha) throw new Error(`apagarContas(${falha.conta.email}): ${falha.erro!.message}`);
  };
  await apagar(contas.filter((conta) => ehCorretor.has(conta.id)));
  await apagar(contas.filter((conta) => !ehCorretor.has(conta.id)));
}

// A assinatura que o servidor do app dá depois de conferir que o contrato é PDF (auditoria
// da Etapa 9), para os testes que registram o contrato direto pela API. Mesma conta de
// src/lib/assinaturaDoContrato.ts, com o eTag que o Storage devolve.
export async function assinaturaDoContrato(proposta: string, caminho: string, corretor: string) {
  const segredo = process.env.CONTRATO_PDF_SEGREDO;
  if (!segredo) throw new Error("Falta CONTRATO_PDF_SEGREDO no .env.local");
  const { data, error } = await clienteAdmin().storage.from("contratos").createSignedUrl(caminho, 60);
  if (error) throw error;
  const resposta = await fetch(data.signedUrl, { headers: { Range: "bytes=0-0" } });
  await resposta.arrayBuffer();
  const etag = resposta.headers.get("etag");
  if (!etag) throw new Error("O Storage não devolveu o eTag");
  return createHmac("sha256", segredo).update(`${proposta}:${caminho}:${corretor}:${etag}`).digest("hex");
}

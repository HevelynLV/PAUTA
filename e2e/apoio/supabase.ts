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

// Apaga as contas de teste cujo e-mail começa com o prefixo (os corretores
// primeiro). Assinante só pode
// ser excluído pendente (RF16): antes, volta o status para pendente. Os imóveis
// da conta vão antes (imoveis.proprietario_id não apaga em cascata), com os
// arquivos das fotos no Storage.
export async function apagarContas(prefixo: string) {
  const admin = clienteAdmin();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const contas = data.users.filter((u) => u.email?.startsWith(prefixo));
  // Corretores antes: o perfil do corretor aponta para o assinante da imobiliária,
  // que só sai depois que nenhum perfil aponta mais para ele.
  const { data: corretores } = await admin
    .from("perfis")
    .select("id")
    .eq("tipo", "corretor")
    .in("id", contas.map((conta) => conta.id));
  const ehCorretor = new Set((corretores ?? []).map((perfil) => perfil.id));
  contas.sort((a, b) => Number(ehCorretor.has(b.id)) - Number(ehCorretor.has(a.id)));
  for (const conta of contas) {
    // Os arquivos das fotos não saem sozinhos com o imóvel: apaga a pasta de cada um.
    const { data: imoveis } = await admin.from("imoveis").select("id").eq("proprietario_id", conta.id);
    for (const { id } of imoveis ?? []) {
      const { data: arquivos } = await admin.storage.from("fotos-imoveis").list(id, { limit: 100 });
      if (arquivos?.length) {
        await admin.storage.from("fotos-imoveis").remove(arquivos.map((arquivo) => `${id}/${arquivo.name}`));
      }
    }
    const { error: erroImoveis } = await admin.from("imoveis").delete().eq("proprietario_id", conta.id);
    if (erroImoveis) throw new Error(`apagarContas(${conta.email}), imóveis: ${erroImoveis.message}`);
    await admin
      .from("assinantes")
      .update({ status: "pendente", bloqueado_pelo_admin: false })
      .eq("responsavel_id", conta.id);
    const { error: erro } = await admin.auth.admin.deleteUser(conta.id);
    if (erro) throw new Error(`apagarContas(${conta.email}): ${erro.message}`);
  }
}

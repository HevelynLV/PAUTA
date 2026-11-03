import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { criarClienteServidor } from "@/lib/supabase/server";

// Guarda das áreas. Toda página de área e toda Server Action chama exigirTipo()
// no início (CLAUDE.md), porque uma action pode ser chamada direto, sem passar
// pela página, e o proxy (src/proxy.ts) não é proteção: ele só redireciona cedo.
//
// O tipo vem SEMPRE da tabela perfis, nunca do token: o metadata do token é
// escrito pelo próprio usuário (o primeiro token do cadastro ainda leva o que ele
// mandou). E a assinatura é lida a cada chamada, sem cache entre requisições:
// bloquear um assinante tem efeito na hora.

export type TipoUsuario = "proprietario" | "imobiliaria" | "autonomo" | "corretor" | "admin";

export const TIPOS_ASSINANTE = ["imobiliaria", "autonomo", "corretor"] as const satisfies TipoUsuario[];

export type Usuario = {
  id: string;
  tipo: TipoUsuario;
  nome: string;
  email: string;
  // Imobiliária e autônomo: a própria assinatura. Corretor: a da imobiliária.
  // Proprietário e admin: null.
  assinanteId: string | null;
};

type StatusAssinatura = "pendente" | "ativo" | "vencido";

type LeituraDaSessao = {
  usuario: Usuario;
  // Só para assinantes: se tem acesso (ativo, não bloqueado e, para o corretor,
  // não removido da equipe), o status e se o corretor foi removido.
  assinatura: { temAcesso: boolean; status: StatusAssinatura; removido: boolean } | null;
} | null;

export function ehAssinante(tipo: TipoUsuario) {
  return (TIPOS_ASSINANTE as readonly TipoUsuario[]).includes(tipo);
}

// Página inicial de cada tipo: para onde vai depois do login e quando abre a
// área de outro tipo.
export function areaDoTipo(tipo: TipoUsuario) {
  if (tipo === "admin") return "/admin";
  if (tipo === "proprietario") return "/proprietario";
  return "/assinante";
}

// Lê a sessão e o perfil uma vez por página. O cache() do React só vale dentro
// de uma renderização: numa Server Action, cada chamada lê de novo.
const lerSessao = cache(async (): Promise<LeituraDaSessao> => {
  const supabase = await criarClienteServidor();

  // getClaims() confere a assinatura do token (não só lê o cookie).
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims.sub;
  if (!id) return null;

  // RLS: cada um lê só o próprio perfil. Sem perfil (conta apagada), é como
  // não estar logado.
  const { data: perfil } = await supabase
    .from("perfis")
    .select("tipo, nome, assinante_id, removido_em")
    .eq("id", id)
    .maybeSingle();
  if (!perfil) return null;

  const usuario: Usuario = {
    id,
    tipo: perfil.tipo as TipoUsuario,
    nome: perfil.nome,
    email: String(claims?.claims.email ?? ""),
    assinanteId: perfil.assinante_id,
  };

  if (!ehAssinante(usuario.tipo)) return { usuario, assinatura: null };

  // Assinante sem assinatura não deveria existir (o banco exige), mas, se
  // existir, fica sem acesso em vez de passar.
  if (!usuario.assinanteId) return { usuario, assinatura: { temAcesso: false, status: "pendente", removido: false } };

  // A regra do acesso fica só no banco (eh_assinante_ativo: ativo e não
  // bloqueado; o corretor segue a imobiliária). O status serve só para escolher
  // a tela de quem está sem acesso.
  const [{ data: temAcesso }, { data: assinante }] = await Promise.all([
    supabase.rpc("eh_assinante_ativo"),
    supabase.from("assinantes").select("status").eq("id", usuario.assinanteId).maybeSingle(),
  ]);

  return {
    usuario,
    assinatura: {
      temAcesso: temAcesso === true,
      status: (assinante?.status ?? "pendente") as StatusAssinatura,
      removido: perfil.removido_em !== null,
    },
  };
});

// Usuário logado ou null, sem redirecionar. Para páginas públicas (ex.: /entrar
// manda quem já está logado para a própria área).
export async function usuarioAtual(): Promise<Usuario | null> {
  return (await lerSessao())?.usuario ?? null;
}

// Quanto tempo depois de abrir o link de recuperação a senha ainda pode ser
// trocada sem a atual (auditoria da Etapa 3).
const PRAZO_DO_LINK_EM_SEGUNDOS = 15 * 60;

// A sessão foi aberta por um link de recuperação de senha há pouco? O token
// registra como e quando a pessoa entrou (amr). O link com token_hash grava
// "otp", e o com code, "recovery"; o horário não muda quando o token é renovado.
// Só esse tipo de sessão troca a senha sem pedir a atual: quem só está logado
// (ex.: celular de outra pessoa) não troca, nem quem abriu o link e deixou para depois.
export async function veioDeLinkDeRecuperacao() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getClaims();
  const amr = data?.claims.amr as { method: string; timestamp: number }[] | undefined;
  const agora = Math.floor(Date.now() / 1000);
  return !!amr?.some(
    (m) => (m.method === "recovery" || m.method === "otp") && agora - m.timestamp <= PRAZO_DO_LINK_EM_SEGUNDOS,
  );
}

// Assinatura de quem está logado (null para proprietário, admin ou sem login).
// Para as telas de quem está sem acesso escolherem o que mostrar.
export async function assinaturaAtual() {
  return (await lerSessao())?.assinatura ?? null;
}

/**
 * Exige um usuário logado de um dos tipos pedidos e devolve quem é.
 *
 * - Sem login: vai para /entrar.
 * - Logado, mas de outro tipo: vai para a área do próprio tipo.
 * - Assinante sem acesso (pendente, vencido, bloqueado ou corretor removido):
 *   vai para /aguardando-ativacao (pendente) ou /acesso-suspenso (os outros).
 *   As duas telas usam { assinaturaAtiva: false } para não cair em laço.
 *
 * redirect() interrompe a página ou a action: nada depois da chamada roda.
 * Não chame exigirTipo() dentro de try/catch, porque o catch engoliria o redirect.
 */
export async function exigirTipo(
  tipos: TipoUsuario | readonly TipoUsuario[],
  { assinaturaAtiva = true }: { assinaturaAtiva?: boolean } = {},
): Promise<Usuario> {
  const sessao = await lerSessao();
  if (!sessao) redirect("/entrar");

  const { usuario, assinatura } = sessao;
  const permitidos: readonly TipoUsuario[] = typeof tipos === "string" ? [tipos] : tipos;

  if (!permitidos.includes(usuario.tipo)) redirect(areaDoTipo(usuario.tipo));

  if (assinaturaAtiva && assinatura && !assinatura.temAcesso) {
    redirect(assinatura.status === "pendente" ? "/aguardando-ativacao" : "/acesso-suspenso");
  }

  return usuario;
}

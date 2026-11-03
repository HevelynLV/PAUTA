import "server-only";

import { criarClienteServidor } from "@/lib/supabase/server";

// Leituras da tela Equipe (passo 5.4), com a sessão do responsável pela
// imobiliária: o RLS deixa ele ler os perfis da equipe (nome, telefone, entrada)
// e os convites da imobiliária. Quem chama já passou pelo exigirTipo("imobiliaria").

export type MembroDaEquipe = {
  id: string;
  nome: string;
  telefone: string;
  responsavel: boolean;
  entrouEm: string;
  removidoEm: string | null;
};

export type ConviteAguardando = {
  id: string;
  // null: convite por link, sem e-mail.
  email: string | null;
  criadoEm: string;
  expiraEm: string;
};

export type Equipe = {
  imobiliaria: { nome: string; creci: string };
  // O responsável primeiro, depois os corretores pela entrada; os removidos no fim.
  membros: MembroDaEquipe[];
  convites: ConviteAguardando[];
};

export async function equipeDaImobiliaria(assinanteId: string): Promise<Equipe> {
  const supabase = await criarClienteServidor();
  const agora = new Date().toISOString();
  const [{ data: assinante }, { data: perfis, error }, { data: convites }] = await Promise.all([
    supabase.from("assinantes").select("nome, creci").eq("id", assinanteId).single(),
    supabase
      .from("perfis")
      .select("id, nome, telefone, tipo, criado_em, removido_em")
      .eq("assinante_id", assinanteId)
      .order("criado_em", { ascending: true }),
    // Só os que ainda servem: sem uso e na validade. Vencido some da lista (o
    // responsável gera outro).
    supabase
      .from("convites")
      .select("id, email, criado_em, expira_em")
      .eq("assinante_id", assinanteId)
      .is("usado_em", null)
      .gt("expira_em", agora)
      .order("criado_em", { ascending: false }),
  ]);
  if (error) throw new Error(`equipeDaImobiliaria: ${error.message}`);

  const membros = (perfis ?? []).map((p) => ({
    id: p.id,
    nome: p.nome,
    telefone: p.telefone,
    responsavel: p.tipo === "imobiliaria",
    entrouEm: p.criado_em,
    removidoEm: p.removido_em,
  }));
  const ordem = (m: MembroDaEquipe) => (m.responsavel ? 0 : m.removidoEm ? 2 : 1);

  return {
    imobiliaria: { nome: assinante?.nome ?? "", creci: assinante?.creci ?? "" },
    membros: membros.sort((a, b) => ordem(a) - ordem(b)),
    convites: (convites ?? []).map((c) => ({ id: c.id, email: c.email, criadoEm: c.criado_em, expiraEm: c.expira_em })),
  };
}

// Para o cartão "Equipe e convites" de Minha conta.
export async function corretoresAtivos(assinanteId: string) {
  const supabase = await criarClienteServidor();
  const { count } = await supabase
    .from("perfis")
    .select("id", { count: "exact", head: true })
    .eq("assinante_id", assinanteId)
    .eq("tipo", "corretor")
    .is("removido_em", null);
  return count ?? 0;
}

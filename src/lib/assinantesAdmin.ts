import "server-only";

import { criarClienteServidor } from "@/lib/supabase/server";

// Leituras do admin sobre assinantes (imobiliárias e corretores autônomos), com a
// sessão dele: o RLS deixa o admin ler todos os assinantes e todos os perfis.
// Quem chama já passou pelo exigirTipo("admin").

// Situação que a tela mostra. No banco são duas coisas separadas (status e
// bloqueado_pelo_admin, passo 2.7): o bloqueio vale por cima de qualquer status.
export type Situacao = "pendente" | "ativo" | "vencido" | "bloqueado";

export type AssinanteNaLista = {
  id: string;
  tipo: "imobiliaria" | "autonomo";
  nome: string;
  creci: string;
  situacao: Situacao;
  // Bloqueado com o pagamento vencido: desbloquear não devolve o acesso.
  vencido: boolean;
  responsavel: string;
  telefone: string;
  corretores: number;
  criadoEm: string;
};

export function situacaoDe(status: string, bloqueado: boolean): Situacao {
  if (bloqueado) return "bloqueado";
  return status as Situacao;
}

// Ligação com outra tabela: sem os tipos gerados do banco, o supabase-js descreve
// como lista, mas chega um objeto só.
function campoDaLigacao<T>(ligacao: T | T[] | null): T | null {
  return (Array.isArray(ligacao) ? ligacao[0] : ligacao) ?? null;
}

// Todos os assinantes, os pendentes primeiro (mais antigos antes: quem espera há
// mais tempo), depois os outros pelo nome.
export async function listaDeAssinantes(): Promise<AssinanteNaLista[]> {
  const supabase = await criarClienteServidor();
  const [{ data: assinantes, error }, { data: corretores }] = await Promise.all([
    supabase
      .from("assinantes")
      .select(
        "id, tipo, nome, creci, status, bloqueado_pelo_admin, criado_em, perfis!assinantes_responsavel_id_fkey(nome, telefone)",
      )
      .order("criado_em", { ascending: true }),
    supabase.from("perfis").select("assinante_id").eq("tipo", "corretor").is("removido_em", null),
  ]);
  if (error) throw new Error(`listaDeAssinantes: ${error.message}`);

  const porImobiliaria = new Map<string, number>();
  for (const { assinante_id } of corretores ?? []) {
    porImobiliaria.set(assinante_id, (porImobiliaria.get(assinante_id) ?? 0) + 1);
  }

  const lista = assinantes.map((a) => {
    const responsavel = campoDaLigacao<{ nome: string; telefone: string }>(a.perfis);
    return {
      id: a.id,
      tipo: a.tipo,
      nome: a.nome,
      creci: a.creci,
      situacao: situacaoDe(a.status, a.bloqueado_pelo_admin),
      vencido: a.status === "vencido",
      responsavel: responsavel?.nome ?? "",
      telefone: responsavel?.telefone ?? "",
      corretores: porImobiliaria.get(a.id) ?? 0,
      criadoEm: a.criado_em,
    } satisfies AssinanteNaLista;
  });

  const pendentes = lista.filter((a) => a.situacao === "pendente");
  const outros = lista
    .filter((a) => a.situacao !== "pendente")
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return [...pendentes, ...outros];
}

// Número do painel (AdmPainel: "Assinantes para ativar").
export async function assinantesParaAtivar() {
  const supabase = await criarClienteServidor();
  const { count } = await supabase
    .from("assinantes")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendente")
    .eq("bloqueado_pelo_admin", false);
  return count ?? 0;
}

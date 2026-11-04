import "server-only";

import type { StatusVisita } from "@/lib/horariosDeVisita";
import { idDeImovelValido } from "@/lib/imovel";
import { criarClienteServidor } from "@/lib/supabase/server";

// Leituras das visitas (RF21, RF22, RNF07), sempre com a sessão de quem está logado.
// O corretor não lê a tabela de imóveis e o proprietário não lê perfis de corretores:
// tudo vem das funções do banco (migration 20261104172132_visitas), que já conferem
// quem pergunta. Quem chama já passou pelo exigirTipo().

export type VisitaDoCorretor = {
  id: string;
  imovel_id: string;
  titulo: string;
  endereco: string;
  bairro: string;
  horario: string;
  recado: string | null;
  status: StatusVisita;
};

export type VisitaDaAgenda = {
  id: string;
  imovel_id: string;
  imovel_titulo: string;
  horario: string;
  recado: string | null;
  status: StatusVisita;
  corretor_nome: string;
  imobiliaria: string | null;
  creci: string;
  telefone: string;
  email: string;
};

// Só o horário: quem marcou não sai do banco.
export async function horariosOcupados(imovelId: string): Promise<string[]> {
  if (!idDeImovelValido(imovelId)) return [];
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("horarios_ocupados", { p_imovel: imovelId });
  if (error) throw error;
  return ((data ?? []) as { horario: string }[]).map((linha) => linha.horario);
}

// As visitas do corretor logado, de todos os imóveis ou de um só.
export async function minhasVisitas(imovelId?: string): Promise<VisitaDoCorretor[]> {
  if (imovelId !== undefined && !idDeImovelValido(imovelId)) return [];
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("minhas_visitas", { p_imovel: imovelId ?? null });
  if (error) throw error;
  return (data ?? []) as VisitaDoCorretor[];
}

// As visitas dos imóveis do proprietário logado, em ordem de horário. p_ate fica de fora.
export async function agendaDeVisitas(filtros: { de?: string; ate?: string; imovelId?: string } = {}): Promise<VisitaDaAgenda[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("agenda_de_visitas", {
    p_de: filtros.de ?? null,
    p_ate: filtros.ate ?? null,
    p_imovel: filtros.imovelId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as VisitaDaAgenda[];
}

// Pedidos ainda sem resposta, por imóvel (o RLS só devolve os dos imóveis do dono).
export async function pedidosParaConfirmar(agora: Date): Promise<Map<string, number>> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("visitas")
    .select("imovel_id")
    .eq("status", "pendente")
    .gt("horario", agora.toISOString());
  if (error) throw error;
  const contagem = new Map<string, number>();
  for (const { imovel_id } of data) contagem.set(imovel_id, (contagem.get(imovel_id) ?? 0) + 1);
  return contagem;
}

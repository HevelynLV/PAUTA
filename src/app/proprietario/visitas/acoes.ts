"use server";

import { revalidatePath } from "next/cache";

import { exigirTipo } from "@/lib/auth";
import { mensagemDoErroDeVisita } from "@/lib/horariosDeVisita";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";

// Respostas do proprietário às visitas (RF22). O banco confere que a visita é de um
// imóvel dele e, ao confirmar, recusa os outros pedidos do mesmo horário na mesma
// operação (migration 20261104172132_visitas).

async function responder(funcao: "confirmar_visita" | "recusar_visita" | "cancelar_visita", id: string) {
  await exigirTipo("proprietario");
  if (!idValido(id)) return { erro: mensagemDoErroDeVisita("visita_nao_encontrada") };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, { p_visita: id });
  if (error) return { erro: mensagemDoErroDeVisita(error.hint) };

  revalidatePath("/proprietario/visitas");
  revalidatePath("/proprietario");
  revalidatePath("/proprietario/imoveis/[id]", "page");
  return {};
}

export async function confirmarVisita(id: string): Promise<{ erro?: string }> {
  return responder("confirmar_visita", id);
}

export async function recusarVisita(id: string): Promise<{ erro?: string }> {
  return responder("recusar_visita", id);
}

export async function cancelarVisitaDoImovel(id: string): Promise<{ erro?: string }> {
  return responder("cancelar_visita", id);
}

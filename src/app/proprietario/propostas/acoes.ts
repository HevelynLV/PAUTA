"use server";

import { revalidatePath } from "next/cache";

import { exigirTipo } from "@/lib/auth";
import { mensagemDoErroDeProposta } from "@/lib/proposta";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";
import { avisarPeloWhatsApp } from "@/lib/whatsapp";

// Respostas do proprietário às propostas (RF24). O banco confere que a proposta é de um
// imóvel dele e que a resposta ainda vale (migration 20261105180815_propostas).

async function responder(funcao: "aceitar_proposta" | "recusar_proposta" | "desfazer_aceite", id: string) {
  await exigirTipo("proprietario");
  if (!idValido(id)) return { erro: mensagemDoErroDeProposta("proposta_nao_encontrada") };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc(funcao, { p_proposta: id });
  if (error) return { erro: mensagemDoErroDeProposta(error.hint) };

  avisarPeloWhatsApp();
  revalidatePath("/proprietario");
  revalidatePath("/proprietario/imoveis/[id]", "page");
  return {};
}

export async function aceitarProposta(id: string): Promise<{ erro?: string }> {
  return responder("aceitar_proposta", id);
}

export async function recusarProposta(id: string): Promise<{ erro?: string }> {
  return responder("recusar_proposta", id);
}

export async function desfazerAceite(id: string): Promise<{ erro?: string }> {
  return responder("desfazer_aceite", id);
}

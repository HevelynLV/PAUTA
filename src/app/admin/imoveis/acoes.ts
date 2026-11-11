"use server";

import { exigirTipo } from "@/lib/auth";
import { idDeImovelValido } from "@/lib/imovel";
import { criarClienteServidor } from "@/lib/supabase/server";
import { avisarPeloWhatsApp } from "@/lib/whatsapp";

// Aprovar ou reprovar imóvel do proprietário (RF14). Quem decide de verdade são
// as funções do banco aprovar_imovel() e reprovar_imovel(), que conferem de novo
// se quem chama é admin e se o imóvel está pendente.

export type ResultadoDecisao =
  | { aprovado: { exclusividadeFim: string } }
  | { reprovado: true }
  | { erro: string; mudou?: boolean };

// versao: a versão que a tela mostrou. Se o dono mexeu no imóvel depois (dados ou
// fotos), o banco já subiu a versão e a aprovação não passa.
export async function aprovarImovel(id: string, versao: number): Promise<ResultadoDecisao> {
  await exigirTipo("admin");
  if (!idDeImovelValido(id) || !Number.isInteger(versao)) return { erro: "Imóvel não encontrado." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("aprovar_imovel", { p_imovel: id, p_versao: versao });
  if (error) {
    if (error.code === "P0001" && error.message.includes("mudou")) {
      return {
        erro: "O imóvel mudou depois que você abriu esta tela, ou já não está pendente. Confira os dados novos antes de aprovar.",
        mudou: true,
      };
    }
    return { erro: "Não foi possível aprovar. Tente de novo." };
  }

  avisarPeloWhatsApp();
  const { data } = await supabase.from("imoveis").select("exclusividade_fim").eq("id", id).single();
  return { aprovado: { exclusividadeFim: data?.exclusividade_fim ?? "" } };
}

// O motivo é o que o proprietário lê para corrigir o imóvel.
export async function reprovarImovel(id: string, motivo: string): Promise<ResultadoDecisao> {
  await exigirTipo("admin");
  if (!idDeImovelValido(id)) return { erro: "Imóvel não encontrado." };
  const texto = String(motivo ?? "").trim();
  if (texto.length < 5) return { erro: "Escreva o motivo, para o proprietário saber o que corrigir." };
  if (texto.length > 1000) return { erro: "O motivo tem no máximo 1.000 letras." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("reprovar_imovel", { p_imovel: id, p_motivo: texto });
  if (error) {
    if (error.code === "P0001" && error.message.includes("pendente")) {
      return { erro: "Este imóvel já não está pendente. Abra a fila de novo.", mudou: true };
    }
    return { erro: "Não foi possível reprovar. Tente de novo." };
  }
  avisarPeloWhatsApp();
  return { reprovado: true };
}

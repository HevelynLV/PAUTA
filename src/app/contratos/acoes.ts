"use server";

import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { BUCKET_CONTRATOS, mensagemDoErroDeContrato, VALIDADE_DO_LINK_DO_PDF_EM_SEGUNDOS } from "@/lib/contrato";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";

// Abrir o PDF (RNF08). O link nasce no clique, com vida curta, e não vem pronto no HTML.
// Quem pode ver é decidido pelas regras do banco: a linha do contrato e o arquivo só
// aparecem para quem enviou, com acesso, para o dono do imóvel e para o admin. Fica fora
// de /assinante porque vale para os três.
export async function abrirContrato(contratoId: string): Promise<{ erro?: string; link?: string }> {
  await exigirTipo([...TIPOS_ASSINANTE, "proprietario", "admin"]);
  if (!idValido(contratoId)) return { erro: mensagemDoErroDeContrato("contrato_nao_encontrado") };

  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("contratos").select("caminho").eq("id", contratoId).maybeSingle();
  if (!data) return { erro: mensagemDoErroDeContrato("contrato_nao_encontrado") };

  const { data: arquivo, error } = await supabase.storage
    .from(BUCKET_CONTRATOS)
    .createSignedUrl(data.caminho, VALIDADE_DO_LINK_DO_PDF_EM_SEGUNDOS);
  if (error) return { erro: "Não foi possível abrir o contrato. Tente de novo." };
  return { link: arquivo.signedUrl };
}

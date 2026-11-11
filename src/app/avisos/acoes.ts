"use server";

import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";

// Ações dos avisos (RF29), do proprietário e do assinante (o admin não tem lista de
// avisos). Ficam fora de /proprietario e /assinante porque valem para os dois. As
// barreiras de verdade estão nas funções do banco (migration 20261109232807_avisos).

const QUEM_TEM_AVISOS = ["proprietario", ...TIPOS_ASSINANTE] as const;

// "Visto até": a data do aviso mais novo que a tela mostrou, do jeito que o banco
// mandou. Não passa por new Date(): o banco guarda microssegundos e o JavaScript só
// milissegundos, e a data cortada ficaria antes do aviso, que seguiria "novo". O banco
// nunca volta a data para trás nem aceita data no futuro.
const DATA_DO_BANCO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export async function marcarAvisosVistos(ate: string): Promise<{ erro?: string }> {
  await exigirTipo(QUEM_TEM_AVISOS);
  if (typeof ate !== "string" || !DATA_DO_BANCO.test(ate) || Number.isNaN(Date.parse(ate))) {
    return { erro: "Data inválida." };
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("marcar_avisos_vistos", { p_ate: ate });
  if (error) return { erro: "Não foi possível marcar os avisos como vistos." };
  return {};
}

// A chave "Receber avisos no WhatsApp" de Minha conta. O banco guarda quando a pessoa
// aceitou (consentimento, LGPD).
export async function mudarWhatsapp(aceito: boolean): Promise<{ erro?: string }> {
  await exigirTipo(QUEM_TEM_AVISOS);
  if (typeof aceito !== "boolean") return { erro: "Escolha ligado ou desligado." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("mudar_whatsapp", { p_aceito: aceito });
  if (error) return { erro: "Não foi possível salvar. Tente de novo." };
  return {};
}

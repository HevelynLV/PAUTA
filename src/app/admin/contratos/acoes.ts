"use server";

import { revalidatePath } from "next/cache";

import { exigirTipo } from "@/lib/auth";
import { mensagemDoErroDeContrato, TAMANHO_DO_MOTIVO } from "@/lib/contrato";
import { lerNumero } from "@/lib/imovel";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";
import { avisarPeloWhatsApp } from "@/lib/whatsapp";

// Conferência do contrato pelo admin (RF26, RF32, RNF05). Quem decide de verdade são as
// funções do banco aprovar_contrato() e recusar_contrato(), que conferem de novo se quem
// chama é admin e fazem tudo numa operação só. Aqui ficam só as conferências que dão
// uma resposta clara antes de ir ao banco.

export type ResultadoDaConferencia = { aprovado?: true; recusado?: true; erro?: string; mudou?: boolean };

// Erros de quem olhou uma tela antiga: o contrato ou o imóvel mudou. A tela recarrega.
const MUDOU = new Set(["contrato_ja_conferido", "contrato_nao_encontrado", "imovel_fora_do_catalogo", "proposta_encerrada"]);

function resultadoDoErro(hint: string | undefined): ResultadoDaConferencia {
  return { erro: mensagemDoErroDeContrato(hint), mudou: MUDOU.has(hint ?? "") };
}

function atualizarTelas() {
  revalidatePath("/admin");
  revalidatePath("/admin/contratos");
}

export async function aprovarContrato(
  id: string,
  dados: { valorFinal: string; comissao: string; comissaoPaga: boolean; itens: { assinado: boolean; valorEImovel: boolean; clausulaDaComissao: boolean } },
): Promise<ResultadoDaConferencia> {
  await exigirTipo("admin");
  if (!idValido(id)) return resultadoDoErro("contrato_nao_encontrado");
  // Os três itens da conferência são obrigatórios (decisão de 06/11/2026).
  const itens = dados?.itens;
  if (itens?.assinado !== true || itens.valorEImovel !== true || itens.clausulaDaComissao !== true) {
    return { erro: "Marque os três itens da conferência antes de aprovar." };
  }

  const valorFinal = typeof dados.valorFinal === "string" ? lerNumero(dados.valorFinal) : null;
  if (valorFinal === null || valorFinal <= 0) return resultadoDoErro("valor_invalido");
  const comissao = typeof dados.comissao === "string" ? lerNumero(dados.comissao) : null;
  if (comissao === null || comissao <= 0 || comissao > valorFinal) return resultadoDoErro("comissao_invalida");

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("aprovar_contrato", {
    p_contrato: id,
    p_valor_final: valorFinal,
    p_comissao: comissao,
    p_comissao_paga: dados.comissaoPaga === true,
  });
  if (error) return resultadoDoErro(error.hint);

  avisarPeloWhatsApp();
  atualizarTelas();
  return { aprovado: true };
}

// O motivo é o que o corretor lê em Negociações para corrigir e reenviar.
export async function recusarContrato(id: string, motivo: string): Promise<ResultadoDaConferencia> {
  await exigirTipo("admin");
  if (!idValido(id)) return resultadoDoErro("contrato_nao_encontrado");
  const texto = typeof motivo === "string" ? motivo.trim() : "";
  if (texto.length === 0 || texto.length > TAMANHO_DO_MOTIVO) return resultadoDoErro("motivo_invalido");

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("recusar_contrato", { p_contrato: id, p_motivo: texto });
  if (error) return resultadoDoErro(error.hint);

  avisarPeloWhatsApp();
  atualizarTelas();
  return { recusado: true };
}

// Comissão recebida fora do app (RF32). Marcar por engano pode ser desfeito.
export async function definirComissaoPaga(vendaId: string, paga: boolean): Promise<{ erro?: string }> {
  await exigirTipo("admin");
  if (!idValido(vendaId) || typeof paga !== "boolean") return { erro: mensagemDoErroDeContrato("venda_nao_encontrada") };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("definir_comissao_paga", { p_venda: vendaId, p_paga: paga });
  if (error) return { erro: mensagemDoErroDeContrato(error.hint) };

  atualizarTelas();
  return {};
}

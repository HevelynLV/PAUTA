import "server-only";

import type { StatusContrato } from "@/lib/contrato";
import type { FormaPagamento, StatusProposta } from "@/lib/proposta";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";

// Leituras dos contratos para o admin (RF26), sempre com a sessão de quem está logado.
// A função do banco contratos_para_conferir() (migration 20261106221451_contratos) só
// devolve linhas para o admin. Quem chama já passou pelo exigirTipo("admin").

export type OutraPropostaEmAberto = {
  corretor: string;
  imobiliaria: string | null;
  valor: number;
  status: Extract<StatusProposta, "aguardando" | "aceita">;
};

export type ContratoParaConferir = {
  id: string;
  status: StatusContrato;
  motivo_recusa: string | null;
  caminho: string;
  nome_arquivo: string;
  tamanho_bytes: number;
  enviado_em: string;
  imovel_id: string;
  imovel_titulo: string;
  proprietario_nome: string;
  proposta_id: string;
  proposta_valor: number;
  forma_pagamento: FormaPagamento;
  condicoes: string;
  nome_comprador: string | null;
  corretor_nome: string;
  imobiliaria: string | null;
  creci: string;
  // Falso se o corretor está bloqueado, vencido ou foi removido: o contrato pode ser
  // aprovado mesmo assim (decisão de 06/11/2026), mas a tela avisa.
  corretor_com_acesso: boolean;
  outras_em_aberto: OutraPropostaEmAberto[];
};

// A fila: os contratos em análise, o mais antigo primeiro.
export async function contratosParaConferir(): Promise<ContratoParaConferir[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("contratos_para_conferir", { p_contrato: null });
  if (error) throw error;
  return (data ?? []) as ContratoParaConferir[];
}

// Um contrato, em qualquer status.
export async function contratoParaConferir(id: string): Promise<ContratoParaConferir | null> {
  if (!idValido(id)) return null;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("contratos_para_conferir", { p_contrato: id });
  if (error) throw error;
  return ((data ?? []) as ContratoParaConferir[])[0] ?? null;
}

export type VendaRegistrada = {
  id: string;
  imovel_id: string;
  imovel_titulo: string;
  contrato_id: string;
  corretor_nome: string;
  imobiliaria: string | null;
  valor_final: number;
  comissao_valor: number;
  comissao_paga_em: string | null;
  registrada_em: string;
};

// As vendas com a comissão do PAUTA (RF32), só para o admin: a mais recente primeiro.
export async function vendasRegistradas(): Promise<VendaRegistrada[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("vendas_registradas");
  if (error) throw error;
  return (data ?? []) as VendaRegistrada[];
}

// A venda de um contrato aprovado. A função traz no máximo 200 vendas, o que basta para
// o piloto; depois dele, a função ganha um filtro (pendência da Etapa 13).
export async function vendaDoContrato(contratoId: string): Promise<VendaRegistrada | null> {
  return (await vendasRegistradas()).find((venda) => venda.contrato_id === contratoId) ?? null;
}

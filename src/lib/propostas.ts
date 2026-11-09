import "server-only";

import type { StatusContrato } from "@/lib/contrato";
import { idDeImovelValido } from "@/lib/imovel";
import type { FormaPagamento, StatusProposta } from "@/lib/proposta";
import { criarClienteServidor } from "@/lib/supabase/server";

// Leituras das propostas (RF23, RF24, RNF07), sempre com a sessão de quem está logado.
// O corretor não lê a tabela de imóveis e o proprietário não lê perfis de corretores:
// tudo vem das funções do banco (migration 20261105180815_propostas), que já conferem
// quem pergunta. Quem chama já passou pelo exigirTipo().

export type PropostaDoCorretor = {
  id: string;
  imovel_id: string;
  titulo: string;
  endereco: string;
  bairro: string;
  no_catalogo: boolean;
  valor: number;
  forma_pagamento: FormaPagamento;
  condicoes: string;
  nome_comprador: string | null;
  status: StatusProposta;
  criada_em: string;
  respondida_em: string | null;
  // O contrato mais recente desta proposta, se houver.
  contrato_id: string | null;
  contrato_status: StatusContrato | null;
  contrato_motivo: string | null;
  contrato_enviado_em: string | null;
};

export type PropostaRecebida = {
  id: string;
  imovel_id: string;
  imovel_titulo: string;
  valor: number;
  forma_pagamento: FormaPagamento;
  condicoes: string;
  nome_comprador: string | null;
  status: StatusProposta;
  criada_em: string;
  respondida_em: string | null;
  corretor_nome: string;
  imobiliaria: string | null;
  creci: string;
  telefone: string;
  email: string;
  contrato_id: string | null;
  contrato_status: StatusContrato | null;
};

// As propostas do corretor logado, de todos os imóveis ou de um só, a mais nova primeiro.
export async function minhasPropostas(imovelId?: string): Promise<PropostaDoCorretor[]> {
  if (imovelId !== undefined && !idDeImovelValido(imovelId)) return [];
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("minhas_propostas", { p_imovel: imovelId ?? null });
  if (error) throw error;
  return (data ?? []) as PropostaDoCorretor[];
}

// As propostas de um imóvel do proprietário logado, com os dados do corretor.
export async function propostasRecebidas(imovelId: string): Promise<PropostaRecebida[]> {
  if (!idDeImovelValido(imovelId)) return [];
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("propostas_recebidas", { p_imovel: imovelId });
  if (error) throw error;
  return (data ?? []) as PropostaRecebida[];
}

export type ResumoDePropostas = {
  emNegociacao: boolean;
  emAberto: number;
  // O contrato em análise mais antigo do imóvel (Etapa 9), se houver.
  contratoCorretor: string | null;
  contratoEnviadoEm: string | null;
  // A venda, depois que o admin aprova o contrato: valor final e data, sem a comissão.
  vendaValor: number | null;
  vendaEm: string | null;
};

// O selo do proprietário: contrato em análise vem antes de "em negociação".
export function seloDoResumo(resumo: ResumoDePropostas | undefined): "contrato" | "negociacao" | null {
  if (resumo?.contratoEnviadoEm) return "contrato";
  if (resumo?.emNegociacao) return "negociacao";
  return null;
}

// Selo e contador do proprietário, por imóvel. "Em negociação" vem do banco: a tela não
// pode refazer esse cálculo. Imóvel sem proposta não vem na lista.
export async function resumoDePropostas(imovelId?: string): Promise<Map<string, ResumoDePropostas>> {
  const resumo = new Map<string, ResumoDePropostas>();
  if (imovelId !== undefined && !idDeImovelValido(imovelId)) return resumo;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("resumo_de_propostas", { p_imovel: imovelId ?? null });
  if (error) throw error;
  type Linha = {
    imovel_id: string;
    em_negociacao: boolean;
    em_aberto: number;
    contrato_corretor: string | null;
    contrato_enviado_em: string | null;
    venda_valor: number | null;
    venda_em: string | null;
  };
  for (const linha of (data ?? []) as Linha[]) {
    resumo.set(linha.imovel_id, {
      emNegociacao: linha.em_negociacao,
      emAberto: linha.em_aberto,
      contratoCorretor: linha.contrato_corretor,
      contratoEnviadoEm: linha.contrato_enviado_em,
      vendaValor: linha.venda_valor,
      vendaEm: linha.venda_em,
    });
  }
  return resumo;
}

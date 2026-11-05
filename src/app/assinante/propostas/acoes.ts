"use server";

import { revalidatePath } from "next/cache";

import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { idDeImovelValido, lerNumero } from "@/lib/imovel";
import { formaValida, mensagemDoErroDeProposta, TAMANHO_DAS_CONDICOES, TAMANHO_DO_COMPRADOR } from "@/lib/proposta";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";

// Propostas do lado do corretor (RF23). O banco confere acesso, catálogo e a regra de
// uma proposta em aberto (enviar_proposta e cancelar_proposta). A conferência daqui
// repete a da tela porque a action pode ser chamada direto, e evita ir ao banco à toa.

function atualizarTelas() {
  revalidatePath("/assinante/imoveis/[id]", "page");
  revalidatePath("/assinante/negociacoes");
  revalidatePath("/assinante");
}

export async function enviarProposta(proposta: {
  imovelId: string;
  valor: string;
  forma: string;
  condicoes: string;
  comprador: string;
}): Promise<{ erro?: string }> {
  await exigirTipo(TIPOS_ASSINANTE);
  const { imovelId, valor, forma, condicoes, comprador } = proposta;

  if (!idDeImovelValido(imovelId)) return { erro: mensagemDoErroDeProposta("imovel_fora_do_catalogo") };
  const numero = typeof valor === "string" ? lerNumero(valor) : null;
  if (numero === null || numero <= 0 || numero >= 1e12) return { erro: mensagemDoErroDeProposta("valor_invalido") };
  if (typeof forma !== "string" || !formaValida(forma)) return { erro: mensagemDoErroDeProposta("forma_invalida") };
  if (typeof condicoes !== "string" || !condicoes.trim() || condicoes.trim().length > TAMANHO_DAS_CONDICOES) {
    return { erro: mensagemDoErroDeProposta("condicoes_invalidas") };
  }
  if (typeof comprador !== "string" || comprador.trim().length > TAMANHO_DO_COMPRADOR) {
    return { erro: mensagemDoErroDeProposta("comprador_invalido") };
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("enviar_proposta", {
    p_imovel: imovelId,
    p_valor: numero,
    p_forma: forma,
    p_condicoes: condicoes,
    p_comprador: comprador,
  });
  if (error) return { erro: mensagemDoErroDeProposta(error.hint) };

  atualizarTelas();
  return {};
}

export async function retirarProposta(id: string): Promise<{ erro?: string }> {
  await exigirTipo(TIPOS_ASSINANTE);
  if (!idValido(id)) return { erro: mensagemDoErroDeProposta("proposta_nao_encontrada") };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("cancelar_proposta", { p_proposta: id });
  if (error) return { erro: mensagemDoErroDeProposta(error.hint) };

  atualizarTelas();
  return {};
}

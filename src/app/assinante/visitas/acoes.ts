"use server";

import { revalidatePath } from "next/cache";

import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import {
  diasParaAgendar,
  diaDe,
  HORARIOS_DE_VISITA,
  instanteDe,
  mensagemDoErroDeVisita,
  TAMANHO_DO_RECADO,
} from "@/lib/horariosDeVisita";
import { idDeImovelValido } from "@/lib/imovel";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";

// Visitas do lado do corretor (RF21). O banco confere acesso, catálogo e horário
// (pedir_visita e cancelar_visita); aqui ficam só os horários fixos e os 14 dias, que
// são regra de tela. A conferência repete a da tela porque a action pode ser chamada
// direto.

export async function pedirVisita(pedido: {
  imovelId: string;
  dia: string;
  hora: string;
  recado: string;
}): Promise<{ erro?: string }> {
  await exigirTipo(TIPOS_ASSINANTE);
  const { imovelId, dia, hora, recado } = pedido;
  if (!idDeImovelValido(imovelId)) return { erro: mensagemDoErroDeVisita("imovel_fora_do_catalogo") };
  if (!diasParaAgendar(diaDe(new Date())).includes(dia) || !HORARIOS_DE_VISITA.includes(hora)) {
    return { erro: mensagemDoErroDeVisita("horario_invalido") };
  }
  if (typeof recado !== "string" || recado.length > TAMANHO_DO_RECADO) {
    return { erro: `O recado pode ter até ${TAMANHO_DO_RECADO} caracteres.` };
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("pedir_visita", {
    p_imovel: imovelId,
    p_horario: instanteDe(dia, hora),
    p_recado: recado,
  });
  if (error) {
    // Fechou depois de a tela abrir: atualiza o calendário, que riscará o horário.
    if (error.hint === "horario_ocupado") revalidatePath(`/assinante/imoveis/${imovelId}`);
    return { erro: mensagemDoErroDeVisita(error.hint) };
  }

  revalidatePath(`/assinante/imoveis/${imovelId}`);
  revalidatePath("/assinante/negociacoes");
  return {};
}

export async function cancelarMinhaVisita(id: string): Promise<{ erro?: string }> {
  await exigirTipo(TIPOS_ASSINANTE);
  if (!idValido(id)) return { erro: mensagemDoErroDeVisita("visita_nao_encontrada") };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("cancelar_visita", { p_visita: id });
  if (error) return { erro: mensagemDoErroDeVisita(error.hint) };

  revalidatePath("/assinante/negociacoes");
  revalidatePath("/assinante/imoveis/[id]", "page");
  return {};
}

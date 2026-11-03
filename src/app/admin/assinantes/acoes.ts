"use server";

import { revalidatePath } from "next/cache";

import { exigirTipo } from "@/lib/auth";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";

// Ações do admin sobre assinantes (RF15, RF16). Ativar e bloquear usam a sessão
// do admin: o RLS só deixa o admin mudar a linha, e o gatilho
// conferir_mudanca_de_status só deixa o status ir de pendente para ativo.
// O bloqueio vale na hora, também para os corretores da imobiliária: o acesso é
// conferido no banco a cada página (eh_assinante_ativo, chamado pelo exigirTipo).

export type ResultadoDaAcao = { erro?: string };

const NAO_ENCONTRADO = "Assinante não encontrado. Recarregue a página.";

function atualizarTelas() {
  revalidatePath("/admin/assinantes");
  revalidatePath("/admin");
}

export async function ativarAssinante(id: string): Promise<ResultadoDaAcao> {
  await exigirTipo("admin");
  if (!idValido(id)) return { erro: NAO_ENCONTRADO };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("assinantes")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("status", "pendente")
    .select("id");
  if (error) return { erro: "Não foi possível ativar. Tente de novo." };
  if (data.length === 0) return { erro: "Este assinante não está mais pendente. Recarregue a página." };
  atualizarTelas();
  return {};
}

export async function mudarBloqueio(id: string, bloquear: boolean): Promise<ResultadoDaAcao> {
  await exigirTipo("admin");
  if (!idValido(id) || typeof bloquear !== "boolean") return { erro: NAO_ENCONTRADO };

  const supabase = await criarClienteServidor();
  // Só ativo ou vencido: o pendente ainda não tem acesso (o admin ativa ou exclui).
  const { data, error } = await supabase
    .from("assinantes")
    .update({ bloqueado_pelo_admin: bloquear })
    .eq("id", id)
    .in("status", ["ativo", "vencido"])
    .select("id");
  if (error) return { erro: "Não foi possível salvar. Tente de novo." };
  if (data.length === 0) return { erro: NAO_ENCONTRADO };
  atualizarTelas();
  return {};
}

// Exclui imobiliária ou autônomo pendente com o usuário dele, liberando o CRECI e
// o e-mail (RF16). Apagar o usuário no Supabase Auth apaga o perfil e o assinante
// em cascata, numa operação só. Se o assinante deixou de ser pendente no meio
// (outro admin ativou), o gatilho conferir_exclusao_de_assinante barra e nada é
// apagado.
export async function excluirPendente(id: string): Promise<ResultadoDaAcao> {
  await exigirTipo("admin");
  if (!idValido(id)) return { erro: NAO_ENCONTRADO };

  // Quem é o usuário vem do banco, com a sessão do admin, nunca do formulário:
  // assim a chave secreta só apaga o responsável de um assinante pendente.
  const supabase = await criarClienteServidor();
  const { data: assinante } = await supabase
    .from("assinantes")
    .select("responsavel_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!assinante) return { erro: NAO_ENCONTRADO };
  if (assinante.status !== "pendente") {
    return { erro: "Só dá para excluir cadastro pendente. Assinante que já foi ativado não é excluído." };
  }

  const { error } = await criarClienteAdmin().auth.admin.deleteUser(assinante.responsavel_id);
  if (error) {
    return { erro: "Não foi possível excluir. Confira se o assinante ainda está pendente e tente de novo." };
  }
  atualizarTelas();
  return {};
}

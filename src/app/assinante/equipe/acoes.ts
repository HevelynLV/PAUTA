"use server";

import { revalidatePath } from "next/cache";

import { exigirTipo } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { emailValido, idValido } from "@/lib/validacao";

// Ações da tela Equipe (RF05, passo 5.4), só do responsável pela imobiliária.
// Quem decide de verdade é o banco: criar_convite() confere que a imobiliária
// tem acesso, sorteia o código e guarda só o hash; remover_corretor() só remove
// corretor da própria equipe. O RLS só deixa cancelar convite da própria
// imobiliária, ainda não usado.

export type ResultadoConvite = { link?: string; erro?: string };

export async function criarConvite(email: string | null): Promise<ResultadoConvite> {
  await exigirTipo("imobiliaria");
  const limpo = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (email !== null && !emailValido(limpo)) return { erro: "Confira o e-mail do corretor." };

  // Sem o SITE_URL, o link sairia quebrado (ex.: esquecido na Vercel).
  const site = process.env.SITE_URL;
  if (!site) throw new Error("Falta SITE_URL no .env.local (ou nas variáveis da Vercel)");

  const supabase = await criarClienteServidor();
  const { data: codigo, error } = await supabase.rpc("criar_convite", { p_email: limpo || null });
  if (error) {
    // O banco diz o motivo no hint (migrations convites_e_equipe e auditoria_etapa_5).
    if (error.hint === "email_invalido") return { erro: "Confira o e-mail do corretor." };
    if (error.hint === "limite_de_convites") {
      return { erro: "Você criou muitos convites na última hora. Espere um pouco e tente de novo." };
    }
    return { erro: "Não foi possível criar o convite. Tente de novo." };
  }
  // Sem código: o e-mail já tem conta (o banco conta a tentativa no limite por hora).
  if (!codigo) {
    return { erro: "Este e-mail já tem conta no PAUTA. Peça ao corretor outro e-mail para o convite." };
  }

  revalidatePath("/assinante/equipe");
  return { link: `${site}/convite/${codigo}` };
}

export async function cancelarConvite(id: string): Promise<{ erro?: string }> {
  await exigirTipo("imobiliaria");
  if (!idValido(id)) return { erro: "Convite não encontrado." };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.from("convites").delete().eq("id", id).is("usado_em", null).select("id");
  if (error || data.length === 0) return { erro: "Convite não encontrado ou já usado. Recarregue a página." };
  revalidatePath("/assinante/equipe");
  return {};
}

export async function removerCorretor(id: string): Promise<{ erro?: string }> {
  await exigirTipo("imobiliaria");
  if (!idValido(id)) return { erro: "Corretor não encontrado." };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("remover_corretor", { p_corretor: id });
  if (error) return { erro: "Não foi possível remover. Recarregue a página e tente de novo." };
  revalidatePath("/assinante/equipe");
  return {};
}

import "server-only";

import { criarClienteServidor } from "@/lib/supabase/server";
import { ERRO_TELEFONE, limparTelefone, nomeValido, telefoneValido } from "@/lib/validacao";

// "Minha conta": nome e telefone de quem está logado. Usado pelas actions de
// cada área, que chamam exigirTipo() antes. O banco só deixa mudar o próprio
// perfil (RLS) e só essas duas colunas (permissão por coluna).

export type EstadoConta = {
  erros?: { nome?: string; telefone?: string };
  erro?: string;
  salvo?: boolean;
};

export async function salvarDadosDaConta(usuarioId: string, formData: FormData): Promise<EstadoConta> {
  const nome = String(formData.get("nome") ?? "").trim();
  const telefone = limparTelefone(String(formData.get("telefone") ?? ""));

  const erros: EstadoConta["erros"] = {};
  if (!nomeValido(nome)) erros.nome = "Escreva o nome (de 2 a 120 letras).";
  if (!telefoneValido(telefone)) erros.telefone = ERRO_TELEFONE;
  if (erros.nome || erros.telefone) return { erros };

  const supabase = await criarClienteServidor();
  const { error } = await supabase.from("perfis").update({ nome, telefone }).eq("id", usuarioId);
  if (error) return { erro: "Não foi possível salvar. Tente de novo." };
  return { salvo: true };
}

// "48998124410" vira "(48) 99812-4410"; "4832221234" vira "(48) 3222-1234".
export function formatarTelefone(telefone: string) {
  const m = telefone.match(/^(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : telefone;
}

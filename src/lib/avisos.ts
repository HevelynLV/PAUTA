import "server-only";

import { cache } from "react";

import { AVISOS_POR_PAGINA, type Aviso } from "@/lib/aviso";
import { criarClienteServidor } from "@/lib/supabase/server";

// Leituras dos avisos (RF29), sempre com a sessão de quem está logado. A lista vem da
// função meus_avisos() (migration 20261109232807_avisos), que já filtra os avisos da
// pessoa e os "imóvel novo" de assinante ativo, sem as colunas do WhatsApp. Quem chama
// já passou pelo exigirTipo().

// Uma página da lista, dos mais novos para os mais antigos. "antes" é o id do último
// aviso da página anterior. Pede um a mais para saber se há outra página.
export async function meusAvisos(antes: number | null) {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("meus_avisos", {
    p_antes: antes,
    p_limite: AVISOS_POR_PAGINA + 1,
  });
  if (error) throw new Error(`meusAvisos: ${error.message}`);
  const lista = (data ?? []) as Aviso[];
  return { avisos: lista.slice(0, AVISOS_POR_PAGINA), temMais: lista.length > AVISOS_POR_PAGINA };
}

// O número do menu. Erro aqui não derruba a tela: o menu só fica sem número. O cache()
// do React faz o menu de baixo e o lateral dividirem uma consulta só por resposta.
export const avisosNaoVistos = cache(async () => {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("avisos_nao_vistos");
  if (error) return 0;
  return typeof data === "number" ? data : 0;
});

// O "antes" vem da URL: só número inteiro positivo.
export function antesValido(valor: unknown) {
  if (typeof valor !== "string" || !/^\d{1,18}$/.test(valor)) return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

import "server-only";

import { type FiltrosCatalogo, POR_PAGINA, type StatusCatalogo } from "@/lib/filtrosCatalogo";
import { BUCKET_FOTOS, caminhoDaMiniatura } from "@/lib/imovel";
import { VALIDADE_DO_LINK_EM_SEGUNDOS } from "@/lib/imoveis";
import { criarClienteServidor } from "@/lib/supabase/server";

// Catálogo do assinante (RF18 a RF20). O assinante não lê a tabela imoveis: a
// lista vem da função catalogo() do banco (migration 20261103144204_catalogo), que
// confere se ele é assinante ativo e devolve só as colunas do corretor. Quem chama
// já passou pelo exigirTipo().

export type ImovelNoCatalogo = {
  id: string;
  titulo: string;
  tipo: string;
  bairro: string;
  preco: number;
  quartos: number;
  vagas: number;
  area: number;
  status: StatusCatalogo;
  // Link temporário da miniatura (640 px) da foto 1, ou null.
  capa: string | null;
  fotos: number;
};

type LinhaDoCatalogo = {
  id: string;
  titulo: string;
  tipo: string;
  bairro: string;
  preco: number | string;
  quartos: number;
  vagas: number;
  area: number | string;
  status: "disponivel" | "em_negociacao";
  capa: string | null;
  total_fotos: number;
  total: number;
};

// Uma página do catálogo e o total de imóveis com esses filtros.
export async function buscarCatalogo(f: FiltrosCatalogo): Promise<{ imoveis: ImovelNoCatalogo[]; total: number }> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("catalogo", {
    p_tipo: f.tipo,
    p_bairros: f.bairros.length > 0 ? f.bairros : null,
    p_preco_min: f.precoMin,
    p_preco_max: f.precoMax,
    p_quartos_min: f.quartos,
    p_status: f.status === "negociacao" ? "em_negociacao" : f.status,
    p_limite: POR_PAGINA,
    p_deslocamento: (f.pagina - 1) * POR_PAGINA,
  });
  if (error) throw error;
  const linhas = (data ?? []) as LinhaDoCatalogo[];

  // Um pedido só de links para as miniaturas da página inteira.
  const miniaturas = linhas.map((linha) => (linha.capa ? caminhoDaMiniatura(linha.capa) : null));
  const caminhos = miniaturas.filter((caminho): caminho is string => caminho !== null);
  const { data: links } = caminhos.length
    ? await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(caminhos, VALIDADE_DO_LINK_EM_SEGUNDOS)
    : { data: [] };
  const linkDe = new Map((links ?? []).map((link) => [link.path, link.signedUrl]));

  return {
    total: Number(linhas[0]?.total ?? 0),
    imoveis: linhas.map((linha, i) => ({
      id: linha.id,
      titulo: linha.titulo,
      tipo: linha.tipo,
      bairro: linha.bairro,
      preco: Number(linha.preco),
      quartos: linha.quartos,
      vagas: linha.vagas,
      area: Number(linha.area),
      status: linha.status === "em_negociacao" ? "negociacao" : "disponivel",
      capa: (miniaturas[i] && linkDe.get(miniaturas[i])) || null,
      fotos: linha.total_fotos,
    })),
  };
}

// Nome que aparece no topo do catálogo: a imobiliária (para o responsável e os
// corretores dela) ou o próprio corretor autônomo.
export async function nomeDoAssinante(assinanteId: string | null) {
  if (!assinanteId) return null;
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("assinantes").select("nome").eq("id", assinanteId).maybeSingle();
  return data?.nome ?? null;
}

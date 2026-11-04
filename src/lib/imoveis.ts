import "server-only";

import { criarClienteServidor } from "@/lib/supabase/server";
import { BUCKET_FOTOS, caminhoDaMiniatura, idDeImovelValido } from "@/lib/imovel";

// Leituras do imóvel no servidor, sempre com a sessão de quem está logado: o RLS
// do banco decide o que cada um vê. Quem chama já passou pelo exigirTipo().

export type StatusImovel = "rascunho" | "pendente" | "reprovado" | "captado" | "disponivel" | "vendido" | "expirado";

export type ImovelDoDono = {
  id: string;
  titulo: string;
  descricao: string;
  tipo_id: number;
  tipo: string;
  endereco: string;
  bairro_id: number;
  bairro: string;
  preco: number;
  quartos: number;
  banheiros: number;
  vagas: number;
  area: number;
  mostrar_contato: boolean;
  status: StatusImovel;
  motivo_reprovacao: string | null;
  exclusividade_fim: string | null;
  versao: number;
  fotos: number;
};

// Imóvel na lista "Meus imóveis", com o link da miniatura da capa.
export type ImovelNaLista = {
  id: string;
  titulo: string;
  status: StatusImovel;
  preco: number;
  quartos: number;
  area: number;
  bairro: string;
  motivo_reprovacao: string | null;
  exclusividade_fim: string | null;
  capa: string | null;
  fotos: number;
};

// Tipos e bairros em uso, para as listas do formulário.
export async function listasDoImovel() {
  const supabase = await criarClienteServidor();
  const [tipos, bairros] = await Promise.all([
    supabase.from("tipos_imovel").select("id, nome").eq("ativo", true).order("id"),
    supabase.from("bairros").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  if (tipos.error) throw tipos.error;
  if (bairros.error) throw bairros.error;
  const opcoes = (lista: { id: number; nome: string }[]) => lista.map((item) => ({ valor: String(item.id), rotulo: item.nome }));
  return { tipos: opcoes(tipos.data), bairros: opcoes(bairros.data) };
}

// Imóvel do proprietário logado, ou null se não existe ou é de outra pessoa.
export async function imovelDoDono(id: string, donoId: string): Promise<ImovelDoDono | null> {
  if (!idDeImovelValido(id)) return null;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("imoveis")
    .select(
      "id, titulo, descricao, tipo_id, endereco, bairro_id, preco, quartos, banheiros, vagas, area, mostrar_contato, status, motivo_reprovacao, exclusividade_fim, versao, tipos_imovel(nome), bairros(nome), fotos_imovel(count)",
    )
    .eq("id", id)
    .eq("proprietario_id", donoId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { tipos_imovel, bairros, fotos_imovel, ...imovel } = data;
  return {
    ...imovel,
    preco: Number(imovel.preco),
    area: Number(imovel.area),
    status: imovel.status as StatusImovel,
    tipo: nomeDaLista(tipos_imovel),
    bairro: nomeDaLista(bairros),
    fotos: fotos_imovel[0]?.count ?? 0,
  };
}

// "Meus imóveis": os imóveis do proprietário logado, os mais novos primeiro, com
// a miniatura da capa (um pedido só de links para todas).
export async function imoveisDoDono(donoId: string): Promise<ImovelNaLista[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("imoveis")
    .select(
      "id, titulo, status, preco, quartos, area, motivo_reprovacao, exclusividade_fim, bairros(nome), fotos_imovel(caminho, ordem)",
    )
    .eq("proprietario_id", donoId)
    .order("criado_em", { ascending: false });
  if (error) throw error;

  const capas = data.map((imovel) => {
    const fotos = (imovel.fotos_imovel as { caminho: string; ordem: number }[]) ?? [];
    const capa = fotos.reduce<{ caminho: string; ordem: number } | null>((a, b) => (!a || b.ordem < a.ordem ? b : a), null);
    return capa ? caminhoDaMiniatura(capa.caminho) : null;
  });
  const caminhos = capas.filter((c): c is string => c !== null);
  const { data: links } = caminhos.length
    ? await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(caminhos, VALIDADE_DO_LINK_EM_SEGUNDOS)
    : { data: [] };
  const linkDe = new Map((links ?? []).map((link) => [link.path, link.signedUrl]));

  return data.map((imovel, i) => ({
    id: imovel.id,
    titulo: imovel.titulo,
    status: imovel.status as StatusImovel,
    preco: Number(imovel.preco),
    quartos: imovel.quartos,
    area: Number(imovel.area),
    bairro: nomeDaLista(imovel.bairros),
    motivo_reprovacao: imovel.motivo_reprovacao,
    exclusividade_fim: imovel.exclusividade_fim,
    capa: (capas[i] && linkDe.get(capas[i])) || null,
    fotos: ((imovel.fotos_imovel as unknown[]) ?? []).length,
  }));
}

// Quanto tempo o link de uma foto vale. O bucket é privado: cada visita pede links
// novos, e um link copiado para fora para de funcionar depois disso.
export const VALIDADE_DO_LINK_EM_SEGUNDOS = 60 * 60;

export type FotoDoImovel = { id: string; ordem: number; caminho: string; miniatura: string | null; grande?: string | null };

// Fotos do imóvel na ordem (a primeira é a capa), com links temporários das
// miniaturas (e das fotos grandes, se pedir). O RLS decide se quem pergunta vê as fotos.
export async function fotosDoImovel(imovelId: string, { grandes = false } = {}): Promise<FotoDoImovel[]> {
  if (!idDeImovelValido(imovelId)) return [];
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("fotos_imovel")
    .select("id, ordem, caminho")
    .eq("imovel_id", imovelId)
    .order("ordem");
  if (error) throw error;
  if (data.length === 0) return [];

  const caminhos = data.map((foto) => caminhoDaMiniatura(foto.caminho));
  if (grandes) caminhos.push(...data.map((foto) => foto.caminho));
  const { data: links } = await supabase.storage
    .from(BUCKET_FOTOS)
    .createSignedUrls(caminhos, VALIDADE_DO_LINK_EM_SEGUNDOS);
  // Sem link (arquivo que não existe mais), a tela mostra o quadro vazio.
  return data.map((foto, i) => ({
    ...foto,
    miniatura: links?.[i]?.signedUrl ?? null,
    ...(grandes && { grande: links?.[data.length + i]?.signedUrl ?? null }),
  }));
}

// Link temporário da miniatura da capa (a foto 1), ou null sem fotos.
export async function capaDoImovel(imovelId: string) {
  return (await fotosDoImovel(imovelId))[0]?.miniatura ?? null;
}

// Nome do tipo ou do bairro ligado ao imóvel. Sem os tipos gerados do banco, o
// supabase-js descreve a ligação como lista, mas ela chega como um objeto só.
function nomeDaLista(ligacao: { nome: string } | { nome: string }[] | null) {
  return (Array.isArray(ligacao) ? ligacao[0]?.nome : ligacao?.nome) ?? "";
}

// Versão do termo de exclusividade que pode ser aceita agora.
export async function termoVigente() {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("termos_exclusividade")
    .select("versao, texto, provisorio")
    .eq("vigente", true)
    .single();
  if (error) throw error;
  return data;
}

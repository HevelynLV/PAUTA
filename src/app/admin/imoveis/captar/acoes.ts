"use server";

import { redirect } from "next/navigation";

import { exigirTipo } from "@/lib/auth";
import { formatarTelefone } from "@/lib/conta";
import { BUCKET_FOTOS, idDeImovelValido, lerDadosDoImovel, type CampoImovel } from "@/lib/imovel";
import { criarClienteServidor } from "@/lib/supabase/server";
import { avisarPeloWhatsApp } from "@/lib/whatsapp";

// Captação pelo admin (RF08, decisões de 27/10/2026): o dono já tem conta; o admin
// procura, cadastra o imóvel para ele e envia as fotos. O imóvel fica "captado",
// fora do catálogo, até o dono aceitar o termo. Quem decide de verdade são as
// funções do banco buscar_proprietarios() e captar_imovel(), que conferem o admin.

export type DonoEncontrado = { id: string; nome: string; telefone: string; email: string };

export async function buscarDonos(texto: string): Promise<{ donos?: DonoEncontrado[]; erro?: string }> {
  await exigirTipo("admin");
  const busca = String(texto ?? "").trim();
  if (busca.length < 3) return { erro: "Escreva pelo menos 3 letras do nome, do e-mail ou do telefone." };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("buscar_proprietarios", { p_texto: busca.slice(0, 120) });
  if (error) return { erro: "Não foi possível procurar agora. Tente de novo." };
  return { donos: (data as DonoEncontrado[]).map((dono) => ({ ...dono, telefone: formatarTelefone(dono.telefone) })) };
}

export type EstadoCaptacao = {
  erros: Partial<Record<CampoImovel | "dono", string>>;
  erroGeral?: string;
  valores: Partial<Record<CampoImovel, string>>;
};

export async function captarImovel(_anterior: EstadoCaptacao, formData: FormData): Promise<EstadoCaptacao> {
  await exigirTipo("admin");
  const dono = String(formData.get("dono") ?? "");
  const leitura = lerDadosDoImovel(formData);
  const erros: EstadoCaptacao["erros"] = leitura.ok ? {} : { ...leitura.erros };
  if (!idDeImovelValido(dono)) erros.dono = "Procure e escolha a conta do dono.";
  if (!leitura.ok || erros.dono) return { erros, valores: leitura.valores };
  const { dados, valores } = leitura;

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("captar_imovel", {
    p_dono: dono,
    p_titulo: dados.titulo,
    p_descricao: dados.descricao,
    p_tipo_id: dados.tipo_id,
    p_endereco: dados.endereco,
    p_bairro_id: dados.bairro_id,
    p_preco: dados.preco,
    p_quartos: dados.quartos,
    p_banheiros: dados.banheiros,
    p_vagas: dados.vagas,
    p_area: dados.area,
  });
  if (error) {
    if (error.code === "P0001" && error.message.includes("conta de proprietário")) {
      return { erros: { dono: "Esta conta não é de proprietário. Escolha outra." }, valores };
    }
    if (error.code === "P0001" && error.message.includes("tipo")) {
      return { erros: { tipo_id: "Este tipo não está mais em uso. Escolha outro." }, valores };
    }
    if (error.code === "P0001" && error.message.includes("bairro")) {
      return { erros: { bairro_id: "Este bairro não está mais em uso. Escolha outro." }, valores };
    }
    return { erros: {}, valores, erroGeral: "Não foi possível captar o imóvel. Confira os dados e tente de novo." };
  }

  avisarPeloWhatsApp();
  redirect(`/admin/imoveis/captar/${data as string}`);
}

// Apaga o imóvel captado que ainda espera o dono (o banco só deixa nesse status).
// Primeiro o imóvel, depois os arquivos que o admin enviou (como no apagar do dono).
export async function apagarCaptado(id: string): Promise<{ erro?: string }> {
  await exigirTipo("admin");
  if (!idDeImovelValido(id)) return { erro: "Imóvel não encontrado." };

  const supabase = await criarClienteServidor();
  const balde = supabase.storage.from(BUCKET_FOTOS);
  const { data: arquivos } = await balde.list(id, { limit: 1000 });
  const { data, error } = await supabase.from("imoveis").delete().eq("id", id).eq("status", "captado").select("id");
  if (error || data.length === 0) return { erro: "Só dá para apagar imóvel captado que ainda espera o dono." };
  if (arquivos?.length) await balde.remove(arquivos.map((arquivo) => `${id}/${arquivo.name}`));
  redirect("/admin/imoveis/captados?apagado=1");
}

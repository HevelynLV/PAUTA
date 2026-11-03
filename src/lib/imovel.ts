// Leitura e conferência dos dados do imóvel (RF07), com as mesmas regras do banco
// (supabase/migrations/20261022221614_imoveis.sql). O banco confere de novo: aqui
// é só para a pessoa ver uma mensagem clara no campo certo.

import { idValido } from "@/lib/validacao";

export type CampoImovel =
  | "titulo"
  | "tipo_id"
  | "preco"
  | "endereco"
  | "bairro_id"
  | "quartos"
  | "banheiros"
  | "vagas"
  | "area"
  | "descricao";

// O que vai para a tabela imoveis.
export type DadosImovel = {
  titulo: string;
  tipo_id: number;
  preco: number;
  endereco: string;
  bairro_id: number;
  quartos: number;
  banheiros: number;
  vagas: number;
  area: number;
  descricao: string;
};

export type LeituraImovel =
  | { ok: true; dados: DadosImovel; valores: Partial<Record<CampoImovel, string>> }
  | { ok: false; erros: Partial<Record<CampoImovel, string>>; valores: Partial<Record<CampoImovel, string>> };

// Número em reais ou m², como a pessoa digita no Brasil: o ponto separa os
// milhares e a vírgula, os centavos. "R$ 1.890.000" vira 1890000; "75,5" vira 75.5.
// Devolve null se não for um número com até 2 casas depois da vírgula.
export function lerNumero(texto: string) {
  const limpo = texto.replace(/R\$|m²|\s/gi, "");
  if (!/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$/.test(limpo)) return null;
  return Number(limpo.replace(/\./g, "").replace(",", "."));
}

// Quartos, banheiros e vagas: número inteiro de 0 a 99 (imoveis_comodos_validos).
// Vazio conta como 0.
function lerComodos(texto: string) {
  if (texto === "") return 0;
  return /^\d{1,2}$/.test(texto) ? Number(texto) : null;
}

function lerId(texto: string) {
  return /^\d{1,18}$/.test(texto) ? Number(texto) : null;
}

export function lerDadosDoImovel(formData: FormData): LeituraImovel {
  const texto = (campo: CampoImovel) => String(formData.get(campo) ?? "").trim();
  const valores: Partial<Record<CampoImovel, string>> = {
    titulo: texto("titulo"),
    tipo_id: texto("tipo_id"),
    preco: texto("preco"),
    endereco: texto("endereco"),
    bairro_id: texto("bairro_id"),
    quartos: texto("quartos"),
    banheiros: texto("banheiros"),
    vagas: texto("vagas"),
    area: texto("area"),
    // A descrição guarda as quebras de linha; só tira os espaços das pontas.
    descricao: String(formData.get("descricao") ?? "").trim(),
  };

  const tipo = lerId(valores.tipo_id!);
  const bairro = lerId(valores.bairro_id!);
  const preco = lerNumero(valores.preco!);
  const area = lerNumero(valores.area!);
  const quartos = lerComodos(valores.quartos!);
  const banheiros = lerComodos(valores.banheiros!);
  const vagas = lerComodos(valores.vagas!);

  const erros: Partial<Record<CampoImovel, string>> = {};
  if (valores.titulo!.length < 3 || valores.titulo!.length > 120) {
    erros.titulo = "Escreva o título (de 3 a 120 letras).";
  }
  if (tipo === null) erros.tipo_id = "Escolha o tipo do imóvel.";
  // numeric(14, 2): até 999 bilhões.
  if (preco === null || preco <= 0 || preco >= 1e12) erros.preco = "Escreva o preço em reais, ex.: 1.890.000.";
  if (valores.endereco!.length < 3 || valores.endereco!.length > 200) {
    erros.endereco = "Escreva o endereço (rua e número).";
  }
  if (bairro === null) erros.bairro_id = "Escolha o bairro.";
  if (quartos === null) erros.quartos = "De 0 a 99.";
  if (banheiros === null) erros.banheiros = "De 0 a 99.";
  if (vagas === null) erros.vagas = "De 0 a 99.";
  // numeric(10, 2): até 99 milhões de m².
  if (area === null || area <= 0 || area >= 1e8) erros.area = "Escreva a área em m², ex.: 220.";
  if (valores.descricao!.length > 5000) erros.descricao = "A descrição tem no máximo 5.000 letras.";

  if (Object.keys(erros).length > 0) return { ok: false, erros, valores };

  return {
    ok: true,
    valores,
    dados: {
      titulo: valores.titulo!,
      tipo_id: tipo!,
      preco: preco!,
      endereco: valores.endereco!,
      bairro_id: bairro!,
      quartos: quartos!,
      banheiros: banheiros!,
      vagas: vagas!,
      area: area!,
      descricao: valores.descricao!,
    },
  };
}

// "R$ 1.890.000" (sem centavos quando o valor é inteiro).
export function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: Number.isInteger(valor) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// "2027-04-13T18:40:00Z" → "13/04/2027", no horário de Florianópolis.
export function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// "12/10/2026 às 18:40", no horário de Florianópolis.
export function formatarDataHora(iso: string) {
  const data = new Date(iso);
  const hora = data.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${formatarData(iso)} às ${hora}`;
}

// Para voltar ao formulário: 1890000 vira "1.890.000"; 75.5 vira "75,5".
export function numeroParaCampo(valor: number) {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

// Fotos (RF09), com as regras do bucket (supabase/migrations/20261026221116_fotos_storage.sql).
export const BUCKET_FOTOS = "fotos-imoveis";
export const LIMITE_DE_FOTOS = 20;
// O que a pessoa pode escolher; o navegador converte tudo para JPEG antes de enviar.
export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"];
export const TAMANHO_MAXIMO_DA_FOTO = 10 * 1024 * 1024;

// "abc/123.jpg" → "abc/123-mini.jpg" (a miniatura enviada junto com a foto).
export function caminhoDaMiniatura(caminho: string) {
  return caminho.replace(/\.jpg$/, "-mini.jpg");
}

// O id do imóvel vem do endereço (ou de um campo que a pessoa pode alterar):
// confere o formato antes de perguntar ao banco.
export function idDeImovelValido(id: string) {
  return idValido(id);
}

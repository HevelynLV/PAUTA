// Regras de contrato que valem no navegador e no servidor (RF25, RF26, RF32). As barreiras
// de verdade estão no banco e no bucket (migration 20261106221451_contratos); aqui ficam
// os limites, os rótulos e as mensagens, para a tela responder na hora.

export type StatusContrato = "em_analise" | "aprovado" | "recusado";

export const BUCKET_CONTRATOS = "contratos";
export const TIPO_DO_PDF = "application/pdf";

// O mesmo limite do bucket. Decidido em 06/11/2026 (plano da Etapa 9).
export const TAMANHO_MAXIMO_DO_PDF = 20 * 1024 * 1024;
export const TAMANHO_DO_MOTIVO = 1000;

// Pela especificação, o PDF se identifica no começo do arquivo, mas alguns programas
// escrevem antes dessa marca. Os leitores procuram no primeiro 1 KB, e aqui também.
export const MARCA_DO_PDF = "%PDF-";
export const BYTES_PARA_CONFERIR = 1024;

// O link de leitura nasce no clique e vale só para abrir o arquivo.
export const VALIDADE_DO_LINK_DO_PDF_EM_SEGUNDOS = 60;

export function tamanhoDoPdfValido(bytes: number) {
  return Number.isInteger(bytes) && bytes > 0 && bytes <= TAMANHO_MAXIMO_DO_PDF;
}

// Caminho no bucket: {proposta}/{uuid}.pdf, com o nome escolhido pelo servidor.
export function caminhoDoContratoValido(propostaId: string, caminho: string) {
  return (
    caminho.startsWith(`${propostaId}/`) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/.test(caminho.slice(propostaId.length + 1))
  );
}

// "1,2 MB", como no protótipo.
export function textoDoTamanho(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

// O banco diz o motivo pelo hint do erro, nunca pelo texto.
export function mensagemDoErroDeContrato(hint: string | null | undefined) {
  switch (hint) {
    case "arquivo_invalido":
      return "Este arquivo não pôde ser usado. Envie o PDF do contrato de novo.";
    case "comissao_invalida":
      return "A comissão precisa ser maior que zero e não pode passar do valor final.";
    case "contrato_em_analise":
      return "Já há um contrato em análise nesta proposta. Recarregue a página.";
    case "contrato_ja_conferido":
      return "Este contrato já foi conferido. Recarregue a página.";
    case "contrato_nao_encontrado":
      return "Contrato não encontrado. Recarregue a página.";
    case "imovel_fora_do_catalogo":
      return "Este imóvel não está mais no catálogo.";
    case "motivo_invalido":
      return `Escreva o motivo, com até ${TAMANHO_DO_MOTIVO.toLocaleString("pt-BR")} caracteres.`;
    case "proposta_encerrada":
      return "A proposta deste contrato não está mais aceita. Recarregue a página.";
    case "proposta_nao_aceita":
      return "Só proposta aceita pelo proprietário recebe contrato. Recarregue a página.";
    case "proposta_nao_encontrada":
      return "Proposta não encontrada. Recarregue a página.";
    case "valor_invalido":
      return "Escreva o valor final do contrato em reais, ex.: 1.800.000.";
    case "venda_nao_encontrada":
      return "Venda não encontrada. Recarregue a página.";
    default:
      return "Não foi possível concluir. Tente de novo.";
  }
}

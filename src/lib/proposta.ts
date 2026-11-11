import type { Status } from "@/components/ui/SeloStatus";
import type { StatusContrato } from "@/lib/contrato";

// Regras de proposta que valem no navegador e no servidor (RF23, RF24). As barreiras de
// verdade estão no banco (migration 20261105180815_propostas); aqui ficam os rótulos,
// as mensagens e a conferência para a tela responder na hora.

export type StatusProposta = "aguardando" | "aceita" | "recusada" | "cancelada";
export type FormaPagamento = "a_vista" | "financiamento" | "permuta";

// Os rótulos são os da decisão de 05/11/2026, não os do protótipo.
export const FORMAS_DE_PAGAMENTO: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: "a_vista", rotulo: "À vista" },
  { valor: "financiamento", rotulo: "Financiamento" },
  { valor: "permuta", rotulo: "Permuta" },
];

export const TAMANHO_DAS_CONDICOES = 1000;
export const TAMANHO_DO_COMPRADOR = 120;

export function rotuloDaForma(forma: FormaPagamento) {
  return FORMAS_DE_PAGAMENTO.find((item) => item.valor === forma)?.rotulo ?? forma;
}

export function formaValida(forma: string): forma is FormaPagamento {
  return FORMAS_DE_PAGAMENTO.some((item) => item.valor === forma);
}

export function propostaEmAberto(status: StatusProposta) {
  return status === "aguardando" || status === "aceita";
}

// A dica embaixo do valor: "4,8% abaixo do preço pedido."
export function comparacaoComOPreco(valor: number, preco: number) {
  const diferenca = ((valor - preco) / preco) * 100;
  const texto = Math.abs(diferenca).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (texto === "0,0") return "Igual ao preço pedido.";
  return `${texto}% ${diferenca < 0 ? "abaixo" : "acima"} do preço pedido.`;
}

export function seloDaProposta(status: StatusProposta, para: "corretor" | "proprietario"): { status: Status; rotulo: string } {
  switch (status) {
    case "aguardando":
      return para === "corretor" ? { status: "pendente", rotulo: "Aguardando resposta" } : { status: "negociacao", rotulo: "Nova" };
    case "aceita":
      return { status: "disponivel", rotulo: "Aceita" };
    case "recusada":
      return { status: "reprovado", rotulo: "Recusada" };
    case "cancelada":
      return { status: "pendente", rotulo: "Retirada" };
  }
}

// O selo das Negociações: depois do aceite, quem manda é o contrato. Proposta que saiu do
// aceite (desfeito, retirada ou recusada) não leva mais o contrato antigo em conta.
export function seloDaNegociacao(status: StatusProposta, contrato: StatusContrato | null): { status: Status; rotulo: string } {
  if (status === "aceita" && contrato === "em_analise") return { status: "contrato", rotulo: "Contrato em análise" };
  if (status === "aceita" && contrato === "recusado") return { status: "reprovado", rotulo: "Contrato recusado" };
  if (status === "aceita" && contrato === "aprovado") return { status: "vendido", rotulo: "Vendido" };
  return seloDaProposta(status, "corretor");
}

// O banco diz o motivo pelo hint do erro, nunca pelo texto.
export function mensagemDoErroDeProposta(hint: string | null | undefined) {
  switch (hint) {
    case "imovel_fora_do_catalogo":
      return "Este imóvel não está mais no catálogo.";
    case "valor_invalido":
      return "Escreva o valor em reais, ex.: 1.800.000.";
    case "forma_invalida":
      return "Escolha a forma de pagamento.";
    case "condicoes_invalidas":
      return `Escreva as condições, com até ${TAMANHO_DAS_CONDICOES.toLocaleString("pt-BR")} caracteres.`;
    case "comprador_invalido":
      return `O nome do comprador pode ter até ${TAMANHO_DO_COMPRADOR} caracteres.`;
    case "proposta_em_aberto":
      return "Você já tem uma proposta em aberto neste imóvel. Para mudar, retire a atual e envie outra.";
    case "proposta_ja_respondida":
      return "Esta proposta já foi respondida. Recarregue a página.";
    case "proposta_encerrada":
      return "Esta proposta não pode mais ser alterada. Recarregue a página.";
    case "proposta_nao_encontrada":
      return "Proposta não encontrada. Recarregue a página.";
    case "limite_por_hora":
      return "Você enviou muitas propostas na última hora. Tente de novo mais tarde.";
    default:
      return "Não foi possível concluir. Tente de novo.";
  }
}

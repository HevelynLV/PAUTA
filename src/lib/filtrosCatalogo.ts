// Filtros do catálogo (RF19, decisões de 03/11/2026), lidos da URL e escritos de
// volta nela, para o corretor compartilhar uma busca. Sem "server-only": a lista
// (servidor) e os filtros (navegador) usam as mesmas regras.
//
// URL: /assinante?tipo=2&bairro=5&bairro=9&preco_min=500000&preco_max=900000&quartos=2&status=negociacao&pagina=2
// Tipo e bairro vão pelo número (o id da lista no banco). Valor inválido na URL
// (texto, número negativo, status desconhecido) é ignorado, como se não tivesse vindo.

import { lerNumero } from "@/lib/imovel";

export type StatusCatalogo = "disponivel" | "negociacao";

export type FiltrosCatalogo = {
  tipo: number | null;
  bairros: number[];
  precoMin: number | null;
  precoMax: number | null;
  quartos: number | null;
  status: StatusCatalogo | null;
  pagina: number;
};

export const POR_PAGINA = 12;
export const OPCOES_DE_QUARTOS = [1, 2, 3, 4];

// Limites que impedem uma URL montada à mão de pesar no banco.
const MAXIMO_DE_BAIRROS = 60;
const MAXIMA_PAGINA = 1000;
const MAIOR_PRECO = 100_000_000_000;

type Parametros = Record<string, string | string[] | undefined>;

function todos(valor: string | string[] | undefined) {
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function primeiro(valor: string | string[] | undefined) {
  return todos(valor)[0] ?? "";
}

function lerId(texto: string) {
  return /^\d{1,9}$/.test(texto) && Number(texto) > 0 ? Number(texto) : null;
}

// Preço como a pessoa digita ("1.500.000", "R$ 900000"), sem centavos.
function lerPreco(texto: string) {
  if (texto.trim() === "") return null;
  const valor = lerNumero(texto);
  if (valor === null || valor > MAIOR_PRECO) return null;
  return Math.floor(valor);
}

export function lerFiltros(parametros: Parametros): FiltrosCatalogo {
  const quartos = Number(primeiro(parametros.quartos));
  const status = primeiro(parametros.status);
  const pagina = /^\d{1,4}$/.test(primeiro(parametros.pagina)) ? Number(primeiro(parametros.pagina)) : 1;

  let precoMin = lerPreco(primeiro(parametros.preco_min));
  let precoMax = lerPreco(primeiro(parametros.preco_max));
  // Mínimo maior que o máximo: a pessoa trocou os campos. Troca de volta.
  if (precoMin !== null && precoMax !== null && precoMin > precoMax) [precoMin, precoMax] = [precoMax, precoMin];

  const bairros = [...new Set(todos(parametros.bairro).map(lerId).filter((id): id is number => id !== null))];

  return {
    tipo: lerId(primeiro(parametros.tipo)),
    bairros: bairros.slice(0, MAXIMO_DE_BAIRROS),
    precoMin,
    precoMax,
    quartos: OPCOES_DE_QUARTOS.includes(quartos) ? quartos : null,
    status: status === "disponivel" || status === "negociacao" ? status : null,
    pagina: Math.min(Math.max(pagina, 1), MAXIMA_PAGINA),
  };
}

// Endereço do catálogo com os filtros f, trocando o que vier em "mudar". Mudar um
// filtro volta para a página 1 (a página 3 de outra busca não faz sentido).
export function urlDoCatalogo(f: FiltrosCatalogo, mudar: Partial<FiltrosCatalogo> = {}) {
  const novo = { ...f, pagina: 1, ...mudar };
  const busca = new URLSearchParams();
  if (novo.tipo !== null) busca.set("tipo", String(novo.tipo));
  for (const bairro of novo.bairros) busca.append("bairro", String(bairro));
  if (novo.precoMin !== null) busca.set("preco_min", String(novo.precoMin));
  if (novo.precoMax !== null) busca.set("preco_max", String(novo.precoMax));
  if (novo.quartos !== null) busca.set("quartos", String(novo.quartos));
  if (novo.status !== null) busca.set("status", novo.status);
  if (novo.pagina > 1) busca.set("pagina", String(novo.pagina));
  const texto = busca.toString();
  return texto ? `/assinante?${texto}` : "/assinante";
}

// Quantos filtros da folha (bairro, preço, quartos) estão ligados, para o botão
// "Filtros" do celular mostrar que há algo escolhido lá dentro.
export function filtrosDaFolhaAtivos(f: FiltrosCatalogo) {
  return (f.bairros.length > 0 ? 1 : 0) + (f.precoMin !== null || f.precoMax !== null ? 1 : 0) + (f.quartos !== null ? 1 : 0);
}

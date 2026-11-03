import type { NomeIcone } from "./icones";

// Item dos menus de área (MenuInferior no celular, MenuLateral no computador).
export type ItemMenu = {
  href: string;
  rotulo: string;
  icone: NomeIcone;
  contador?: number;
  // A página do item é uma tela de passo a passo, sem o menu de baixo (ex.: "Novo
  // imóvel" abre o passo 1 do cadastro, que no protótipo não tem menu).
  semMenuInferior?: boolean;
  // Outras páginas que acendem este item (ex.: a Equipe fica dentro de "Minha
  // conta" no protótipo, embora o endereço comece com /assinante).
  tambem?: string[];
};

// Acende o item do endereço atual e também das páginas dentro dele
// (/imoveis/123 acende "Imóveis"). Se dois itens servirem, vale o mais específico.
export function hrefAtivo(caminho: string, itens: ItemMenu[]) {
  const serve = (base: string) => caminho === base || caminho.startsWith(`${base}/`);
  // Para cada item, o endereço mais longo que serve (o href ou um dos "tambem").
  const servem = itens
    .map((item) => ({
      href: item.href,
      tamanho: Math.max(-1, ...[item.href, ...(item.tambem ?? [])].filter(serve).map((base) => base.length)),
    }))
    .filter((item) => item.tamanho >= 0);
  return servem.sort((a, b) => b.tamanho - a.tamanho)[0]?.href;
}

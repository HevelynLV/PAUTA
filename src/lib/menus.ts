import type { ItemMenu } from "@/components/ui/itensMenu";

// Itens de menu de cada área, como no protótipo: "celular" é o menu de baixo
// (.nav do pauta.css) e "computador" é o menu lateral (.snav do site.css).
// Páginas que ainda não existem respondem 404 até a etapa delas.

export type MenusDaArea = { rotulo: string; celular: ItemMenu[]; computador: ItemMenu[] };

export const menuProprietario: MenusDaArea = {
  rotulo: "Menu do proprietário",
  celular: [
    { href: "/proprietario", rotulo: "Imóveis", icone: "imoveis" },
    { href: "/proprietario/imoveis/novo", rotulo: "Novo imóvel", icone: "novo", semMenuInferior: true },
    { href: "/proprietario/avisos", rotulo: "Avisos", icone: "avisos" }, // Etapa 10
    { href: "/proprietario/conta", rotulo: "Conta", icone: "conta" }, // passo 3.5
  ],
  computador: [
    { href: "/proprietario", rotulo: "Meus imóveis", icone: "imoveis" },
    { href: "/proprietario/imoveis/novo", rotulo: "Novo imóvel", icone: "novo" },
    { href: "/proprietario/avisos", rotulo: "Avisos", icone: "avisos" },
    { href: "/proprietario/conta", rotulo: "Minha conta", icone: "conta" },
  ],
};

// Imobiliária, corretor autônomo e corretor convidado. A Equipe (só para o
// responsável da imobiliária, passo 5.4) abre por Minha conta, como no protótipo.
export const menuAssinante: MenusDaArea = {
  rotulo: "Menu do corretor",
  celular: [
    { href: "/assinante", rotulo: "Catálogo", icone: "catalogo" }, // Etapa 6
    { href: "/assinante/negociacoes", rotulo: "Negociações", icone: "negociacoes" }, // Etapa 8
    { href: "/assinante/avisos", rotulo: "Avisos", icone: "avisos" }, // Etapa 10
    { href: "/assinante/conta", rotulo: "Conta", icone: "conta", tambem: ["/assinante/equipe"] }, // passo 3.5
  ],
  computador: [
    { href: "/assinante", rotulo: "Catálogo", icone: "catalogo" },
    { href: "/assinante/negociacoes", rotulo: "Negociações", icone: "negociacoes" },
    { href: "/assinante/avisos", rotulo: "Avisos", icone: "avisos" },
    { href: "/assinante/conta", rotulo: "Minha conta", icone: "conta", tambem: ["/assinante/equipe"] },
  ],
};

export const menuAdmin: MenusDaArea = {
  rotulo: "Menu do admin",
  celular: [
    { href: "/admin", rotulo: "Painel", icone: "painel" },
    { href: "/admin/imoveis", rotulo: "Imóveis", icone: "imoveis", semMenuInferior: true },
    { href: "/admin/assinantes", rotulo: "Assinantes", icone: "assinantes" }, // Etapa 5
    { href: "/admin/contratos", rotulo: "Contratos", icone: "contratos" }, // Etapa 9
  ],
  computador: [
    { href: "/admin", rotulo: "Painel", icone: "painel" },
    { href: "/admin/imoveis", rotulo: "Aprovar imóveis", icone: "imoveis" },
    { href: "/admin/imoveis/captar", rotulo: "Captar imóvel", icone: "novo" }, // Etapa 4
    { href: "/admin/assinantes", rotulo: "Assinantes", icone: "assinantes" },
    { href: "/admin/edicoes", rotulo: "Edições", icone: "edicoes" }, // Etapa 4
    { href: "/admin/contratos", rotulo: "Contratos", icone: "contratos" },
  ],
};

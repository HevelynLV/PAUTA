import { Suspense, type ReactNode } from "react";

import { BotaoSair } from "@/components/BotaoSair";
import { Logo } from "@/components/ui/Logo";
import { MenuInferior } from "@/components/ui/MenuInferior";
import { MenuLateral } from "@/components/ui/MenuLateral";
import type { ItemMenu } from "@/components/ui/itensMenu";
import { usuarioAtual, type TipoUsuario } from "@/lib/auth";
import { avisosNaoVistos } from "@/lib/avisos";
import type { MenusDaArea } from "@/lib/menus";

// Moldura das áreas logadas: no celular, o conteúdo e o menu de baixo
// (pauta.css); no computador (a partir de 768 px), o menu lateral (.side do
// site.css) e o conteúdo.
//
// Esta moldura NÃO protege nada: o layout não roda de novo quando a pessoa
// navega entre páginas da mesma área. Quem protege é o exigirTipo() de cada
// página. A sessão só é lida no quadro "quem está logado", dentro de um
// <Suspense>, nunca no topo do layout (regra do Cache Components no CLAUDE.md).

export function AreaLogada({ menu, children }: { menu: MenusDaArea; children: ReactNode }) {
  return (
    <div className="flex flex-1 bg-bg">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-[22px] overflow-y-auto border-r border-line bg-card px-4 py-6 md:flex">
        <Logo />
        <Suspense fallback={<div className="h-[62px] rounded-[14px] bg-bg" />}>
          <QuemEsta />
        </Suspense>
        <Suspense fallback={null}>
          <MenuComAvisos itens={menu.computador} rotulo={menu.rotulo} Menu={MenuLateral} />
        </Suspense>
        {/* No celular, o "Sair" fica na tela Minha conta (passo 3.5). */}
        <BotaoSair className="mt-auto" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex flex-1 flex-col">{children}</main>
        <div className="sticky bottom-0 md:hidden">
          <Suspense fallback={<div className="h-[72px] border-t border-line bg-card" />}>
            <MenuComAvisos itens={menu.celular} rotulo={menu.rotulo} Menu={MenuInferior} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

// O número de avisos não vistos no item Avisos (Etapa 10). O admin não tem o item, e aí
// nada é consultado. O layout não roda de novo ao navegar: a tela de avisos chama
// router.refresh() depois de marcar como visto, para o número sumir.
async function MenuComAvisos({
  itens,
  rotulo,
  Menu,
}: {
  itens: ItemMenu[];
  rotulo: string;
  Menu: typeof MenuLateral | typeof MenuInferior;
}) {
  if (!itens.some((item) => item.icone === "avisos")) return <Menu itens={itens} rotulo={rotulo} />;
  const naoVistos = await avisosNaoVistos();
  const comNumero = itens.map((item) => (item.icone === "avisos" && naoVistos > 0 ? { ...item, contador: naoVistos } : item));
  return <Menu itens={comNumero} rotulo={rotulo} />;
}

const rotuloDoTipo: Record<TipoUsuario, string> = {
  proprietario: "Proprietário",
  imobiliaria: "Imobiliária",
  autonomo: "Corretor autônomo",
  corretor: "Corretor",
  admin: "Admin",
};

// Quadro "quem está logado" do menu lateral (.side .who do site.css).
// Só mostra; quem barra o acesso é o exigirTipo() da página.
async function QuemEsta() {
  const usuario = await usuarioAtual();
  if (!usuario) return null;

  const iniciais = usuario.nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-bg p-3">
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-mar-soft text-sm font-bold text-mar-dark">
        {iniciais}
      </span>
      <div className="flex min-w-0 flex-col">
        <b className="truncate text-small">{usuario.nome}</b>
        <span className="text-tiny text-ink2">{rotuloDoTipo[usuario.tipo]}</span>
      </div>
    </div>
  );
}

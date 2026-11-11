"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { icones } from "./icones";
import { hrefAtivo, type ItemMenu } from "./itensMenu";

export type { ItemMenu } from "./itensMenu";

// Menu de baixo do celular (.nav em docs/prototipo/pauta.css).
// No computador, as áreas usam o MenuLateral (.side do site.css).
//
// ATENÇÃO (Cache Components): este menu usa usePathname(). Num layout que fica
// acima de uma rota com parte variável (ex.: /proprietario/imoveis/[id]), ele só
// funciona dentro de um <Suspense>; sem isso, o npm run build falha. Veja
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-pathname.md

//
// Como no protótipo, o menu só aparece nas telas das abas (o endereço de um dos
// itens). As telas de dentro (ex.: os passos do cadastro do imóvel) têm o botão
// de voltar no topo e a barra de ação embaixo, no lugar do menu.
export function MenuInferior({ itens, rotulo }: { itens: ItemMenu[]; rotulo: string }) {
  const caminho = usePathname();
  const ativoHref = hrefAtivo(caminho, itens);
  if (!itens.some((item) => item.href === caminho && !item.semMenuInferior)) return null;

  return (
    <nav aria-label={rotulo} className="flex shrink-0 border-t border-line bg-card px-1.5 pt-1.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {itens.map((item) => {
        const ativo = item.href === ativoHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? "page" : undefined}
            className={`relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-[3px] rounded-botao text-[11px] font-semibold no-underline ${
              ativo ? "text-mar" : "text-ink2"
            }`}
          >
            {ativo && <span aria-hidden="true" className="absolute top-0.5 h-[3px] w-6 rounded-[3px] bg-mar" />}
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-[22px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
            >
              {icones[item.icone]}
            </svg>
            {item.rotulo}
            {item.contador ? (
              <span className="absolute right-[calc(50%-20px)] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-erro px-1 text-[10px] font-bold text-white">
                {item.contador > 99 ? "99+" : item.contador}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

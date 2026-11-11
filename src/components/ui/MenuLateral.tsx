"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { icones } from "./icones";
import { hrefAtivo, type ItemMenu } from "./itensMenu";

// Lista de links do menu lateral do computador (.snav em docs/prototipo/site.css).
// O resto do menu (logo, quem está logado, Sair) fica no AreaLogada.
//
// Como o MenuInferior, usa usePathname(): fica dentro de um <Suspense>.

export function MenuLateral({ itens, rotulo }: { itens: ItemMenu[]; rotulo: string }) {
  const ativoHref = hrefAtivo(usePathname(), itens);

  return (
    <nav aria-label={rotulo} className="flex flex-col gap-1">
      {itens.map((item) => {
        const ativo = item.href === ativoHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-botao-sm px-3 text-sm font-semibold no-underline ${
              ativo ? "bg-mar-soft text-mar-dark" : "text-ink2 hover:bg-bg hover:text-ink"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-[18px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
            >
              {icones[item.icone]}
            </svg>
            {item.rotulo}
            {item.contador ? (
              <span className="ml-auto flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-erro px-1.5 text-[11px] font-bold text-white">
                {item.contador > 99 ? "99+" : item.contador}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

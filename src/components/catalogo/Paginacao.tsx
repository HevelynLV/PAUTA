import Link from "next/link";

import { classesBotao } from "@/components/ui/Botao";
import { type FiltrosCatalogo, POR_PAGINA, urlDoCatalogo } from "@/lib/filtrosCatalogo";

// Páginas de 12 imóveis com "Anterior" e "Próxima" (decisão de 03/11/2026). A
// página vai na URL junto com os filtros, então o link compartilhado abre a mesma.
export function Paginacao({ filtros, total }: { filtros: FiltrosCatalogo; total: number }) {
  const paginas = Math.ceil(total / POR_PAGINA);
  if (paginas <= 1) return null;
  const { pagina } = filtros;

  return (
    <nav aria-label="Páginas do catálogo" className="flex items-center justify-between gap-3">
      {pagina > 1 ? (
        <Link href={urlDoCatalogo(filtros, { pagina: pagina - 1 })} className={classesBotao({ variante: "secundario", tamanho: "pequeno" })}>
          Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-small text-ink2">
        Página {pagina} de {paginas}
      </span>
      {pagina < paginas ? (
        <Link href={urlDoCatalogo(filtros, { pagina: pagina + 1 })} className={classesBotao({ variante: "secundario", tamanho: "pequeno" })}>
          Próxima
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

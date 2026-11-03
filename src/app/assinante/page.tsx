import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CardDoCatalogo } from "@/components/catalogo/CardDoCatalogo";
import { FiltrosDoCatalogo } from "@/components/catalogo/FiltrosDoCatalogo";
import { Paginacao } from "@/components/catalogo/Paginacao";
import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { buscarCatalogo, nomeDoAssinante } from "@/lib/catalogo";
import { filtrosDaFolhaAtivos, lerFiltros, urlDoCatalogo } from "@/lib/filtrosCatalogo";
import { listasDoImovel } from "@/lib/imoveis";

export const metadata: Metadata = { title: "Catálogo" };

// Catálogo do assinante (RF18 a RF20): docs/prototipo/CorCatalogo.dc.html (celular)
// e SiteCorCatalogo.dc.html (site). exigirTipo() já manda para outra tela quem está
// pendente, vencido, bloqueado ou removido; e a função catalogo() do banco confere
// de novo e devolve a lista vazia para quem não é assinante ativo.
export default function Catalogo({ searchParams }: PageProps<"/assinante">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2 md:px-10 md:pt-8">Carregando o catálogo…</p>}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}

// Quantos cards carregam a foto na hora (os que aparecem sem rolar).
const CARDS_PRIORITARIOS = 2;

async function Conteudo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const usuario = await exigirTipo(TIPOS_ASSINANTE);
  const filtros = lerFiltros(await searchParams);

  const [{ imoveis, total }, listas, nome] = await Promise.all([
    buscarCatalogo(filtros),
    listasDoImovel(),
    nomeDoAssinante(usuario.assinanteId),
  ]);

  const tipos = [
    { rotulo: "Todos", href: urlDoCatalogo(filtros, { tipo: null }), ativo: filtros.tipo === null },
    ...listas.tipos.map((tipo) => ({
      rotulo: tipo.rotulo,
      href: urlDoCatalogo(filtros, { tipo: Number(tipo.valor) }),
      ativo: filtros.tipo === Number(tipo.valor),
    })),
  ];
  const status = [
    { rotulo: "Todos os status", href: urlDoCatalogo(filtros, { status: null }), ativo: filtros.status === null },
    { rotulo: "Disponível", href: urlDoCatalogo(filtros, { status: "disponivel" }), ativo: filtros.status === "disponivel" },
    { rotulo: "Em negociação", href: urlDoCatalogo(filtros, { status: "negociacao" }), ativo: filtros.status === "negociacao" },
  ];
  const rotuloDoTotal = total === 1 ? "1 imóvel" : `${total} imóveis`;
  // Muda a cada busca: os filtros voltam a mostrar o que está na URL nova.
  const busca = urlDoCatalogo(filtros);

  return (
    <div className="flex w-full max-w-[1140px] flex-col gap-3 px-5 pb-7 pt-[22px] md:gap-6 md:px-10 md:pt-8">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col md:gap-0.5">
          <span className="text-small text-ink2 md:hidden">{nome ?? usuario.nome}</span>
          <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Catálogo</h1>
          <span className="hidden text-small text-ink2 md:block">
            {rotuloDoTotal} {total === 1 ? "exclusivo" : "exclusivos"} em Florianópolis
          </span>
        </div>
        <span className="text-tiny text-ink2 md:hidden">{rotuloDoTotal}</span>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
        <FiltrosDoCatalogo
          key={busca}
          tipos={tipos}
          status={status}
          bairros={listas.bairros.map((bairro) => ({ id: Number(bairro.valor), nome: bairro.rotulo }))}
          escolhidos={filtros}
          manter={{ tipo: filtros.tipo, status: filtros.status }}
          ativosNaFolha={filtrosDaFolhaAtivos(filtros)}
          limpar={urlDoCatalogo(filtros, { bairros: [], precoMin: null, precoMax: null, quartos: null })}
        />

        <section aria-label="Imóveis" className="flex min-w-0 flex-1 flex-col gap-3.5 pt-1 md:gap-5 md:pt-0">
          {imoveis.length > 0 ? (
            <ul className="grid gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-5">
              {imoveis.map((imovel, i) => (
                <CardDoCatalogo key={imovel.id} imovel={imovel} prioridade={i < CARDS_PRIORITARIOS} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 py-[30px] text-center md:py-12">
              <p className="text-small text-ink2 md:text-corpo">Nenhum imóvel com esses filtros.</p>
              {filtros.pagina > 1 ? (
                <Link href={urlDoCatalogo(filtros, { pagina: 1 })} className="text-small font-bold text-mar">
                  Voltar para a primeira página
                </Link>
              ) : (
                busca !== "/assinante" && (
                  <Link href="/assinante" className="text-small font-bold text-mar">
                    Ver o catálogo inteiro
                  </Link>
                )
              )}
            </div>
          )}
          <Paginacao filtros={filtros} total={total} />
        </section>
      </div>
    </div>
  );
}

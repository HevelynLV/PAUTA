import Link from "next/link";

import { SeloStatus } from "@/components/ui/SeloStatus";
import type { ImovelNoCatalogo } from "@/lib/catalogo";
import { formatarPreco } from "@/lib/imovel";

// Card do imóvel no catálogo (docs/prototipo/CorCatalogo.dc.html no celular e
// .pcard de SiteCorCatalogo.dc.html no site): foto com o status e o número de
// fotos, preço, bairro, título e quartos, vagas e área.

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

export function resumoDoImovel(imovel: Pick<ImovelNoCatalogo, "quartos" | "vagas" | "area">) {
  return [
    imovel.quartos > 0 && plural(imovel.quartos, "quarto", "quartos"),
    imovel.vagas > 0 && plural(imovel.vagas, "vaga", "vagas"),
    `${imovel.area.toLocaleString("pt-BR")} m²`,
  ].filter((parte): parte is string => Boolean(parte));
}

// prioridade: os primeiros cards da página carregam a foto na hora; os outros, só
// quando chegam perto da tela (economiza dados na rede móvel, RNF14).
export function CardDoCatalogo({ imovel, prioridade = false }: { imovel: ImovelNoCatalogo; prioridade?: boolean }) {
  return (
    <li>
      <Link
        href={`/assinante/imoveis/${imovel.id}`}
        className="flex h-full flex-col overflow-hidden rounded-cartao border border-line bg-card text-ink no-underline md:rounded-pcard md:hover:border-mar"
      >
        <div className="relative flex h-[150px] items-end justify-between bg-[#BFD3CD] p-3 md:h-[180px] md:items-start">
          {imovel.capa && (
            // A miniatura já vem do tamanho certo (640 px), com link temporário do
            // bucket privado: o otimizador do Next não ajuda aqui.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imovel.capa}
              alt=""
              loading={prioridade ? "eager" : "lazy"}
              fetchPriority={prioridade ? "high" : "auto"}
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          )}
          <span className="relative">
            <SeloStatus status={imovel.status} />
          </span>
          <span className="relative rounded-full bg-ink/65 px-2.5 py-[3px] text-tiny font-bold text-white">
            {plural(imovel.fotos, "foto", "fotos")}
          </span>
        </div>
        <div className="flex flex-col gap-1 px-3.5 pb-3.5 pt-3 md:px-4 md:pb-4 md:pt-3.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <span className="font-display text-[19px] font-bold tracking-[-0.01em] md:text-[20px]">
              {formatarPreco(imovel.preco)}
            </span>
            <span className="truncate text-tiny text-ink2 md:hidden">{imovel.bairro}</span>
          </div>
          <b>{imovel.titulo}</b>
          <span className="hidden text-small text-ink2 md:block">{imovel.bairro}</span>
          <span className="flex flex-wrap gap-x-3.5 text-small text-ink2 md:mt-1">
            {resumoDoImovel(imovel).map((parte) => (
              <span key={parte}>{parte}</span>
            ))}
          </span>
        </div>
      </Link>
    </li>
  );
}

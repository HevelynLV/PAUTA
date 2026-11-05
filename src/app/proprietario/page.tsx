import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BotaoApagarImovel } from "@/components/imovel/BotaoApagarImovel";
import { AbasDoProprietario } from "@/components/visita/AbasDoProprietario";
import { classesBotao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { SeloStatus, type Status } from "@/components/ui/SeloStatus";
import { exigirTipo } from "@/lib/auth";
import { formatarData, formatarPreco } from "@/lib/imovel";
import { imoveisDoDono, type ImovelNaLista } from "@/lib/imoveis";
import { pedidosParaConfirmar } from "@/lib/visitas";

export const metadata: Metadata = { title: "Meus imóveis" };

// "Meus imóveis" (ProImoveis no celular, SiteProImoveis no computador): os imóveis
// do proprietário com o status de cada um. "Em negociação" e "contrato em análise"
// chegam com as propostas e os contratos (Etapas 8 e 9); editar e reenviar, no 4.6.
export default function MeusImoveis({ searchParams }: PageProps<"/proprietario">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}

async function Conteudo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const usuario = await exigirTipo("proprietario");
  const [imoveis, pedidos, { apagado }] = await Promise.all([
    imoveisDoDono(usuario.id),
    pedidosParaConfirmar(new Date()),
    searchParams,
  ]);

  return (
    <div className="flex w-full max-w-[1140px] flex-col gap-4 px-5 pb-7 pt-[22px] md:gap-6 md:px-10 md:pt-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-small text-ink2">Olá, {usuario.nome}</span>
          <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Meus imóveis</h1>
        </div>
        <Link href="/proprietario/imoveis/novo" className={classesBotao({ tamanho: "pequeno" })}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-width:2]">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="md:hidden">Novo</span>
          <span className="hidden md:inline">Cadastrar imóvel</span>
        </Link>
      </div>

      <AbasDoProprietario aba="imoveis" paraConfirmar={[...pedidos.values()].reduce((soma, n) => soma + n, 0)} />

      {apagado === "1" && (
        <p role="status" className="rounded-[14px] bg-mar-soft px-3.5 py-3 text-small text-mar-dark">
          O imóvel e as fotos dele foram apagados.
        </p>
      )}

      {imoveis.length === 0 ? (
        <Cartao>
          <b>Você ainda não cadastrou nenhum imóvel</b>
          <p className="text-small text-ink2">
            Cadastre o imóvel com fotos e aceite o termo de exclusividade. A equipe PAUTA confere antes de ele entrar no catálogo.
          </p>
        </Cartao>
      ) : (
        <ul className="flex flex-col gap-2.5 md:grid md:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] md:gap-5">
          {imoveis.map((imovel) => (
            <CartaoDoImovel key={imovel.id} imovel={imovel} paraConfirmar={pedidos.get(imovel.id) ?? 0} />
          ))}
        </ul>
      )}
    </div>
  );
}

const seloDo: Record<ImovelNaLista["status"], Status> = {
  rascunho: "rascunho",
  pendente: "pendente",
  reprovado: "reprovado",
  captado: "captado",
  disponivel: "disponivel",
  vendido: "vendido",
  expirado: "expirado",
};

const podeApagar = (status: ImovelNaLista["status"]) => ["rascunho", "pendente", "reprovado"].includes(status);

function CartaoDoImovel({ imovel, paraConfirmar }: { imovel: ImovelNaLista; paraConfirmar: number }) {
  // O rascunho continua o cadastro (a partir das fotos); os outros abrem a página do imóvel.
  // O captado abre o aceite do termo (passo 4.7).
  const destino =
    imovel.status === "rascunho"
      ? `/proprietario/imoveis/${imovel.id}/fotos`
      : imovel.status === "captado"
        ? `/proprietario/imoveis/${imovel.id}/aceitar`
        : `/proprietario/imoveis/${imovel.id}`;
  const resumo = [formatarPreco(imovel.preco), imovel.bairro, imovel.quartos > 0 ? `${imovel.quartos} ${imovel.quartos === 1 ? "quarto" : "quartos"}` : `${imovel.area.toLocaleString("pt-BR")} m²`]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="relative flex gap-3 rounded-cartao border border-line bg-card p-3 md:flex-col md:gap-0 md:overflow-hidden md:rounded-pcard md:p-0 md:hover:border-mar">
      <div
        className="size-[88px] shrink-0 rounded-foto bg-[#BFD3CD] bg-cover bg-center md:flex md:h-[180px] md:w-full md:items-start md:rounded-none md:p-3"
        style={imovel.capa ? { backgroundImage: `url("${imovel.capa}")` } : undefined}
      >
        <span className="hidden md:inline-flex">
          <SeloStatus status={seloDo[imovel.status]}>{imovel.status === "captado" ? "Aguardando seu aceite" : undefined}</SeloStatus>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 md:px-4 md:pb-4 md:pt-3.5">
        <span className="md:hidden">
          <SeloStatus status={seloDo[imovel.status]}>{imovel.status === "captado" ? "Aguardando seu aceite" : undefined}</SeloStatus>
        </span>
        {/* O link cobre o cartão inteiro (after:inset-0); os botões ficam por cima. */}
        <Link href={destino} className="font-bold text-ink no-underline after:absolute after:inset-0 after:content-['']">
          {imovel.titulo}
        </Link>
        <span className="text-small text-ink2">{resumo}</span>

        {imovel.status === "rascunho" && <span className="text-tiny font-bold text-mar">Continuar o cadastro</span>}
        {imovel.status === "captado" && (
          <span className="text-tiny font-bold text-mar">Cadastrado pela equipe PAUTA · Ler e aceitar o termo</span>
        )}
        {imovel.status === "reprovado" && imovel.motivo_reprovacao && (
          <span className="rounded-[10px] bg-erro-soft px-2.5 py-2 text-tiny text-erro-texto">
            Motivo: {imovel.motivo_reprovacao}
          </span>
        )}
        {imovel.status === "disponivel" && imovel.exclusividade_fim && (
          <span className="text-tiny text-ink2">Exclusividade até {formatarData(imovel.exclusividade_fim)}</span>
        )}
        {imovel.status === "vendido" && <span className="text-tiny text-ink2">Não aparece mais no catálogo.</span>}
        {paraConfirmar > 0 && (
          <span className="text-tiny font-bold text-mar">
            {paraConfirmar} {paraConfirmar === 1 ? "visita" : "visitas"} para confirmar
          </span>
        )}

        {(imovel.status === "pendente" || imovel.status === "reprovado" || imovel.status === "rascunho") && (
          <div className="relative z-10 flex flex-wrap gap-x-3.5 self-start">
            {imovel.status !== "rascunho" && (
              <Link href={`/proprietario/imoveis/${imovel.id}/editar`} className="flex min-h-11 items-center text-small font-bold text-mar no-underline">
                Editar
              </Link>
            )}
            {/* O reenvio é um passo explícito, na tela de edição (editar não reenvia sozinho). */}
            {imovel.status === "reprovado" && (
              <Link href={`/proprietario/imoveis/${imovel.id}/editar`} className="flex min-h-11 items-center text-small font-bold text-mar no-underline">
                Reenviar
              </Link>
            )}
            {podeApagar(imovel.status) && <BotaoApagarImovel id={imovel.id} titulo={imovel.titulo} fotos={imovel.fotos} />}
          </div>
        )}
      </div>
    </li>
  );
}

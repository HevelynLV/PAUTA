import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { classesBotao } from "@/components/ui/Botao";
import { SeloStatus, type Status } from "@/components/ui/SeloStatus";
import { ListaDePropostas } from "@/components/proposta/CartaoDeProposta";
import { ListaDeVisitas } from "@/components/visita/CartaoDeVisita";
import { exigirTipo } from "@/lib/auth";
import { diaDe, instanteDe } from "@/lib/horariosDeVisita";
import { formatarData, formatarPreco } from "@/lib/imovel";
import { capaDoImovel, imovelDoDono, type StatusImovel } from "@/lib/imoveis";
import { propostasRecebidas, resumoDePropostas } from "@/lib/propostas";
import { agendaDeVisitas } from "@/lib/visitas";

import { ContatoDoImovel } from "./ContatoDoImovel";

export const metadata: Metadata = { title: "Imóvel" };

// Página do imóvel do proprietário (ProImovel e SiteProImovel): o "Editar", a foto de
// capa, os dados, a exclusividade, a escolha de mostrar o contato (RF13), as visitas e
// as propostas daquele imóvel. No celular são abas (?aba=propostas); no site, duas colunas.
export default function PaginaDoImovel({ params, searchParams }: PageProps<"/proprietario/imoveis/[id]">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const seloDo: Record<StatusImovel, Status> = {
  rascunho: "rascunho",
  pendente: "pendente",
  reprovado: "reprovado",
  captado: "captado",
  disponivel: "disponivel",
  vendido: "vendido",
  expirado: "expirado",
};

async function Conteudo({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usuario = await exigirTipo("proprietario");
  const [{ id }, { publicado, aba }] = await Promise.all([params, searchParams]);
  const [imovel, capa] = await Promise.all([imovelDoDono(id, usuario.id), capaDoImovel(id)]);
  if (!imovel) notFound();
  // O rascunho ainda está no cadastro: segue de onde parou.
  if (imovel.status === "rascunho") redirect(`/proprietario/imoveis/${id}/fotos`);
  // O captado ainda espera o aceite do termo (passo 4.7).
  if (imovel.status === "captado") redirect(`/proprietario/imoveis/${id}/aceitar`);

  // Depois de vendido, o contato não muda mais nada (o imóvel saiu do catálogo).
  const podeMudarContato = ["pendente", "reprovado", "disponivel"].includes(imovel.status);

  // Só imóvel que passou pelo catálogo tem visitas. Do dia de hoje em diante.
  const agora = new Date();
  const passouPeloCatalogo = ["disponivel", "vendido", "expirado"].includes(imovel.status);
  const [visitas, propostas, resumo] = passouPeloCatalogo
    ? await Promise.all([
        agendaDeVisitas({ imovelId: id, de: instanteDe(diaDe(agora), "00:00") }),
        propostasRecebidas(id),
        resumoDePropostas(id),
      ])
    : [null, null, null];
  const selo: Status = resumo?.get(id)?.emNegociacao ? "negociacao" : seloDo[imovel.status];
  const abaPropostas = aba === "propostas";

  return (
    <div className="flex flex-col pb-7 md:px-10 md:pt-8">
      <nav aria-label="Caminho" className="hidden items-center gap-1.5 text-small text-ink2 md:flex">
        <Link href="/proprietario" className="text-ink2 no-underline hover:text-mar">
          Meus imóveis
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate">{imovel.titulo}</span>
      </nav>

      <div className="flex w-full max-w-[1040px] flex-col md:mt-4 md:gap-5">
        <div
          className="flex h-[200px] items-start justify-between bg-[#BFD3CD] bg-cover bg-center px-5 py-4 md:h-[320px] md:justify-end md:rounded-pcard"
          style={capa ? { backgroundImage: `url("${capa}")` } : undefined}
        >
          <Link
            href="/proprietario"
            aria-label="Voltar"
            className="flex size-11 shrink-0 items-center justify-center rounded-botao border border-line bg-card text-ink md:hidden"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          {podeMudarContato && (
            <Link href={`/proprietario/imoveis/${id}/editar`} className={classesBotao({ variante: "secundario", tamanho: "pequeno" })}>
              {imovel.status === "reprovado" ? "Editar e reenviar" : "Editar"}
            </Link>
          )}
        </div>

        <div className="flex flex-col gap-4 px-5 pt-[18px] md:px-0 md:pt-0">
          {publicado === "1" && imovel.status === "disponivel" && (
            <p role="status" className="rounded-[14px] bg-mar-soft px-3.5 py-3 text-small text-mar-dark">
              Termo aceito. O imóvel já está no catálogo para os corretores assinantes.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <SeloStatus status={selo} />
            <h1 className="font-display text-[24px] font-bold leading-[1.15] tracking-[-0.01em] md:text-t1">{imovel.titulo}</h1>
            <span className="text-small text-ink2">
              {imovel.endereco} · {imovel.bairro} · {formatarPreco(imovel.preco)}
            </span>
            {imovel.status === "disponivel" && imovel.exclusividade_fim && (
              <span className="text-tiny text-ink2">
                Exclusividade PAUTA até {formatarData(imovel.exclusividade_fim)}
              </span>
            )}
            {imovel.status === "pendente" && (
              <span className="text-tiny text-ink2">
                A equipe PAUTA está conferindo. A exclusividade de 6 meses começa quando ele for aprovado.
              </span>
            )}
          </div>

          {imovel.status === "reprovado" && imovel.motivo_reprovacao && (
            <p className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
              <b>Motivo da equipe PAUTA:</b> {imovel.motivo_reprovacao}
            </p>
          )}

          {podeMudarContato && <ContatoDoImovel id={imovel.id} mostrar={imovel.mostrar_contato} />}

          {visitas && propostas && (
            <>
              <nav aria-label="Visitas e propostas" className="flex gap-1 border-b border-line md:hidden">
                <AbaDoImovel href={`/proprietario/imoveis/${id}`} ligada={!abaPropostas} rotulo="Visitas" total={visitas.length} />
                <AbaDoImovel href={`/proprietario/imoveis/${id}?aba=propostas`} ligada={abaPropostas} rotulo="Propostas" total={propostas.length} />
              </nav>
              <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start md:gap-6">
                <section className={`${abaPropostas ? "hidden md:flex" : "flex"} min-w-0 flex-col gap-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-t2 font-bold tracking-[-0.01em]">Visitas</h2>
                    <Link href="/proprietario/visitas" className="text-small font-bold text-mar">
                      Ver agenda
                    </Link>
                  </div>
                  {visitas.length === 0 ? (
                    <p className="text-small text-ink2">Nenhum pedido de visita por enquanto.</p>
                  ) : (
                    <ListaDeVisitas visitas={visitas} agora={agora} comImovel={false} />
                  )}
                </section>
                <section className={`${abaPropostas ? "flex" : "hidden md:flex"} min-w-0 flex-col gap-3`}>
                  <div className="flex flex-col gap-1">
                    <h2 className="font-display text-t2 font-bold tracking-[-0.01em]">Propostas</h2>
                    <p className="text-tiny text-ink2">
                      Você pode aceitar mais de uma. Com uma aceita, o imóvel aparece como &quot;em negociação&quot; no catálogo.
                    </p>
                  </div>
                  {propostas.length === 0 ? (
                    <p className="text-small text-ink2">Nenhuma proposta por enquanto.</p>
                  ) : (
                    <ListaDePropostas propostas={propostas} noCatalogo={imovel.status === "disponivel"} />
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AbaDoImovel({ href, ligada, rotulo, total }: { href: string; ligada: boolean; rotulo: string; total: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={ligada ? "page" : undefined}
      className={`flex min-h-11 flex-1 items-center justify-center gap-2 border-b-[3px] text-small font-bold no-underline ${
        ligada ? "border-mar text-ink" : "border-transparent text-ink2"
      }`}
    >
      {rotulo}
      <span className="rounded-full bg-cinza-soft px-1.5 text-tiny text-ink2">{total}</span>
    </Link>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BotaoRetirarProposta } from "@/components/proposta/BotaoRetirarProposta";
import { Cartao } from "@/components/ui/Cartao";
import { classesBotao } from "@/components/ui/Botao";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { BotaoCancelarVisita } from "@/components/visita/BotaoCancelarVisita";
import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { formatarHorario, seloDaVisita } from "@/lib/horariosDeVisita";
import { formatarData, formatarPreco } from "@/lib/imovel";
import { propostaEmAberto, rotuloDaForma, seloDaProposta } from "@/lib/proposta";
import { minhasPropostas, type PropostaDoCorretor } from "@/lib/propostas";
import { minhasVisitas, type VisitaDoCorretor } from "@/lib/visitas";

import { cancelarMinhaVisita } from "../visitas/acoes";

export const metadata: Metadata = { title: "Negociações" };

// Negociações do corretor (CorNegociacoes e SiteCorNegociacoes), com as abas Propostas
// e Visitas na URL. Propostas: a mais nova no topo; no celular são cartões, no site as
// mesmas linhas viram a tabela do protótipo. Visitas: primeiro as por vir, a mais
// próxima no topo; depois as anteriores, a mais recente no topo.
// "Enviar contrato assinado" entra na Etapa 9.
export default function Negociacoes({ searchParams }: PageProps<"/assinante/negociacoes">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}

async function Conteudo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirTipo(TIPOS_ASSINANTE);
  const [{ aba }, visitas, propostas] = await Promise.all([searchParams, minhasVisitas(), minhasPropostas()]);
  const agora = new Date();
  const abaVisitas = aba === "visitas";

  const emAberto = (visita: VisitaDoCorretor) =>
    ["pendente", "confirmada"].includes(visita.status) && new Date(visita.horario) > agora;
  const proximas = visitas.filter(emAberto).reverse();
  const anteriores = visitas.filter((visita) => !emAberto(visita));
  const imoveisComProposta = new Set(
    propostas.filter((proposta) => propostaEmAberto(proposta.status)).map((proposta) => proposta.imovel_id),
  );

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-4 px-5 pb-7 pt-[22px] md:gap-6 md:px-10 md:pt-8">
      <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Negociações</h1>

      <nav aria-label="Negociações" className="flex gap-1 border-b border-line">
        <Aba href="/assinante/negociacoes" ligada={!abaVisitas} rotulo="Propostas" total={propostas.length} />
        <Aba href="/assinante/negociacoes?aba=visitas" ligada={abaVisitas} rotulo="Visitas" total={visitas.length} />
      </nav>

      {!abaVisitas ? (
        propostas.length === 0 ? (
          <Vazio titulo="Você ainda não enviou propostas" texto="Abra um imóvel do catálogo e envie sua proposta. O proprietário aceita ou recusa pelo app." />
        ) : (
          <TabelaDePropostas propostas={propostas} />
        )
      ) : visitas.length === 0 ? (
        <Vazio titulo="Você ainda não agendou visitas" texto="Abra um imóvel do catálogo e escolha um horário. O proprietário confirma ou recusa pelo app." />
      ) : (
        <>
          <Secao titulo="Próximas visitas" visitas={proximas} agora={agora} imoveisComProposta={imoveisComProposta} vazio="Nenhuma visita por vir." />
          {anteriores.length > 0 && <Secao titulo="Anteriores" visitas={anteriores} agora={agora} imoveisComProposta={imoveisComProposta} />}
        </>
      )}
    </div>
  );
}

function Aba({ href, ligada, rotulo, total }: { href: string; ligada: boolean; rotulo: string; total: number }) {
  return (
    <Link
      href={href}
      aria-current={ligada ? "page" : undefined}
      className={`flex min-h-11 flex-1 items-center justify-center gap-2 border-b-[3px] text-small font-bold no-underline md:flex-none md:px-5 ${
        ligada ? "border-mar text-ink" : "border-transparent text-ink2"
      }`}
    >
      {rotulo}
      <span className="rounded-full bg-cinza-soft px-1.5 text-tiny text-ink2">{total}</span>
    </Link>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <Cartao>
      <b>{titulo}</b>
      <p className="text-small text-ink2">{texto}</p>
      <Link href="/assinante" className={`${classesBotao({ variante: "secundario", tamanho: "pequeno" })} self-start`}>
        Ver o catálogo
      </Link>
    </Cartao>
  );
}

const COLUNAS = "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_170px_170px]";

function TabelaDePropostas({ propostas }: { propostas: PropostaDoCorretor[] }) {
  return (
    <div className="md:overflow-hidden md:rounded-cartao md:border md:border-line md:bg-card">
      <div aria-hidden="true" className={`hidden gap-3 px-4 py-3 text-tiny font-bold text-ink2 md:grid ${COLUNAS}`}>
        <span>Imóvel</span>
        <span>Sua proposta</span>
        <span>Status</span>
        <span className="text-right">Próximo passo</span>
      </div>
      <ul className="flex flex-col gap-3 md:gap-0">
        {propostas.map((proposta) => (
          <LinhaDaProposta
            key={proposta.id}
            proposta={proposta}
            // A lista vem da mais nova para a mais antiga.
            maisRecente={propostas.find((outra) => outra.imovel_id === proposta.imovel_id)?.id === proposta.id}
          />
        ))}
      </ul>
    </div>
  );
}

function LinhaDaProposta({ proposta, maisRecente }: { proposta: PropostaDoCorretor; maisRecente: boolean }) {
  const selo = seloDaProposta(proposta.status, "corretor");
  const valor = formatarPreco(proposta.valor);
  const aberta = propostaEmAberto(proposta.status);

  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 rounded-cartao border border-line bg-card p-4 md:items-start md:gap-3 md:rounded-none md:border-0 md:border-t ${COLUNAS}`}
    >
      <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-0.5">
        {/* Só imóvel do catálogo leva à página: o que saiu não abre mais. */}
        {proposta.no_catalogo ? (
          <Link href={`/assinante/imoveis/${proposta.imovel_id}`} className="font-bold text-ink no-underline">
            {proposta.titulo}
          </Link>
        ) : (
          <b>{proposta.titulo}</b>
        )}
        <span className="text-tiny text-ink2 [overflow-wrap:anywhere]">{proposta.condicoes}</span>
        {proposta.nome_comprador && <span className="text-tiny text-ink2 [overflow-wrap:anywhere]">Comprador: {proposta.nome_comprador}</span>}
      </div>
      <div className="col-start-2 row-start-1 md:col-start-3">
        <SeloStatus status={selo.status}>{selo.rotulo}</SeloStatus>
      </div>
      <div className="col-span-2 flex flex-wrap gap-x-1 text-small md:col-span-1 md:col-start-2 md:row-start-1 md:flex-col">
        <span>
          <span className="md:hidden">Sua proposta: </span>
          <b>{valor}</b>
        </span>
        <span className="text-ink2 md:text-tiny">
          <span aria-hidden="true" className="md:hidden">
            ·{" "}
          </span>
          {rotuloDaForma(proposta.forma_pagamento)}
        </span>
      </div>
      <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1 md:col-start-4 md:row-start-1 md:items-end md:text-right">
        {proposta.status === "aceita" && proposta.respondida_em && (
          <span className="text-tiny text-ink2">
            Aceita pelo proprietário em {formatarData(proposta.respondida_em)}. O contrato é assinado fora do PAUTA.
          </span>
        )}
        {!aberta && maisRecente && proposta.no_catalogo && (
          <Link href={`/assinante/imoveis/${proposta.imovel_id}?proposta=1`} className="text-small font-bold text-mar">
            Enviar outra proposta
          </Link>
        )}
        {aberta && proposta.no_catalogo && (
          <div className="self-start md:self-end">
            <BotaoRetirarProposta id={proposta.id} valor={valor} aceita={proposta.status === "aceita"} />
          </div>
        )}
      </div>
    </li>
  );
}

function Secao({
  titulo,
  visitas,
  agora,
  imoveisComProposta,
  vazio,
}: {
  titulo: string;
  visitas: VisitaDoCorretor[];
  agora: Date;
  imoveisComProposta: Set<string>;
  vazio?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-t2 font-bold tracking-[-0.01em]">{titulo}</h2>
      {visitas.length === 0 ? (
        <p className="text-small text-ink2">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visitas.map((visita) => (
            <li key={visita.id}>
              <CartaoDaVisita visita={visita} agora={agora} temProposta={imoveisComProposta.has(visita.imovel_id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CartaoDaVisita({ visita, agora, temProposta }: { visita: VisitaDoCorretor; agora: Date; temProposta: boolean }) {
  const selo = seloDaVisita(visita.status, visita.horario, agora, "corretor");
  const quando = formatarHorario(visita.horario);
  const aberta = ["pendente", "confirmada"].includes(visita.status) && new Date(visita.horario) > agora;

  return (
    <Cartao>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Só a visita em aberto leva ao imóvel: o que saiu do catálogo não abre mais. */}
        {aberta ? (
          <Link href={`/assinante/imoveis/${visita.imovel_id}`} className="font-bold text-ink no-underline">
            {visita.titulo}
          </Link>
        ) : (
          <b>{visita.titulo}</b>
        )}
        <SeloStatus status={selo.status}>{selo.rotulo}</SeloStatus>
      </div>
      <span className="text-small">{quando}</span>
      <span className="text-tiny text-ink2">
        {visita.endereco} · {visita.bairro}
      </span>
      {visita.status === "pendente" && aberta && <span className="text-tiny text-ink2">Esperando a confirmação do proprietário</span>}
      {(aberta || (visita.status === "confirmada" && visita.no_catalogo && !temProposta)) && (
        <div className="flex flex-wrap gap-2.5 self-start">
          {visita.status === "confirmada" && visita.no_catalogo && !temProposta && (
            <Link href={`/assinante/imoveis/${visita.imovel_id}?proposta=1`} className={classesBotao({ tamanho: "pequeno" })}>
              Enviar proposta
            </Link>
          )}
          {aberta && <BotaoCancelarVisita id={visita.id} horario={quando} acao={cancelarMinhaVisita} />}
        </div>
      )}
    </Cartao>
  );
}

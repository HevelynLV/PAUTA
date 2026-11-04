import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Cartao } from "@/components/ui/Cartao";
import { classesBotao } from "@/components/ui/Botao";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { BotaoCancelarVisita } from "@/components/visita/BotaoCancelarVisita";
import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { formatarHorario, seloDaVisita } from "@/lib/horariosDeVisita";
import { minhasVisitas, type VisitaDoCorretor } from "@/lib/visitas";

import { cancelarMinhaVisita } from "../visitas/acoes";

export const metadata: Metadata = { title: "Negociações" };

// Negociações do corretor (CorNegociacoes e SiteCorNegociacoes). Por enquanto só as
// visitas: a aba Propostas entra na Etapa 8. Primeiro as visitas por vir, a mais
// próxima no topo; depois as anteriores, a mais recente no topo.
export default function Negociacoes() {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  await exigirTipo(TIPOS_ASSINANTE);
  const visitas = await minhasVisitas();
  const agora = new Date();

  const emAberto = (visita: VisitaDoCorretor) =>
    ["pendente", "confirmada"].includes(visita.status) && new Date(visita.horario) > agora;
  const proximas = visitas.filter(emAberto).reverse();
  const anteriores = visitas.filter((visita) => !emAberto(visita));

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-4 px-5 pb-7 pt-[22px] md:gap-6 md:px-10 md:pt-8">
      <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Negociações</h1>

      {visitas.length === 0 ? (
        <Cartao>
          <b>Você ainda não agendou visitas</b>
          <p className="text-small text-ink2">Abra um imóvel do catálogo e escolha um horário. O proprietário confirma ou recusa pelo app.</p>
          <Link href="/assinante" className={`${classesBotao({ variante: "secundario", tamanho: "pequeno" })} self-start`}>
            Ver o catálogo
          </Link>
        </Cartao>
      ) : (
        <>
          <Secao titulo="Próximas visitas" visitas={proximas} agora={agora} vazio="Nenhuma visita por vir." />
          {anteriores.length > 0 && <Secao titulo="Anteriores" visitas={anteriores} agora={agora} />}
        </>
      )}
    </div>
  );
}

function Secao({
  titulo,
  visitas,
  agora,
  vazio,
}: {
  titulo: string;
  visitas: VisitaDoCorretor[];
  agora: Date;
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
              <CartaoDaVisita visita={visita} agora={agora} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CartaoDaVisita({ visita, agora }: { visita: VisitaDoCorretor; agora: Date }) {
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
      {aberta && (
        <div className="self-start">
          <BotaoCancelarVisita id={visita.id} horario={quando} acao={cancelarMinhaVisita} />
        </div>
      )}
    </Cartao>
  );
}

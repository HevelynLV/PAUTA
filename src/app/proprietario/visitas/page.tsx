import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Cartao } from "@/components/ui/Cartao";
import { AbasDoProprietario } from "@/components/visita/AbasDoProprietario";
import { CalendarioDaAgenda } from "@/components/visita/CalendarioDaAgenda";
import { ListaDeVisitas } from "@/components/visita/CartaoDeVisita";
import { exigirTipo } from "@/lib/auth";
import {
  diaDe,
  diaEMes,
  diaValido,
  formatarHorario,
  horaDe,
  HORARIOS_DE_VISITA,
  inicioDaSemana,
  instanteDe,
  nomeDoDia,
  somarDias,
} from "@/lib/horariosDeVisita";
import { agendaDeVisitas, type VisitaDaAgenda } from "@/lib/visitas";

export const metadata: Metadata = { title: "Visitas" };

// Agenda de visitas do proprietário, com todos os imóveis dele (decisão de 04/11/2026;
// esta tela não existe no protótipo). No computador, a semana com dias e horários; no
// celular, uma faixa com os dias da semana. Abaixo, a lista: as próximas visitas ou,
// com um dia escolhido, as daquele dia. A semana e o dia ficam na URL.
export default function AgendaDeVisitas({ searchParams }: PageProps<"/proprietario/visitas">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}

const estaEmAberto = (visita: VisitaDaAgenda) => visita.status === "pendente" || visita.status === "confirmada";

async function Conteudo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const usuario = await exigirTipo("proprietario");
  const busca = await searchParams;
  const agora = new Date();
  const hoje = diaDe(agora);
  const diaEscolhido = diaValido(busca.dia) ? busca.dia : null;
  const semana = inicioDaSemana(diaEscolhido ?? (diaValido(busca.semana) ? busca.semana : hoje));
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(semana, i));

  const [naSemana, proximas] = await Promise.all([
    agendaDeVisitas({ de: instanteDe(semana, "00:00"), ate: instanteDe(somarDias(semana, 7), "00:00") }),
    agendaDeVisitas({ de: agora.toISOString() }),
  ]);
  const daSemana = naSemana.filter(estaEmAberto);
  const abertas = proximas.filter(estaEmAberto);
  const paraConfirmar = abertas.filter((visita) => visita.status === "pendente").length;
  const lista = diaEscolhido ? daSemana.filter((visita) => diaDe(visita.horario) === diaEscolhido) : abertas;

  const url = (novaSemana: string, dia?: string) => `/proprietario/visitas?semana=${novaSemana}${dia ? `&dia=${dia}` : ""}`;

  return (
    <div className="flex w-full max-w-[1140px] flex-col gap-4 px-5 pb-7 pt-[22px] md:gap-6 md:px-10 md:pt-8">
      <div className="flex flex-col">
        <span className="text-small text-ink2">Olá, {usuario.nome}</span>
        <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Meus imóveis</h1>
      </div>

      <AbasDoProprietario aba="visitas" paraConfirmar={paraConfirmar} />

      <div className="flex items-center justify-between gap-3">
        <CalendarioDaAgenda
          hoje={hoje}
          semana={semana}
          escolhido={diaEscolhido}
          diasComVisita={[...new Set([...abertas, ...daSemana].map((visita) => diaDe(visita.horario)))]}
        />
        <nav aria-label="Semana" className="flex items-center gap-1 text-small font-bold">
          <Link href={url(somarDias(semana, -7))} aria-label="Semana anterior" className="flex size-11 items-center justify-center text-mar no-underline">
            ‹
          </Link>
          <Link href="/proprietario/visitas" className="flex min-h-11 items-center px-1 text-mar no-underline">
            Hoje
          </Link>
          <Link href={url(somarDias(semana, 7))} aria-label="Próxima semana" className="flex size-11 items-center justify-center text-mar no-underline">
            ›
          </Link>
        </nav>
      </div>

      <FaixaDeDias dias={dias} hoje={hoje} escolhido={diaEscolhido} visitas={daSemana} url={(dia) => url(semana, dia)} />
      <GradeDaSemana dias={dias} hoje={hoje} escolhido={diaEscolhido} visitas={daSemana} url={(dia) => url(semana, dia)} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-t2 font-bold tracking-[-0.01em]">
            {diaEscolhido ? `Visitas de ${nomeDoDia(diaEscolhido).toLowerCase()}, ${diaEMes(diaEscolhido)}` : "Próximas visitas"}
          </h2>
          {diaEscolhido && (
            <Link href={url(semana)} className="text-small font-bold text-mar">
              Ver todas
            </Link>
          )}
        </div>
        {lista.length === 0 ? (
          <Cartao>
            <p className="text-small text-ink2">
              {diaEscolhido ? "Nenhuma visita neste dia." : "Quando um corretor pedir uma visita, ela aparece aqui para você confirmar ou recusar."}
            </p>
          </Cartao>
        ) : (
          <ListaDeVisitas visitas={lista} agora={agora} comImovel />
        )}
      </section>
    </div>
  );
}

// Celular: os 7 dias, com um ponto nos dias que têm visita.
function FaixaDeDias({
  dias,
  hoje,
  escolhido,
  visitas,
  url,
}: {
  dias: string[];
  hoje: string;
  escolhido: string | null;
  visitas: VisitaDaAgenda[];
  url: (dia: string) => string;
}) {
  return (
    <ul aria-label="Dias da semana" className="grid grid-cols-7 gap-1 md:hidden">
      {dias.map((dia) => {
        const ligado = dia === escolhido;
        const quantas = visitas.filter((visita) => diaDe(visita.horario) === dia).length;
        return (
          <li key={dia}>
            <Link
              href={url(dia)}
              aria-current={ligado ? "date" : undefined}
              aria-label={`${nomeDoDia(dia)}, ${diaEMes(dia)}, ${quantas === 1 ? "1 visita" : `${quantas} visitas`}`}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-[12px] border no-underline ${
                ligado ? "border-ink bg-ink text-white" : dia === hoje ? "border-mar bg-card text-ink" : "border-line bg-card text-ink"
              }`}
            >
              <span className="text-[11px]">{nomeDoDia(dia)}</span>
              <b className="text-corpo">{Number(dia.slice(8, 10))}</b>
              <span aria-hidden="true" className={`size-1.5 rounded-full ${quantas > 0 ? (ligado ? "bg-white" : "bg-mar") : "bg-transparent"}`} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Computador: a semana estilo agenda. Cada visita é um link para o dia dela. Linhas
// nos horários fixos e em qualquer outro horário que exista no banco, para nenhuma
// visita ficar de fora.
function GradeDaSemana({
  dias,
  hoje,
  escolhido,
  visitas,
  url,
}: {
  dias: string[];
  hoje: string;
  escolhido: string | null;
  visitas: VisitaDaAgenda[];
  url: (dia: string) => string;
}) {
  const horas = [...new Set([...HORARIOS_DE_VISITA, ...visitas.map((visita) => horaDe(visita.horario))])].sort();
  return (
    <div className="hidden overflow-hidden rounded-cartao border border-line bg-card md:block">
      <div role="table" aria-label="Agenda da semana" className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
        <div role="row" className="contents">
          <span role="columnheader" className="border-b border-line" />
          {dias.map((dia) => (
            <span
              key={dia}
              role="columnheader"
              aria-current={dia === escolhido ? "date" : undefined}
              className={`border-b border-l border-line py-2 text-center text-tiny ${dia === hoje ? "font-bold text-mar" : "text-ink2"} ${
                dia === escolhido ? "bg-mar-soft" : ""
              }`}
            >
              {nomeDoDia(dia)} {Number(dia.slice(8, 10))}
            </span>
          ))}
        </div>
        {horas.map((hora) => (
          <div key={hora} role="row" className="contents">
            <span role="rowheader" className="border-b border-line px-1.5 pt-1.5 text-right text-tiny text-ink2">
              {hora}
            </span>
            {dias.map((dia) => (
              <div key={dia} role="cell" className="flex min-h-12 flex-col gap-1 border-b border-l border-line p-1">
                {visitas
                  .filter((visita) => diaDe(visita.horario) === dia && horaDe(visita.horario) === hora)
                  .map((visita) => (
                    <Link
                      key={visita.id}
                      href={url(dia)}
                      title={`${formatarHorario(visita.horario)} · ${visita.imovel_titulo} · ${visita.corretor_nome}`}
                      className={`block rounded-[7px] px-1.5 py-1 text-[11px] leading-tight no-underline ${
                        visita.status === "confirmada" ? "bg-mar-soft text-mar-dark" : "bg-areia-soft text-areia"
                      }`}
                    >
                      <b className="block truncate">{visita.corretor_nome}</b>
                      <span className="block truncate">{visita.imovel_titulo}</span>
                    </Link>
                  ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-4 border-t border-line px-3 py-2 text-tiny text-ink2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-mar-soft" /> Confirmada
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-areia-soft" /> Para confirmar
        </span>
      </div>
    </div>
  );
}

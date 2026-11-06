"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Botao } from "@/components/ui/Botao";
import { icones } from "@/components/ui/icones";
import { diaEMes, diasDoMes, inicioDaSemana, mesDe, nomeDoDia, nomeDoMes, somarDias, somarMeses, tituloDoPeriodo } from "@/lib/horariosDeVisita";

const SEMANA = ["S", "T", "Q", "Q", "S", "S", "D"];

// Até onde o calendário vai, para os lados: a agenda não precisa de mais que isso, e
// assim nenhum dia cai fora do que diaValido() aceita na URL.
const ANOS_PARA_OS_LADOS = 5;

const classesDaSeta =
  "flex size-11 cursor-pointer items-center justify-center text-corpo font-bold text-mar disabled:cursor-not-allowed disabled:text-[#A9B5B1]";

// Calendário para pular para qualquer semana (decisão de 05/11/2026): o mês com a
// semana aberta em destaque e um ponto nos dias com visita em aberto; clicando no
// nome do mês, os 12 meses e o ano. Cada dia é um link: a semana e o dia continuam na
// URL, como na faixa de dias e na grade.
//
// O <dialog> é o mesmo do apagar imóvel: folha de baixo no celular, janela no site.
// "hoje" vem do servidor, para o navegador desenhar igual a ele.
export function CalendarioDaAgenda({
  hoje,
  semana,
  escolhido,
  diasComVisita,
}: {
  hoje: string;
  semana: string;
  escolhido: string | null;
  diasComVisita: string[];
}) {
  const janela = useRef<HTMLDialogElement>(null);
  const [mes, setMes] = useState(mesDe(escolhido ?? semana));
  const [escolhendoMes, setEscolhendoMes] = useState(false);

  const ano = Number(mes.slice(0, 4));
  const numeroDoMes = Number(mes.slice(5, 7));
  const anoDeHoje = Number(hoje.slice(0, 4));
  const primeiroMes = `${anoDeHoje - ANOS_PARA_OS_LADOS}-01`;
  const ultimoMes = `${anoDeHoje + ANOS_PARA_OS_LADOS}-12`;
  const fimDaSemana = somarDias(semana, 6);

  function abrir() {
    setMes(mesDe(escolhido ?? semana));
    setEscolhendoMes(false);
    janela.current?.showModal();
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-label={`Abrir calendário, semana de ${diaEMes(semana)} a ${diaEMes(fimDaSemana)}`}
        className="-mx-1.5 flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[10px] px-1.5 font-display text-t2 font-bold tracking-[-0.01em] hover:bg-mar-soft"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0 fill-none stroke-mar stroke-2">
          {icones.calendario}
        </svg>
        {diaEMes(semana)} a {diaEMes(fimDaSemana)}
      </button>

      <dialog
        ref={janela}
        aria-labelledby="titulo-calendario"
        // Clicar fora fecha, como nas agendas: nada aqui se perde ao fechar.
        onClick={(evento) => {
          if (evento.target === janela.current) janela.current?.close();
        }}
        className="mb-0 mt-auto w-full max-w-none rounded-t-folha bg-card p-0 text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[380px] md:rounded-modal"
      >
        <div className="flex flex-col gap-3 px-5 pt-5 pb-[max(22px,env(safe-area-inset-bottom))] md:p-6">
          <h2 id="titulo-calendario" className="font-display text-t2 font-bold tracking-[-0.01em]">
            Escolher semana
          </h2>

          {escolhendoMes ? (
            <>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Ano anterior"
                  disabled={`${ano - 1}-12` < primeiroMes}
                  onClick={() => setMes(somarMeses(mes, -12))}
                  className={classesDaSeta}
                >
                  ‹
                </button>
                <b aria-live="polite">{ano}</b>
                <button
                  type="button"
                  aria-label="Próximo ano"
                  disabled={`${ano + 1}-01` > ultimoMes}
                  onClick={() => setMes(somarMeses(mes, 12))}
                  className={classesDaSeta}
                >
                  ›
                </button>
              </div>
              <div role="group" aria-label="Mês" className="grid grid-cols-3 gap-2">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((numero) => {
                  const ligado = numero === numeroDoMes;
                  return (
                    <button
                      key={numero}
                      type="button"
                      aria-pressed={ligado}
                      onClick={() => {
                        setMes(`${ano}-${String(numero).padStart(2, "0")}`);
                        setEscolhendoMes(false);
                      }}
                      className={`min-h-11 cursor-pointer rounded-botao-sm border text-small ${
                        ligado ? "border-ink bg-ink font-bold text-white" : "border-line bg-card hover:bg-mar-soft"
                      }`}
                    >
                      {nomeDoMes(numero)}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Mês anterior"
                  disabled={mes <= primeiroMes}
                  onClick={() => setMes(somarMeses(mes, -1))}
                  className={classesDaSeta}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Escolher mês e ano"
                  onClick={() => setEscolhendoMes(true)}
                  className="min-h-11 cursor-pointer rounded-[10px] px-2 font-bold hover:bg-mar-soft"
                >
                  {tituloDoPeriodo(`${mes}-01`, `${mes}-01`)}
                </button>
                <button
                  type="button"
                  aria-label="Próximo mês"
                  disabled={mes >= ultimoMes}
                  onClick={() => setMes(somarMeses(mes, 1))}
                  className={classesDaSeta}
                >
                  ›
                </button>
              </div>

              <div className="grid grid-cols-7">
                {SEMANA.map((letra, i) => (
                  <span key={i} aria-hidden="true" className="pb-1 text-center text-tiny text-ink2">
                    {letra}
                  </span>
                ))}
                {diasDoMes(mes).map((dia) => {
                  const ligado = dia === escolhido;
                  const naSemana = inicioDaSemana(dia) === semana;
                  const temVisita = diasComVisita.includes(dia);
                  return (
                    <Link
                      key={dia}
                      href={`/proprietario/visitas?semana=${inicioDaSemana(dia)}&dia=${dia}`}
                      onClick={() => janela.current?.close()}
                      aria-current={dia === hoje ? "date" : undefined}
                      aria-label={`${nomeDoDia(dia)}, ${diaEMes(dia)}${temVisita ? ", com visita" : ""}`}
                      className={`flex h-11 flex-col items-center justify-center text-small no-underline ${
                        ligado
                          ? "rounded-[10px] bg-mar font-bold text-white"
                          : naSemana
                            ? "bg-mar-soft text-mar-dark"
                            : mesDe(dia) === mes
                              ? "rounded-[10px] text-ink hover:bg-mar-soft"
                              : "rounded-[10px] text-[#A9B5B1] hover:bg-mar-soft"
                      } ${dia === hoje ? "font-bold underline underline-offset-2" : ""}`}
                    >
                      {Number(dia.slice(8, 10))}
                      <span aria-hidden="true" className={`size-1 rounded-full ${temVisita ? (ligado ? "bg-white" : "bg-mar") : "bg-transparent"}`} />
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          <Botao variante="secundario" onClick={() => janela.current?.close()}>
            Fechar
          </Botao>
        </div>
      </dialog>
    </>
  );
}

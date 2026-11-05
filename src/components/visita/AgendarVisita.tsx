"use client";

import { useRef, useState, useTransition } from "react";

import { pedirVisita } from "@/app/assinante/visitas/acoes";
import { Botao } from "@/components/ui/Botao";
import { CampoTextoLongo } from "@/components/ui/Campo";
import { chamarAcao } from "@/lib/chamarAcao";
import {
  diaDaSemana,
  diaEMes,
  diasParaAgendar,
  formatarHorario,
  HORARIOS_DE_VISITA,
  instanteDe,
  nomeDoDia,
  somarDias,
  TAMANHO_DO_RECADO,
  tituloDoPeriodo,
} from "@/lib/horariosDeVisita";

const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

// Calendário de agendar visita na página do imóvel (decisões de 04/11/2026): os
// próximos 14 dias e os horários fixos. Horário fechado aparece riscado, sem dizer
// quem marcou. Vários corretores podem pedir o mesmo horário enquanto ninguém foi
// confirmado, por isso um pedido dos outros não fecha nada aqui.
//
// O <dialog> é o mesmo do apagar imóvel: folha de baixo no celular, janela no site.
// "hoje" e "agora" vêm do servidor, para o navegador desenhar igual a ele.
export function AgendarVisita({
  imovelId,
  hoje,
  agora,
  ocupados,
  meusPedidos,
}: {
  imovelId: string;
  hoje: string;
  agora: string;
  ocupados: string[];
  meusPedidos: string[];
}) {
  const janela = useRef<HTMLDialogElement>(null);
  const dias = diasParaAgendar(hoje);
  const [dia, setDia] = useState(dias[0]);
  const [horaClicada, setHora] = useState<string>();
  const [recado, setRecado] = useState("");
  const [erro, setErro] = useState<string>();
  const [enviado, setEnviado] = useState<string>();
  const [ocupado, iniciar] = useTransition();

  const mesmoInstante = (lista: string[], instante: string) => {
    const momento = new Date(instante).getTime();
    return lista.some((item) => new Date(item).getTime() === momento);
  };

  function situacao(d: string, h: string) {
    const instante = instanteDe(d, h);
    if (new Date(instante) <= new Date(agora)) return "passou";
    // Nesta ordem: a visita confirmada dele também está em "ocupados".
    if (mesmoInstante(meusPedidos, instante)) return "meu";
    if (mesmoInstante(ocupados, instante)) return "ocupado";
    return "livre";
  }

  // Dia sem nenhum horário livre (ex.: hoje à noite) não abre.
  const temHorario = (d: string) => HORARIOS_DE_VISITA.some((h) => situacao(d, h) === "livre");

  // Se o horário escolhido fechou enquanto a janela estava aberta, ele deixa de valer.
  const hora = horaClicada && situacao(dia, horaClicada) === "livre" ? horaClicada : undefined;

  function abrir() {
    setErro(undefined);
    setEnviado(undefined);
    setHora(undefined);
    setDia(dias.find(temHorario) ?? dias[0]);
    janela.current?.showModal();
  }

  function enviar() {
    if (!hora) return setErro("Escolha um horário.");
    iniciar(async () => {
      const resultado = await chamarAcao(() => pedirVisita({ imovelId, dia, hora, recado }));
      setErro(resultado.erro);
      if (!resultado.erro) {
        setEnviado(formatarHorario(instanteDe(dia, hora)));
        setRecado("");
      }
    });
  }

  // A grade começa no domingo da primeira semana, para os dias caírem na coluna certa.
  const vazios = Array.from({ length: diaDaSemana(dias[0]) });
  const fim = somarDias(dias[0], dias.length - 1);
  const tituloId = `agendar-${imovelId}`;

  return (
    <>
      <Botao variante="secundario" onClick={abrir} className="w-full">
        Agendar visita
      </Botao>
      <dialog
        ref={janela}
        aria-labelledby={tituloId}
        onCancel={(evento) => {
          if (ocupado) evento.preventDefault();
        }}
        className="mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-folha bg-card p-0 text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        <div className="flex flex-col gap-4 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:p-7">
          <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
            {enviado ? "Pedido enviado" : "Agendar visita"}
          </h2>

          {enviado ? (
            <>
              <p role="status" className="text-ink2">
                Sua visita para {enviado} está aguardando a confirmação do proprietário. Acompanhe em Negociações.
              </p>
              <Botao variante="secundario" autoFocus onClick={() => janela.current?.close()}>
                Fechar
              </Botao>
            </>
          ) : (
            <>
              <p className="text-small text-ink2">Escolha o dia e o horário. Os riscados já estão ocupados.</p>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-small font-bold">{tituloDoPeriodo(dias[0], fim)}</legend>
                <div className="grid grid-cols-7 gap-1" role="group" aria-label="Dia da visita">
                  {SEMANA.map((letra, i) => (
                    <span key={i} aria-hidden="true" className="text-center text-tiny text-ink2">
                      {letra}
                    </span>
                  ))}
                  {vazios.map((_, i) => (
                    <span key={i} aria-hidden="true" />
                  ))}
                  {dias.map((d) => {
                    const pode = temHorario(d);
                    const escolhido = d === dia;
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={!pode}
                        aria-pressed={escolhido}
                        aria-label={`${nomeDoDia(d)}, ${diaEMes(d)}`}
                        onClick={() => {
                          setDia(d);
                          setHora(undefined);
                          setErro(undefined);
                        }}
                        className={`flex h-11 cursor-pointer items-center justify-center rounded-[10px] text-small disabled:cursor-not-allowed disabled:text-[#A9B5B1] ${
                          escolhido ? "bg-mar font-bold text-white" : "hover:bg-mar-soft disabled:hover:bg-transparent"
                        }`}
                      >
                        {Number(d.slice(8, 10))}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-col gap-2">
                <span className="text-small font-bold">
                  Horários de {nomeDoDia(dia).toLowerCase()}, {diaEMes(dia)}
                </span>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Horário da visita">
                  {HORARIOS_DE_VISITA.map((h) => {
                    const estado = situacao(dia, h);
                    const escolhido = h === hora;
                    const fechado = estado !== "livre";
                    return (
                      <button
                        key={h}
                        type="button"
                        disabled={fechado}
                        aria-pressed={escolhido}
                        aria-label={
                          estado === "ocupado" ? `${h}, ocupado` : estado === "meu" ? `${h}, você já pediu` : estado === "passou" ? `${h}, já passou` : h
                        }
                        onClick={() => {
                          setHora(h);
                          setErro(undefined);
                        }}
                        className={`flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-botao-sm border text-small disabled:cursor-not-allowed ${
                          escolhido
                            ? "border-ink bg-ink font-bold text-white"
                            : estado === "ocupado" || estado === "passou"
                              ? "border-cinza-soft bg-cinza-soft text-ink2 line-through"
                              : estado === "meu"
                                ? "border-mar-soft bg-mar-soft text-mar-dark"
                                : "border-line bg-card hover:bg-mar-soft"
                        }`}
                      >
                        {h}
                        {estado === "meu" && <span className="text-[11px] leading-none">seu pedido</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <CampoTextoLongo
                id={`recado-${imovelId}`}
                name="recado"
                rotulo="Recado para o proprietário (opcional)"
                value={recado}
                maxLength={TAMANHO_DO_RECADO}
                rows={2}
                onChange={(evento) => setRecado(evento.target.value)}
              />

              {erro && (
                <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
                  {erro}
                </p>
              )}

              <div className="grid grid-cols-[auto_1fr] gap-2.5 md:flex md:justify-end">
                <Botao variante="secundario" onClick={() => janela.current?.close()} disabled={ocupado}>
                  Fechar
                </Botao>
                <Botao onClick={enviar} disabled={ocupado}>
                  {ocupado ? "Enviando…" : hora ? `Pedir para ${nomeDoDia(dia).toLowerCase()}, ${diaEMes(dia)} às ${hora}` : "Pedir visita"}
                </Botao>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

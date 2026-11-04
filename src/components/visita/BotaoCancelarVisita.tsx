"use client";

import { useRef, useState, useTransition } from "react";

import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";

// "Cancelar visita", com confirmação (o mesmo <dialog> do apagar imóvel). A action
// vem por quem usa: a do corretor ou a do proprietário.
export function BotaoCancelarVisita({
  id,
  horario,
  acao,
}: {
  id: string;
  horario: string;
  acao: (id: string) => Promise<{ erro?: string }>;
}) {
  const janela = useRef<HTMLDialogElement>(null);
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();
  const tituloId = `cancelar-${id}`;

  return (
    <>
      <Botao
        variante="perigo"
        tamanho="pequeno"
        onClick={() => {
          setErro(undefined);
          janela.current?.showModal();
        }}
      >
        Cancelar visita
      </Botao>
      <dialog
        ref={janela}
        aria-labelledby={tituloId}
        className="mb-0 mt-auto w-full max-w-none rounded-t-folha bg-card p-0 text-left text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        <div className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
          <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
            Cancelar a visita?
          </h2>
          <p className="text-ink2">A visita de {horario} será cancelada, e o horário fica livre para outros corretores.</p>
          {erro && (
            <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
              {erro}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
            <Botao variante="secundario" onClick={() => janela.current?.close()} disabled={ocupado}>
              Voltar
            </Botao>
            <Botao
              variante="perigo"
              disabled={ocupado}
              onClick={() =>
                iniciar(async () => {
                  const resultado = await chamarAcao(() => acao(id));
                  setErro(resultado.erro);
                  if (!resultado.erro) janela.current?.close();
                })
              }
            >
              {ocupado ? "Cancelando…" : "Cancelar visita"}
            </Botao>
          </div>
        </div>
      </dialog>
    </>
  );
}

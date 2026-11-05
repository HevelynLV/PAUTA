"use client";

import { useRef, useState, useTransition } from "react";

import { retirarProposta } from "@/app/assinante/propostas/acoes";
import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";

// "Retirar proposta", com confirmação (o mesmo <dialog> do cancelar visita). Retirar é
// também o caminho para melhorar uma proposta em aberto: depois, ele pode mandar outra.
export function BotaoRetirarProposta({ id, valor, aceita }: { id: string; valor: string; aceita: boolean }) {
  const janela = useRef<HTMLDialogElement>(null);
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();
  const tituloId = `retirar-${id}`;

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
        Retirar proposta
      </Botao>
      <dialog
        ref={janela}
        aria-labelledby={tituloId}
        onCancel={(evento) => {
          if (ocupado) evento.preventDefault();
        }}
        className="mb-0 mt-auto w-full max-w-none rounded-t-folha bg-card p-0 text-left text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        <div className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
          <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
            Retirar a proposta?
          </h2>
          <p className="text-ink2">
            Sua proposta de {valor} será retirada{aceita ? ", mesmo já aceita pelo proprietário" : ""}. Depois, você pode enviar outra.
          </p>
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
                  const resultado = await chamarAcao(() => retirarProposta(id));
                  setErro(resultado.erro);
                  if (!resultado.erro) janela.current?.close();
                })
              }
            >
              {ocupado ? "Retirando…" : "Retirar proposta"}
            </Botao>
          </div>
        </div>
      </dialog>
    </>
  );
}

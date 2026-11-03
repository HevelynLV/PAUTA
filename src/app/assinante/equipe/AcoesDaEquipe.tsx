"use client";

import { useRef, useState, useTransition } from "react";

import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";

import { cancelarConvite, removerCorretor } from "./acoes";

// "Remover" de um corretor da equipe, com confirmação (o mesmo <dialog> do
// apagar imóvel: folha de baixo no celular, janela no computador). O protótipo
// não tinha esta ação: ela veio da decisão de 28/10/2026.
export function BotaoRemoverCorretor({ id, nome }: { id: string; nome: string }) {
  const janela = useRef<HTMLDialogElement>(null);
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();
  const tituloId = `remover-${id}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErro(undefined);
          janela.current?.showModal();
        }}
        className="min-h-11 shrink-0 cursor-pointer text-small font-bold text-erro"
      >
        Remover
      </button>
      <dialog
        ref={janela}
        aria-labelledby={tituloId}
        className="mb-0 mt-auto w-full max-w-none rounded-t-folha bg-card p-0 text-left text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        <div className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
          <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
            Remover {nome} da equipe?
          </h2>
          <p className="text-ink2">
            {nome} perde o acesso ao catálogo na hora. A conta não é apagada e continua no histórico da equipe.
          </p>
          <p className="rounded-[14px] bg-areia-soft px-3.5 py-3 text-small text-atencao-texto">
            Isso não pode ser desfeito. Para voltar à equipe, {nome} precisa de um convite novo e de outra conta, com
            outro e-mail.
          </p>
          {erro && (
            <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
              {erro}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
            <Botao variante="secundario" onClick={() => janela.current?.close()} disabled={ocupado}>
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              disabled={ocupado}
              onClick={() =>
                iniciar(async () => {
                  const resultado = await chamarAcao(() => removerCorretor(id));
                  setErro(resultado.erro);
                  if (!resultado.erro) janela.current?.close();
                })
              }
            >
              {ocupado ? "Removendo…" : "Remover"}
            </Botao>
          </div>
        </div>
      </dialog>
    </>
  );
}

// "Cancelar" de um convite que ainda aguarda: o link deixa de valer.
export function BotaoCancelarConvite({ id }: { id: string }) {
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();
  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => iniciar(async () => setErro((await chamarAcao(() => cancelarConvite(id))).erro))}
        className="min-h-11 cursor-pointer text-small font-bold text-erro disabled:text-ink2"
      >
        {ocupado ? "Cancelando…" : "Cancelar"}
      </button>
      {erro && (
        <span role="alert" className="text-tiny text-erro-texto">
          {erro}
        </span>
      )}
    </div>
  );
}

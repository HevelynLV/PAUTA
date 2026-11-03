"use client";

import { useRef, useState, useTransition } from "react";

import { Botao } from "@/components/ui/Botao";
import type { Situacao } from "@/lib/assinantesAdmin";
import { chamarAcao } from "@/lib/chamarAcao";

import { ativarAssinante, excluirPendente, mudarBloqueio, type ResultadoDaAcao } from "./acoes";

// Botões de cada assinante, como no AdmAssinantes (celular: botões largos no
// cartão) e no SiteAdmAssinantes (computador: botões pequenos na coluna Ações).
// Depois da ação, a lista é lida de novo pelo servidor (revalidatePath).
export function AcoesDoAssinante({
  id,
  nome,
  creci,
  situacao,
  largo = false,
}: {
  id: string;
  nome: string;
  creci: string;
  situacao: Situacao;
  largo?: boolean;
}) {
  const janela = useRef<HTMLDialogElement>(null);
  // O erro aparece onde a pessoa clicou: na linha ou na janela do "Excluir".
  const [erro, setErro] = useState<string>();
  const [erroNaJanela, setErroNaJanela] = useState<string>();
  const [ocupado, iniciar] = useTransition();

  function fazer(acao: () => Promise<ResultadoDaAcao>, naJanela = false) {
    setErro(undefined);
    setErroNaJanela(undefined);
    iniciar(async () => {
      const resultado = await chamarAcao(acao);
      if (naJanela) setErroNaJanela(resultado.erro);
      else setErro(resultado.erro);
      if (naJanela && !resultado.erro) janela.current?.close();
    });
  }

  const flex = largo ? "flex-1" : "";
  const tituloId = `excluir-${id}`;

  return (
    <div className={`flex flex-col gap-2 ${largo ? "" : "items-end"}`}>
      <div className={`flex gap-2 ${largo ? "" : "justify-end"}`}>
        {situacao === "pendente" && (
          <>
            <Botao
              variante="perigo"
              tamanho="pequeno"
              className={flex}
              disabled={ocupado}
              onClick={() => {
                setErroNaJanela(undefined);
                janela.current?.showModal();
              }}
            >
              Excluir
            </Botao>
            <Botao tamanho="pequeno" className={flex} disabled={ocupado} onClick={() => fazer(() => ativarAssinante(id))}>
              {ocupado ? "Salvando…" : "Ativar"}
            </Botao>
          </>
        )}
        {(situacao === "ativo" || situacao === "vencido") && (
          <Botao variante="perigo" tamanho="pequeno" className={flex} disabled={ocupado} onClick={() => fazer(() => mudarBloqueio(id, true))}>
            {ocupado ? "Salvando…" : largo ? "Bloquear acesso" : "Bloquear"}
          </Botao>
        )}
        {situacao === "bloqueado" && (
          <Botao variante="secundario" tamanho="pequeno" className={flex} disabled={ocupado} onClick={() => fazer(() => mudarBloqueio(id, false))}>
            {ocupado ? "Salvando…" : "Desbloquear"}
          </Botao>
        )}
      </div>
      {erro && (
        <p role="alert" className="text-tiny text-erro-texto">
          {erro}
        </p>
      )}

      {situacao === "pendente" && (
        <dialog
          ref={janela}
          aria-labelledby={tituloId}
          className="mb-0 mt-auto w-full max-w-none rounded-t-folha bg-card p-0 text-left text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
        >
          <div className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
            <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
              Excluir cadastro pendente?
            </h2>
            <p className="text-ink2">
              O cadastro de “{nome}” e o usuário dele serão apagados. O CRECI {creci} e o e-mail ficam livres para outra
              conta. Isso não pode ser desfeito.
            </p>
            {erroNaJanela && (
              <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
                {erroNaJanela}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
              <Botao variante="secundario" onClick={() => janela.current?.close()} disabled={ocupado}>
                Cancelar
              </Botao>
              <Botao variante="perigo" onClick={() => fazer(() => excluirPendente(id), true)} disabled={ocupado}>
                {ocupado ? "Excluindo…" : "Excluir"}
              </Botao>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}

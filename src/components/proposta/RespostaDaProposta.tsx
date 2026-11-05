"use client";

import { useState, useTransition } from "react";

import { aceitarProposta, desfazerAceite, recusarProposta } from "@/app/proprietario/propostas/acoes";
import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";
import type { StatusProposta } from "@/lib/proposta";

// "Recusar" e "Aceitar" de uma proposta nova e "Desfazer aceite" da aceita (ProImovel).
// Com o imóvel fora do catálogo, ele só limpa a lista: aceitar e desfazer não valem mais.
export function RespostaDaProposta({ id, status, noCatalogo }: { id: string; status: StatusProposta; noCatalogo: boolean }) {
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();

  function responder(acao: (id: string) => Promise<{ erro?: string }>) {
    iniciar(async () => {
      const resultado = await chamarAcao(() => acao(id));
      setErro(resultado.erro);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {erro && (
        <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
          {erro}
        </p>
      )}
      {status === "aguardando" && (
        <div className="flex gap-2.5">
          <Botao variante="perigo" tamanho="pequeno" className="flex-1" disabled={ocupado} onClick={() => responder(recusarProposta)}>
            Recusar
          </Botao>
          {noCatalogo && (
            <Botao tamanho="pequeno" className="flex-1" disabled={ocupado} onClick={() => responder(aceitarProposta)}>
              Aceitar
            </Botao>
          )}
        </div>
      )}
      {status === "aceita" && noCatalogo && (
        <Botao variante="secundario" tamanho="pequeno" disabled={ocupado} onClick={() => responder(desfazerAceite)}>
          Desfazer aceite
        </Botao>
      )}
    </div>
  );
}

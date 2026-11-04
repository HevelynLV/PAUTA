"use client";

import { useState, useTransition } from "react";

import { confirmarVisita, recusarVisita } from "@/app/proprietario/visitas/acoes";
import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";

// "Recusar" e "Confirmar" de um pedido de visita (ProImovel). Sem texto do
// proprietário: ele só responde (decisão de 04/11/2026).
export function RespostaDaVisita({ id, podeConfirmar, concorrentes }: { id: string; podeConfirmar: boolean; concorrentes: number }) {
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
      {podeConfirmar && concorrentes > 0 && (
        <p className="rounded-[14px] bg-areia-soft px-3.5 py-2.5 text-tiny text-atencao-texto">
          {concorrentes === 1
            ? "Outro corretor pediu este horário. Se você confirmar, o pedido dele será recusado."
            : `Outros ${concorrentes} corretores pediram este horário. Se você confirmar, os pedidos deles serão recusados.`}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
          {erro}
        </p>
      )}
      <div className="flex gap-2.5">
        <Botao variante="perigo" tamanho="pequeno" className="flex-1" disabled={ocupado} onClick={() => responder(recusarVisita)}>
          Recusar
        </Botao>
        {podeConfirmar && (
          <Botao tamanho="pequeno" className="flex-1" disabled={ocupado} onClick={() => responder(confirmarVisita)}>
            Confirmar
          </Botao>
        )}
      </div>
    </div>
  );
}

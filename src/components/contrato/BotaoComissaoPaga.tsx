"use client";

import { useState, useTransition } from "react";

import { definirComissaoPaga } from "@/app/admin/contratos/acoes";
import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";

// "Marcar como paga" e "Desfazer" da comissão do PAUTA (AdmPainel). A página atualiza
// sozinha depois da action, e o botão troca com ela.
export function BotaoComissaoPaga({ vendaId, paga }: { vendaId: string; paga: boolean }) {
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();

  function trocar() {
    setErro(undefined);
    iniciar(async () => {
      const resultado = await chamarAcao(() => definirComissaoPaga(vendaId, !paga));
      setErro(resultado.erro);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <Botao variante={paga ? "secundario" : "primario"} tamanho="pequeno" disabled={ocupado} onClick={trocar}>
        {ocupado ? "Salvando…" : paga ? "Desfazer" : "Marcar como paga"}
      </Botao>
      {erro && (
        <span role="alert" className="text-tiny text-erro-texto">
          {erro}
        </span>
      )}
    </div>
  );
}

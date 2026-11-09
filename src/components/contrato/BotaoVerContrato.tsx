"use client";

import { useState, useTransition } from "react";

import { abrirContrato } from "@/app/contratos/acoes";
import { chamarAcao } from "@/lib/chamarAcao";

// Abre o PDF numa aba nova. O link nasce no clique e dura pouco (RNF08). A aba é aberta
// antes de falar com o servidor: depois da espera, o navegador do celular a bloquearia.
export function BotaoVerContrato({ id, rotulo = "Ver contrato" }: { id: string; rotulo?: string }) {
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();

  function abrir() {
    setErro(undefined);
    const aba = window.open("about:blank", "_blank");
    iniciar(async () => {
      const resultado = await chamarAcao(() => abrirContrato(id));
      if (resultado.erro || !resultado.link) {
        aba?.close();
        return setErro(resultado.erro ?? "Não foi possível abrir o contrato. Tente de novo.");
      }
      if (!aba) return window.location.assign(resultado.link);
      aba.opener = null;
      aba.location.href = resultado.link;
    });
  }

  return (
    <>
      <button type="button" onClick={abrir} disabled={ocupado} className="min-h-6 text-small font-bold text-mar disabled:opacity-60">
        {ocupado ? "Abrindo…" : rotulo}
      </button>
      {erro && (
        <span role="alert" className="text-tiny text-erro-texto">
          {erro}
        </span>
      )}
    </>
  );
}

"use client";

import { useState, useTransition } from "react";

import { abrirContrato } from "@/app/contratos/acoes";
import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";

// Pré-visualização do PDF dentro da página, só no computador (SiteAdmContratos). O link
// nasce no clique, como no "Ver contrato", e não vem pronto no HTML (RNF08). O Storage
// não proíbe mostrar o arquivo dentro de outra página (conferido em 09/11/2026).
export function PreviaDoContrato({ id, nome }: { id: string; nome: string }) {
  const [link, setLink] = useState<string>();
  const [erro, setErro] = useState<string>();
  const [ocupado, iniciar] = useTransition();

  function mostrar() {
    setErro(undefined);
    iniciar(async () => {
      const resultado = await chamarAcao(() => abrirContrato(id));
      if (resultado.erro || !resultado.link) return setErro(resultado.erro ?? "Não foi possível abrir o contrato. Tente de novo.");
      setLink(resultado.link);
    });
  }

  if (link) {
    return <iframe src={link} title={`Contrato: ${nome}`} className="h-[640px] w-full rounded-[14px] border border-line bg-white" />;
  }
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-bg text-center">
      <Botao variante="secundario" tamanho="pequeno" disabled={ocupado} onClick={mostrar}>
        {ocupado ? "Carregando…" : "Mostrar o PDF aqui"}
      </Botao>
      {erro && (
        <span role="alert" className="text-tiny text-erro-texto">
          {erro}
        </span>
      )}
    </div>
  );
}

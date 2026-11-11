"use client";

import { useState } from "react";

import { mudarWhatsapp } from "@/app/avisos/acoes";
import { Interruptor } from "@/components/ui/Interruptor";
import { chamarAcao } from "@/lib/chamarAcao";

// A chave "Receber avisos no WhatsApp" de Minha conta (decisão de 09/11/2026). Salva na
// hora, sem o botão do formulário: o consentimento vale a partir do próximo aviso.
export function ChaveWhatsapp({ aceito }: { aceito: boolean }) {
  const [ligado, setLigado] = useState(aceito);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string>();

  async function trocar(novo: boolean) {
    setSalvando(true);
    setErro(undefined);
    const resultado = await chamarAcao(() => mudarWhatsapp(novo));
    setSalvando(false);
    if (resultado.erro) setErro(resultado.erro);
    else setLigado(novo);
  }

  return (
    <div className="flex flex-col gap-2 rounded-cartao border border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b id="whatsapp-rotulo" className="text-small">
            Receber avisos no WhatsApp
          </b>
          <span className="text-tiny text-ink2">
            {ligado
              ? "Os avisos chegam também no seu celular. A lista de avisos do app continua valendo."
              : "Os avisos ficam só na lista do app."}
          </span>
        </div>
        <Interruptor ligado={ligado} aoTrocar={trocar} rotuladoPor="whatsapp-rotulo" desabilitado={salvando} />
      </div>
      {erro && (
        <p role="alert" className="text-small text-erro-texto">
          {erro}
        </p>
      )}
    </div>
  );
}

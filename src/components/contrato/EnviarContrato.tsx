"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";

import { confirmarEnvioDeContrato, pedirEnvioDeContrato } from "@/app/assinante/contratos/acoes";
import { Botao } from "@/components/ui/Botao";
import { chamarAcao } from "@/lib/chamarAcao";
import { BUCKET_CONTRATOS, tamanhoDoPdfValido, textoDoTamanho, TIPO_DO_PDF } from "@/lib/contrato";
import { criarClienteNavegador } from "@/lib/supabase/client";

// "Enviar contrato assinado": CorContrato (celular) e a janela do SiteCorNegociacoes. O
// PDF vai direto do navegador para o Storage (o limite de uma Server Action é 1 MB): o
// servidor dá o link, o navegador envia e o servidor confere e registra. Depois do envio
// o botão some, mas a janela continua montada: é ela que mostra "Contrato em análise".
export function EnviarContrato({
  propostaId,
  titulo,
  resumo,
  mostrarBotao,
  reenvio,
}: {
  propostaId: string;
  titulo: string;
  resumo: string;
  mostrarBotao: boolean;
  reenvio: boolean;
}) {
  const janela = useRef<HTMLDialogElement>(null);
  const [arquivo, setArquivo] = useState<File>();
  const [erro, setErro] = useState<string>();
  const [enviado, setEnviado] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const tituloId = `contrato-${propostaId}`;

  function abrir() {
    setArquivo(undefined);
    setErro(undefined);
    setEnviado(false);
    janela.current?.showModal();
  }

  // Aqui é só para responder na hora: quem decide são o bucket e o servidor. Alguns
  // celulares não informam o tipo; nesse caso vale a extensão e, depois, o conteúdo.
  function escolher(escolhido?: File) {
    if (!escolhido) return;
    const ehPdf = escolhido.type === TIPO_DO_PDF || (!escolhido.type && /\.pdf$/i.test(escolhido.name));
    if (!ehPdf) return setErro("Escolha um arquivo PDF.");
    if (!tamanhoDoPdfValido(escolhido.size)) return setErro("Envie um PDF de até 20 MB.");
    setErro(undefined);
    setArquivo(escolhido);
  }

  function soltar(evento: DragEvent<HTMLLabelElement>) {
    evento.preventDefault();
    if (!ocupado) escolher(evento.dataTransfer.files[0]);
  }

  function enviar() {
    if (!arquivo) return;
    setErro(undefined);
    iniciar(async () => {
      const pedido = await chamarAcao(() => pedirEnvioDeContrato(propostaId, arquivo.size));
      if (pedido.erro || !pedido.caminho || !pedido.token) {
        return setErro(pedido.erro ?? "Não foi possível enviar o arquivo. Tente de novo.");
      }
      const { caminho, token } = pedido;

      const { error } = await criarClienteNavegador()
        .storage.from(BUCKET_CONTRATOS)
        .uploadToSignedUrl(caminho, token, arquivo, { contentType: TIPO_DO_PDF });
      if (error) return setErro("Não foi possível enviar o arquivo. Confira a internet e tente de novo.");

      const resultado = await chamarAcao(() => confirmarEnvioDeContrato(propostaId, caminho, arquivo.name));
      if (resultado.erro) return setErro(resultado.erro);
      setEnviado(true);
    });
  }

  return (
    <>
      {mostrarBotao && (
        <Botao tamanho="pequeno" onClick={abrir} className="self-start md:self-end">
          {reenvio ? "Reenviar contrato" : "Enviar contrato assinado"}
        </Botao>
      )}
      <dialog
        ref={janela}
        aria-labelledby={tituloId}
        onCancel={(evento) => {
          if (ocupado) evento.preventDefault();
        }}
        className="mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-folha bg-card p-0 text-left text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        {enviado ? (
          <div role="status" className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
            <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
              Contrato em análise
            </h2>
            <p className="text-ink2">A equipe PAUTA vai conferir o PDF. Se aprovar, o imóvel vira vendido. Se recusar, você recebe o motivo e pode reenviar.</p>
            <div className="md:flex md:justify-end">
              <Botao autoFocus className="w-full md:w-auto" onClick={() => janela.current?.close()}>
                Ver minhas negociações
              </Botao>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
            <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
              {reenvio ? "Reenviar contrato" : "Enviar contrato assinado"}
            </h2>

            <div className="flex flex-col gap-0.5 rounded-[14px] border border-line px-3.5 py-3">
              <span className="text-tiny font-bold text-ink2">Proposta aceita</span>
              <b className="[overflow-wrap:anywhere]">{titulo}</b>
              <span className="text-small text-ink2">{resumo}</span>
            </div>

            <p className="text-small text-ink2">
              O contrato é assinado fora do app (Clicksign ou outro meio) por todas as partes. Envie aqui o PDF final para o PAUTA conferir.
            </p>

            {arquivo ? (
              <div className="flex items-center justify-between gap-3 rounded-[14px] bg-mar-soft px-3.5 py-3">
                <div className="flex min-w-0 flex-col">
                  <b className="truncate text-small">{arquivo.name}</b>
                  <span className="text-tiny text-ink2">{textoDoTamanho(arquivo.size)}</span>
                </div>
                <Botao variante="secundario" tamanho="pequeno" disabled={ocupado} onClick={() => setArquivo(undefined)}>
                  Trocar
                </Botao>
              </div>
            ) : (
              <label
                onDragOver={(evento) => evento.preventDefault()}
                onDrop={soltar}
                className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed border-line px-4 py-5 text-center focus-within:border-mar"
              >
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onChange={(evento) => {
                    escolher(evento.target.files?.[0]);
                    evento.target.value = "";
                  }}
                />
                <b className="text-mar">
                  <span className="md:hidden">Escolher PDF</span>
                  <span className="hidden md:inline">Arraste o PDF ou clique para escolher</span>
                </b>
                <span className="text-tiny text-ink2">Só PDF, até 20 MB</span>
              </label>
            )}

            <p className="text-tiny text-ink2">Só você, o proprietário e a equipe PAUTA veem este contrato.</p>

            {erro && (
              <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
                {erro}
              </p>
            )}

            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 md:flex md:justify-end">
              <Botao variante="secundario" disabled={ocupado} onClick={() => janela.current?.close()}>
                Voltar
              </Botao>
              <Botao disabled={ocupado || !arquivo} onClick={enviar}>
                {ocupado ? "Enviando…" : arquivo ? "Enviar para conferência" : "Anexe o PDF para enviar"}
              </Botao>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

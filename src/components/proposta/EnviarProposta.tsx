"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { enviarProposta } from "@/app/assinante/propostas/acoes";
import { Botao } from "@/components/ui/Botao";
import { Campo, CampoSelecao, CampoTextoLongo } from "@/components/ui/Campo";
import { chamarAcao } from "@/lib/chamarAcao";
import { formatarPreco, lerNumero } from "@/lib/imovel";
import {
  comparacaoComOPreco,
  FORMAS_DE_PAGAMENTO,
  type FormaPagamento,
  TAMANHO_DAS_CONDICOES,
  TAMANHO_DO_COMPRADOR,
} from "@/lib/proposta";

// "Enviar proposta" na página do imóvel: CorProposta (celular) e a janela de proposta do
// SiteCorImovel. Mesma janela do agendamento de visita: folha de baixo no celular,
// janela no site. Com proposta em aberto, o botão some, mas a janela continua montada:
// é ela que mostra "Proposta enviada" depois de a página atualizar.
export function EnviarProposta({
  imovelId,
  titulo,
  preco,
  temEmAberto,
  abrirAoCarregar,
}: {
  imovelId: string;
  titulo: string;
  preco: number;
  temEmAberto: boolean;
  abrirAoCarregar: boolean;
}) {
  const janela = useRef<HTMLDialogElement>(null);
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<FormaPagamento>("a_vista");
  const [condicoes, setCondicoes] = useState("");
  const [comprador, setComprador] = useState("");
  const [erro, setErro] = useState<string>();
  const [enviada, setEnviada] = useState<string>();
  const [ocupado, iniciar] = useTransition();

  // Veio de "Enviar proposta" na visita confirmada.
  useEffect(() => {
    if (abrirAoCarregar && !temEmAberto) janela.current?.showModal();
    // Só ao abrir a página: depois de enviar, temEmAberto muda e nada deve acontecer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function abrir() {
    setErro(undefined);
    setEnviada(undefined);
    janela.current?.showModal();
  }

  function enviar() {
    const numero = lerNumero(valor);
    if (numero === null || numero <= 0) return setErro("Escreva o valor em reais, ex.: 1.800.000.");
    if (!condicoes.trim()) return setErro("Escreva as condições da proposta.");
    iniciar(async () => {
      const resultado = await chamarAcao(() => enviarProposta({ imovelId, valor, forma, condicoes, comprador }));
      setErro(resultado.erro);
      if (!resultado.erro) {
        setEnviada(formatarPreco(numero));
        setValor("");
        setForma("a_vista");
        setCondicoes("");
        setComprador("");
      }
    });
  }

  const numero = lerNumero(valor);
  const dica = numero !== null && numero > 0 ? comparacaoComOPreco(numero, preco) : undefined;
  const tituloId = `proposta-${imovelId}`;

  return (
    <>
      {!temEmAberto && (
        <Botao onClick={abrir} className="w-full">
          Enviar proposta
        </Botao>
      )}
      <dialog
        ref={janela}
        aria-labelledby={tituloId}
        onCancel={(evento) => {
          if (ocupado) evento.preventDefault();
        }}
        className="mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-folha bg-card p-0 text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        <div className="flex flex-col gap-4 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:p-7">
          <div className="flex flex-col gap-0.5">
            <h2 id={tituloId} className="font-display text-t2 font-bold tracking-[-0.01em]">
              {enviada ? "Proposta enviada" : "Enviar proposta"}
            </h2>
            {!enviada && (
              <span className="text-tiny text-ink2">
                {titulo} · {formatarPreco(preco)}
              </span>
            )}
          </div>

          {enviada ? (
            <>
              <p role="status" className="text-ink2">
                Sua proposta de {enviada} foi para o proprietário. Acompanhe a resposta em Negociações.
              </p>
              <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
                <Botao variante="secundario" autoFocus onClick={() => janela.current?.close()}>
                  Fechar
                </Botao>
                <Link
                  href="/assinante/negociacoes"
                  className="inline-flex min-h-12 items-center justify-center rounded-botao bg-mar px-4 text-center font-bold text-white no-underline"
                >
                  Ver minhas negociações
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
                <Campo
                  id={`valor-${imovelId}`}
                  name="valor"
                  rotulo="Valor da proposta (R$)"
                  inputMode="decimal"
                  placeholder="1.800.000"
                  value={valor}
                  dica={dica}
                  onChange={(evento) => setValor(evento.target.value)}
                />
                <CampoSelecao
                  id={`forma-${imovelId}`}
                  name="forma"
                  rotulo="Forma de pagamento"
                  value={forma}
                  opcoes={FORMAS_DE_PAGAMENTO}
                  onChange={(evento) => setForma(evento.target.value as FormaPagamento)}
                />
              </div>
              <CampoTextoLongo
                id={`condicoes-${imovelId}`}
                name="condicoes"
                rotulo="Condições"
                value={condicoes}
                maxLength={TAMANHO_DAS_CONDICOES}
                rows={3}
                onChange={(evento) => setCondicoes(evento.target.value)}
              />
              <Campo
                id={`comprador-${imovelId}`}
                name="comprador"
                rotulo="Nome do comprador (opcional)"
                value={comprador}
                maxLength={TAMANHO_DO_COMPRADOR}
                autoComplete="off"
                onChange={(evento) => setComprador(evento.target.value)}
              />
              <p className="rounded-[14px] bg-mar-soft px-3.5 py-3 text-small text-mar-dark">
                O proprietário vê seu nome, sua imobiliária e seu contato junto com a proposta.
              </p>

              {erro && (
                <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
                  {erro}
                </p>
              )}

              <div className="grid grid-cols-[auto_1fr] gap-2.5 md:flex md:justify-end">
                <Botao variante="secundario" onClick={() => janela.current?.close()} disabled={ocupado}>
                  Fechar
                </Botao>
                <Botao onClick={enviar} disabled={ocupado}>
                  {ocupado ? "Enviando…" : "Enviar proposta"}
                </Botao>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

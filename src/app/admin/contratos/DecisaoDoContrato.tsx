"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

import { Botao } from "@/components/ui/Botao";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { Campo, CampoTextoLongo } from "@/components/ui/Campo";
import { chamarAcao } from "@/lib/chamarAcao";
import { TAMANHO_DO_MOTIVO, type StatusContrato } from "@/lib/contrato";
import { formatarData, formatarPreco } from "@/lib/imovel";

import { aprovarContrato, recusarContrato, type ResultadoDaConferencia } from "./acoes";

// A conferência do AdmContratos e do SiteAdmContratos: os três itens, Aprovar e Recusar,
// as janelas de cada um e a resposta. children: os dados do contrato, prontos do servidor;
// aviso: as outras propostas que serão recusadas, logo acima dos botões.
const ITENS = [
  "Assinado por vendedor, compradores e corretor",
  "Valor e imóvel batem com a proposta aceita",
  "Cláusula da comissão do PAUTA presente",
];

export type OutraParaRecusar = { corretor: string; imobiliaria: string | null; valor: number };
export type DadosDaVenda = {
  valorFinal: number;
  registradaEm: string;
  comissao: number;
  comissaoPagaEm: string | null;
  corretor: string;
  imobiliaria: string | null;
};

export function DecisaoDoContrato({
  id,
  titulo,
  status,
  motivoDaRecusa,
  corretor,
  valorDaProposta,
  outras,
  venda,
  aviso,
  children,
}: {
  id: string;
  titulo: string;
  status: StatusContrato;
  motivoDaRecusa: string | null;
  corretor: string;
  valorDaProposta: number;
  outras: OutraParaRecusar[];
  // Só depois da aprovação: a tela atualiza e passa a venda registrada.
  venda: DadosDaVenda | null;
  aviso?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const janelaAprovar = useRef<HTMLDialogElement>(null);
  const janelaRecusar = useRef<HTMLDialogElement>(null);
  const [marcados, setMarcados] = useState<boolean[]>(ITENS.map(() => false));
  const [valorFinal, setValorFinal] = useState(valorDaProposta.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
  const [comissao, setComissao] = useState("");
  const [comissaoPaga, setComissaoPaga] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [janelaAberta, setJanelaAberta] = useState<"aprovar" | "recusar">();
  const [resultado, setResultado] = useState<ResultadoDaConferencia>();
  const [ocupado, iniciar] = useTransition();
  const erro = resultado && "erro" in resultado ? resultado.erro : undefined;
  const conferido = marcados.every(Boolean);
  const outrasEmAberto = outras.length;
  // As que estavam em aberto quando a tela abriu: depois da venda, o banco já as recusou.
  const [recusadasNaVenda] = useState(outras);

  function abrir(qual: "aprovar" | "recusar") {
    setResultado(undefined);
    setJanelaAberta(qual);
    (qual === "aprovar" ? janelaAprovar : janelaRecusar).current?.showModal();
  }

  function tratar(resposta: ResultadoDaConferencia) {
    setResultado(resposta);
    if (!("erro" in resposta)) {
      janelaAprovar.current?.close();
      janelaRecusar.current?.close();
    }
    // Outra pessoa conferiu antes, ou o imóvel mudou: a tela recarrega e o aviso fica.
    if ("mudou" in resposta && resposta.mudou) {
      janelaAprovar.current?.close();
      janelaRecusar.current?.close();
      router.refresh();
    }
  }

  function aprovar() {
    iniciar(async () => tratar(await chamarAcao(() => aprovarContrato(id, { valorFinal, comissao, comissaoPaga, conferido }))));
  }

  function recusar() {
    iniciar(async () => tratar(await chamarAcao(() => recusarContrato(id, motivo))));
  }

  function proximo() {
    router.push("/admin/contratos");
    router.refresh();
  }

  if (status === "aprovado" && venda) {
    return <Vendido titulo={titulo} venda={venda} recusadas={resultado?.aprovado ? recusadasNaVenda : []} aoSeguir={proximo} />;
  }
  if (resultado && "aprovado" in resultado) {
    return (
      <Resposta titulo="Venda registrada" aoSeguir={proximo}>
        “{titulo}” agora está vendido e saiu do catálogo.
      </Resposta>
    );
  }
  if (resultado && "recusado" in resultado) {
    return (
      <Resposta titulo="Contrato devolvido" erro aoSeguir={proximo}>
        {corretor} vê o motivo em Negociações e pode reenviar. O imóvel continua em negociação e as outras propostas seguem
        valendo.
      </Resposta>
    );
  }

  // Já conferido antes desta tela (outra aba, outra pessoa ou link antigo).
  if (status !== "em_analise") {
    return (
      <Resposta titulo="Contrato já conferido" erro={status === "recusado"} aoSeguir={proximo}>
        {status === "aprovado"
          ? `Este contrato já foi aprovado: “${titulo}” está vendido.`
          : `Este contrato já foi recusado. Motivo: ${motivoDaRecusa ?? ""}`}
      </Resposta>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3.5">
      {erro && !janelaAberta && (
        <p role="alert" className="mx-5 rounded-[14px] bg-areia-soft px-3.5 py-3 text-small text-atencao-texto md:mx-0">
          {erro}
        </p>
      )}
      {children}

      <fieldset className="mx-5 flex flex-col gap-2.5 rounded-cartao border border-line bg-card p-4 md:mx-0">
        <legend className="float-left mb-1 text-tiny font-bold uppercase tracking-[0.08em] text-ink2">Confira no PDF</legend>
        {ITENS.map((item, i) => (
          <label key={item} className="flex items-start gap-3 text-small">
            <input
              type="checkbox"
              checked={marcados[i]}
              onChange={(evento) => setMarcados((atuais) => atuais.map((marcado, j) => (j === i ? evento.target.checked : marcado)))}
              className="mt-px size-[22px] shrink-0 accent-mar"
            />
            <span>{item}</span>
          </label>
        ))}
      </fieldset>

      {aviso}

      {/* No fim da página: aqui o menu de baixo do celular fica à vista e cobriria um rodapé preso. */}
      <div className="mt-auto flex flex-col gap-2 px-5 pb-6 md:mt-2 md:p-0">
        {!conferido && <p className="text-tiny text-ink2 md:text-right">Marque os três itens para aprovar.</p>}
        <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
          <Botao variante="perigo" disabled={ocupado} onClick={() => abrir("recusar")}>
            Recusar
          </Botao>
          <Botao disabled={ocupado || !conferido} onClick={() => abrir("aprovar")}>
            Aprovar
          </Botao>
        </div>
      </div>

      <dialog
        ref={janelaAprovar}
        aria-labelledby="aprovar-titulo"
        onClose={() => setJanelaAberta(undefined)}
        onCancel={(evento) => {
          if (ocupado) evento.preventDefault();
        }}
        className="mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-folha bg-card p-0 text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        <div className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
          <h2 id="aprovar-titulo" className="font-display text-t2 font-bold tracking-[-0.01em]">
            Aprovar e registrar a venda
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-ink2">
            <li>O imóvel vira vendido e sai do catálogo</li>
            {outrasEmAberto > 0 && (
              <li>
                {outrasEmAberto === 1 ? "1 outra proposta em aberto é recusada" : `${outrasEmAberto} outras propostas em aberto são recusadas`}
              </li>
            )}
            <li>Visitas pendentes e visitas confirmadas que ainda vão acontecer são canceladas</li>
            <li>Tudo numa operação só</li>
          </ul>
          <Campo
            name="valor_final"
            rotulo="Valor final do contrato (R$)"
            dica="Já vem com o valor da proposta. Mude se o contrato disser outro."
            inputMode="decimal"
            value={valorFinal}
            onChange={(evento) => setValorFinal(evento.target.value)}
          />
          <Campo
            name="comissao"
            rotulo="Comissão do PAUTA que consta no contrato (R$)"
            inputMode="decimal"
            placeholder="Ex.: 36.000"
            value={comissao}
            onChange={(evento) => setComissao(evento.target.value)}
          />
          <label className="flex items-start gap-3 text-small">
            <input
              type="checkbox"
              checked={comissaoPaga}
              onChange={(evento) => setComissaoPaga(evento.target.checked)}
              className="mt-px size-[22px] shrink-0 accent-mar"
            />
            <span>A comissão já foi paga</span>
          </label>
          {erro && janelaAberta === "aprovar" && (
            <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
              {erro}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
            <Botao variante="secundario" disabled={ocupado} onClick={() => janelaAprovar.current?.close()}>
              Cancelar
            </Botao>
            <Botao disabled={ocupado} onClick={aprovar}>
              {ocupado ? "Registrando…" : "Confirmar venda"}
            </Botao>
          </div>
        </div>
      </dialog>

      <dialog
        ref={janelaRecusar}
        aria-labelledby="recusar-titulo"
        onClose={() => setJanelaAberta(undefined)}
        onCancel={(evento) => {
          if (ocupado) evento.preventDefault();
        }}
        className="mb-0 mt-auto w-full max-w-none rounded-t-folha bg-card p-0 text-ink backdrop:bg-[rgba(16,32,30,.45)] md:m-auto md:max-w-[520px] md:rounded-modal"
      >
        <div className="flex flex-col gap-3.5 px-5 pt-5 pb-[max(26px,env(safe-area-inset-bottom))] md:gap-4 md:p-7">
          <h2 id="recusar-titulo" className="font-display text-t2 font-bold tracking-[-0.01em]">
            Recusar contrato
          </h2>
          <CampoTextoLongo
            name="motivo"
            rotulo="Motivo (o corretor vai ler)"
            maxLength={TAMANHO_DO_MOTIVO}
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            erro={janelaAberta === "recusar" ? erro : undefined}
          />
          <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
            <Botao variante="secundario" disabled={ocupado} onClick={() => janelaRecusar.current?.close()}>
              Cancelar
            </Botao>
            <Botao className="border-erro bg-erro hover:bg-erro-texto" disabled={ocupado} onClick={recusar}>
              {ocupado ? "Recusando…" : "Recusar contrato"}
            </Botao>
          </div>
        </div>
      </dialog>
    </div>
  );
}

// AdmVendido e SiteAdmVendido. Sem "foram avisados": os avisos chegam na Etapa 10.
function Vendido({
  titulo,
  venda,
  recusadas,
  aoSeguir,
}: {
  titulo: string;
  venda: DadosDaVenda;
  recusadas: OutraParaRecusar[];
  aoSeguir: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4 px-5 pt-7 pb-6 md:p-4">
      <SeloStatus status="vendido" />
      <h2 role="status" className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em]">
        Venda registrada
      </h2>
      <p className="text-ink2">
        “{titulo}” vendida por <b className="text-ink">{formatarPreco(venda.valorFinal)}</b> em {formatarData(venda.registradaEm)}, pelo
        corretor {venda.corretor}
        {venda.imobiliaria && ` (${venda.imobiliaria})`}.
      </p>

      <div className="flex flex-col gap-1.5 rounded-cartao border border-line bg-card p-4 text-small">
        <p className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">O que aconteceu, numa operação só</p>
        <span>O imóvel saiu do catálogo dos assinantes</span>
        {recusadas.map((outra, i) => (
          <span key={i}>
            A proposta de {outra.corretor}
            {outra.imobiliaria && ` (${outra.imobiliaria})`} ({formatarPreco(outra.valor)}) foi recusada
          </span>
        ))}
        <span>Visitas pendentes e visitas confirmadas que ainda iam acontecer foram canceladas</span>
      </div>

      <div className="flex flex-col gap-1 rounded-cartao border border-line bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">Comissão do PAUTA</p>
          {venda.comissaoPagaEm ? (
            <SeloStatus status="disponivel">Paga em {formatarData(venda.comissaoPagaEm)}</SeloStatus>
          ) : (
            <SeloStatus status="negociacao">A receber</SeloStatus>
          )}
        </div>
        <b className="font-display text-t2">{formatarPreco(venda.comissao)}</b>
        <span className="text-small text-ink2">Paga fora do PAUTA. Marque como paga no painel quando receber.</span>
      </div>

      <div className="flex flex-col gap-2.5 md:flex-row">
        <Botao
          onClick={() => {
            router.push("/admin");
            router.refresh();
          }}
        >
          Voltar ao painel
        </Botao>
        <Botao variante="secundario" onClick={aoSeguir}>
          Próximo da fila
        </Botao>
      </div>
    </div>
  );
}

function Resposta({ titulo, erro = false, aoSeguir, children }: { titulo: string; erro?: boolean; aoSeguir: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 px-5 pt-7 md:p-4">
      <span className={`flex size-14 items-center justify-center rounded-2xl ${erro ? "bg-erro-soft text-erro" : "bg-mar-soft text-mar"}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]">
          {erro ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="m5 12 5 5L20 7" />}
        </svg>
      </span>
      <h2 role="status" className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em]">
        {titulo}
      </h2>
      <p className="text-ink2">{children}</p>
      <Botao variante="secundario" className="md:self-start" onClick={aoSeguir}>
        Próximo da fila
      </Botao>
    </div>
  );
}

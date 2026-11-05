import { Cartao } from "@/components/ui/Cartao";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { formatarTelefone } from "@/lib/conta";
import { formatarData, formatarPreco } from "@/lib/imovel";
import { propostaEmAberto, rotuloDaForma, seloDaProposta } from "@/lib/proposta";
import type { PropostaRecebida } from "@/lib/propostas";

import { RespostaDaProposta } from "./RespostaDaProposta";

// Proposta para o proprietário (ProImovel). Ele sempre vê nome, imobiliária, CRECI e
// contato do corretor (RNF07), e o nome do comprador quando o corretor informou.
// Primeiro as que pedem resposta, depois as aceitas e, por fim, o histórico.
export function ListaDePropostas({ propostas, noCatalogo }: { propostas: PropostaRecebida[]; noCatalogo: boolean }) {
  const peso = (proposta: PropostaRecebida) =>
    proposta.status === "aguardando" ? 0 : proposta.status === "aceita" ? 1 : 2;
  const ordenadas = [...propostas].sort((a, b) => peso(a) - peso(b));

  return (
    <ul className="flex flex-col gap-3">
      {ordenadas.map((proposta) => (
        <li key={proposta.id}>
          <CartaoDeProposta proposta={proposta} noCatalogo={noCatalogo} />
        </li>
      ))}
    </ul>
  );
}

function CartaoDeProposta({ proposta, noCatalogo }: { proposta: PropostaRecebida; noCatalogo: boolean }) {
  const selo = seloDaProposta(proposta.status, "proprietario");
  const iniciais = proposta.corretor_nome
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");

  return (
    <Cartao>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="font-display text-[20px]">{formatarPreco(proposta.valor)}</b>
        <SeloStatus status={selo.status}>{selo.rotulo}</SeloStatus>
      </div>
      <span className="text-tiny text-ink2">
        {rotuloDaForma(proposta.forma_pagamento)} · enviada em {formatarData(proposta.criada_em)}
      </span>
      <p className="whitespace-pre-line text-small [overflow-wrap:anywhere]">{proposta.condicoes}</p>
      {proposta.nome_comprador && (
        <span className="text-small [overflow-wrap:anywhere]">
          <b>Comprador:</b> {proposta.nome_comprador}
        </span>
      )}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mar-soft text-small font-bold text-mar-dark">
          {iniciais}
        </span>
        <div className="flex min-w-0 flex-col">
          <b className="text-small">{proposta.corretor_nome}</b>
          <span className="text-tiny text-ink2">
            {proposta.imobiliaria ?? "Corretor autônomo"} · CRECI {proposta.creci}
          </span>
          <a href={`tel:+55${proposta.telefone}`} className="text-tiny text-mar">
            {formatarTelefone(proposta.telefone)}
          </a>
          <a href={`mailto:${encodeURIComponent(proposta.email).replace("%40", "@")}`} className="truncate text-tiny text-mar">
            {proposta.email}
          </a>
        </div>
      </div>
      {propostaEmAberto(proposta.status) && <RespostaDaProposta id={proposta.id} status={proposta.status} noCatalogo={noCatalogo} />}
    </Cartao>
  );
}

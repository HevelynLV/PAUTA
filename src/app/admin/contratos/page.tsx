import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BotaoVerContrato } from "@/components/contrato/BotaoVerContrato";
import { PreviaDoContrato } from "@/components/contrato/PreviaDoContrato";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { exigirTipo } from "@/lib/auth";
import { textoDoTamanho } from "@/lib/contrato";
import { contratoParaConferir, contratosParaConferir, vendaDoContrato, type ContratoParaConferir } from "@/lib/contratos";
import { formatarData, formatarDataHora, formatarPreco } from "@/lib/imovel";
import { rotuloDaForma } from "@/lib/proposta";

import { DecisaoDoContrato } from "./DecisaoDoContrato";

export const metadata: Metadata = { title: "Contratos" };

// Conferir contrato (AdmContratos no celular, SiteAdmContratos no computador): a fila dos
// contratos em análise, do mais antigo para o mais novo, e o escolhido (?id=), com a
// proposta aceita, o corretor, o PDF, os três itens da conferência e as outras propostas
// que serão recusadas. Mesma forma da fila de imóveis para aprovar.
export default function Contratos({ searchParams }: PageProps<"/admin/contratos">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}

async function Conteudo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirTipo("admin");
  const [fila, { id }] = await Promise.all([contratosParaConferir(), searchParams]);
  // O contrato pedido (?id=) abre mesmo que já tenha saído da fila: depois de aprovar ou
  // recusar, a tela continua nele e mostra a resposta, e quem abre um link antigo vê que
  // ele já foi conferido. Sem ?id=, o primeiro da fila.
  const pedido = typeof id === "string" ? await contratoParaConferir(id) : null;
  const contrato = pedido ?? (fila.length > 0 ? await contratoParaConferir(fila[0].id) : null);
  const posicao = contrato ? fila.findIndex((item) => item.id === contrato.id) : -1;
  const venda = contrato?.status === "aprovado" ? await vendaDoContrato(contrato.id) : null;
  const total = fila.length === 1 ? "1 contrato em análise" : `${fila.length} contratos em análise`;

  return (
    <div className="flex flex-1 flex-col md:px-10 md:pb-14 md:pt-8">
      {/* Celular */}
      <div className="flex items-center gap-2.5 px-5 pb-2.5 pt-[18px] md:hidden">
        <Link
          href="/admin"
          aria-label="Voltar ao painel"
          className="flex size-11 shrink-0 items-center justify-center rounded-botao border border-line bg-card text-ink"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex flex-1 flex-col">
          <h1 className="text-corpo font-bold">Conferir contrato</h1>
          {fila.length > 0 && (
            <span className="text-tiny text-ink2">
              {fila.length > 1 && posicao >= 0 ? `${posicao + 1} de ${fila.length} · ` : ""}
              {total}
            </span>
          )}
        </div>
      </div>

      {/* Computador */}
      <div className="hidden md:block">
        <h1 className="font-display text-[34px] font-bold leading-[1.1] tracking-[-0.02em]">Conferir contrato</h1>
        {contrato && (
          <p className="text-ink2">
            {contrato.imovel_titulo} · enviado em {formatarDataHora(contrato.enviado_em)}
          </p>
        )}
      </div>

      {!contrato ? (
        <p className="mx-5 mt-2 rounded-cartao border border-line bg-card p-4 text-ink2 md:mx-0 md:mt-6 md:max-w-[640px]">
          Nenhum contrato esperando conferência.
        </p>
      ) : (
        <div className="flex flex-1 flex-col md:mt-6 md:flex-row md:items-start md:gap-6">
          <Fila fila={fila} atual={contrato.id} />
          <div className="flex min-w-0 flex-1 flex-col md:max-w-[760px] md:rounded-cartao md:border md:border-line md:bg-card md:p-6">
            <DecisaoDoContrato
              key={contrato.id}
              id={contrato.id}
              titulo={contrato.imovel_titulo}
              status={contrato.status}
              motivoDaRecusa={contrato.motivo_recusa}
              corretor={contrato.corretor_nome}
              valorDaProposta={contrato.proposta_valor}
              outras={contrato.outras_em_aberto.map(({ corretor, imobiliaria, valor }) => ({ corretor, imobiliaria, valor }))}
              venda={
                venda && {
                  valorFinal: venda.valor_final,
                  registradaEm: venda.registrada_em,
                  comissao: venda.comissao_valor,
                  comissaoPagaEm: venda.comissao_paga_em,
                  corretor: venda.corretor_nome,
                  imobiliaria: venda.imobiliaria,
                }
              }
              aviso={<OutrasPropostas contrato={contrato} />}
            >
              <DadosDoContrato contrato={contrato} />
            </DecisaoDoContrato>
          </div>
        </div>
      )}
    </div>
  );
}

// A fila, só no computador (no celular, um contrato por vez).
function Fila({ fila, atual }: { fila: ContratoParaConferir[]; atual: string }) {
  if (fila.length < 2) return null;
  return (
    <nav aria-label="Fila de contratos para conferir" className="hidden w-[300px] shrink-0 flex-col gap-2 md:flex">
      <p className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">Fila ({fila.length})</p>
      {fila.map((item) => (
        <Link
          key={item.id}
          href={`/admin/contratos?id=${item.id}`}
          aria-current={item.id === atual ? "true" : undefined}
          className={`flex flex-col rounded-[14px] bg-card p-2.5 text-ink no-underline ${
            item.id === atual ? "border-2 border-mar" : "border border-line hover:border-mar"
          }`}
        >
          <b className="text-small">{item.imovel_titulo}</b>
          <span className="text-tiny text-ink2">
            {item.corretor_nome} · {formatarData(item.enviado_em)}
          </span>
        </Link>
      ))}
    </nav>
  );
}

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

function DadosDoContrato({ contrato }: { contrato: ContratoParaConferir }) {
  return (
    <div className="flex flex-col gap-3.5 px-5 md:px-0">
      <div className="flex flex-col gap-1">
        {contrato.status === "em_analise" && <SeloStatus status="contrato" />}
        <h2 className="font-display text-t2 font-bold tracking-[-0.01em] md:text-t1">{contrato.imovel_titulo}</h2>
        <span className="text-small text-ink2">Proprietário: {contrato.proprietario_nome}</span>
      </div>

      {!contrato.corretor_com_acesso && (
        <p className="rounded-[14px] bg-areia-soft px-3.5 py-3 text-small text-atencao-texto">
          O corretor está sem acesso ao PAUTA (bloqueado, com pagamento vencido ou removido da imobiliária). O contrato já
          enviado pode ser aprovado mesmo assim.
        </p>
      )}

      <div className="flex flex-col gap-2.5 rounded-cartao border border-line bg-card p-4">
        <p className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">Proposta aceita</p>
        <span className="font-display text-t2 font-bold">
          {formatarPreco(contrato.proposta_valor)}{" "}
          <span className="font-sans text-small font-normal text-ink2">{rotuloDaForma(contrato.forma_pagamento).toLowerCase()}</span>
        </span>
        <span className="whitespace-pre-line text-small [overflow-wrap:anywhere]">{contrato.condicoes}</span>
        {contrato.nome_comprador && <span className="text-small text-ink2">Comprador: {contrato.nome_comprador}</span>}
        <div className="flex items-center gap-3 border-t border-line pt-2.5">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mar-soft text-small font-bold text-mar-dark">
            {iniciais(contrato.corretor_nome)}
          </span>
          <div className="flex min-w-0 flex-col">
            <b className="text-small">{contrato.corretor_nome}</b>
            <span className="text-tiny text-ink2">
              {contrato.imobiliaria ? `${contrato.imobiliaria} · ` : "Corretor autônomo · "}CRECI {contrato.creci} SC
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-cartao border border-line bg-card p-4">
        <div className="flex min-w-0 flex-col">
          <b className="truncate text-small">{contrato.nome_arquivo}</b>
          <span className="text-tiny text-ink2">
            {textoDoTamanho(contrato.tamanho_bytes)} · enviado em {formatarDataHora(contrato.enviado_em)}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <BotaoVerContrato id={contrato.id} rotulo="Abrir" />
        </div>
      </div>

      <div className="hidden md:block">
        <PreviaDoContrato id={contrato.id} nome={contrato.nome_arquivo} />
      </div>
    </div>
  );
}

function OutrasPropostas({ contrato }: { contrato: ContratoParaConferir }) {
  const outras = contrato.outras_em_aberto;
  if (outras.length === 0) return null;
  return (
    <div className="mx-5 flex flex-col gap-1 rounded-[14px] bg-areia-soft px-3.5 py-3 text-small text-atencao-texto md:mx-0">
      <b>{outras.length === 1 ? "Outra proposta em aberto neste imóvel" : `${outras.length} outras propostas em aberto neste imóvel`}</b>
      <ul className="flex flex-col gap-0.5">
        {outras.map((outra, i) => (
          <li key={i}>
            {outra.corretor}
            {outra.imobiliaria && ` (${outra.imobiliaria})`}, {formatarPreco(outra.valor)}, {outra.status === "aceita" ? "aceita" : "sem resposta"}
          </li>
        ))}
      </ul>
      <span>{outras.length === 1 ? "Ela será recusada" : "Elas serão recusadas"} se você aprovar.</span>
    </div>
  );
}

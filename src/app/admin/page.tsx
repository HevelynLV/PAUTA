import Link from "next/link";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { BotaoSair } from "@/components/BotaoSair";
import { BotaoComissaoPaga } from "@/components/contrato/BotaoComissaoPaga";
import { classesBotao } from "@/components/ui/Botao";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { assinantesParaAtivar } from "@/lib/assinantesAdmin";
import { exigirTipo } from "@/lib/auth";
import { contratosParaConferir, vendasRegistradas, type VendaRegistrada } from "@/lib/contratos";
import { formatarData, formatarPreco } from "@/lib/imovel";
import { numerosDoPainel } from "@/lib/imoveisAdmin";

export const metadata: Metadata = { title: "Painel" };

// Painel do admin (AdmPainel e SiteAdmPainel): o que está esperando por ele (e os
// captados que esperam o dono, passo 4.7, e os assinantes para ativar, passo 5.2).
// Os outros cartões chegam com as etapas de cada assunto (exclusividade vencendo
// na 12) e as comissões do PAUTA das vendas registradas (Etapa 9).
export default function Painel() {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  await exigirTipo("admin");
  const [numeros, paraAtivar, contratos, vendas] = await Promise.all([
    numerosDoPainel(),
    assinantesParaAtivar(),
    contratosParaConferir(),
    vendasRegistradas(),
  ]);

  return (
    <div className="flex w-full max-w-[1140px] flex-col gap-4 px-5 pb-7 pt-[22px] md:gap-6 md:px-10 md:pt-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-small text-ink2">Equipe PAUTA</span>
          <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Painel</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* No celular o admin não tem Minha conta: o "Sair" fica no topo do
              painel, como no AdmPainel. No computador ele está no menu lateral. */}
          <BotaoSair className="md:hidden" />
          <Link href="/admin/imoveis/captar" className={classesBotao({ tamanho: "pequeno" })}>
            Captar imóvel
          </Link>
        </div>
      </div>

      <p className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">Para fazer</p>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5 md:gap-4">
        <Tile href="/admin/imoveis" numero={numeros.imoveisParaAprovar} rotulo="Imóveis para aprovar" icone={<path d="M3 10.5 12 3l9 7.5V21H3z" />} />
        <Tile
          href="/admin/assinantes?filtro=pendentes"
          numero={paraAtivar}
          rotulo="Assinantes para ativar"
          icone={
            <>
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" />
            </>
          }
          areia
        />
        <Tile
          href="/admin/contratos"
          numero={contratos.length}
          rotulo="Contratos para conferir"
          icone={
            <>
              <path d="M14 3H6v18h12V7z" />
              <path d="M14 3v4h4M9 13l2 2 4-4" />
            </>
          }
        />
        <Tile
          href="/admin/edicoes"
          numero={numeros.edicoesParaRevisar}
          rotulo="Edições para revisar"
          icone={<path d="M4 20h4L19 9l-4-4L4 16z" />}
          cinza
        />
        <Tile
          href="/admin/imoveis/captados"
          numero={numeros.captadosAguardando}
          rotulo="Captados aguardando o dono"
          icone={<path d="M12 5v14M5 12h14" />}
          cinza
        />
      </div>

      <Comissoes vendas={vendas} />
    </div>
  );
}

// "Comissões do PAUTA" (RF32): primeiro as a receber, depois as 10 pagas mais recentes.
// A comissão é paga fora do app; o admin marca quando recebe e pode desfazer.
function Comissoes({ vendas }: { vendas: VendaRegistrada[] }) {
  if (vendas.length === 0) return null;
  const aReceber = vendas.filter((venda) => !venda.comissao_paga_em);
  const pagas = vendas.filter((venda) => venda.comissao_paga_em).slice(0, 10);
  const total = aReceber.reduce((soma, venda) => soma + Number(venda.comissao_valor), 0);

  return (
    <section aria-labelledby="comissoes-titulo" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="comissoes-titulo" className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">
          Comissões do PAUTA
        </h2>
        {aReceber.length > 0 && <span className="text-small text-ink2">A receber: {formatarPreco(total)}</span>}
      </div>
      <ul className="flex flex-col overflow-hidden rounded-cartao border border-line bg-card">
        {[...aReceber, ...pagas].map((venda) => (
          <li
            key={venda.id}
            className="flex flex-col gap-2 border-t border-line p-4 first:border-t-0 md:flex-row md:items-center md:justify-between md:gap-4"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-small">{venda.imovel_titulo}</b>
                {venda.comissao_paga_em ? (
                  <SeloStatus status="disponivel">Paga em {formatarData(venda.comissao_paga_em)}</SeloStatus>
                ) : (
                  <SeloStatus status="negociacao">A receber</SeloStatus>
                )}
              </div>
              <span className="text-tiny text-ink2">
                Vendida em {formatarData(venda.registrada_em)} · {venda.corretor_nome}
                {venda.imobiliaria && ` (${venda.imobiliaria})`} · venda de {formatarPreco(venda.valor_final)}
              </span>
              <span className="text-small">
                Comissão: <b>{formatarPreco(venda.comissao_valor)}</b>
              </span>
            </div>
            <BotaoComissaoPaga vendaId={venda.id} paga={Boolean(venda.comissao_paga_em)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// Cartão de número do protótipo (.tile do AdmPainel).
function Tile({
  href,
  numero,
  rotulo,
  icone,
  cinza = false,
  areia = false,
}: {
  href: string;
  numero: number;
  rotulo: string;
  icone: ReactNode;
  cinza?: boolean;
  areia?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[116px] flex-col gap-1.5 rounded-cartao border border-line bg-card p-3.5 text-ink no-underline hover:border-mar"
    >
      <span className={`flex size-9 items-center justify-center rounded-[10px] ${cinza ? "bg-cinza-soft text-ink2" : areia ? "bg-areia-soft text-areia" : "bg-mar-soft text-mar"}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]">
          {icone}
        </svg>
      </span>
      <b className="font-display text-[32px] leading-none">{numero}</b>
      <span className="text-small">{rotulo}</span>
    </Link>
  );
}

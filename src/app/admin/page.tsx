import Link from "next/link";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { BotaoSair } from "@/components/BotaoSair";
import { classesBotao } from "@/components/ui/Botao";
import { assinantesParaAtivar } from "@/lib/assinantesAdmin";
import { exigirTipo } from "@/lib/auth";
import { numerosDoPainel } from "@/lib/imoveisAdmin";

export const metadata: Metadata = { title: "Painel" };

// Painel do admin (AdmPainel e SiteAdmPainel): o que está esperando por ele (e os
// captados que esperam o dono, passo 4.7, e os assinantes para ativar, passo 5.2).
// Os outros cartões chegam com as etapas de cada assunto (exclusividade vencendo
// na 12, contratos e comissões na 9).
export default function Painel() {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  await exigirTipo("admin");
  const [numeros, paraAtivar] = await Promise.all([numerosDoPainel(), assinantesParaAtivar()]);

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
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
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
    </div>
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

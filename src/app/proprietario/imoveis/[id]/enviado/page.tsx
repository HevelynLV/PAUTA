import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { classesBotao } from "@/components/ui/Botao";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { exigirTipo } from "@/lib/auth";
import { formatarPreco } from "@/lib/imovel";
import { capaDoImovel, imovelDoDono } from "@/lib/imoveis";

export const metadata: Metadata = { title: "Imóvel enviado" };

// Depois do envio (ProEnviado e o fim do SiteProNovo).
export default function ImovelEnviado({ params }: PageProps<"/proprietario/imoveis/[id]/enviado">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo params={params} />
    </Suspense>
  );
}

async function Conteudo({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await exigirTipo("proprietario");
  const { id } = await params;
  const [imovel, capa] = await Promise.all([imovelDoDono(id, usuario.id), capaDoImovel(id)]);
  if (!imovel || imovel.status !== "pendente") notFound();

  return (
    <div className="flex flex-col gap-[22px] px-5 pb-7 pt-[46px] md:px-10 md:pt-8">
      <div className="flex w-full max-w-[640px] flex-col gap-[22px] md:rounded-cartao md:border md:border-line md:bg-card md:p-10">
        <div className="flex flex-col gap-3">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-mar-soft text-mar">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]">
              <path d="m5 12 5 5L20 7" />
            </svg>
          </span>
          <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em]">Imóvel enviado</h1>
          <p className="text-ink2">
            A equipe PAUTA vai conferir os dados e as fotos. Você recebe um aviso no app quando ele for aprovado (e no WhatsApp, se tiver ligado em Minha conta).
          </p>
        </div>

        <div className="flex gap-3 rounded-cartao border border-line bg-card p-3">
          <div
            aria-hidden="true"
            className="size-[88px] shrink-0 rounded-foto bg-[#BFD3CD] bg-cover bg-center"
            style={capa ? { backgroundImage: `url("${capa}")` } : undefined}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SeloStatus status="pendente" />
            <b className="truncate">{imovel.titulo}</b>
            <span className="text-small text-ink2">
              {formatarPreco(imovel.preco)} · {imovel.bairro}
            </span>
          </div>
        </div>

        <p className="rounded-[14px] bg-mar-soft px-3.5 py-3 text-small text-mar-dark">
          Enquanto estiver pendente, você pode editar ou apagar o imóvel. A exclusividade de 6 meses começa quando ele for aprovado.
        </p>

        <Link href="/proprietario" className={`${classesBotao({ variante: "secundario" })} md:self-start`}>
          Voltar para meus imóveis
        </Link>
      </div>
    </div>
  );
}

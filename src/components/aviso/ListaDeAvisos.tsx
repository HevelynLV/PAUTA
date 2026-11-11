"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { marcarAvisosVistos } from "@/app/avisos/acoes";
import { agruparAvisos, quandoDoAviso, textoDoAviso, type Aviso, type CorDoAviso, type IconeDoAviso } from "@/lib/aviso";
import { chamarAcao } from "@/lib/chamarAcao";

// A lista de avisos (CorAvisos, ProAvisos e as versões Site): grupos "Hoje", "Esta
// semana" e "Antes", cada aviso leva ao link dele. No celular, a hora fica embaixo do
// texto, com o "Toque para ..."; no site, à direita do título, como no protótipo.
//
// Ao abrir a primeira página, marca tudo como visto e atualiza o contador do menu
// (router.refresh). Os avisos que chegaram novos seguem destacados enquanto a pessoa
// estiver na tela: a lista guarda quais eram novos na primeira vez que apareceram.
export function ListaDeAvisos({ avisos, agora, marcarVistos }: { avisos: Aviso[]; agora: string; marcarVistos: boolean }) {
  const router = useRouter();
  const [novos, setNovos] = useState(() => new Set(avisos.filter((aviso) => aviso.novo).map((aviso) => aviso.id)));
  const maisNovo = avisos[0];
  const temNovo = avisos.some((aviso) => aviso.novo);
  // Marca uma vez só para cada aviso mais novo: se o banco não mudar nada, a tela não
  // fica chamando a action de novo a cada refresh.
  const jaMarcado = useRef<number | null>(null);

  // Aviso que chegou depois (outra página, refresh) e veio como novo entra no destaque.
  const novosAgora = avisos.filter((aviso) => aviso.novo && !novos.has(aviso.id));
  if (novosAgora.length > 0) setNovos(new Set([...novos, ...novosAgora.map((aviso) => aviso.id)]));

  useEffect(() => {
    if (!marcarVistos || !temNovo || !maisNovo || jaMarcado.current === maisNovo.id) return;
    jaMarcado.current = maisNovo.id;
    chamarAcao(() => marcarAvisosVistos(maisNovo.criado_em)).then((resultado) => {
      if (!resultado.erro) router.refresh();
    });
  }, [marcarVistos, temNovo, maisNovo, router]);

  const instante = new Date(agora);
  return (
    <div className="flex flex-col gap-2.5">
      {agruparAvisos(avisos, instante).map((grupo, indice) => (
        <section key={grupo.titulo} aria-label={grupo.titulo} className="flex flex-col gap-2.5">
          <h2 className={`text-[12px] font-bold uppercase tracking-[0.08em] text-ink2 ${indice > 0 ? "mt-2.5" : ""}`}>{grupo.titulo}</h2>
          {grupo.avisos.map((aviso) => (
            <CartaoDoAviso key={aviso.id} aviso={aviso} novo={novos.has(aviso.id)} quando={quandoDoAviso(aviso.criado_em, instante)} />
          ))}
        </section>
      ))}
    </div>
  );
}

function CartaoDoAviso({ aviso, novo, quando }: { aviso: Aviso; novo: boolean; quando: string }) {
  const { titulo, texto, icone, cor, acao } = textoDoAviso(aviso.tipo, aviso.dados);
  return (
    <Link
      href={aviso.link}
      data-novo={novo ? "sim" : undefined}
      className={`flex gap-3 rounded-[14px] border p-3.5 text-ink no-underline hover:border-mar ${
        novo ? "border-aviso-novo-borda bg-aviso-novo" : "border-line bg-card"
      }`}
    >
      <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${CORES[cor]}`}>
        <svg viewBox="0 0 24 24" className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]">
          {ICONES[icone]}
        </svg>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <b className="text-small md:text-base">
            {novo && <span className="sr-only">Novo: </span>}
            {titulo}
          </b>
          <span className="hidden shrink-0 text-tiny text-ink2 md:inline">{quando}</span>
        </div>
        <span className="text-small">{texto}</span>
        <span className="text-tiny text-ink2 md:hidden">
          {quando}
          {acao ? ` · ${acao}` : ""}
        </span>
      </div>
    </Link>
  );
}

const CORES: Record<CorDoAviso, string> = {
  mar: "bg-mar-soft text-mar",
  erro: "bg-erro-soft text-erro",
  areia: "bg-areia-soft text-areia",
  roxo: "bg-roxo-soft text-roxo",
};

// Os ícones do protótipo (CorAvisos e ProAvisos).
const ICONES: Record<IconeDoAviso, ReactNode> = {
  ok: <path d="m5 12 5 5L20 7" />,
  calendario: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  contrato: (
    <>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4M9 13h6M9 17h6" />
    </>
  ),
  contratoRecusado: (
    <>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4M10 12l4 4M14 12l-4 4" />
    </>
  ),
  casa: <path d="M3 10.5 12 3l9 7.5V21H3z" />,
  proposta: (
    <>
      <path d="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
    </>
  ),
  fechar: <path d="M6 6l12 12M18 6 6 18" />,
  equipe: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.5 2.4 3.5 5.5" />
    </>
  ),
};

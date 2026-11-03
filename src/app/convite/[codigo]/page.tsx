import Link from "next/link";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { BotaoSair } from "@/components/BotaoSair";
import { classesBotao } from "@/components/ui/Botao";
import { Logo } from "@/components/ui/Logo";
import { usuarioAtual } from "@/lib/auth";
import { CODIGO_DO_CONVITE, textoDaSituacao } from "@/lib/convite";
import { criarClienteServidor } from "@/lib/supabase/server";

import { FormAceitarConvite } from "./FormAceitarConvite";

// O código do convite está no endereço: o navegador não o manda para outros sites
// (no-referrer), e a página não entra em buscadores.
export const metadata: Metadata = {
  title: "Convite para a equipe",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

// Convite (Convite.dc.html no celular, SiteConvite.dc.html no computador): o
// corretor convidado cria a conta e entra vinculado à imobiliária e ativo (RF05).
// Página pública: quem decide se o convite vale é o banco (dados_do_convite aqui,
// o gatilho de cadastro no aceite).
export default function Convite({ params }: PageProps<"/convite/[codigo]">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo params={params} />
    </Suspense>
  );
}

type DadosDoConvite = {
  situacao: string;
  imobiliaria: string;
  creci: string;
  convidado_por: string | null;
  email: string | null;
};

async function Conteudo({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const [usuario, convite] = await Promise.all([usuarioAtual(), lerConvite(codigo)]);

  if (usuario) {
    return (
      <Aviso titulo="Você já está conectado">
        <p className="text-ink2">
          Você está no PAUTA como {usuario.nome}. Para aceitar este convite, saia e abra o link de novo: o convite cria uma
          conta nova, com outro e-mail.
        </p>
        <BotaoSair estilo="botao" />
      </Aviso>
    );
  }

  if (!convite || convite.situacao !== "valido") {
    return (
      <Aviso titulo="Este convite não vale mais">
        <p className="text-ink2">{textoDaSituacao(convite?.situacao)}</p>
        <Link href="/" className={classesBotao({ variante: "secundario" })}>
          Ir para o início
        </Link>
      </Aviso>
    );
  }

  const iniciais = convite.imobiliaria
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");
  const deQuem = `CRECI ${convite.creci} SC${convite.convidado_por ? ` · convite de ${convite.convidado_por}` : ""}`;

  return (
    <div className="flex flex-1 flex-col bg-bg md:flex-row">
      {/* Painel do computador (.split > .art do SiteConvite) */}
      <aside className="hidden flex-1 flex-col justify-between gap-8 bg-mar p-12 text-white md:flex">
        <Logo claro />
        <div className="flex max-w-[460px] flex-col gap-4">
          <span className="flex size-16 items-center justify-center rounded-full bg-white font-display text-[20px] font-bold text-mar">
            {iniciais}
          </span>
          <p className="font-display text-[34px] font-bold leading-[1.1]">
            A {convite.imobiliaria} convidou você para a equipe.
          </p>
          <p className="text-[#CFE6E2]">{deQuem}. Você entra já vinculado e com acesso ao catálogo.</p>
        </div>
        <span className="text-tiny text-[#A9D2CB]">A imobiliária responde pelos corretores que convida.</span>
      </aside>

      <div className="flex flex-1 flex-col md:items-center md:justify-center md:px-6 md:py-12">
        <div className="flex w-full flex-1 flex-col gap-5 md:max-w-[440px] md:flex-none">
          {/* Celular: de quem é o convite (.card do Convite) */}
          <div className="flex flex-col gap-5 px-5 pt-[26px] md:hidden">
            <Logo />
            <div className="flex items-center gap-3.5 rounded-cartao border border-line bg-card p-4">
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-mar-soft text-sm font-bold text-mar-dark">
                {iniciais}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-small text-ink2">Convite para a equipe</span>
                <b>{convite.imobiliaria}</b>
                <span className="text-tiny text-ink2">{deQuem}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 px-5 md:px-0">
            <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[36px]">
              Crie sua conta de corretor
            </h1>
            <p className="text-small text-ink2">
              Você entra já vinculado à {convite.imobiliaria} e com acesso ao catálogo. A imobiliária responde pelos
              corretores que convida.
            </p>
          </div>

          <FormAceitarConvite codigo={codigo} emailDoConvite={convite.email} />
        </div>
      </div>
    </div>
  );
}

// Só pergunta ao banco se o código tem o formato certo.
async function lerConvite(codigo: string): Promise<DadosDoConvite | null> {
  if (!CODIGO_DO_CONVITE.test(codigo)) return null;
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("dados_do_convite", { p_codigo: codigo });
  return (data as DadosDoConvite[] | null)?.[0] ?? null;
}

function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-5 px-5 pb-7 pt-[26px] md:pt-12">
        <Logo />
        <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em]">{titulo}</h1>
        {children}
      </div>
    </div>
  );
}

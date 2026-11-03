import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { exigirTipo } from "@/lib/auth";
import { formatarTelefone } from "@/lib/conta";
import { equipeDaImobiliaria, type ConviteAguardando, type MembroDaEquipe } from "@/lib/equipe";
import { formatarData } from "@/lib/imovel";

import { BotaoCancelarConvite, BotaoRemoverCorretor } from "./AcoesDaEquipe";
import { ConvidarCorretor } from "./ConvidarCorretor";

export const metadata: Metadata = { title: "Equipe" };

// Equipe da imobiliária (ImobEquipe no celular, SiteImobEquipe no computador),
// só para o responsável: convidar corretores por e-mail ou link (RF05), ver os
// convites que aguardam e cancelar, e remover corretores (decisão de 28/10/2026).
// O cartão "Assinatura" do protótipo entra na Etapa 11, com o Asaas.
export default function Equipe() {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  const usuario = await exigirTipo("imobiliaria");
  const { imobiliaria, membros, convites } = await equipeDaImobiliaria(usuario.assinanteId!);
  const subtitulo = `${imobiliaria.nome} · CRECI ${imobiliaria.creci} SC`;

  return (
    <div className="flex w-full max-w-[1140px] flex-col gap-4 pb-7 md:gap-6 md:px-10 md:pt-8">
      {/* Celular: voltar para Minha conta */}
      <div className="flex items-center gap-2.5 px-5 pt-[18px] md:hidden">
        <Link
          href="/assinante/conta"
          aria-label="Voltar para Minha conta"
          className="flex size-11 shrink-0 items-center justify-center rounded-botao border border-line bg-card text-ink"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-small text-ink2">{subtitulo}</span>
          <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em]">Equipe</h1>
        </div>
      </div>

      {/* Computador */}
      <div className="hidden flex-col gap-0.5 md:flex">
        <span className="text-small text-ink2">{subtitulo}</span>
        <h1 className="font-display text-[34px] font-bold leading-[1.1] tracking-[-0.02em]">Equipe</h1>
      </div>

      <div className="flex flex-col gap-4 px-5 md:grid md:grid-cols-[1fr_340px] md:items-start md:gap-6 md:px-0">
        <div className="order-2 flex flex-col gap-4 md:order-1">
          <section aria-labelledby="titulo-corretores" className="flex flex-col gap-2">
            <h2 id="titulo-corretores" className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">
              Corretores ({membros.filter((m) => !m.removidoEm).length})
            </h2>
            <ul className="flex flex-col gap-2">
              {membros.map((membro) => (
                <Membro key={membro.id} membro={membro} />
              ))}
            </ul>
          </section>

          {convites.length > 0 && (
            <section aria-labelledby="titulo-convites" className="flex flex-col gap-2">
              <h2 id="titulo-convites" className="text-tiny font-bold uppercase tracking-[0.08em] text-ink2">
                Convites aguardando ({convites.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {convites.map((convite) => (
                  <Convite key={convite.id} convite={convite} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="order-1 md:sticky md:top-8 md:order-2">
          <ConvidarCorretor imobiliaria={imobiliaria.nome} />
        </div>
      </div>
    </div>
  );
}

function iniciais(nome: string) {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");
}

// Linha da equipe (.card em linha da ImobEquipe; no computador, a mesma linha
// faz o papel da tabela da SiteImobEquipe: nome, contato, desde e status).
function Membro({ membro }: { membro: MembroDaEquipe }) {
  const removido = membro.removidoEm !== null;
  const info = membro.responsavel
    ? `Responsável · ${formatarTelefone(membro.telefone)}`
    : removido
      ? `Removido em ${formatarData(membro.removidoEm!)}`
      : `Entrou por convite em ${formatarData(membro.entrouEm)} · ${formatarTelefone(membro.telefone)}`;

  return (
    <li
      className={`flex items-center gap-3 rounded-cartao border border-line bg-card p-3 ${removido ? "opacity-70" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-[38px] shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          membro.responsavel ? "bg-mar-soft text-mar-dark" : "bg-areia-soft text-areia"
        }`}
      >
        {iniciais(membro.nome)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <b className="max-w-full truncate text-small">{membro.nome}</b>
        <span className="text-tiny text-ink2">{info}</span>
        {/* No celular o selo fica embaixo do nome, para o nome caber. */}
        <Selo className="mt-1 md:hidden" cinza={removido}>{removido ? "Removido" : "Ativo"}</Selo>
      </div>
      <Selo className="hidden md:inline-flex" cinza={removido}>{removido ? "Removido" : "Ativo"}</Selo>
      {!membro.responsavel && !removido && <BotaoRemoverCorretor id={membro.id} nome={membro.nome} />}
    </li>
  );
}

function Convite({ convite }: { convite: ConviteAguardando }) {
  return (
    <li className="flex items-center gap-3 rounded-cartao border border-line bg-card p-3">
      <span
        aria-hidden="true"
        className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-cinza-soft text-sm font-bold text-ink2"
      >
        {convite.email ? convite.email[0]?.toUpperCase() : "@"}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <b className="max-w-full break-all text-small">{convite.email ?? "Convite por link"}</b>
        <span className="text-tiny text-ink2">
          Criado em {formatarData(convite.criadoEm)} · vale até {formatarData(convite.expiraEm)}
        </span>
        <Selo className="mt-1 md:hidden" cinza>
          Aguardando
        </Selo>
      </div>
      <Selo className="hidden md:inline-flex" cinza>
        Aguardando
      </Selo>
      <BotaoCancelarConvite id={convite.id} />
    </li>
  );
}

// Selo de status (.badge: b-disp para ativo, b-pend para os outros).
function Selo({ cinza = false, className = "", children }: { cinza?: boolean; className?: string; children: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-tiny font-bold ${
        cinza ? "bg-cinza-soft text-ink2" : "bg-mar-soft text-mar-dark"
      } ${className}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

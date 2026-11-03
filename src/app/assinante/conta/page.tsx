import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { TelaConta } from "@/components/conta/TelaConta";
import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { formatarTelefone } from "@/lib/conta";
import { corretoresAtivos } from "@/lib/equipe";
import { criarClienteServidor } from "@/lib/supabase/server";

import { salvarContaAssinante } from "./acoes";

export const metadata: Metadata = { title: "Minha conta" };

// Minha conta do assinante (docs/prototipo/CorConta.dc.html e SiteConta.dc.html).
// "Equipe e convites" (só o responsável pela imobiliária) desde o passo 5.4;
// "Assinatura e pagamentos" entra na Etapa 11.
export default function ContaAssinante() {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  const usuario = await exigirTipo(TIPOS_ASSINANTE);
  const supabase = await criarClienteServidor();
  const [{ data: perfil }, { data: assinante }, corretores] = await Promise.all([
    supabase.from("perfis").select("telefone").eq("id", usuario.id).maybeSingle(),
    // RLS: o corretor convidado lê a assinatura da imobiliária dele.
    supabase.from("assinantes").select("nome").eq("id", usuario.assinanteId!).maybeSingle(),
    usuario.tipo === "imobiliaria" ? corretoresAtivos(usuario.assinanteId!) : Promise.resolve(0),
  ]);

  const papel =
    usuario.tipo === "autonomo"
      ? "Corretor autônomo"
      : usuario.tipo === "imobiliaria"
        ? `Responsável · ${assinante?.nome ?? ""}`
        : `Corretor · ${assinante?.nome ?? ""}`;

  return (
    <TelaConta
      nome={usuario.nome}
      papel={papel}
      email={usuario.email}
      telefone={formatarTelefone(perfil?.telefone ?? "")}
      acao={salvarContaAssinante}
    >
      {usuario.tipo === "imobiliaria" && (
        <Link
          href="/assinante/equipe"
          className="flex items-center gap-3 rounded-cartao border border-line bg-card p-4 text-ink no-underline hover:border-mar"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-areia-soft text-areia">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5" />
              <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.5 2.3 3.5 5.2" />
            </svg>
          </span>
          <span className="flex flex-1 flex-col">
            <b>Equipe e convites</b>
            <span className="text-small text-ink2">
              {corretores === 1 ? "1 corretor" : `${corretores} corretores`} · convidar novos
            </span>
          </span>
        </Link>
      )}
      {usuario.tipo === "corretor" && (
        <p className="rounded-[14px] bg-mar-soft px-3.5 py-3 text-small text-mar-dark">
          A assinatura e os convites da {assinante?.nome} ficam com o responsável pela imobiliária. Você não paga
          mensalidade.
        </p>
      )}
    </TelaConta>
  );
}

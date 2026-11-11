import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { TelaConta } from "@/components/conta/TelaConta";
import { exigirTipo } from "@/lib/auth";
import { formatarTelefone } from "@/lib/conta";
import { criarClienteServidor } from "@/lib/supabase/server";

import { salvarContaProprietario } from "./acoes";

export const metadata: Metadata = { title: "Minha conta" };

// Minha conta do proprietário (docs/prototipo/ProConta.dc.html e SiteConta.dc.html).
export default function ContaProprietario() {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  const usuario = await exigirTipo("proprietario");
  const supabase = await criarClienteServidor();
  const { data: perfil } = await supabase.from("perfis").select("telefone, whatsapp_aceito").eq("id", usuario.id).maybeSingle();

  return (
    <TelaConta
      nome={usuario.nome}
      papel="Proprietário"
      email={usuario.email}
      telefone={formatarTelefone(perfil?.telefone ?? "")}
      whatsappAceito={perfil?.whatsapp_aceito === true}
      acao={salvarContaProprietario}
    >
      <div className="flex flex-col gap-1 rounded-cartao border border-line bg-card p-4">
        <b className="text-small">Seu contato para os corretores</b>
        <span className="text-tiny text-ink2">
          Você escolhe em cada imóvel se mostra seu telefone e e-mail aos corretores.
        </span>
        <Link href="/proprietario" className="text-small font-bold text-mar no-underline hover:underline">
          Ver meus imóveis
        </Link>
      </div>
    </TelaConta>
  );
}

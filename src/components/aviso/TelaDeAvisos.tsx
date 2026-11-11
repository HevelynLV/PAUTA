import "server-only";

import Link from "next/link";

import { classesBotao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { exigirTipo, type TipoUsuario } from "@/lib/auth";
import { antesValido, meusAvisos } from "@/lib/avisos";
import { criarClienteServidor } from "@/lib/supabase/server";

import { ListaDeAvisos } from "./ListaDeAvisos";

// A tela de avisos do proprietário e do assinante (ProAvisos, CorAvisos, SiteProAvisos e
// SiteCorAvisos). Fica num componente só porque as duas são iguais; cada página passa o
// próprio tipo para o exigirTipo(). A página anterior vem da URL (?antes=<id>), para o
// "Ver avisos anteriores" funcionar sem JavaScript e com o voltar do navegador.
export async function TelaDeAvisos({
  tipos,
  endereco,
  searchParams,
}: {
  tipos: TipoUsuario | readonly TipoUsuario[];
  endereco: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usuario = await exigirTipo(tipos);
  const supabase = await criarClienteServidor();
  const antes = antesValido((await searchParams).antes);
  const [{ avisos, temMais }, { data: perfil }] = await Promise.all([
    meusAvisos(antes),
    supabase.from("perfis").select("whatsapp_aceito").eq("id", usuario.id).maybeSingle(),
  ]);
  const whatsapp = perfil?.whatsapp_aceito === true;
  const ultimo = avisos.at(-1);

  return (
    <div className="flex w-full max-w-[820px] flex-col gap-4 px-5 pb-7 pt-[22px] md:gap-5 md:px-10 md:pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Avisos</h1>
        {whatsapp ? (
          <span className="text-tiny text-ink2 md:text-small">
            <span className="md:hidden">Também no seu WhatsApp</span>
            <span className="hidden md:inline">Os mesmos avisos chegam no seu WhatsApp</span>
          </span>
        ) : (
          <Link href={`${endereco.replace(/\/avisos$/, "")}/conta`} className="text-tiny font-bold text-mar no-underline hover:underline md:text-small">
            Receber também no WhatsApp
          </Link>
        )}
      </div>

      {avisos.length === 0 ? (
        <Cartao>
          <b>{antes ? "Não há avisos anteriores" : "Nenhum aviso por enquanto"}</b>
          <p className="text-small text-ink2">
            {antes
              ? "Você já viu todos os seus avisos."
              : "Quando algo acontecer nas suas visitas, propostas e contratos, o aviso aparece aqui."}
          </p>
          {antes && (
            <Link href={endereco} className={`${classesBotao({ variante: "secundario", tamanho: "pequeno" })} self-start`}>
              Ver os mais recentes
            </Link>
          )}
        </Cartao>
      ) : (
        <ListaDeAvisos avisos={avisos} agora={new Date().toISOString()} marcarVistos={antes === null} />
      )}

      <div className="flex flex-wrap gap-3">
        {antes && avisos.length > 0 && (
          <Link href={endereco} className={classesBotao({ variante: "secundario", tamanho: "pequeno" })}>
            Ver os mais recentes
          </Link>
        )}
        {temMais && ultimo && (
          <Link href={`${endereco}?antes=${ultimo.id}`} className={classesBotao({ variante: "secundario", tamanho: "pequeno" })}>
            Ver avisos anteriores
          </Link>
        )}
      </div>
    </div>
  );
}

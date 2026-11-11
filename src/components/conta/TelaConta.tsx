import Link from "next/link";
import type { ReactNode } from "react";

import { BotaoSair } from "@/components/BotaoSair";
import type { EstadoConta } from "@/lib/conta";

import { ChaveWhatsapp } from "./ChaveWhatsapp";
import { FormConta } from "./FormConta";

// "Minha conta" (ProConta, CorConta e SiteConta): quem é, os dados, os avisos de
// cada tipo (children), trocar senha e sair.
export function TelaConta({
  nome,
  papel,
  email,
  telefone,
  whatsappAceito,
  acao,
  children,
}: {
  nome: string;
  papel: string;
  email: string;
  telefone: string;
  whatsappAceito: boolean;
  acao: (anterior: EstadoConta, formData: FormData) => Promise<EstadoConta>;
  children?: ReactNode;
}) {
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex w-full max-w-[640px] flex-col gap-4 px-5 pb-7 pt-[22px] md:px-10 md:pt-8">
      <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Minha conta</h1>

      <div className="flex items-center gap-3 rounded-cartao border border-line bg-card p-4">
        <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-mar-soft text-sm font-bold text-mar-dark">
          {iniciais}
        </span>
        <div className="flex min-w-0 flex-col">
          <b className="truncate">{nome}</b>
          <span className="text-tiny text-ink2">{papel}</span>
        </div>
      </div>

      {children}

      <ChaveWhatsapp aceito={whatsappAceito} />

      <FormConta acao={acao} nome={nome} email={email} telefone={telefone} />

      {/* Trocar senha: pelo link no e-mail, que confirma que a conta é da pessoa. */}
      <Link href="/recuperar-senha" className="self-start text-small font-bold text-mar no-underline hover:underline">
        Trocar senha
      </Link>

      {/* No computador, o "Sair" já fica no menu lateral. */}
      <BotaoSair estilo="botao" className="md:hidden" />
    </div>
  );
}

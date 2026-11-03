"use client";

import { useState, useTransition } from "react";

import { Botao } from "@/components/ui/Botao";
import { Campo } from "@/components/ui/Campo";
import { chamarAcao } from "@/lib/chamarAcao";

import { criarConvite } from "./acoes";

// "Convidar corretor" da ImobEquipe (celular) e da SiteImobEquipe (computador).
// - Enviar convite: convite preso ao e-mail digitado.
// - Copiar link: convite por link, para uma pessoa só, e o link já vai para a
//   área de transferência.
// Até o SMTP próprio (passo 13.2), o PAUTA não manda e-mail: o link aparece aqui
// para o responsável mandar (decisão de 28/10/2026). O banco guarda só o hash do
// código, então o link aparece uma vez só.
export function ConvidarCorretor({ imobiliaria }: { imobiliaria: string }) {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string>();
  const [criado, setCriado] = useState<{ link: string; email: string | null; copiado: boolean }>();
  const [ocupado, iniciar] = useTransition();

  async function copiar(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      // Sem permissão (alguns navegadores depois de esperar o servidor): o link
      // continua na caixa abaixo, com o botão "Copiar".
      return false;
    }
  }

  function convidar(porEmail: boolean) {
    setErro(undefined);
    setCriado(undefined);
    if (porEmail && !email.trim()) {
      setErro("Escreva o e-mail do corretor.");
      return;
    }
    iniciar(async () => {
      const resultado = await chamarAcao(() => criarConvite(porEmail ? email : null));
      if (!resultado.link) {
        setErro(resultado.erro);
        return;
      }
      const copiado = porEmail ? false : await copiar(resultado.link);
      setCriado({ link: resultado.link, email: porEmail ? email.trim().toLowerCase() : null, copiado });
      if (porEmail) setEmail("");
    });
  }

  const mensagem = criado
    ? `Olá! A ${imobiliaria} convidou você para a equipe no PAUTA. Crie sua conta por este link (vale 7 dias): ${criado.link}`
    : "";

  return (
    <div className="flex flex-col gap-3 rounded-cartao border border-line bg-card p-4 md:gap-3.5 md:p-[22px]">
      <h2 className="font-display text-corpo font-bold md:text-t2">Convidar corretor</h2>
      <Campo
        name="email"
        type="email"
        rotulo="E-mail do corretor"
        autoComplete="off"
        value={email}
        onChange={(evento) => setEmail(evento.target.value)}
        erro={erro}
      />
      <div className="flex gap-2.5 md:flex-col-reverse">
        <Botao variante="secundario" tamanho="pequeno" className="flex-1 md:min-h-12" disabled={ocupado} onClick={() => convidar(false)}>
          <span className="md:hidden">Copiar link</span>
          <span className="hidden md:inline">Copiar link de convite</span>
        </Botao>
        <Botao tamanho="pequeno" className="flex-1 md:min-h-12" disabled={ocupado} onClick={() => convidar(true)}>
          {ocupado ? "Criando…" : "Enviar convite"}
        </Botao>
      </div>

      {criado && (
        <div role="status" className="flex flex-col gap-2.5 rounded-[14px] bg-mar-soft p-3.5 text-small text-mar-dark">
          <b>
            {criado.email
              ? `Convite criado para ${criado.email}`
              : criado.copiado
                ? "Link de convite copiado"
                : "Link de convite criado"}
          </b>
          <span>
            {criado.email
              ? "Mande este link ao corretor: só esse e-mail consegue usar. "
              : "Mande este link ao corretor: ele vale para uma pessoa só. "}
            Vale 7 dias e só aparece agora. Se perder, cancele o convite e crie outro.
          </span>
          <label className="flex flex-col gap-1">
            <span className="text-tiny font-bold">Link do convite</span>
            <input
              readOnly
              value={criado.link}
              onFocus={(evento) => evento.currentTarget.select()}
              className="min-h-11 w-full rounded-botao-sm border border-line bg-card px-3 text-tiny text-ink"
            />
          </label>
          <div className="flex gap-2.5">
            <Botao
              variante="secundario"
              tamanho="pequeno"
              className="flex-1"
              onClick={async () => {
                const copiado = await copiar(criado.link);
                setCriado({ ...criado, copiado });
              }}
            >
              {criado.copiado ? "Copiado" : "Copiar"}
            </Botao>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-botao-sm border border-mar bg-mar px-3.5 text-sm font-bold text-white no-underline hover:bg-mar-dark"
            >
              Mandar pelo WhatsApp
            </a>
          </div>
        </div>
      )}

      <span className="text-tiny text-ink2">
        O corretor entra já vinculado e ativo. A imobiliária responde pelos corretores que convida.
      </span>
    </div>
  );
}

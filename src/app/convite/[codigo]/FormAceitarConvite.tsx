"use client";

import { startTransition, useActionState } from "react";

import { Botao } from "@/components/ui/Botao";
import { Campo } from "@/components/ui/Campo";

import { aceitarConvite, type EstadoConvite } from "../acoes";

const estadoInicial: EstadoConvite = { erros: {}, valores: {} };

// Formulário do Convite (celular) e do SiteConvite (computador). O código vai num
// campo escondido; o banco confere tudo de novo no cadastro.
// emailDoConvite: convite por e-mail, que só esse e-mail usa (o campo fica fixo).
export function FormAceitarConvite({ codigo, emailDoConvite }: { codigo: string; emailDoConvite: string | null }) {
  const [estado, enviar, enviando] = useActionState(aceitarConvite, estadoInicial);
  const { erros, valores } = estado;

  return (
    <form
      action={enviar}
      // Sem isto, o React limpa o formulário depois de enviar e a pessoa perde o
      // que digitou quando aparece um erro (como no cadastro).
      onSubmit={(evento) => {
        evento.preventDefault();
        const dados = new FormData(evento.currentTarget);
        startTransition(() => enviar(dados));
      }}
      noValidate
      className="flex flex-1 flex-col gap-[18px]"
    >
      <input type="hidden" name="codigo" value={codigo} />

      <div className="flex flex-col gap-3.5 px-5 md:px-0">
        <Campo name="nome" rotulo="Nome completo" autoComplete="name" defaultValue={valores.nome} erro={erros.nome} />
        <Campo
          name="email"
          type="email"
          rotulo="E-mail"
          autoComplete="email"
          dica={
            emailDoConvite
              ? "O convite foi feito para este e-mail."
              : "Use o seu e-mail de trabalho. Ele precisa ser novo no PAUTA."
          }
          defaultValue={emailDoConvite ?? valores.email}
          readOnly={!!emailDoConvite}
          erro={erros.email}
        />
        <div className="grid gap-3.5 md:grid-cols-2 md:gap-4">
          <Campo
            name="telefone"
            type="tel"
            rotulo="Telefone com DDD"
            dica="Os avisos chegam por WhatsApp neste número."
            autoComplete="tel-national"
            inputMode="tel"
            defaultValue={valores.telefone}
            erro={erros.telefone}
          />
          <Campo
            name="senha"
            type="password"
            rotulo="Senha"
            dica="Mínimo de 8 caracteres."
            autoComplete="new-password"
            erro={erros.senha}
          />
        </div>

        {estado.erroGeral && (
          <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
            {estado.erroGeral}
          </p>
        )}
      </div>

      {/* .foot do protótipo: preso embaixo no celular; no computador, logo abaixo dos campos. */}
      <div className="sticky bottom-0 mt-auto border-t border-line bg-card px-5 pt-3 pb-[max(22px,env(safe-area-inset-bottom))] md:static md:mt-0 md:border-0 md:bg-transparent md:p-0">
        <Botao type="submit" disabled={enviando} className="w-full">
          {enviando ? "Criando conta…" : "Aceitar convite e entrar"}
        </Botao>
      </div>
    </form>
  );
}

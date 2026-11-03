"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";

import { Botao } from "@/components/ui/Botao";
import { Campo } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import type { PerfilCadastro } from "@/lib/validacao";

import { cadastrar, type EstadoCadastro } from "./acoes";

const estadoInicial: EstadoCadastro = { erros: {}, valores: {} };

// Formulário de cadastro. O tipo da conta vem do endereço (/cadastro,
// /cadastro/imobiliaria ou /cadastro/autonomo) e vai num campo escondido; o
// servidor confere de novo, porque o campo pode ser alterado.
export function FormCadastro({ perfil }: { perfil: PerfilCadastro }) {
  const [estado, enviar, enviando] = useActionState(cadastrar, estadoInicial);
  const { erros, valores } = estado;
  const assinante = perfil !== "proprietario";

  if (estado.confirmarEmail) {
    return (
      <Cartao className="mx-5 md:mx-0">
        <b>Confira seu e-mail</b>
        <p className="text-small text-ink2">
          Enviamos um link para {estado.confirmarEmail}. Abra o link para ativar a conta e depois entre no PAUTA.
        </p>
      </Cartao>
    );
  }

  return (
    <form
      action={enviar}
      // Sem isto, o React limpa o formulário depois de enviar, e a pessoa perde o
      // que digitou quando aparece um erro. Sem JavaScript, o action acima envia.
      onSubmit={(evento) => {
        evento.preventDefault();
        const dados = new FormData(evento.currentTarget);
        startTransition(() => enviar(dados));
      }}
      noValidate
      className="flex flex-1 flex-col gap-[18px]"
    >
      <input type="hidden" name="perfil" value={perfil} />

      <div className="flex flex-col gap-3.5 px-5 md:px-0">
        {perfil === "imobiliaria" && (
          <Campo
            name="nome_imobiliaria"
            rotulo="Nome da imobiliária"
            autoComplete="organization"
            defaultValue={valores.nome_imobiliaria}
            erro={erros.nome_imobiliaria}
          />
        )}
        {assinante && (
          <Campo
            name="creci"
            rotulo={perfil === "imobiliaria" ? "CRECI da imobiliária" : "Seu CRECI"}
            dica={
              perfil === "imobiliaria"
                ? "O número com a letra J, ex.: 12345-J. Conferimos o CRECI à mão antes de ativar a assinatura."
                : "O número com a letra F (pessoa física) ou J (empresa), ex.: 12345-F. Conferimos o CRECI à mão antes de ativar a assinatura."
            }
            autoCapitalize="characters"
            defaultValue={valores.creci}
            erro={erros.creci}
          />
        )}
        <div className="grid gap-3.5 md:grid-cols-2 md:gap-4">
          <Campo
            name="nome"
            rotulo={perfil === "imobiliaria" ? "Nome do responsável" : "Nome completo"}
            autoComplete="name"
            defaultValue={valores.nome}
            erro={erros.nome}
          />
          <Campo
            name="email"
            type="email"
            rotulo="E-mail"
            autoComplete="email"
            defaultValue={valores.email}
            erro={erros.email}
          />
          <Campo
            name="telefone"
            type="tel"
            rotulo="Telefone com DDD"
            dica="Obrigatório. Os avisos chegam por WhatsApp neste número."
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
      <div className="sticky bottom-0 mt-auto flex flex-col gap-2.5 border-t border-line bg-card px-5 pt-3 pb-[max(22px,env(safe-area-inset-bottom))] md:static md:mt-0 md:border-0 md:bg-transparent md:p-0">
        <Botao type="submit" disabled={enviando}>
          {enviando ? "Criando conta…" : "Criar conta"}
        </Botao>
        <p className="text-center text-tiny text-ink2 md:hidden">
          Já tem conta?{" "}
          <Link href="/entrar" className="font-bold text-mar no-underline hover:underline">
            Entrar
          </Link>
        </p>
        {assinante && (
          <p className="hidden text-tiny text-ink2 md:block">
            Corretor de imobiliária não se cadastra aqui: ele entra pelo convite da imobiliária.
          </p>
        )}
      </div>
    </form>
  );
}

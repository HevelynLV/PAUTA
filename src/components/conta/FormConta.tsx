"use client";

import { startTransition, useActionState } from "react";

import { Botao } from "@/components/ui/Botao";
import { Campo } from "@/components/ui/Campo";
import { CampoTelefone } from "@/components/ui/CampoTelefone";
import type { EstadoConta } from "@/lib/conta";

// Formulário de "Minha conta" (ProConta.dc.html). A action vem da página de cada
// área, e cada uma confere o tipo com exigirTipo().
export function FormConta({
  acao,
  nome,
  email,
  telefone,
}: {
  acao: (anterior: EstadoConta, formData: FormData) => Promise<EstadoConta>;
  nome: string;
  email: string;
  telefone: string;
}) {
  const [estado, enviar, enviando] = useActionState(acao, {} as EstadoConta);

  return (
    <form
      action={enviar}
      // Mantém o que foi digitado quando aparece um erro (ver FormCadastro).
      onSubmit={(evento) => {
        evento.preventDefault();
        const dados = new FormData(evento.currentTarget);
        startTransition(() => enviar(dados));
      }}
      noValidate
      className="flex flex-col gap-3.5"
    >
      <Campo name="nome" rotulo="Nome completo" autoComplete="name" defaultValue={nome} erro={estado.erros?.nome} />
      <Campo
        name="email"
        type="email"
        rotulo="E-mail"
        defaultValue={email}
        readOnly
        dica="Para trocar o e-mail, fale com a equipe PAUTA."
        className="[&_input]:bg-bg [&_input]:text-ink2"
      />
      <CampoTelefone
        dica="Use um celular: os avisos chegam por WhatsApp neste número."
        defaultValue={telefone}
        erro={estado.erros?.telefone}
      />
      <Botao type="submit" variante="secundario" disabled={enviando}>
        {enviando ? "Salvando…" : "Salvar dados"}
      </Botao>
      {estado.salvo && (
        <p role="status" className="rounded-[14px] bg-mar-soft px-3.5 py-3 text-small text-mar-dark">
          Dados salvos.
        </p>
      )}
      {estado.erro && (
        <p role="alert" className="rounded-[14px] bg-erro-soft px-3.5 py-3 text-small text-erro-texto">
          {estado.erro}
        </p>
      )}
    </form>
  );
}

"use client";

import { Campo } from "@/components/ui/Campo";
import { mascararTelefone } from "@/lib/validacao";

// Campo do celular, com o modelo e a máscara. O servidor limpa e confere de novo
// (limparTelefone e telefoneValido). A máscara muda o valor direto na caixa, sem
// useState: o texto digitado antes de a página carregar não se perde, e sem
// JavaScript o campo continua funcionando.
export function CampoTelefone({
  defaultValue = "",
  erro,
  dica,
}: {
  defaultValue?: string;
  erro?: string;
  dica: string;
}) {
  return (
    <Campo
      name="telefone"
      type="tel"
      rotulo="Telefone com DDD"
      placeholder="(48) 99812-4410"
      dica={dica}
      autoComplete="tel-national"
      inputMode="tel"
      defaultValue={mascararTelefone(defaultValue)}
      erro={erro}
      onChange={(evento) => {
        evento.currentTarget.value = mascararTelefone(evento.currentTarget.value);
      }}
    />
  );
}

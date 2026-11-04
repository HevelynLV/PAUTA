"use client";

import { TelaDeErro } from "@/components/TelaDeErro";

// Falha ao carregar uma página do assinante, como o catálogo. Fica dentro do layout
// da área: o menu continua na tela.
export default function ErroDoAssinante({ retry }: { retry: () => void }) {
  return <TelaDeErro tentarDeNovo={() => retry()} />;
}

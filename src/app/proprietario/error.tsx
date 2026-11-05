"use client";

import { TelaDeErro } from "@/components/TelaDeErro";

// Falha ao carregar uma página do proprietário, como a agenda. Fica dentro do layout
// da área: o menu continua na tela.
export default function ErroDoProprietario({ retry }: { retry: () => void }) {
  return <TelaDeErro tentarDeNovo={() => retry()} />;
}

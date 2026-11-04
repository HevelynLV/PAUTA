"use client";

import { TelaDeErro } from "@/components/TelaDeErro";

// Falha ao carregar qualquer página do app. Erro precisa ser componente do
// navegador, e retry() busca a página de novo no servidor.
export default function Erro({ retry }: { retry: () => void }) {
  return <TelaDeErro tentarDeNovo={() => retry()} />;
}

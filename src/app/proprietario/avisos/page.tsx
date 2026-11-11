import type { Metadata } from "next";
import { Suspense } from "react";

import { TelaDeAvisos } from "@/components/aviso/TelaDeAvisos";

export const metadata: Metadata = { title: "Avisos" };

// Avisos do proprietário (ProAvisos e SiteProAvisos, RF29).
export default function AvisosProprietario({ searchParams }: PageProps<"/proprietario/avisos">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <TelaDeAvisos tipos="proprietario" endereco="/proprietario/avisos" searchParams={searchParams} />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";

import { TelaDeAvisos } from "@/components/aviso/TelaDeAvisos";
import { TIPOS_ASSINANTE } from "@/lib/auth";

export const metadata: Metadata = { title: "Avisos" };

// Avisos do corretor, da imobiliária e do autônomo (CorAvisos e SiteCorAvisos, RF29).
export default function AvisosAssinante({ searchParams }: PageProps<"/assinante/avisos">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <TelaDeAvisos tipos={TIPOS_ASSINANTE} endereco="/assinante/avisos" searchParams={searchParams} />
    </Suspense>
  );
}

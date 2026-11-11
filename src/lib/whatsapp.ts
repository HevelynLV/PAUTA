import "server-only";

import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";

import { configDoWhatsApp, processarFilaDoWhatsApp } from "@/lib/whatsappFila";

// Avisos pelo WhatsApp (RF29, passo 10.3b). Cada Server Action que gera aviso chama
// avisarPeloWhatsApp() depois de dar certo. O envio roda com after(), depois de a resposta
// ir para o navegador: a tela nunca espera a Meta, e o aviso no app já existe (nasceu no
// banco, na mesma operação do evento). A fila é de todo mundo: uma chamada também manda os
// pendentes que outros eventos deixaram.
//
// Sem WHATSAPP_TOKEN, WHATSAPP_NUMERO_ID ou WHATSAPP_FILA_SEGREDO no ambiente, nada é feito
// (decisão de 09/11/2026). As chaves ficam só no servidor: nada aqui vai para o navegador.

export function avisarPeloWhatsApp() {
  const config = configDoWhatsApp(process.env);
  if (!config) return;
  after(async () => {
    try {
      // Sem sessão: a fila é protegida pelo segredo, não por quem está logado.
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { falhas } = await processarFilaDoWhatsApp(supabase, config);
      if (falhas > 0) console.warn(`WhatsApp: ${falhas} aviso(s) não saíram; ficam na fila para nova tentativa`);
    } catch (erro) {
      // O aviso no app não depende disto; o que ficou reservado volta à fila em 10 minutos.
      console.error("WhatsApp: a fila não rodou", erro);
    }
  });
}

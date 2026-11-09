import "server-only";

import { createHmac } from "node:crypto";

// Assinatura que prova ao banco que o servidor leu o arquivo e viu que é PDF (auditoria
// da Etapa 9). O banco refaz a mesma conta em enviar_contrato(), com o mesmo segredo,
// guardado no Vault do Supabase com o nome pauta_contrato_pdf. O segredo nunca vai para
// o navegador: a variável não tem o prefixo NEXT_PUBLIC_.
export function assinarContrato(dados: { proposta: string; caminho: string; corretor: string; etag: string }): string | null {
  const segredo = process.env.CONTRATO_PDF_SEGREDO;
  if (!segredo) return null;
  return createHmac("sha256", segredo)
    .update(`${dados.proposta}:${dados.caminho}:${dados.corretor}:${dados.etag}`)
    .digest("hex");
}

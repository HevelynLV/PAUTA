import type { SupabaseClient } from "@supabase/supabase-js";

import { textoDoAviso, type DadosDoAviso, type TipoAviso } from "@/lib/aviso";

// A fila do WhatsApp (RF29, passo 10.3b): pega os avisos pendentes no banco, manda cada um
// para a Meta (WhatsApp Cloud API) e grava o resultado. O banco só entrega a fila a quem
// tem o segredo (reservar_avisos_whatsapp e registrar_envio_whatsapp, migration
// 20261111000433_avisos_whatsapp), porque a resposta traz o telefone de quem recebe.
//
// Este arquivo não lê o ambiente nem a sessão: recebe a configuração, o cliente do
// Supabase e o fetch de quem chama. O app usa src/lib/whatsapp.ts; o e2e troca o fetch por
// uma Meta falsa (decidido em 10/11/2026: o número de teste não entrega no Brasil).

export type ConfigDoWhatsApp = {
  token: string;
  numeroId: string;
  segredo: string;
  // Modelo de mensagem aprovado na Meta, com dois parâmetros no corpo: título e texto.
  modelo: string;
  idioma: string;
  // Endereço da API da Meta; o e2e aponta para a Meta falsa.
  api: string;
};

export const VERSAO_DA_API_DA_META = "v21.0";

// Lê a configuração de um conjunto de variáveis (process.env no app). Sem token, número ou
// segredo, o WhatsApp é pulado e o aviso no app segue valendo (decisão de 09/11/2026).
// WHATSAPP_DESLIGADO=1 pula também com as chaves no .env.local: o servidor do e2e usa,
// para os avisos das contas de teste nunca irem para a Meta (auditoria da Etapa 10).
export function configDoWhatsApp(env: Record<string, string | undefined>): ConfigDoWhatsApp | null {
  if (env.WHATSAPP_DESLIGADO?.trim() === "1") return null;
  const token = env.WHATSAPP_TOKEN?.trim();
  const numeroId = env.WHATSAPP_NUMERO_ID?.trim();
  const segredo = env.WHATSAPP_FILA_SEGREDO?.trim();
  if (!token || !numeroId || !segredo) return null;
  return {
    token,
    numeroId,
    segredo,
    modelo: env.WHATSAPP_MODELO?.trim() || "aviso_pauta",
    idioma: "pt_BR",
    api: (env.WHATSAPP_API_URL?.trim() || "https://graph.facebook.com").replace(/\/+$/, ""),
  };
}

export type AvisoDaFila = {
  id: number;
  tipo: TipoAviso;
  dados: DadosDoAviso;
  telefone: string;
  tentativa: number;
};

// A Meta recusa parâmetro com quebra de linha, tabulação ou mais de 4 espaços seguidos.
export function textoParaParametro(texto: string, limite = 500) {
  const limpo = texto.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

// O corpo do envio para a Meta: um modelo com o título e o texto do aviso, os mesmos da
// lista do app (src/lib/aviso.ts). Sem link: o endereço público só existe na Etapa 13.
export function mensagemDoAviso(aviso: AvisoDaFila, config: Pick<ConfigDoWhatsApp, "modelo" | "idioma">) {
  const { titulo, texto } = textoDoAviso(aviso.tipo, aviso.dados ?? {});
  return {
    messaging_product: "whatsapp",
    to: aviso.telefone,
    type: "template",
    template: {
      name: config.modelo,
      language: { code: config.idioma },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: textoParaParametro(titulo, 100) },
            { type: "text", text: textoParaParametro(texto) },
          ],
        },
      ],
    },
  };
}

type Resultado = { enviado: true; id: string } | { enviado: false; erro: string };

// Manda um aviso. Nunca lança: qualquer problema vira o erro gravado no aviso.
async function enviarUm(aviso: AvisoDaFila, config: ConfigDoWhatsApp, enviar: typeof fetch): Promise<Resultado> {
  try {
    const resposta = await enviar(`${config.api}/${VERSAO_DA_API_DA_META}/${config.numeroId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(mensagemDoAviso(aviso, config)),
      signal: AbortSignal.timeout(10_000),
    });
    const corpo = (await resposta.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { code?: number; message?: string };
    } | null;
    const id = corpo?.messages?.[0]?.id;
    if (resposta.ok && id) return { enviado: true, id };
    const erro = corpo?.error;
    return { enviado: false, erro: `Meta ${resposta.status}${erro?.code ? ` (${erro.code})` : ""}: ${erro?.message ?? "sem detalhe"}` };
  } catch (e) {
    return { enviado: false, erro: `Sem resposta da Meta: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Esvazia a fila: reserva até "limite" avisos por vez e repete até não sobrar nenhum (no
// máximo "rodadas" vezes, para uma chamada nunca ficar presa). Devolve quantos saíram e
// quantos falharam. O cliente é o anônimo: quem protege a fila é o segredo.
// - Uma falha só volta depois de uma espera no banco (5 minutos por tentativa), então a
//   rodada seguinte não pega de novo o que acabou de falhar.
// - "prazoMs": depois dele, não reserva mais nada (o que já foi reservado é enviado). O
//   after() roda dentro do tempo da função na Vercel; sem prazo, uma Meta lenta (10 s por
//   envio) podia passar desse tempo, e o aviso que a Meta aceitou sem o resultado gravado
//   sairia de novo 10 minutos depois.
// - "destinatarios": só os avisos dessas contas. Usado só pelo e2e, para não mexer nos
//   avisos de outras pessoas no banco compartilhado.
export async function processarFilaDoWhatsApp(
  supabase: SupabaseClient,
  config: ConfigDoWhatsApp,
  enviar: typeof fetch = fetch,
  { limite = 20, rodadas = 3, prazoMs = 30_000, destinatarios }: { limite?: number; rodadas?: number; prazoMs?: number; destinatarios?: string[] } = {},
) {
  const fim = Date.now() + prazoMs;
  let enviados = 0;
  let falhas = 0;
  for (let rodada = 0; rodada < rodadas && Date.now() < fim; rodada++) {
    const { data, error } = await supabase.rpc("reservar_avisos_whatsapp", {
      p_segredo: config.segredo,
      p_limite: limite,
      ...(destinatarios && { p_destinatarios: destinatarios }),
    });
    if (error) throw new Error(`reservar_avisos_whatsapp: ${error.message}`);
    const avisos = (data ?? []) as AvisoDaFila[];
    for (const aviso of avisos) {
      const resultado = await enviarUm(aviso, config, enviar);
      const { error: erroAoGravar } = await supabase.rpc("registrar_envio_whatsapp", {
        p_segredo: config.segredo,
        p_aviso: aviso.id,
        p_enviado: resultado.enviado,
        p_whatsapp_id: resultado.enviado ? resultado.id : null,
        p_erro: resultado.enviado ? null : resultado.erro,
      });
      if (erroAoGravar) throw new Error(`registrar_envio_whatsapp: ${erroAoGravar.message}`);
      if (resultado.enviado) enviados++;
      else falhas++;
    }
    if (avisos.length < limite) break;
  }
  return { enviados, falhas };
}

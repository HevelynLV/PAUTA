"use server";

import { revalidatePath } from "next/cache";

import { assinarContrato } from "@/lib/assinaturaDoContrato";
import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import {
  BUCKET_CONTRATOS,
  BYTES_PARA_CONFERIR,
  caminhoDoContratoValido,
  MARCA_DO_PDF,
  mensagemDoErroDeContrato,
  tamanhoDoPdfValido,
  VALIDADE_DO_LINK_DO_PDF_EM_SEGUNDOS,
} from "@/lib/contrato";
import { criarClienteServidor } from "@/lib/supabase/server";
import { idValido } from "@/lib/validacao";
import { avisarPeloWhatsApp } from "@/lib/whatsapp";

// Envio do contrato assinado (RF25). O PDF não passa por aqui (o limite de uma Server
// Action é 1 MB): o servidor dá um link de envio assinado, o navegador manda o arquivo
// direto para o Storage e depois o servidor confere e registra. O banco confere a
// proposta, o acesso e o arquivo (enviar_contrato e as regras do bucket), e só registra
// com a assinatura que este servidor dá depois de ver que o arquivo é PDF.

export type EnvioDoContrato = { erro?: string; caminho?: string; token?: string };

export async function pedirEnvioDeContrato(propostaId: string, tamanho: number): Promise<EnvioDoContrato> {
  await exigirTipo(TIPOS_ASSINANTE);
  if (!idValido(propostaId)) return { erro: mensagemDoErroDeContrato("proposta_nao_encontrada") };
  if (typeof tamanho !== "number" || !tamanhoDoPdfValido(tamanho)) {
    return { erro: "Envie um PDF de até 20 MB." };
  }

  // O nome do arquivo é escolhido aqui, não pelo navegador. O Storage confere as regras
  // do bucket (insert) para quem está logado: proposta dele, aceita e sem contrato em análise.
  const caminho = `${propostaId}/${crypto.randomUUID()}.pdf`;
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.storage.from(BUCKET_CONTRATOS).createSignedUploadUrl(caminho);
  if (error) return { erro: "Esta proposta não recebe contrato agora. Recarregue a página." };
  return { caminho, token: data.token };
}

// O bucket só olha o tipo declarado pelo navegador. Aqui vale o conteúdo do arquivo. Junto
// vem o eTag, a impressão do arquivo que o Storage também guarda no banco: a assinatura
// vale só para este conteúdo.
async function arquivoEhPdf(caminho: string): Promise<{ pdf: boolean; etag: string | null } | null> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.storage
    .from(BUCKET_CONTRATOS)
    .createSignedUrl(caminho, VALIDADE_DO_LINK_DO_PDF_EM_SEGUNDOS);
  if (error) return null;

  try {
    // Só o começo do arquivo. O e2e confere que o Storage respeita o Range. O prazo evita
    // que um Storage lento prenda a tela do corretor.
    const resposta = await fetch(data.signedUrl, {
      headers: { Range: `bytes=0-${BYTES_PARA_CONFERIR - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!resposta.ok) return null;
    const inicio = Buffer.from(await resposta.arrayBuffer()).subarray(0, BYTES_PARA_CONFERIR);
    return { pdf: inicio.includes(MARCA_DO_PDF), etag: resposta.headers.get("etag") };
  } catch {
    return null;
  }
}

export async function confirmarEnvioDeContrato(
  propostaId: string,
  caminho: string,
  nomeDoArquivo: string,
): Promise<{ erro?: string }> {
  const usuario = await exigirTipo(TIPOS_ASSINANTE);
  if (!idValido(propostaId) || typeof caminho !== "string" || !caminhoDoContratoValido(propostaId, caminho)) {
    return { erro: mensagemDoErroDeContrato("arquivo_invalido") };
  }
  if (typeof nomeDoArquivo !== "string") return { erro: mensagemDoErroDeContrato("arquivo_invalido") };

  const supabase = await criarClienteServidor();
  const balde = supabase.storage.from(BUCKET_CONTRATOS);
  const leitura = await arquivoEhPdf(caminho);
  // Não deu para ler agora. Cada tentativa nova sobe o arquivo de novo, com outro nome, e
  // o bucket aceita só 3 sem registro por proposta: este sai.
  if (leitura === null || !leitura.etag) {
    await balde.remove([caminho]);
    return { erro: mensagemDoErroDeContrato(null) };
  }
  if (!leitura.pdf) {
    await balde.remove([caminho]);
    return { erro: "Este arquivo não é um PDF. Escolha o PDF do contrato." };
  }

  const assinatura = assinarContrato({ proposta: propostaId, caminho, corretor: usuario.id, etag: leitura.etag });
  if (!assinatura) {
    console.error("Falta CONTRATO_PDF_SEGREDO no ambiente: o contrato não pode ser registrado.");
    await balde.remove([caminho]);
    return { erro: mensagemDoErroDeContrato(null) };
  }

  const { error } = await supabase.rpc("enviar_contrato", {
    p_proposta: propostaId,
    p_caminho: caminho,
    p_nome: nomeDoArquivo,
    p_assinatura: assinatura,
  });
  if (error) {
    // A resposta pode ter se perdido depois de o banco registrar (sem hint: rede ou tempo).
    // Se o contrato deste arquivo existe, deu certo.
    if (!error.hint) {
      const { data: registrado } = await supabase.from("contratos").select("id").eq("caminho", caminho).maybeSingle();
      if (registrado) {
        atualizarTelas();
        return {};
      }
    }
    // Sem registro, o arquivo não serve para nada. Com registro, a regra do bucket não deixa apagar.
    await balde.remove([caminho]);
    return { erro: mensagemDoErroDeContrato(error.hint) };
  }

  atualizarTelas();
  return {};
}

function atualizarTelas() {
  // Só os dois caminhos de sucesso do envio chamam: o proprietário recebe o aviso.
  avisarPeloWhatsApp();
  revalidatePath("/assinante/imoveis/[id]", "page");
  revalidatePath("/assinante/negociacoes");
}

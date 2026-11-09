"use server";

import { revalidatePath } from "next/cache";

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

// Envio do contrato assinado (RF25). O PDF não passa por aqui (o limite de uma Server
// Action é 1 MB): o servidor dá um link de envio assinado, o navegador manda o arquivo
// direto para o Storage e depois o servidor confere e registra. O banco confere a
// proposta, o acesso e o arquivo (enviar_contrato e as regras do bucket).

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

// O bucket só olha o tipo declarado pelo navegador. Aqui vale o conteúdo do arquivo.
async function arquivoEhPdf(caminho: string): Promise<boolean | null> {
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
    return inicio.includes(MARCA_DO_PDF);
  } catch {
    return null;
  }
}

export async function confirmarEnvioDeContrato(
  propostaId: string,
  caminho: string,
  nomeDoArquivo: string,
): Promise<{ erro?: string }> {
  await exigirTipo(TIPOS_ASSINANTE);
  if (!idValido(propostaId) || typeof caminho !== "string" || !caminhoDoContratoValido(propostaId, caminho)) {
    return { erro: mensagemDoErroDeContrato("arquivo_invalido") };
  }
  if (typeof nomeDoArquivo !== "string") return { erro: mensagemDoErroDeContrato("arquivo_invalido") };

  const pdf = await arquivoEhPdf(caminho);
  // null: não deu para ler agora. O arquivo fica, e o corretor tenta de novo.
  if (pdf === null) return { erro: mensagemDoErroDeContrato(null) };

  const supabase = await criarClienteServidor();
  const balde = supabase.storage.from(BUCKET_CONTRATOS);
  if (!pdf) {
    await balde.remove([caminho]);
    return { erro: "Este arquivo não é um PDF. Escolha o PDF do contrato." };
  }

  const { error } = await supabase.rpc("enviar_contrato", {
    p_proposta: propostaId,
    p_caminho: caminho,
    p_nome: nomeDoArquivo,
  });
  if (error) {
    // Sem registro, o arquivo não serve para nada. Com registro, a regra do bucket não deixa apagar.
    await balde.remove([caminho]);
    return { erro: mensagemDoErroDeContrato(error.hint) };
  }

  revalidatePath("/assinante/imoveis/[id]", "page");
  revalidatePath("/assinante/negociacoes");
  return {};
}

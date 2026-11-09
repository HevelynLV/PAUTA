import { expect, test } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// O bucket de contratos pela API de verdade (RF25, RNF08), com arquivos de verdade: o
// testar_rls.sql só grava linhas em storage.objects, sem passar pelo Storage. Não depende
// do tamanho de tela: roda só no projeto "celular".
//
// Os imóveis de teste usam preços 7.776.xxx.

test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-contratos-api-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
const PDF = new TextEncoder().encode("%PDF-1.7\nContrato de teste do PAUTA\n%%EOF\n");
const BUCKET = "contratos";

type Sessao = Awaited<ReturnType<typeof entrarComo>>["cliente"];
let dono: Sessao;
let donoId: string;
let ana: Sessao;
let anaId: string;
let beto: Sessao;
let adm: Sessao;
let tipo: number;
let bairro: number;
let preco = 7_776_000;

test.beforeAll(async () => {
  test.skip(test.info().project.name !== "celular", "só chama a API: basta uma vez");
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  donoId = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dona do Contrato", telefone: "48999990070" });
  dono = (await entrarComo(email("dono"))).cliente;
  anaId = await criarConta(email("ana"), { tipo: "autonomo", nome: "Ana", telefone: "48999990071", creci: `${unico()}-F` });
  await mudarAssinatura(anaId, "ativo");
  ana = (await entrarComo(email("ana"))).cliente;
  const betoId = await criarConta(email("beto"), { tipo: "autonomo", nome: "Beto", telefone: "48999990072", creci: `${unico()}-F` });
  await mudarAssinatura(betoId, "ativo");
  beto = (await entrarComo(email("beto"))).cliente;
  const admId = await criarConta(email("adm"), { tipo: "proprietario", nome: "Admin", telefone: "48999990073" });
  await tornarAdmin(admId);
  adm = (await entrarComo(email("adm"))).cliente;
});

test.afterAll(() => apagarContas(PREFIXO));

// Imóvel disponível com uma proposta aceita da Ana. Devolve o id da proposta.
async function propostaAceita() {
  const agora = Date.now();
  preco += 1;
  const { data: imovel, error } = await clienteAdmin()
    .from("imoveis")
    .insert({
      proprietario_id: donoId,
      titulo: "Casa do contrato",
      descricao: "Casa de teste.",
      tipo_id: tipo,
      endereco: "Rua do Contrato, 10",
      bairro_id: bairro,
      preco,
      quartos: 3,
      banheiros: 2,
      vagas: 1,
      area: 150,
      status: "disponivel",
      termo_versao: "2026-10-provisorio",
      termo_aceito_em: new Date(agora).toISOString(),
      exclusividade_inicio: new Date(agora).toISOString(),
      exclusividade_fim: new Date(agora + 180 * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: proposta, error: erroEnvio } = await ana.rpc("enviar_proposta", {
    p_imovel: imovel.id,
    p_valor: 7_000_000,
    p_forma: "a_vista",
    p_condicoes: "Escritura em 60 dias",
  });
  if (erroEnvio) throw erroEnvio;
  const { error: erroAceite } = await dono.rpc("aceitar_proposta", { p_proposta: proposta });
  if (erroAceite) throw erroAceite;
  return proposta as string;
}

const novoCaminho = (proposta: string) => `${proposta}/${crypto.randomUUID()}.pdf`;

async function enviarArquivo(cliente: Sessao, caminho: string, corpo: Uint8Array<ArrayBuffer> = PDF, tipoDoArquivo = "application/pdf") {
  const balde = cliente.storage.from(BUCKET);
  const { data, error } = await balde.createSignedUploadUrl(caminho);
  if (error) return { error };
  return balde.uploadToSignedUrl(caminho, data.token, new Blob([corpo], { type: tipoDoArquivo }), { contentType: tipoDoArquivo });
}

async function contratoEnviado(proposta: string) {
  const caminho = novoCaminho(proposta);
  const envio = await enviarArquivo(ana, caminho);
  expect(envio.error).toBeNull();
  const { data, error } = await ana.rpc("enviar_contrato", { p_proposta: proposta, p_caminho: caminho, p_nome: "contrato.pdf" });
  expect(error).toBeNull();
  return { caminho, id: data as string };
}

test("o corretor envia o PDF pelo link assinado e o banco registra o tamanho que o Storage guardou", async () => {
  const proposta = await propostaAceita();
  const { id } = await contratoEnviado(proposta);
  const { data } = await clienteAdmin().from("contratos").select("status, tamanho_bytes, enviado_por").eq("id", id).single();
  expect(data).toEqual({ status: "em_analise", tamanho_bytes: PDF.length, enviado_por: anaId });
});

test("o começo do arquivo pode ser lido sem baixar tudo, para conferir que é PDF", async () => {
  const proposta = await propostaAceita();
  const { caminho } = await contratoEnviado(proposta);
  const { data } = await ana.storage.from(BUCKET).createSignedUrl(caminho, 60);
  const resposta = await fetch(data!.signedUrl, { headers: { Range: "bytes=0-4" } });
  expect(resposta.ok).toBe(true);
  expect(await resposta.text()).toBe("%PDF-");
});

test("o bucket recusa tipo que não é PDF e arquivo acima de 20 MB", async () => {
  const proposta = await propostaAceita();
  const imagem = await enviarArquivo(ana, novoCaminho(proposta), PDF, "image/png");
  expect(imagem.error).not.toBeNull();
  const grande = await enviarArquivo(ana, novoCaminho(proposta), new Uint8Array(20 * 1024 * 1024 + 1));
  expect(grande.error).not.toBeNull();
  expect(((await clienteAdmin().storage.from(BUCKET).list(proposta)).data ?? []).length).toBe(0);
});

test("outro corretor não envia na pasta da proposta e não registra o arquivo dela", async () => {
  const proposta = await propostaAceita();
  const caminho = novoCaminho(proposta);
  expect((await enviarArquivo(beto, caminho)).error).not.toBeNull();
  expect((await enviarArquivo(ana, caminho)).error).toBeNull();
  const { error } = await beto.rpc("enviar_contrato", { p_proposta: proposta, p_caminho: caminho, p_nome: "x.pdf" });
  expect(error?.hint).toBe("proposta_nao_encontrada");
});

test("só quem enviou, o dono e o admin abrem o PDF", async () => {
  const proposta = await propostaAceita();
  const { caminho } = await contratoEnviado(proposta);
  const link = async (cliente: Sessao) => (await cliente.storage.from(BUCKET).createSignedUrl(caminho, 60)).data?.signedUrl;
  expect(await link(ana)).toBeTruthy();
  expect(await link(dono)).toBeTruthy();
  expect(await link(adm)).toBeTruthy();
  expect(await link(beto)).toBeUndefined();
  expect((await beto.storage.from(BUCKET).download(caminho)).error).not.toBeNull();
});

test("quem enviou apaga o arquivo sem registro, mas ninguém apaga nem troca o contrato registrado", async () => {
  const proposta = await propostaAceita();
  const solto = novoCaminho(proposta);
  expect((await enviarArquivo(ana, solto)).error).toBeNull();
  await ana.storage.from(BUCKET).remove([solto]);
  expect((await clienteAdmin().storage.from(BUCKET).exists(solto)).data).toBe(false);

  const { caminho } = await contratoEnviado(proposta);
  for (const cliente of [ana, dono, adm]) await cliente.storage.from(BUCKET).remove([caminho]);
  expect((await clienteAdmin().storage.from(BUCKET).exists(caminho)).data).toBe(true);

  const troca = await ana.storage.from(BUCKET).update(caminho, new Blob([PDF], { type: "application/pdf" }));
  expect(troca.error).not.toBeNull();
});

test("com contrato em análise não entra outro arquivo, e depois da recusa entra", async () => {
  const proposta = await propostaAceita();
  const { id } = await contratoEnviado(proposta);
  expect((await enviarArquivo(ana, novoCaminho(proposta))).error).not.toBeNull();

  const { error } = await adm.rpc("recusar_contrato", { p_contrato: id, p_motivo: "Falta assinatura" });
  expect(error).toBeNull();
  await contratoEnviado(proposta);
  const { data } = await clienteAdmin().from("contratos").select("status").eq("proposta_id", proposta).order("enviado_em");
  expect(data?.map((linha) => linha.status)).toEqual(["recusado", "em_analise"]);
});

test("aprovar pela API vende o imóvel, e a limpeza dos testes consegue apagar tudo", async () => {
  const proposta = await propostaAceita();
  const { id } = await contratoEnviado(proposta);
  const { error } = await adm.rpc("aprovar_contrato", { p_contrato: id, p_valor_final: 7_100_000, p_comissao: 71_000, p_comissao_paga: false });
  expect(error).toBeNull();
  const admin = clienteAdmin();
  const imovel = (await admin.from("propostas").select("imovel_id").eq("id", proposta).single()).data!.imovel_id;
  expect((await admin.from("imoveis").select("status").eq("id", imovel).single()).data?.status).toBe("vendido");
  // O dono vê o valor final, nunca a comissão.
  const { data: resumo } = await dono.rpc("resumo_de_propostas", { p_imovel: imovel });
  expect(resumo?.[0]).toMatchObject({ venda_valor: 7_100_000 });
  expect(resumo?.[0]).not.toHaveProperty("comissao_valor");
  expect((await dono.from("vendas").select("id")).data).toEqual([]);
});

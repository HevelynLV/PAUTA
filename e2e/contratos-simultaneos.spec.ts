import { expect, test } from "@playwright/test";

import { apagarContas, assinaturaDoContrato, clienteAdmin, criarConta, entrarComo, mudarAssinatura, tornarAdmin } from "./apoio/supabase";

// Operações de contrato ao mesmo tempo (RNF05). O testar_rls.sql roda numa conexão só e
// não enxerga a disputa; aqui cada chamada vai pela API, como duas telas fariam. Chamar o
// banco não depende do tamanho de tela: roda só no projeto "celular".
//
// Os imóveis de teste usam preços 7.781.xxx.

test.describe.configure({ timeout: 180_000 });

const PREFIXO = "e2e-contrato-simult-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
const PDF = new TextEncoder().encode("%PDF-1.7\nContrato de teste do PAUTA\n%%EOF\n");
// O mesmo cenário algumas vezes: a ordem de chegada muda de uma rodada para outra.
const RODADAS = 3;

type Cliente = Awaited<ReturnType<typeof entrarComo>>["cliente"];
type Resposta = { error: { hint?: string | null } | null };
let donoId: string;
let dono: Cliente;
let adm: Cliente;
const corretores: { id: string; cliente: Cliente }[] = [];
let preco = 7_781_000;

test.beforeAll(async () => {
  test.skip(test.info().project.name !== "celular", "só chama a API: basta uma vez");
  await apagarContas(PREFIXO);
  donoId = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dono Simultâneo", telefone: "48999990124" });
  dono = (await entrarComo(email("dono"))).cliente;
  for (const [i, nome] of ["ana", "beto", "cida"].entries()) {
    const id = await criarConta(email(nome), { tipo: "autonomo", nome, telefone: `4899999012${5 + i}`, creci: `${unico()}-F` });
    await mudarAssinatura(id, "ativo");
    corretores.push({ id, cliente: (await entrarComo(email(nome))).cliente });
  }
  const admId = await criarConta(email("adm"), { tipo: "proprietario", nome: "Admin", telefone: "48999990128" });
  await tornarAdmin(admId);
  adm = (await entrarComo(email("adm"))).cliente;
});

test.afterAll(() => apagarContas(PREFIXO));

async function criarImovel() {
  const admin = clienteAdmin();
  const tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  const bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;
  const agora = Date.now();
  preco += 1;
  const { data, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: donoId,
      titulo: "Casa dos contratos simultâneos",
      descricao: "Casa de teste.",
      tipo_id: tipo,
      endereco: "Rua Simultânea, 20",
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
  return data.id as string;
}

async function propostaAceita(imovel: string, corretor: (typeof corretores)[number]) {
  const { data, error } = await corretor.cliente.rpc("enviar_proposta", {
    p_imovel: imovel,
    p_valor: 7_000_000,
    p_forma: "a_vista",
    p_condicoes: "Escritura em 60 dias",
  });
  if (error) throw error;
  const { error: erroAceite } = await dono.rpc("aceitar_proposta", { p_proposta: data });
  if (erroAceite) throw erroAceite;
  return data as string;
}

// Sobe o PDF para a pasta da proposta. Sem registrar: o registro é a disputa de alguns testes.
async function subirPdf(proposta: string, corretor: (typeof corretores)[number]) {
  const caminho = `${proposta}/${crypto.randomUUID()}.pdf`;
  const balde = corretor.cliente.storage.from("contratos");
  const { data, error } = await balde.createSignedUploadUrl(caminho);
  if (error) throw error;
  const envio = await balde.uploadToSignedUrl(caminho, data.token, new Blob([PDF], { type: "application/pdf" }), { contentType: "application/pdf" });
  if (envio.error) throw envio.error;
  return caminho;
}

// A assinatura é calculada antes, para a disputa ser só a do registro.
const registrar = (proposta: string, caminho: string, corretor: (typeof corretores)[number], p_assinatura: string) =>
  corretor.cliente.rpc("enviar_contrato", { p_proposta: proposta, p_caminho: caminho, p_nome: "contrato.pdf", p_assinatura });

async function contratoEmAnalise(imovel: string, corretor: (typeof corretores)[number]) {
  const proposta = await propostaAceita(imovel, corretor);
  const caminho = await subirPdf(proposta, corretor);
  const { data, error } = await registrar(proposta, caminho, corretor, await assinaturaDoContrato(proposta, caminho, corretor.id));
  if (error) throw error;
  return { proposta, contrato: data as string };
}

const aprovar = (contrato: string) =>
  adm.rpc("aprovar_contrato", { p_contrato: contrato, p_valor_final: 7_000_000, p_comissao: 70_000, p_comissao_paga: false });

const dicas = (respostas: Resposta[]) => respostas.filter((r) => r.error).map((r) => r.error!.hint);
const certas = (respostas: Resposta[]) => respostas.filter((r) => !r.error).length;

async function situacao(imovel: string) {
  const admin = clienteAdmin();
  const status = (await admin.from("imoveis").select("status").eq("id", imovel).single()).data!.status;
  const contratos = ((await admin.from("contratos").select("status, motivo_recusa").eq("imovel_id", imovel)).data ?? []).map(
    (c) => `${c.status}${c.motivo_recusa ? `: ${c.motivo_recusa}` : ""}`,
  );
  const vendas = ((await admin.from("vendas").select("id").eq("imovel_id", imovel)).data ?? []).length;
  const propostas = ((await admin.from("propostas").select("status").eq("imovel_id", imovel)).data ?? []).map((p) => p.status);
  return { status, contratos: contratos.sort(), vendas, propostas: propostas.sort() };
}

test("dois contratos do mesmo imóvel aprovados ao mesmo tempo: uma venda só", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const a = await contratoEmAnalise(imovel, corretores[0]);
    const b = await contratoEmAnalise(imovel, corretores[1]);
    const respostas = await Promise.all([aprovar(a.contrato), aprovar(b.contrato)]);

    expect(certas(respostas)).toBe(1);
    // Quem chega depois encontra o imóvel vendido ou o próprio contrato já recusado.
    for (const dica of dicas(respostas)) expect(["imovel_fora_do_catalogo", "contrato_ja_conferido"]).toContain(dica);
    expect(await situacao(imovel)).toEqual({
      status: "vendido",
      contratos: ["aprovado", "recusado: Imóvel vendido por outra proposta"],
      vendas: 1,
      propostas: ["aceita", "recusada"],
    });
  }
});

test("o mesmo contrato aprovado duas vezes: uma venda só", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const { contrato } = await contratoEmAnalise(imovel, corretores[0]);
    const respostas = await Promise.all([aprovar(contrato), aprovar(contrato)]);
    expect(certas(respostas)).toBe(1);
    for (const dica of dicas(respostas)) expect(["imovel_fora_do_catalogo", "contrato_ja_conferido"]).toContain(dica);
    expect((await situacao(imovel)).vendas).toBe(1);
  }
});

test("aprovar e recusar o mesmo contrato ao mesmo tempo: vale o primeiro que chegar", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const { contrato } = await contratoEmAnalise(imovel, corretores[0]);
    const [aprovacao, recusa] = await Promise.all([
      aprovar(contrato),
      adm.rpc("recusar_contrato", { p_contrato: contrato, p_motivo: "Recusado na disputa" }),
    ]);
    expect(certas([aprovacao, recusa])).toBe(1);
    const fim = await situacao(imovel);
    if (aprovacao.error) {
      expect(fim).toMatchObject({ status: "disponivel", contratos: ["recusado: Recusado na disputa"], vendas: 0 });
    } else {
      expect(fim).toMatchObject({ status: "vendido", contratos: ["aprovado"], vendas: 1 });
    }
  }
});

test("o dono aceita outra proposta enquanto o admin aprova: ela termina recusada", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const { contrato } = await contratoEmAnalise(imovel, corretores[0]);
    const { data: outra, error } = await corretores[1].cliente.rpc("enviar_proposta", {
      p_imovel: imovel,
      p_valor: 6_900_000,
      p_forma: "a_vista",
      p_condicoes: "Escritura em 30 dias",
    });
    if (error) throw error;
    const [aprovacao, aceite] = await Promise.all([aprovar(contrato), dono.rpc("aceitar_proposta", { p_proposta: outra })]);
    expect(aprovacao.error).toBeNull();
    // O aceite chega antes (e a venda recusa a proposta) ou depois (e o imóvel já saiu).
    if (aceite.error) expect(aceite.error.hint).toBe("imovel_fora_do_catalogo");
    expect(await situacao(imovel)).toMatchObject({ status: "vendido", vendas: 1, propostas: ["aceita", "recusada"] });
  }
});

test("outro corretor registra o contrato enquanto o admin aprova: o dele não fica em análise", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const { contrato } = await contratoEmAnalise(imovel, corretores[0]);
    const doBeto = await propostaAceita(imovel, corretores[1]);
    const caminho = await subirPdf(doBeto, corretores[1]);
    const assinatura = await assinaturaDoContrato(doBeto, caminho, corretores[1].id);
    const [aprovacao, registro] = await Promise.all([aprovar(contrato), registrar(doBeto, caminho, corretores[1], assinatura)]);
    expect(aprovacao.error).toBeNull();
    const fim = await situacao(imovel);
    expect(fim).toMatchObject({ status: "vendido", vendas: 1 });
    if (registro.error) {
      expect(["imovel_fora_do_catalogo", "proposta_nao_aceita", "proposta_encerrada"]).toContain(registro.error.hint);
      expect(fim.contratos).toEqual(["aprovado"]);
    } else {
      expect(fim.contratos).toEqual(["aprovado", "recusado: Imóvel vendido por outra proposta"]);
    }
    expect(fim.contratos).not.toContain("em_analise");
  }
});

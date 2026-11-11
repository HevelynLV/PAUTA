import { expect, test } from "@playwright/test";

import { apagarContas, clienteAdmin, criarConta, entrarComo, esquecerEnviosRecentes, mudarAssinatura } from "./apoio/supabase";

// Operações de proposta ao mesmo tempo (auditoria da Etapa 8). O testar_rls.sql roda numa
// conexão só e não enxerga isso; aqui cada chamada vai pela API, como dois celulares
// fariam. Chamar o banco não depende do tamanho de tela: roda só no projeto "celular".
//
// O que não está aqui: enviar_proposta ou pedir_visita x remover_corretor. A janela é de
// milissegundos e só aparece segurando a linha do imóvel com uma terceira conexão, que
// os testes não têm. Foi provado à mão no passo 8.5 (ver o ROADMAP.md).
//
// Os imóveis de teste usam preços 7.775.xxx.

test.describe.configure({ timeout: 120_000 });

const PREFIXO = "e2e-simultaneas-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));
// O mesmo cenário algumas vezes: a ordem de chegada muda de uma rodada para outra.
const RODADAS = 3;

type Sessao = Awaited<ReturnType<typeof entrarComo>>;
type Resposta = { error: { hint?: string | null } | null };
let dono: { id: string; cliente: Sessao["cliente"] };
const corretores: { id: string; cliente: Sessao["cliente"] }[] = [];
let tipo: number;
let bairro: number;
let preco = 7_775_000;

test.beforeAll(async () => {
  test.skip(test.info().project.name !== "celular", "só chama a API: basta uma vez");
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;

  const idDono = await criarConta(email("dono"), { tipo: "proprietario", nome: "Dono Simultâneo", telefone: "48999990060" });
  dono = { id: idDono, cliente: (await entrarComo(email("dono"))).cliente };
  for (const [i, nome] of ["ana", "beto", "cida"].entries()) {
    const id = await criarConta(email(nome), { tipo: "autonomo", nome, telefone: `4899999006${i + 1}`, creci: `${unico()}-F` });
    await mudarAssinatura(id, "ativo");
    corretores.push({ id, cliente: (await entrarComo(email(nome))).cliente });
  }
});

// A "ana" envia em quase todos os testes: sem isto, passaria do limite de 10 por hora.
test.afterEach(() => esquecerEnviosRecentes(corretores.map((c) => c.id)));
test.afterAll(() => apagarContas(PREFIXO));

async function criarImovel() {
  const agora = Date.now();
  preco += 1;
  const { data, error } = await clienteAdmin()
    .from("imoveis")
    .insert({
      proprietario_id: dono.id,
      titulo: "Casa das propostas simultâneas",
      descricao: "Casa de teste.",
      tipo_id: tipo,
      endereco: "Rua Simultânea, 10",
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

const enviar = (corretor: (typeof corretores)[number], imovelId: string) =>
  corretor.cliente.rpc("enviar_proposta", {
    p_imovel: imovelId,
    p_valor: 7_000_000,
    p_forma: "a_vista",
    p_condicoes: "Escritura em 60 dias",
  });

async function enviarUma(corretor: (typeof corretores)[number], imovelId: string) {
  const { data, error } = await enviar(corretor, imovelId);
  if (error) throw error;
  return data as string;
}

const statusDoImovel = async (imovelId: string) =>
  ((await clienteAdmin().from("propostas").select("status").eq("imovel_id", imovelId)).data ?? []).map((p) => p.status).sort();

// Quem perdeu a disputa recebe um erro que a tela conhece, nunca um erro do banco.
const dicas = (respostas: Resposta[]) => respostas.filter((r) => r.error).map((r) => r.error!.hint);
const aceitas = (respostas: Resposta[]) => respostas.filter((r) => !r.error).length;

test("o mesmo corretor enviando várias vezes fica com uma proposta só", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const respostas = await Promise.all([1, 2, 3, 4, 5].map(() => enviar(corretores[0], imovel)));
    expect(aceitas(respostas)).toBe(1);
    expect(new Set(dicas(respostas))).toEqual(new Set(["proposta_em_aberto"]));
    expect(await statusDoImovel(imovel)).toEqual(["aguardando"]);
  }
});

test("corretores diferentes enviam ao mesmo tempo e ninguém perde a proposta", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const respostas = await Promise.all(corretores.map((corretor) => enviar(corretor, imovel)));
    expect(dicas(respostas)).toEqual([]);
    expect(await statusDoImovel(imovel)).toEqual(["aguardando", "aguardando", "aguardando"]);
  }
});

test("o dono aceita duas propostas ao mesmo tempo", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const propostas = [await enviarUma(corretores[0], imovel), await enviarUma(corretores[1], imovel)];
    const respostas = await Promise.all(propostas.map((p) => dono.cliente.rpc("aceitar_proposta", { p_proposta: p })));
    expect(dicas(respostas)).toEqual([]);
    expect(await statusDoImovel(imovel)).toEqual(["aceita", "aceita"]);
  }
});

test("aceitar duas vezes a mesma proposta: vale uma", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const proposta = await enviarUma(corretores[0], imovel);
    const respostas = await Promise.all([1, 2].map(() => dono.cliente.rpc("aceitar_proposta", { p_proposta: proposta })));
    expect(aceitas(respostas)).toBe(1);
    expect(dicas(respostas)).toEqual(["proposta_ja_respondida"]);
    expect(await statusDoImovel(imovel)).toEqual(["aceita"]);
  }
});

test("aceitar e recusar ao mesmo tempo: vale a primeira que chegar", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const proposta = await enviarUma(corretores[0], imovel);
    const respostas = await Promise.all([
      dono.cliente.rpc("aceitar_proposta", { p_proposta: proposta }),
      dono.cliente.rpc("recusar_proposta", { p_proposta: proposta }),
    ]);
    expect(aceitas(respostas)).toBe(1);
    expect(dicas(respostas)).toEqual(["proposta_ja_respondida"]);
    const esperado = respostas[0].error ? "recusada" : "aceita";
    expect(await statusDoImovel(imovel)).toEqual([esperado]);
  }
});

test("aceitar enquanto o corretor retira: a proposta termina retirada", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const proposta = await enviarUma(corretores[0], imovel);
    const [aceite, retirada] = await Promise.all([
      dono.cliente.rpc("aceitar_proposta", { p_proposta: proposta }),
      corretores[0].cliente.rpc("cancelar_proposta", { p_proposta: proposta }),
    ]);
    // O aceite pode chegar antes (e a retirada desfaz) ou depois (e é recusado).
    expect(retirada.error).toBeNull();
    if (aceite.error) expect(aceite.error.hint).toBe("proposta_ja_respondida");
    expect(await statusDoImovel(imovel)).toEqual(["cancelada"]);
  }
});

test("desfazer o aceite enquanto o corretor retira: a proposta termina retirada", async () => {
  for (let i = 0; i < RODADAS; i++) {
    const imovel = await criarImovel();
    const proposta = await enviarUma(corretores[0], imovel);
    await dono.cliente.rpc("aceitar_proposta", { p_proposta: proposta });
    const [desfazer, retirada] = await Promise.all([
      dono.cliente.rpc("desfazer_aceite", { p_proposta: proposta }),
      corretores[0].cliente.rpc("cancelar_proposta", { p_proposta: proposta }),
    ]);
    expect(retirada.error).toBeNull();
    if (desfazer.error) expect(desfazer.error.hint).toBe("proposta_encerrada");
    expect(await statusDoImovel(imovel)).toEqual(["cancelada"]);
  }
});

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { configDoWhatsApp, processarFilaDoWhatsApp, type ConfigDoWhatsApp } from "../src/lib/whatsappFila";
import { apagarContas, clienteAdmin, criarConta, mudarAssinatura } from "./apoio/supabase";

// Fila do WhatsApp (passo 10.3b, RF29). Decidido em 10/11/2026: o número de teste da Meta
// não entrega para celulares do Brasil, então a Meta é simulada aqui (o fetch é trocado por
// uma função), e a fila, o segredo e o banco são os de verdade. O envio real num celular
// brasileiro fica para o piloto (Etapa 13).
//
// A fila é de todo mundo, mas o teste só reserva os avisos das próprias contas (filtro
// "destinatarios"), para não mexer nos avisos de outras pessoas no banco compartilhado. Por
// garantia, a Meta falsa ainda responde erro para qualquer número que não seja do teste.

const PREFIXO = "e2e-whatsapp-";
const email = (nome: string) => `${PREFIXO}${nome}@exemplo.com`;
const unico = () => String(Math.floor(10_000 + Math.random() * 89_999));

const TELEFONE_DONA = "48999990190";
const TELEFONE_SEM = "48999990191";
const TELEFONE_FALHA = "48999990192";

const segredo = process.env.WHATSAPP_FILA_SEGREDO;
const config: ConfigDoWhatsApp | null = segredo
  ? configDoWhatsApp({ WHATSAPP_TOKEN: "token-falso", WHATSAPP_NUMERO_ID: "123", WHATSAPP_FILA_SEGREDO: segredo, WHATSAPP_API_URL: "https://meta.falsa" })
  : null;

type Envio = { url: string; token: string | null; corpo: Record<string, unknown> & { to: string } };
type Resposta = (envio: Envio) => Response | Promise<Response>;

// A Meta falsa: guarda cada envio e responde como a função mandar. Número que não é do
// teste recebe erro, para nunca marcar como enviado um aviso de outra pessoa.
function metaFalsa(telefonesDoTeste: string[], responder: Resposta) {
  const envios: Envio[] = [];
  const enviar = (async (url: string | URL | Request, init?: RequestInit) => {
    const envio: Envio = {
      url: String(url),
      token: new Headers(init?.headers).get("authorization"),
      corpo: JSON.parse(String(init?.body)),
    };
    if (!telefonesDoTeste.includes(envio.corpo.to)) {
      return Response.json({ error: { code: 0, message: "simulado: fora do teste" } }, { status: 400 });
    }
    envios.push(envio);
    return responder(envio);
  }) as typeof fetch;
  return { enviar, envios };
}

const clienteAnonimo = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

let corretor: string;
let tipo: number;
let bairro: number;
let preco = 7_776_000;

test.beforeAll(async () => {
  test.skip(test.info().project.name !== "celular", "só chama a fila e o banco: basta uma vez");
  test.skip(!config, "falta WHATSAPP_FILA_SEGREDO no .env.local (o mesmo valor do Vault, pauta_whatsapp_fila)");
  await apagarContas(PREFIXO);
  const admin = clienteAdmin();
  tipo = (await admin.from("tipos_imovel").select("id").eq("nome", "Casa").single()).data!.id;
  bairro = (await admin.from("bairros").select("id").eq("nome", "Campeche").single()).data!.id;
  corretor = await criarConta(email("corretor"), { tipo: "autonomo", nome: "Rui Corretor", telefone: "48999990193", creci: `${unico()}-F` });
  await mudarAssinatura(corretor, "ativo");
});

test.afterAll(() => apagarContas(PREFIXO));

// Dono com um imóvel e um pedido de visita: o gatilho do banco cria o aviso visita_pedida.
async function avisoDeVisita(nome: string, telefone: string, whatsapp: boolean) {
  const dono = await criarConta(email(nome), {
    tipo: "proprietario",
    nome: `Dona ${nome}`,
    telefone,
    ...(whatsapp && { whatsapp: "true" }),
  });
  const admin = clienteAdmin();
  const agora = Date.now();
  preco += 1;
  const { data: imovel, error } = await admin
    .from("imoveis")
    .insert({
      proprietario_id: dono,
      titulo: `Casa do WhatsApp ${nome}`,
      descricao: "Casa de teste do WhatsApp.",
      tipo_id: tipo,
      endereco: "Rua do WhatsApp, 1",
      bairro_id: bairro,
      preco,
      quartos: 2,
      banheiros: 1,
      vagas: 1,
      area: 90,
      status: "disponivel",
      termo_versao: "2026-10-provisorio",
      termo_aceito_em: new Date(agora).toISOString(),
      exclusividade_inicio: new Date(agora).toISOString(),
      exclusividade_fim: new Date(agora + 180 * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  const horario = new Date(Math.ceil((agora + 3 * 86_400_000) / 3_600_000) * 3_600_000).toISOString();
  const { error: erroVisita } = await admin.from("visitas").insert({ imovel_id: imovel.id, corretor_id: corretor, horario, status: "pendente" });
  if (erroVisita) throw erroVisita;
  const { data: aviso } = await admin.from("avisos").select("id").eq("destinatario_id", dono).eq("tipo", "visita_pedida").single();
  return { aviso: aviso!.id as number, dono };
}

// Roda a fila só com os avisos da conta do teste.
const rodarFila = (dono: string, enviar: typeof fetch) =>
  processarFilaDoWhatsApp(clienteAnonimo(), config!, enviar, { destinatarios: [dono] });

// Passa a espera da nova tentativa (5 minutos por tentativa, no banco).
const passarEspera = async (id: number) => {
  const { error } = await clienteAdmin()
    .from("avisos")
    .update({ whatsapp_reservado_em: new Date(Date.now() - 3_600_000).toISOString() })
    .eq("id", id);
  if (error) throw error;
};

const situacao = async (id: number) =>
  (await clienteAdmin().from("avisos").select("whatsapp, whatsapp_tentativas, whatsapp_id, whatsapp_erro").eq("id", id).single()).data!;

test("o aviso sai pelo modelo, com o telefone em +55 e o texto da lista, e fica enviado", async () => {
  const { aviso, dono } = await avisoDeVisita("ana", TELEFONE_DONA, true);
  expect((await situacao(aviso)).whatsapp).toBe("pendente");

  const meta = metaFalsa([`55${TELEFONE_DONA}`], () => Response.json({ messages: [{ id: "wamid.falso.1" }] }));
  await rodarFila(dono, meta.enviar);

  expect(meta.envios).toHaveLength(1);
  const [envio] = meta.envios;
  expect(envio.url).toBe("https://meta.falsa/v21.0/123/messages");
  expect(envio.token).toBe("Bearer token-falso");
  expect(envio.corpo).toMatchObject({
    messaging_product: "whatsapp",
    to: `55${TELEFONE_DONA}`,
    type: "template",
    template: { name: "aviso_pauta", language: { code: "pt_BR" } },
  });
  const parametros = (envio.corpo.template as { components: { parameters: { text: string }[] }[] }).components[0].parameters;
  expect(parametros).toHaveLength(2);
  expect(parametros[1].text).toContain("Rui Corretor");
  for (const { text } of parametros) expect(text).not.toMatch(/[\n\t]| {2}/);

  expect(await situacao(aviso)).toMatchObject({ whatsapp: "enviado", whatsapp_tentativas: 1, whatsapp_id: "wamid.falso.1" });

  // Já enviado: a fila não manda de novo.
  const outra = metaFalsa([`55${TELEFONE_DONA}`], () => Response.json({ messages: [{ id: "wamid.falso.2" }] }));
  await rodarFila(dono, outra.enviar);
  expect(outra.envios).toHaveLength(0);
});

test("quem não aceitou o WhatsApp não recebe; o aviso no app existe do mesmo jeito", async () => {
  const { aviso, dono } = await avisoDeVisita("bia", TELEFONE_SEM, false);
  const meta = metaFalsa([`55${TELEFONE_SEM}`], () => Response.json({ messages: [{ id: "wamid.nunca" }] }));
  await rodarFila(dono, meta.enviar);
  expect(meta.envios).toHaveLength(0);
  expect((await situacao(aviso)).whatsapp).toBe("desligado");
});

test("a Meta recusa ou cai: tenta 3 vezes e fica falhou, com o erro guardado", async () => {
  const { aviso, dono } = await avisoDeVisita("cris", TELEFONE_FALHA, true);
  let chamada = 0;
  const meta = metaFalsa([`55${TELEFONE_FALHA}`], () => {
    chamada++;
    // Na primeira, a Meta não responde; depois, recusa o número.
    if (chamada === 1) throw new TypeError("fetch failed");
    return Response.json({ error: { code: 131030, message: "Recipient phone number not in allowed list" } }, { status: 400 });
  });

  await rodarFila(dono, meta.enviar);
  expect(await situacao(aviso)).toMatchObject({ whatsapp: "falhou", whatsapp_tentativas: 1 });
  expect((await situacao(aviso)).whatsapp_erro).toContain("Sem resposta da Meta");

  // Logo depois da falha, a fila espera: uma queda curta da Meta não gasta as 3 tentativas.
  await rodarFila(dono, meta.enviar);
  expect(await situacao(aviso)).toMatchObject({ whatsapp: "falhou", whatsapp_tentativas: 1 });
  expect(meta.envios).toHaveLength(1);

  await passarEspera(aviso);
  await rodarFila(dono, meta.enviar);
  await passarEspera(aviso);
  await rodarFila(dono, meta.enviar);
  const depois = await situacao(aviso);
  expect(depois).toMatchObject({ whatsapp: "falhou", whatsapp_tentativas: 3 });
  expect(depois.whatsapp_erro).toContain("131030");

  // Sem tentativa sobrando: não chama mais a Meta.
  await passarEspera(aviso);
  await rodarFila(dono, meta.enviar);
  expect(meta.envios).toHaveLength(3);
});

test("sem as chaves no ambiente, o WhatsApp é pulado", () => {
  expect(configDoWhatsApp({})).toBeNull();
  expect(configDoWhatsApp({ WHATSAPP_TOKEN: "x", WHATSAPP_NUMERO_ID: "1" })).toBeNull();
  expect(configDoWhatsApp({ WHATSAPP_TOKEN: "x", WHATSAPP_NUMERO_ID: "1", WHATSAPP_FILA_SEGREDO: "s" })?.api).toBe("https://graph.facebook.com");
  // O servidor do e2e desliga o WhatsApp mesmo com as chaves no .env.local (playwright.config.ts).
  expect(configDoWhatsApp({ WHATSAPP_DESLIGADO: "1", WHATSAPP_TOKEN: "x", WHATSAPP_NUMERO_ID: "1", WHATSAPP_FILA_SEGREDO: "s" })).toBeNull();
});

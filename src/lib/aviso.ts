// Avisos (RF29): o único lugar com o título, o texto, o ícone e a cor de cada tipo de
// aviso. Os dados vêm do banco já como um retrato do momento (migrations
// 20261109232807_avisos e 20261109234543_avisos_nos_eventos); aqui só viram frase.
// Serve à lista do app e, no passo 10.3b, ao WhatsApp. Roda no navegador e no servidor.

import { diaDe, diaEMes, formatarHorario, horaDe, nomeDoDia } from "@/lib/horariosDeVisita";
import { formatarData, formatarPreco } from "@/lib/imovel";

export type TipoAviso =
  | "imovel_aprovado"
  | "imovel_reprovado"
  | "imovel_captado"
  | "visita_pedida"
  | "visita_cancelada_pelo_corretor"
  | "visita_cancelada_corretor_saiu"
  | "proposta_recebida"
  | "proposta_retirada"
  | "proposta_cancelada_corretor_saiu"
  | "contrato_enviado"
  | "imovel_vendido"
  | "visita_confirmada"
  | "visita_recusada"
  | "visita_horario_ocupado"
  | "visita_cancelada_pelo_proprietario"
  | "visita_cancelada_pela_venda"
  | "proposta_aceita"
  | "proposta_recusada"
  | "aceite_desfeito"
  | "proposta_recusada_pela_venda"
  | "contrato_aprovado"
  | "contrato_recusado"
  | "contrato_recusado_pela_venda"
  | "imovel_novo"
  | "assinatura_ativada"
  | "corretor_entrou";

// O que o banco guarda em avisos.dados. Cada tipo usa só uma parte.
export type DadosDoAviso = {
  titulo?: string;
  corretor?: string;
  imobiliaria?: string | null;
  horario?: string;
  endereco?: string;
  valor?: number;
  valor_final?: number;
  preco?: number;
  bairro?: string;
  motivo?: string;
  exclusividade_fim?: string;
  nome?: string;
};

export type Aviso = {
  id: number;
  tipo: TipoAviso;
  imovel_id: string | null;
  dados: DadosDoAviso;
  link: string;
  criado_em: string;
  novo: boolean;
};

export type IconeDoAviso = "ok" | "calendario" | "contrato" | "contratoRecusado" | "casa" | "proposta" | "fechar" | "equipe";
export type CorDoAviso = "mar" | "erro" | "areia" | "roxo";

export type TextoDoAviso = {
  titulo: string;
  texto: string;
  icone: IconeDoAviso;
  cor: CorDoAviso;
  // "Toque para ..." do protótipo, quando o aviso pede uma ação.
  acao?: string;
};

// "o Imóvel X" fica estranho: o título vai entre aspas, como nas outras telas.
const imovel = (d: DadosDoAviso) => (d.titulo ? `“${d.titulo}”` : "o imóvel");
// "Ana Souza (Maré Imóveis)" ou só "Ana Souza" para o autônomo.
const corretor = (d: DadosDoAviso) => `${d.corretor ?? "Um corretor"}${d.imobiliaria ? ` (${d.imobiliaria})` : ""}`;
const preco = (valor: number | undefined) => (typeof valor === "number" ? formatarPreco(Number(valor)) : "");
// "ter, 14/10 às 10:00", para o meio da frase.
const horario = (d: DadosDoAviso) => (d.horario ? minuscula(formatarHorario(d.horario)) : "o horário marcado");
const minuscula = (texto: string) => texto.charAt(0).toLowerCase() + texto.slice(1);
// O motivo é texto livre: termina a frase sem ponto dobrado.
const semPontoFinal = (texto: string | undefined) => (texto ?? "").trim().replace(/[.!]+$/, "");

export function textoDoAviso(tipo: TipoAviso, d: DadosDoAviso): TextoDoAviso {
  switch (tipo) {
    // Proprietário
    case "imovel_aprovado":
      return {
        titulo: "Imóvel aprovado",
        texto: `${maiuscula(imovel(d))} está no catálogo.${d.exclusividade_fim ? ` A exclusividade vai até ${formatarData(d.exclusividade_fim)}.` : ""}`,
        icone: "ok",
        cor: "mar",
      };
    case "imovel_reprovado":
      return {
        titulo: "Imóvel reprovado",
        texto: `${maiuscula(imovel(d))} precisa de ajustes: ${semPontoFinal(d.motivo)}. Edite e reenvie.`,
        icone: "fechar",
        cor: "erro",
        acao: "Toque para editar",
      };
    case "imovel_captado":
      return {
        titulo: "Seu imóvel no PAUTA",
        texto: `A equipe PAUTA cadastrou ${imovel(d)}. Confira os dados e, quando as fotos estiverem lá, aceite o termo de exclusividade para ele entrar no catálogo.`,
        icone: "casa",
        cor: "areia",
        acao: "Toque para conferir",
      };
    case "visita_pedida":
      return {
        titulo: "Pedido de visita",
        texto: `${corretor(d)} quer visitar ${imovel(d)} ${prefixoDoDia(d)}${horario(d)}.`,
        icone: "calendario",
        cor: "mar",
        acao: "Toque para confirmar ou recusar",
      };
    case "visita_cancelada_pelo_corretor":
      return {
        titulo: "Visita cancelada",
        texto: `${corretor(d)} cancelou a visita de ${horario(d)} em ${imovel(d)}.`,
        icone: "calendario",
        cor: "erro",
      };
    case "visita_cancelada_corretor_saiu":
      return {
        titulo: "Visita cancelada",
        texto: `${d.corretor ?? "O corretor"} saiu da ${d.imobiliaria ?? "imobiliária"}, e a visita de ${horario(d)} em ${imovel(d)} foi cancelada.`,
        icone: "calendario",
        cor: "erro",
      };
    case "proposta_recebida":
      return {
        titulo: `Nova proposta: ${preco(d.valor)}`,
        texto: `${corretor(d)} enviou uma proposta para ${imovel(d)}.`,
        icone: "proposta",
        cor: "mar",
        acao: "Toque para responder",
      };
    case "proposta_retirada":
      return {
        titulo: "Proposta retirada",
        texto: `${corretor(d)} retirou a proposta de ${preco(d.valor)} em ${imovel(d)}.`,
        icone: "proposta",
        cor: "erro",
      };
    case "proposta_cancelada_corretor_saiu":
      return {
        titulo: "Proposta cancelada",
        texto: `${d.corretor ?? "O corretor"} saiu da ${d.imobiliaria ?? "imobiliária"}, e a proposta de ${preco(d.valor)} em ${imovel(d)} foi cancelada.`,
        icone: "proposta",
        cor: "erro",
      };
    case "contrato_enviado":
      return {
        titulo: "Contrato enviado",
        texto: `${corretor(d)} enviou o contrato assinado de ${imovel(d)}. A equipe PAUTA está conferindo.`,
        icone: "contrato",
        cor: "roxo",
      };
    case "imovel_vendido":
      return {
        titulo: "Imóvel vendido",
        texto: `A venda de ${imovel(d)} foi registrada por ${preco(d.valor_final)}.`,
        icone: "ok",
        cor: "mar",
      };

    // Corretor
    case "visita_confirmada":
      return {
        titulo: "Visita confirmada",
        texto: `${formatarHorarioOuVazio(d)} em ${imovel(d)}${d.endereco ? `, ${d.endereco}` : ""}.`,
        icone: "calendario",
        cor: "mar",
      };
    case "visita_recusada":
      return {
        titulo: "Visita recusada",
        texto: `O proprietário recusou a visita de ${horario(d)} em ${imovel(d)}. Você pode escolher outro horário.`,
        icone: "calendario",
        cor: "erro",
      };
    case "visita_horario_ocupado":
      return {
        titulo: "Horário ocupado",
        texto: `O horário de ${horario(d)} em ${imovel(d)} foi confirmado para outro corretor. Você pode escolher outro horário.`,
        icone: "calendario",
        cor: "erro",
      };
    case "visita_cancelada_pelo_proprietario":
      return {
        titulo: "Visita cancelada",
        texto: `O proprietário cancelou a visita de ${horario(d)} em ${imovel(d)}.`,
        icone: "calendario",
        cor: "erro",
      };
    case "visita_cancelada_pela_venda":
      return {
        titulo: "Visita cancelada",
        texto: `${maiuscula(imovel(d))} foi vendido, e a visita de ${horario(d)} foi cancelada.`,
        icone: "calendario",
        cor: "erro",
      };
    case "proposta_aceita":
      return {
        titulo: "Proposta aceita",
        texto: `O proprietário aceitou sua proposta de ${preco(d.valor)} em ${imovel(d)}. Envie o contrato assinado.`,
        icone: "ok",
        cor: "mar",
        acao: "Toque para enviar o contrato",
      };
    case "proposta_recusada":
      return {
        titulo: "Proposta recusada",
        texto: `O proprietário recusou sua proposta de ${preco(d.valor)} em ${imovel(d)}. Você pode enviar outra.`,
        icone: "proposta",
        cor: "erro",
      };
    case "aceite_desfeito":
      return {
        titulo: "Aceite desfeito",
        texto: `O proprietário desfez o aceite da sua proposta de ${preco(d.valor)} em ${imovel(d)}. Ela voltou a aguardar resposta.`,
        icone: "proposta",
        cor: "areia",
      };
    case "proposta_recusada_pela_venda":
      return {
        titulo: "Imóvel vendido",
        texto: `${maiuscula(imovel(d))} foi vendido por outra proposta, e a sua, de ${preco(d.valor)}, foi encerrada.`,
        icone: "proposta",
        cor: "erro",
      };
    case "contrato_aprovado":
      return {
        titulo: "Venda registrada",
        texto: `A equipe PAUTA aprovou o contrato de ${imovel(d)}: venda de ${preco(d.valor_final)}.`,
        icone: "ok",
        cor: "mar",
      };
    case "contrato_recusado":
      return {
        titulo: "Contrato recusado",
        texto: `${maiuscula(imovel(d))}: ${semPontoFinal(d.motivo)}. Corrija e reenvie.`,
        icone: "contratoRecusado",
        cor: "erro",
        acao: "Toque para reenviar",
      };
    case "contrato_recusado_pela_venda":
      return {
        titulo: "Contrato encerrado",
        texto: `${maiuscula(imovel(d))} foi vendido por outra proposta, e o seu contrato não será conferido.`,
        icone: "contratoRecusado",
        cor: "erro",
      };
    case "imovel_novo":
      return {
        titulo: "Imóvel novo no catálogo",
        texto: [d.titulo ?? "Imóvel", preco(d.preco), d.bairro].filter(Boolean).join(", ") + ".",
        icone: "casa",
        cor: "areia",
      };

    // Responsável da imobiliária ou autônomo
    case "assinatura_ativada":
      return {
        titulo: "Conta ativada",
        texto: "A equipe PAUTA conferiu seu CRECI. Você já pode ver o catálogo.",
        icone: "ok",
        cor: "mar",
      };
    case "corretor_entrou":
      return {
        titulo: "Corretor novo na equipe",
        texto: `${d.corretor ?? "Um corretor"} entrou na equipe pelo convite.`,
        icone: "equipe",
        cor: "areia",
      };
  }
}

function maiuscula(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// "Ter, 14/10 às 10:00", no começo da frase.
function formatarHorarioOuVazio(d: DadosDoAviso) {
  return d.horario ? formatarHorario(d.horario) : "No horário marcado";
}

// "no ter, 14/10 às 10:00" (pedido de visita, como no protótipo).
function prefixoDoDia(d: DadosDoAviso) {
  return d.horario ? "no " : "";
}

// Grupos da lista, como no protótipo: "Hoje", "Esta semana" e "Antes", no horário de
// Florianópolis.
export type GrupoDeAvisos = { titulo: string; avisos: Aviso[] };

export function agruparAvisos(avisos: Aviso[], agora: Date): GrupoDeAvisos[] {
  const hoje = diaDe(agora);
  const umaSemana = new Date(agora.getTime() - 7 * 86_400_000);
  const grupos: GrupoDeAvisos[] = [
    { titulo: "Hoje", avisos: [] },
    { titulo: "Esta semana", avisos: [] },
    { titulo: "Antes", avisos: [] },
  ];
  for (const aviso of avisos) {
    const criado = new Date(aviso.criado_em);
    if (diaDe(criado) === hoje) grupos[0].avisos.push(aviso);
    else if (criado > umaSemana) grupos[1].avisos.push(aviso);
    else grupos[2].avisos.push(aviso);
  }
  return grupos.filter((grupo) => grupo.avisos.length > 0);
}

// "10:42" para hoje, "Ter, 14/10" nesta semana, "13/04/2026" antes.
export function quandoDoAviso(criadoEm: string, agora: Date) {
  const criado = new Date(criadoEm);
  const dia = diaDe(criado);
  if (dia === diaDe(agora)) return horaDe(criado);
  if (criado > new Date(agora.getTime() - 7 * 86_400_000)) return `${nomeDoDia(dia)}, ${diaEMes(dia)}`;
  return formatarData(criadoEm);
}

// O banco devolve "visto até" como a data do aviso mais novo que a tela mostrou.
export const AVISOS_POR_PAGINA = 30;

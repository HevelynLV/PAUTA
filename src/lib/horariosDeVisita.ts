// Regras de data e hora da visita (decisões de 04/11/2026, plano da Etapa 7). Roda
// no navegador e no servidor, então não lê nada da sessão.
//
// A Vercel roda em UTC e o celular pode estar em outro fuso: nada aqui usa o fuso da
// máquina. "Dia" é sempre um texto AAAA-MM-DD no calendário de Florianópolis, e o
// horário vai ao banco com o deslocamento -03:00 (o Brasil não tem horário de verão
// desde 2019).

export const FUSO = "America/Sao_Paulo";
export const DESLOCAMENTO = "-03:00";

// Os horários do protótipo. O banco só exige horário futuro, então esta lista pode
// mudar sem migration.
export const HORARIOS_DE_VISITA = ["09:00", "10:00", "11:00", "14:00", "15:30", "17:00"];
export const DIAS_PARA_AGENDAR = 14;
export const TAMANHO_DO_RECADO = 500;

const NOMES_DOS_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const NOMES_DOS_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// O dia em Florianópolis de um instante: "2026-11-04T02:30:00Z" → "2026-11-03".
export function diaDe(instante: Date | string) {
  return new Date(instante).toLocaleDateString("en-CA", { timeZone: FUSO });
}

// A hora em Florianópolis de um instante: "15:30".
export function horaDe(instante: Date | string) {
  return new Date(instante).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
}

// Dia e hora de Florianópolis no formato que vai para o banco.
export function instanteDe(dia: string, hora: string) {
  return `${dia}T${hora}:00${DESLOCAMENTO}`;
}

// Conta em cima do dia do calendário (meio-dia UTC), sem depender do fuso da máquina.
function emUtc(dia: string) {
  return new Date(`${dia}T12:00:00Z`);
}

export function somarDias(dia: string, dias: number) {
  const data = emUtc(dia);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

// 0 = domingo.
export function diaDaSemana(dia: string) {
  return emUtc(dia).getUTCDay();
}

// A segunda-feira da semana do dia (a agenda começa na segunda).
export function inicioDaSemana(dia: string) {
  return somarDias(dia, -((diaDaSemana(dia) + 6) % 7));
}

export function diaValido(dia: unknown): dia is string {
  return typeof dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dia) && emUtc(dia).toISOString().slice(0, 10) === dia;
}

// Os dias que podem ser agendados, de hoje em diante.
export function diasParaAgendar(hoje: string) {
  return Array.from({ length: DIAS_PARA_AGENDAR }, (_, i) => somarDias(hoje, i));
}

// "Ter" e "10/11".
export function nomeDoDia(dia: string) {
  return NOMES_DOS_DIAS[diaDaSemana(dia)];
}
export function diaEMes(dia: string) {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

// "Novembro de 2026", ou "Novembro e dezembro de 2026" quando o período vira o mês.
export function tituloDoPeriodo(inicio: string, fim: string) {
  const mes = (dia: string) => NOMES_DOS_MESES[Number(dia.slice(5, 7)) - 1];
  const ano = (dia: string) => dia.slice(0, 4);
  if (inicio.slice(0, 7) === fim.slice(0, 7)) return `${mes(inicio)} de ${ano(inicio)}`;
  if (ano(inicio) === ano(fim)) return `${mes(inicio)} e ${mes(fim).toLowerCase()} de ${ano(fim)}`;
  return `${mes(inicio)} de ${ano(inicio)} e ${mes(fim).toLowerCase()} de ${ano(fim)}`;
}

// "Ter, 10/11 às 10:00".
export function formatarHorario(instante: string) {
  const dia = diaDe(instante);
  return `${nomeDoDia(dia)}, ${diaEMes(dia)} às ${horaDe(instante)}`;
}

export type StatusVisita = "pendente" | "confirmada" | "recusada" | "cancelada";

// O que o selo mostra. Pedido que ninguém respondeu e cujo horário passou não muda
// no banco (nenhuma tarefa automática cuida disso): só muda o que aparece.
export function seloDaVisita(status: StatusVisita, horario: string, agora: Date, quem: "corretor" | "proprietario") {
  if (status === "pendente" && new Date(horario) <= agora) {
    return { status: "expirado", rotulo: "Horário passou" } as const;
  }
  switch (status) {
    case "pendente":
      return { status: "negociacao", rotulo: quem === "corretor" ? "Aguardando" : "Para confirmar" } as const;
    case "confirmada":
      return { status: "disponivel", rotulo: "Confirmada" } as const;
    case "recusada":
      return { status: "reprovado", rotulo: "Recusada" } as const;
    case "cancelada":
      return { status: "expirado", rotulo: "Cancelada" } as const;
  }
}

// O banco diz o motivo no hint (migration 20261104172132_visitas).
export function mensagemDoErroDeVisita(hint: string | null | undefined) {
  switch (hint) {
    case "imovel_fora_do_catalogo":
      return "Este imóvel não está mais no catálogo.";
    case "horario_passado":
      return "Esse horário já passou. Escolha outro.";
    case "horario_ocupado":
      return "Esse horário acabou de ser ocupado. Escolha outro.";
    case "pedido_repetido":
      return "Você já pediu visita nesse horário.";
    case "visita_ja_respondida":
      return "Esta visita já foi respondida. Recarregue a página.";
    case "visita_encerrada":
      return "Esta visita não pode mais ser cancelada. Recarregue a página.";
    case "visita_nao_encontrada":
      return "Visita não encontrada. Recarregue a página.";
    default:
      return "Não foi possível concluir. Tente de novo.";
  }
}

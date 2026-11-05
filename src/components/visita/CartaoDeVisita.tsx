import Link from "next/link";

import { cancelarVisitaDoImovel } from "@/app/proprietario/visitas/acoes";
import { Cartao } from "@/components/ui/Cartao";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { formatarTelefone } from "@/lib/conta";
import { formatarHorario, seloDaVisita } from "@/lib/horariosDeVisita";
import type { VisitaDaAgenda } from "@/lib/visitas";

import { BotaoCancelarVisita } from "./BotaoCancelarVisita";
import { RespostaDaVisita } from "./RespostaDaVisita";

// Pedido de visita para o proprietário (ProImovel), usado na agenda e na página do
// imóvel. Ele sempre vê nome, imobiliária, CRECI e contato do corretor (RNF07).

// Quantos outros pedidos sem resposta há no mesmo imóvel e horário.
function contarConcorrentes(visita: VisitaDaAgenda, visitas: VisitaDaAgenda[]) {
  return visitas.filter(
    (outra) =>
      outra.id !== visita.id &&
      outra.status === "pendente" &&
      outra.imovel_id === visita.imovel_id &&
      new Date(outra.horario).getTime() === new Date(visita.horario).getTime(),
  ).length;
}

export function ListaDeVisitas({
  visitas,
  agora,
  comImovel,
}: {
  visitas: VisitaDaAgenda[];
  agora: Date;
  comImovel: boolean;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {visitas.map((visita) => (
        <li key={visita.id} id={`visita-${visita.id}`} className="scroll-mt-4">
          <CartaoDeVisita visita={visita} agora={agora} comImovel={comImovel} concorrentes={contarConcorrentes(visita, visitas)} />
        </li>
      ))}
    </ul>
  );
}

function CartaoDeVisita({
  visita,
  agora,
  comImovel,
  concorrentes,
}: {
  visita: VisitaDaAgenda;
  agora: Date;
  comImovel: boolean;
  concorrentes: number;
}) {
  const selo = seloDaVisita(visita.status, visita.horario, agora, "proprietario");
  const futura = new Date(visita.horario) > agora;
  const quando = formatarHorario(visita.horario);
  const iniciais = visita.corretor_nome
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");

  return (
    <Cartao>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b>{quando}</b>
        <SeloStatus status={selo.status}>{selo.rotulo}</SeloStatus>
      </div>
      {comImovel && (
        <Link href={`/proprietario/imoveis/${visita.imovel_id}`} className="text-small font-bold text-mar no-underline">
          {visita.imovel_titulo}
        </Link>
      )}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mar-soft text-small font-bold text-mar-dark">
          {iniciais}
        </span>
        <div className="flex min-w-0 flex-col">
          <b className="text-small">{visita.corretor_nome}</b>
          <span className="text-tiny text-ink2">
            {visita.imobiliaria ?? "Corretor autônomo"} · CRECI {visita.creci}
          </span>
          <a href={`tel:+55${visita.telefone}`} className="text-tiny text-mar">
            {formatarTelefone(visita.telefone)}
          </a>
          <a href={`mailto:${encodeURIComponent(visita.email).replace("%40", "@")}`} className="truncate text-tiny text-mar">
            {visita.email}
          </a>
        </div>
      </div>
      {visita.recado && <p className="whitespace-pre-line rounded-[14px] bg-cinza-soft px-3.5 py-2.5 text-small [overflow-wrap:anywhere]">{visita.recado}</p>}
      {visita.status === "pendente" && <RespostaDaVisita id={visita.id} podeConfirmar={futura} concorrentes={concorrentes} />}
      {visita.status === "confirmada" && futura && (
        <div className="self-start">
          <BotaoCancelarVisita id={visita.id} horario={quando} acao={cancelarVisitaDoImovel} />
        </div>
      )}
    </Cartao>
  );
}

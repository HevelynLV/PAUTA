import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { listaDeAssinantes, type AssinanteNaLista, type Situacao } from "@/lib/assinantesAdmin";
import { exigirTipo } from "@/lib/auth";
import { formatarTelefone } from "@/lib/conta";
import { formatarData } from "@/lib/imovel";

import { AcoesDoAssinante } from "./AcoesDoAssinante";

export const metadata: Metadata = { title: "Assinantes" };

// Assinantes (AdmAssinantes no celular, SiteAdmAssinantes no computador): o admin
// confere o CRECI à mão e ativa (RF15), bloqueia ou desbloqueia, e exclui o
// cadastro pendente com o usuário, liberando o CRECI (RF16). O filtro fica na URL
// (?filtro=), para a tela continuar no mesmo filtro depois de cada ação.

// Consulta pública do CRECI-SC. O site não tem um endereço fixo da consulta: o
// admin procura pelo número na página inicial.
const SITE_CRECI_SC = "https://www.creci-sc.gov.br";

const FILTROS = [
  { valor: "pendentes", rotulo: "Pendentes" },
  { valor: "ativos", rotulo: "Ativos" },
  { valor: "bloqueados", rotulo: "Bloqueados" },
  { valor: "todos", rotulo: "Todos" },
] as const;

type Filtro = (typeof FILTROS)[number]["valor"];

const NO_FILTRO: Record<Filtro, (a: AssinanteNaLista) => boolean> = {
  pendentes: (a) => a.situacao === "pendente",
  ativos: (a) => a.situacao === "ativo",
  bloqueados: (a) => a.situacao === "bloqueado",
  // Vencido (pagamento atrasado, Etapa 11) aparece só aqui.
  todos: () => true,
};

export default function Assinantes({ searchParams }: PageProps<"/admin/assinantes">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2">Carregando…</p>}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}

async function Conteudo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirTipo("admin");
  const [todos, { filtro: pedido }] = await Promise.all([listaDeAssinantes(), searchParams]);
  const filtro: Filtro = FILTROS.some((f) => f.valor === pedido) ? (pedido as Filtro) : "pendentes";
  const lista = todos.filter(NO_FILTRO[filtro]);
  const pendentes = todos.filter(NO_FILTRO.pendentes).length;

  return (
    <div className="flex w-full max-w-[1140px] flex-col gap-3 px-5 pb-7 pt-[22px] md:gap-5 md:px-10 md:pt-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]">Assinantes</h1>
        <span className="hidden text-small text-ink2 md:block">Confira o CRECI à mão antes de ativar</span>
      </div>

      <nav aria-label="Filtrar assinantes" className="flex gap-2 overflow-x-auto pb-0.5 md:flex-wrap">
        {FILTROS.map((f) => (
          <Link
            key={f.valor}
            href={`/admin/assinantes?filtro=${f.valor}`}
            aria-current={f.valor === filtro ? "page" : undefined}
            className={`inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-small font-semibold no-underline ${
              f.valor === filtro ? "border-ink bg-ink text-white" : "border-line bg-card text-ink"
            }`}
          >
            {f.valor === "pendentes" ? `${f.rotulo} (${pendentes})` : f.rotulo}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <p className="py-[30px] text-center text-small text-ink2">Nada aqui.</p>
      ) : (
        <>
          {/* Celular: um cartão por assinante */}
          <ul className="flex flex-col gap-3 pt-2.5 md:hidden">
            {lista.map((a) => (
              <li key={a.id} className="flex flex-col gap-1.5 rounded-cartao border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <b>{a.nome}</b>
                  <SeloSituacao situacao={a.situacao} tipo={a.tipo} />
                </div>
                <span className="text-small text-ink2">
                  {a.tipo === "imobiliaria" ? "Imobiliária" : "Corretor autônomo"} ·{" "}
                  <CreciEmDestaque creci={a.creci} />
                </span>
                <span className="text-tiny text-ink2">{informacoes(a)}</span>
                {a.situacao === "pendente" && (
                  <a href={SITE_CRECI_SC} target="_blank" rel="noopener noreferrer" className="text-small font-bold text-mar-dark underline">
                    Conferir CRECI no site do CRECI-SC
                  </a>
                )}
                <div className="pt-1.5">
                  <AcoesDoAssinante id={a.id} nome={a.nome} creci={a.creci} situacao={a.situacao} largo />
                </div>
                {a.situacao === "pendente" && (
                  <span className="text-tiny text-ink2">Excluir apaga o cadastro pendente e libera o CRECI para outra conta.</span>
                )}
              </li>
            ))}
          </ul>

          {/* Computador: tabela */}
          <div className="hidden overflow-x-auto rounded-cartao border border-line bg-card md:block">
            <table className="w-full min-w-[860px] border-collapse text-left text-small">
              <thead className="bg-bg text-tiny uppercase tracking-[0.08em] text-ink2">
                <tr>
                  {["Assinante", "CRECI", "Responsável e contato", "Status"].map((titulo) => (
                    <th key={titulo} scope="col" className="px-4 py-3 font-bold">
                      {titulo}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 text-right font-bold">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.map((a) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <b>{a.nome}</b>
                      <br />
                      <span className="text-tiny text-ink2">
                        {a.tipo === "imobiliaria"
                          ? `Imobiliária${a.situacao !== "pendente" ? ` · ${corretores(a.corretores)}` : ""}`
                          : "Corretor autônomo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <CreciEmDestaque creci={a.creci} />
                      <br />
                      <a href={SITE_CRECI_SC} target="_blank" rel="noopener noreferrer" className="text-tiny font-bold text-mar-dark underline">
                        Conferir no CRECI-SC
                      </a>
                    </td>
                    <td className="px-4 py-3">{contato(a)}</td>
                    <td className="px-4 py-3">
                      <SeloSituacao situacao={a.situacao} tipo={a.tipo} />
                      {avisoDoPagamento(a) && <p className="pt-1 text-tiny text-ink2">{avisoDoPagamento(a)}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <AcoesDoAssinante id={a.id} nome={a.nome} creci={a.creci} situacao={a.situacao} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="hidden text-tiny text-ink2 md:block">
        Excluir apaga o cadastro pendente com o usuário e libera o CRECI para outra conta. Assinante com mensalidade
        vencida perde o acesso sozinho. Bloquear corta o acesso na hora, também dos corretores da imobiliária.
      </p>
    </div>
  );
}

// O CRECI é o que o admin confere à mão: em negrito, com a UF (sempre SC).
function CreciEmDestaque({ creci }: { creci: string }) {
  return <b className="font-bold text-ink">CRECI {creci} SC</b>;
}

function corretores(n: number) {
  return n === 1 ? "1 corretor" : `${n} corretores`;
}

// Nome do responsável (o autônomo é o próprio assinante, então o nome não repete
// no cartão), telefone e data do cadastro.
function contato(a: AssinanteNaLista, comNome = true) {
  const partes = [formatarTelefone(a.telefone), `cadastro em ${formatarData(a.criadoEm)}`];
  return (comNome ? [a.responsavel, ...partes] : partes).join(" · ");
}

function avisoDoPagamento(a: AssinanteNaLista) {
  if (a.situacao === "vencido") return "Pagamento vencido: sem acesso até pagar";
  if (a.situacao === "bloqueado" && a.vencido) return "Pagamento também vencido: desbloquear não devolve o acesso";
  return null;
}

// Linha de informações do cartão do celular.
function informacoes(a: AssinanteNaLista) {
  const partes: string[] = [];
  if (a.tipo === "imobiliaria" && a.situacao !== "pendente") partes.push(corretores(a.corretores));
  partes.push(a.tipo === "imobiliaria" ? `Responsável: ${contato(a)}` : contato(a, false));
  const aviso = avisoDoPagamento(a);
  if (aviso) partes.push(aviso);
  return partes.join(" · ");
}

const SELOS: Record<Situacao, { classes: string; rotulo: [string, string] }> = {
  pendente: { classes: "bg-areia-soft text-areia", rotulo: ["Pendente", "Pendente"] },
  ativo: { classes: "bg-mar-soft text-mar-dark", rotulo: ["Ativa", "Ativo"] },
  bloqueado: { classes: "bg-erro-soft text-erro", rotulo: ["Bloqueada", "Bloqueado"] },
  vencido: { classes: "bg-cinza-soft text-ink2", rotulo: ["Vencida", "Vencido"] },
};

// Selo do protótipo (.badge: b-neg pendente, b-disp ativa, b-repr bloqueada).
// "Vencida" não está no protótipo: o vencido é da Etapa 11.
function SeloSituacao({ situacao, tipo }: { situacao: Situacao; tipo: AssinanteNaLista["tipo"] }) {
  const { classes, rotulo } = SELOS[situacao];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-tiny font-bold ${classes}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {rotulo[tipo === "imobiliaria" ? 0 : 1]}
    </span>
  );
}

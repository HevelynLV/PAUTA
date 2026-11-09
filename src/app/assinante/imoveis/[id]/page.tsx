import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GaleriaDoImovel } from "@/components/catalogo/GaleriaDoImovel";
import { SeloStatus } from "@/components/ui/SeloStatus";
import { EnviarProposta } from "@/components/proposta/EnviarProposta";
import { AgendarVisita } from "@/components/visita/AgendarVisita";
import { exigirTipo, TIPOS_ASSINANTE } from "@/lib/auth";
import { type ImovelDoCatalogo, imovelDoCatalogo } from "@/lib/catalogo";
import { formatarTelefone } from "@/lib/conta";
import { lerFiltros, urlDoCatalogo } from "@/lib/filtrosCatalogo";
import { diaDe, formatarHorario, seloDaVisita } from "@/lib/horariosDeVisita";
import { formatarPreco } from "@/lib/imovel";
import { propostaEmAberto, rotuloDaForma, seloDaNegociacao } from "@/lib/proposta";
import { minhasPropostas } from "@/lib/propostas";
import { horariosOcupados, minhasVisitas } from "@/lib/visitas";

export const metadata: Metadata = { title: "Imóvel" };

// Detalhe do imóvel para o corretor (RF18 a RF20, passo 6.3):
// docs/prototipo/CorImovel.dc.html (celular) e SiteCorImovel.dc.html (site).
// O agendamento de visita (Etapa 7) é um calendário, não a tela CorVisita do protótipo
// (decisão de 04/11/2026). A proposta (Etapa 8) abre na mesma janela, e não na tela
// CorProposta; ?proposta=1 já chega com ela aberta.
//
// O contato do proprietário (RNF06) só existe aqui se o banco o devolveu: ele é
// montado no servidor e, quando está escondido, nada dele chega ao navegador.
export default function DetalheDoImovel({ params, searchParams }: PageProps<"/assinante/imoveis/[id]">) {
  return (
    <Suspense fallback={<p className="px-5 pt-[22px] text-ink2 md:px-10 md:pt-8">Carregando o imóvel…</p>}>
      <Conteudo params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Conteudo({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirTipo(TIPOS_ASSINANTE);
  const { id } = await params;
  // A busca veio junto do card. Passa por lerFiltros: o voltar nunca leva para fora.
  const busca = await searchParams;
  const filtros = lerFiltros(busca);
  const voltar = urlDoCatalogo(filtros, { pagina: filtros.pagina });
  const imovel = await imovelDoCatalogo(id);
  if (!imovel) notFound();

  const agora = new Date();
  const [ocupados, visitas, propostas] = await Promise.all([horariosOcupados(id), minhasVisitas(id), minhasPropostas(id)]);
  const abertas = visitas
    .filter((visita) => ["pendente", "confirmada"].includes(visita.status) && new Date(visita.horario) > agora)
    .reverse();

  // Uma em aberto por vez; se não há, a mais recente diz se foi recusada.
  const propostaAberta = propostas.find((proposta) => propostaEmAberto(proposta.status));
  const recusada = !propostaAberta && propostas[0]?.status === "recusada";
  const seloProposta = propostaAberta && seloDaNegociacao(propostaAberta.status, propostaAberta.contrato_status);

  const preco = formatarPreco(imovel.preco);
  const endereco = `${imovel.endereco} · ${imovel.bairro} · Florianópolis`;

  return (
    <div className="flex w-full max-w-[1140px] flex-col pb-28 md:gap-6 md:px-10 md:pb-10 md:pt-8">
      <nav aria-label="Caminho" className="hidden items-center gap-2 text-small text-ink2 md:flex">
        <Link href={voltar} className="font-semibold text-mar">
          Catálogo
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate">{imovel.titulo}</span>
      </nav>

      <GaleriaDoImovel
        titulo={imovel.titulo}
        voltar={voltar}
        fotos={imovel.fotos.map((foto) => ({ id: foto.id, miniatura: foto.miniatura, grande: foto.grande ?? null }))}
      />

      <div className="flex flex-col gap-[18px] px-5 pt-[18px] md:grid md:grid-cols-[minmax(0,1fr)_340px] md:items-start md:gap-8 md:px-0 md:pt-0">
        <div className="flex flex-col gap-[18px] md:gap-6">
          <div className="flex flex-col gap-1.5 md:gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SeloStatus status={imovel.status} />
              <span className="rounded-full border border-line px-2.5 py-0.5 text-tiny font-bold text-mar-dark">Exclusivo PAUTA</span>
            </div>
            <h1 className="font-display text-[24px] font-bold leading-[1.15] tracking-[-0.02em] md:text-[34px] md:leading-[1.1]">
              {imovel.titulo}
            </h1>
            <span className="font-display text-[22px] font-bold md:hidden">{preco}</span>
            <span className="text-small text-ink2 md:text-corpo">{endereco}</span>
          </div>

          <Numeros imovel={imovel} />

          {imovel.descricao.trim() && (
            <div className="flex flex-col gap-1.5">
              <h2 className="text-corpo font-bold md:font-display md:text-t2">Descrição</h2>
              <p className="whitespace-pre-line text-small leading-relaxed md:text-corpo">{imovel.descricao}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 md:sticky md:top-8">
          <div className="flex flex-col gap-3.5 md:rounded-cartao md:border md:border-line md:bg-card md:p-[22px]">
            <span className="hidden font-display text-[28px] font-bold md:block">{preco}</span>
            {/* No celular, o rodapé fixo do protótipo (.foot); no site, dentro da coluna. */}
            <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2.5 border-t border-line bg-card px-5 pt-3 pb-[max(22px,env(safe-area-inset-bottom))] md:static md:z-auto md:flex-col md:border-0 md:bg-transparent md:p-0">
              <AgendarVisita
                imovelId={imovel.id}
                hoje={diaDe(agora)}
                agora={agora.toISOString()}
                ocupados={ocupados}
                meusPedidos={abertas.map((visita) => visita.horario)}
              />
              <EnviarProposta
                imovelId={imovel.id}
                titulo={imovel.titulo}
                preco={imovel.preco}
                temEmAberto={Boolean(propostaAberta)}
                abrirAoCarregar={busca.proposta === "1"}
              />
            </div>
            {propostaAberta && seloProposta && (
              <div className="flex flex-col gap-1.5">
                <b className="text-small">Sua proposta neste imóvel</b>
                <div className="flex flex-wrap items-center justify-between gap-2 text-small">
                  <span>
                    {formatarPreco(propostaAberta.valor)} · {rotuloDaForma(propostaAberta.forma_pagamento)}
                  </span>
                  <SeloStatus status={seloProposta.status}>{seloProposta.rotulo}</SeloStatus>
                </div>
                <Link href="/assinante/negociacoes" className="text-small font-bold text-mar">
                  Ver minhas negociações
                </Link>
              </div>
            )}
            {recusada && <p className="text-small text-ink2">Sua última proposta foi recusada. Você pode enviar outra.</p>}
            {abertas.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <b className="text-small">Suas visitas neste imóvel</b>
                <ul className="flex flex-col gap-1.5">
                  {abertas.map((visita) => {
                    const selo = seloDaVisita(visita.status, visita.horario, agora, "corretor");
                    return (
                      <li key={visita.id} className="flex flex-wrap items-center justify-between gap-2 text-small">
                        {formatarHorario(visita.horario)}
                        <SeloStatus status={selo.status}>{selo.rotulo}</SeloStatus>
                      </li>
                    );
                  })}
                </ul>
                <Link href="/assinante/negociacoes?aba=visitas" className="text-small font-bold text-mar">
                  Ver em Negociações
                </Link>
              </div>
            )}
            <hr className="hidden border-line md:block" />
            <Contato contato={imovel.contato} />
          </div>
          <p className="text-tiny text-ink2 md:text-small">Outros corretores podem estar trabalhando este imóvel ao mesmo tempo.</p>
        </div>
      </div>
    </div>
  );
}

function Numeros({ imovel }: { imovel: ImovelDoCatalogo }) {
  // Como no card: o que é zero (um terreno não tem quartos) não aparece.
  const contagens = [
    { valor: imovel.quartos, rotulo: imovel.quartos === 1 ? "quarto" : "quartos" },
    { valor: imovel.banheiros, rotulo: imovel.banheiros === 1 ? "banheiro" : "banheiros" },
    { valor: imovel.vagas, rotulo: imovel.vagas === 1 ? "vaga" : "vagas" },
  ];
  const itens = [
    ...contagens.filter((item) => item.valor > 0).map((item) => ({ ...item, valor: String(item.valor) })),
    { valor: `${imovel.area.toLocaleString("pt-BR")} m²`, rotulo: "área" },
  ];
  return (
    <dl className="grid auto-cols-fr grid-flow-col gap-2 rounded-cartao border border-line bg-card p-4 md:gap-3">
      {itens.map((item) => (
        <div key={item.rotulo} className="flex flex-col">
          <dt className="order-2 text-tiny text-ink2">{item.rotulo}</dt>
          <dd className="order-1 text-corpo font-bold md:text-[20px]">{item.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

const icone = "size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]";

// Contato divulgado: ligar, WhatsApp e e-mail (decisão de 03/11/2026). Escondido:
// o cartão do protótipo, sem nenhum dado do proprietário.
function Contato({ contato }: { contato: ImovelDoCatalogo["contato"] }) {
  if (!contato) {
    return (
      <div className="flex items-start gap-3 rounded-cartao border border-line bg-card p-4 md:border-0 md:p-0">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cinza-soft text-ink2">
          <svg viewBox="0 0 24 24" className={icone}>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <div className="flex flex-col gap-0.5">
          <b className="text-small">Contato do proprietário não divulgado</b>
          <span className="text-tiny text-ink2">
            Visitas e propostas passam pelo PAUTA. O proprietário vê seu nome, sua imobiliária e seu contato.
          </span>
        </div>
      </div>
    );
  }

  const telefone = formatarTelefone(contato.telefone);
  const opcoes = [
    {
      href: `tel:+55${contato.telefone}`,
      rotulo: "Ligar",
      detalhe: telefone,
      desenho: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
    },
    {
      href: `https://wa.me/55${contato.telefone}`,
      rotulo: "WhatsApp",
      detalhe: telefone,
      desenho: <path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 7.8 19.6Z" />,
      foraDoPauta: true,
    },
    {
      // O e-mail vai escapado: um "?" nele não pode virar parâmetro do link.
      href: `mailto:${encodeURIComponent(contato.email).replace("%40", "@")}`,
      rotulo: "E-mail",
      detalhe: contato.email,
      desenho: (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2.5 rounded-cartao border border-line bg-card p-4 md:border-0 md:p-0">
      <b className="text-small">Contato do proprietário</b>
      <ul className="flex flex-col gap-2">
        {opcoes.map((opcao) => (
          <li key={opcao.rotulo}>
            <a
              href={opcao.href}
              {...(opcao.foraDoPauta && { target: "_blank", rel: "noreferrer" })}
              className="flex min-h-12 items-center gap-3 rounded-botao border border-line px-3 text-ink no-underline hover:bg-mar-soft"
            >
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mar-soft text-mar-dark">
                <svg viewBox="0 0 24 24" className={icone}>
                  {opcao.desenho}
                </svg>
              </span>
              <span className="flex min-w-0 flex-col">
                <b className="text-small">{opcao.rotulo}</b>
                <span className="truncate text-tiny text-ink2">{opcao.detalhe}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import Form from "next/form";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Botao, classesBotao } from "@/components/ui/Botao";
import { CampoSelecao } from "@/components/ui/Campo";

// Filtros do catálogo (RF19): no celular, chips de tipo e status e o botão
// "Filtros", que abre a folha de baixo com bairros, preço e quartos
// (docs/prototipo/CorCatalogo.dc.html); no site, tudo na coluna "Filtros"
// (SiteCorCatalogo.dc.html). É um bloco só: a folha do celular vira a parte de
// baixo da coluna no site.
//
// Os chips são links (cada um já com a URL pronta, montada no servidor). A folha
// é um formulário GET: o navegador põe os campos na URL e o <Form> do Next navega
// sem recarregar a página. A URL é a única fonte dos filtros.

type Chip = { rotulo: string; href: string; ativo: boolean };
type Bairro = { id: number; nome: string };

type Props = {
  tipos: Chip[];
  status: Chip[];
  bairros: Bairro[];
  escolhidos: { bairros: number[]; precoMin: number | null; precoMax: number | null; quartos: number | null };
  // tipo e status escolhidos pelos chips, para o formulário levar junto.
  manter: { tipo: number | null; status: string | null };
  ativosNaFolha: number;
  limpar: string;
};

const classeChip = (ativo: boolean) =>
  `inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-small font-semibold no-underline ${
    ativo ? "border-ink bg-ink text-white" : "border-line bg-card text-ink"
  }`;

// "Jurerê" e "jurere" são a mesma busca.
const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const formatarPreco = (valor: number | null) => (valor === null ? "" : valor.toLocaleString("pt-BR"));

export function FiltrosDoCatalogo({ tipos, status, bairros, escolhidos, manter, ativosNaFolha, limpar }: Props) {
  const [aberta, setAberta] = useState(false);
  const [procura, setProcura] = useState("");
  const [marcados, setMarcados] = useState(escolhidos.bairros.length);
  const titulo = useId();
  const painel = useRef<HTMLDivElement>(null);

  // Folha aberta no celular: Esc fecha, o foco vai para dentro e a página de trás
  // não rola.
  useEffect(() => {
    if (!aberta) return;
    painel.current?.focus();
    const fecharComEsc = (evento: KeyboardEvent) => evento.key === "Escape" && setAberta(false);
    document.addEventListener("keydown", fecharComEsc);
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", fecharComEsc);
      document.body.style.overflow = rolagem;
    };
  }, [aberta]);

  // Campos vazios ficam fora da URL (sem "preco_min=&quartos="). Desativar o campo
  // antes do envio tira ele dos dados; logo depois volta ao normal.
  function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    const vazios = [...evento.currentTarget.elements].filter(
      (campo): campo is HTMLInputElement | HTMLSelectElement =>
        (campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement) && campo.name !== "" && campo.value === "",
    );
    vazios.forEach((campo) => (campo.disabled = true));
    setTimeout(() => vazios.forEach((campo) => (campo.disabled = false)));
    setAberta(false);
  }

  const termo = semAcento(procura.trim());

  return (
    <aside
      aria-label="Filtros"
      className="flex flex-col gap-2.5 md:sticky md:top-8 md:w-[264px] md:shrink-0 md:gap-[18px] md:rounded-cartao md:border md:border-line md:bg-card md:p-4"
    >
      <p className="hidden text-corpo font-bold md:block">Filtros</p>

      <div className="flex flex-col gap-2">
        <span className="hidden text-small font-bold md:block">Tipo</span>
        <div role="group" aria-label="Filtrar por tipo" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 md:mx-0 md:flex-wrap md:px-0">
          {tipos.map((chip) => (
            <Link key={chip.rotulo} href={chip.href} aria-current={chip.ativo ? "true" : undefined} className={classeChip(chip.ativo)}>
              {chip.rotulo}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="hidden text-small font-bold md:block">Status</span>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 md:mx-0 md:flex-wrap md:px-0">
          <div role="group" aria-label="Filtrar por status" className="flex gap-2 md:flex-wrap">
            {status.map((chip) => (
              <Link key={chip.rotulo} href={chip.href} aria-current={chip.ativo ? "true" : undefined} className={classeChip(chip.ativo)}>
                {chip.rotulo}
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAberta(true)}
            aria-haspopup="dialog"
            aria-expanded={aberta}
            className={`${classeChip(ativosNaFolha > 0)} cursor-pointer md:hidden`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current [stroke-linecap:round] [stroke-width:2]">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Filtros{ativosNaFolha > 0 && ` (${ativosNaFolha})`}
          </button>
        </div>
      </div>

      {/* Fundo escuro e folha no celular (só quando aberta); no site, parte da coluna. */}
      <div
        className={`${aberta ? "fixed inset-0 z-50 flex items-end bg-[rgba(16,32,30,.45)]" : "hidden"} md:static md:z-auto md:flex md:bg-transparent`}
        onClick={(evento) => evento.target === evento.currentTarget && setAberta(false)}
      >
        <div
          ref={painel}
          tabIndex={-1}
          role={aberta ? "dialog" : undefined}
          aria-modal={aberta ? true : undefined}
          aria-labelledby={aberta ? titulo : undefined}
          className="flex max-h-[88dvh] w-full flex-col gap-3.5 overflow-y-auto rounded-t-folha bg-card px-5 pb-[max(26px,env(safe-area-inset-bottom))] pt-5 outline-none md:max-h-none md:overflow-visible md:rounded-none md:bg-transparent md:p-0"
        >
          <div className="flex items-center justify-between md:hidden">
            <p id={titulo} className="font-display text-t2 font-bold">
              Filtros
            </p>
            <button
              type="button"
              onClick={() => setAberta(false)}
              aria-label="Fechar"
              className="flex size-11 cursor-pointer items-center justify-center rounded-full text-ink2 hover:bg-cinza-soft"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-width:2]">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <Form action="/assinante" onSubmit={aoEnviar} className="flex flex-col gap-[18px]">
            {manter.tipo !== null && <input type="hidden" name="tipo" value={manter.tipo} />}
            {manter.status !== null && <input type="hidden" name="status" value={manter.status} />}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 flex w-full items-baseline justify-between text-small font-bold">
                Bairros
                {marcados > 0 && <span className="text-tiny font-semibold text-ink2">{marcados === 1 ? "1 marcado" : `${marcados} marcados`}</span>}
              </legend>
              <input
                type="search"
                value={procura}
                onChange={(evento) => setProcura(evento.target.value)}
                placeholder="Procurar bairro"
                aria-label="Procurar bairro"
                className="min-h-11 w-full rounded-botao border border-line bg-card px-3.5 text-ink focus:outline-2 focus:outline-offset-1 focus:outline-mar"
              />
              <div
                className="flex max-h-[220px] flex-col overflow-y-auto rounded-botao border border-line"
                onChange={(evento) => {
                  const lista = evento.currentTarget;
                  setMarcados(lista.querySelectorAll("input:checked").length);
                }}
              >
                {bairros.map((bairro) => (
                  // Bairro que não bate com a procura só some da vista: se estiver
                  // marcado, continua indo junto no envio.
                  <label
                    key={bairro.id}
                    className={`flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-line px-3 text-small last:border-b-0 ${
                      termo && !semAcento(bairro.nome).includes(termo) ? "hidden" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="bairro"
                      value={bairro.id}
                      defaultChecked={escolhidos.bairros.includes(bairro.id)}
                      className="size-[18px] accent-mar"
                    />
                    {bairro.nome}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="preco_min" className="text-small font-bold">
                  Preço mín.
                </label>
                <input
                  id="preco_min"
                  name="preco_min"
                  inputMode="numeric"
                  placeholder="R$"
                  defaultValue={formatarPreco(escolhidos.precoMin)}
                  className="min-h-12 w-full rounded-botao border border-line bg-card px-3.5 text-ink focus:outline-2 focus:outline-offset-1 focus:outline-mar"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="preco_max" className="text-small font-bold">
                  Preço máx.
                </label>
                <input
                  id="preco_max"
                  name="preco_max"
                  inputMode="numeric"
                  placeholder="R$"
                  defaultValue={formatarPreco(escolhidos.precoMax)}
                  className="min-h-12 w-full rounded-botao border border-line bg-card px-3.5 text-ink focus:outline-2 focus:outline-offset-1 focus:outline-mar"
                />
              </div>
            </div>

            <CampoSelecao
              name="quartos"
              rotulo="Quartos"
              vazio="Qualquer"
              defaultValue={escolhidos.quartos === null ? "" : String(escolhidos.quartos)}
              opcoes={[1, 2, 3, 4].map((n) => ({ valor: String(n), rotulo: `${n}+` }))}
            />

            <div className="flex flex-col gap-2">
              <Botao type="submit">Ver imóveis</Botao>
              {ativosNaFolha > 0 && (
                <Link href={limpar} onClick={() => setAberta(false)} className={classesBotao({ variante: "secundario" })}>
                  Limpar bairros, preço e quartos
                </Link>
              )}
            </div>
          </Form>
        </div>
      </div>
    </aside>
  );
}

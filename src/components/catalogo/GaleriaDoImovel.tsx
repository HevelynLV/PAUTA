"use client";

/* eslint-disable @next/next/no-img-element -- links temporários do Storage privado: o otimizador do Next não os guarda */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Galeria do imóvel para o corretor (passo 6.3):
// - celular (CorImovel): as fotos passam de lado, com o contador "1 / N" e o
//   botão de voltar por cima
// - computador (SiteCorImovel): a grade com a foto 1 grande, até 3 menores e o
//   quadro "Ver as N fotos"
// Tocar numa foto abre a versão grande em tela cheia, com Anterior e Próxima.
//
// Recebe só os links das fotos (nunca o imóvel inteiro): o que vem para este
// componente vai para o navegador.

export type FotoDaGaleria = { id: string; miniatura: string | null; grande: string | null };

const seta = "size-6 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]";
const quadroVazio = "bg-[#BFD3CD]";

export function GaleriaDoImovel({ fotos, titulo, voltar }: { fotos: FotoDaGaleria[]; titulo: string; voltar: string }) {
  const [atual, setAtual] = useState(0);
  const [aberta, setAberta] = useState<number | null>(null);
  const tira = useRef<HTMLDivElement>(null);
  const total = fotos.length;

  function aoRolar() {
    const el = tira.current;
    if (el && el.clientWidth > 0) setAtual(Math.min(total - 1, Math.round(el.scrollLeft / el.clientWidth)));
  }

  const rotulo = (i: number) => `Foto ${i + 1} de ${total}: ${titulo}`;

  return (
    <>
      {/* Celular */}
      <div className="relative h-[240px] md:hidden">
        <div ref={tira} onScroll={aoRolar} className={`flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] ${quadroVazio}`}>
          {fotos.map((foto, i) => (
            <button
              key={foto.id}
              type="button"
              onClick={() => setAberta(i)}
              aria-label={`${rotulo(i)}. Abrir a foto grande`}
              className="h-full w-full shrink-0 cursor-zoom-in snap-center"
            >
              {foto.miniatura && (
                <img
                  src={foto.miniatura}
                  alt=""
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchPriority={i === 0 ? "high" : "auto"}
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
        <Link
          href={voltar}
          aria-label="Voltar ao catálogo"
          className="absolute left-5 top-4 flex size-11 items-center justify-center rounded-botao border border-line bg-card text-ink"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className={seta}>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        {total > 0 && (
          <span aria-hidden="true" className="absolute bottom-3.5 right-5 rounded-full bg-[rgba(16,32,30,.7)] px-2.5 py-1 text-tiny font-semibold text-white">
            {atual + 1} / {total}
          </span>
        )}
      </div>

      {/* Computador */}
      {total > 0 ? (
        <GradeDoComputador fotos={fotos} abrir={setAberta} rotulo={rotulo} />
      ) : (
        <div className={`hidden h-[200px] items-center justify-center rounded-foto text-small text-ink2 md:flex ${quadroVazio}`}>Sem fotos</div>
      )}

      {aberta !== null && <Visualizador fotos={fotos} inicio={aberta} titulo={titulo} rotulo={rotulo} fechar={() => setAberta(null)} />}
    </>
  );
}

// A foto 1 ocupa as duas linhas; as outras (até 3) e o quadro "Ver as N fotos"
// enchem as colunas de cima para baixo. Com número ímpar de quadros, o último
// ocupa as duas linhas, para a grade não ficar com buraco.
function GradeDoComputador({
  fotos,
  abrir,
  rotulo,
}: {
  fotos: FotoDaGaleria[];
  abrir: (i: number) => void;
  rotulo: (i: number) => string;
}) {
  const [capa, ...resto] = fotos;
  const outras = resto.slice(0, 3);
  const quadrosMenores = outras.length + 1;
  const textoDoUltimo = fotos.length === 1 ? "Ampliar a foto" : `Ver as ${fotos.length} fotos`;

  return (
    <div className="hidden h-[388px] grid-flow-col grid-cols-[2fr] grid-rows-2 gap-2 [grid-auto-columns:1fr] md:grid">
      <QuadroDaFoto foto={capa} rotulo={rotulo(0)} onClick={() => abrir(0)} className="row-span-2" prioridade />
      {outras.map((foto, i) => (
        <QuadroDaFoto key={foto.id} foto={foto} rotulo={rotulo(i + 1)} onClick={() => abrir(i + 1)} />
      ))}
      <button
        type="button"
        onClick={() => abrir(0)}
        className={`flex cursor-pointer items-center justify-center rounded-foto border border-line bg-card text-small font-bold text-mar hover:bg-mar-soft ${
          quadrosMenores % 2 === 1 ? "row-span-2" : ""
        }`}
      >
        {textoDoUltimo}
      </button>
    </div>
  );
}

function QuadroDaFoto({
  foto,
  rotulo,
  onClick,
  className = "",
  prioridade = false,
}: {
  foto: FotoDaGaleria;
  rotulo: string;
  onClick: () => void;
  className?: string;
  prioridade?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${rotulo}. Abrir a foto grande`}
      className={`min-h-0 cursor-zoom-in overflow-hidden rounded-foto ${quadroVazio} ${className}`}
    >
      {foto.miniatura && (
        <img
          src={foto.miniatura}
          alt=""
          loading={prioridade ? "eager" : "lazy"}
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
        />
      )}
    </button>
  );
}

// Tela cheia com a foto grande (2.000 px). Só carrega a grande de quem abriu.
// <dialog> com showModal(): o navegador cuida do foco e do Esc.
function Visualizador({
  fotos,
  inicio,
  titulo,
  rotulo,
  fechar,
}: {
  fotos: FotoDaGaleria[];
  inicio: number;
  titulo: string;
  rotulo: (i: number) => string;
  fechar: () => void;
}) {
  const [i, setI] = useState(inicio);
  const janela = useRef<HTMLDialogElement>(null);
  const total = fotos.length;
  const foto = fotos[i];
  // A grande; se o link dela faltar, a miniatura.
  const endereco = foto?.grande ?? foto?.miniatura ?? null;
  const anterior = () => setI((n) => (n - 1 + total) % total);
  const proxima = () => setI((n) => (n + 1) % total);

  useEffect(() => {
    const el = janela.current;
    if (!el) return;
    el.showModal();
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = rolagem;
    };
  }, []);

  function teclas(evento: React.KeyboardEvent) {
    if (evento.key === "ArrowLeft") anterior();
    if (evento.key === "ArrowRight") proxima();
  }

  const botao = "flex size-11 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25";

  return (
    <dialog
      ref={janela}
      onClose={fechar}
      onKeyDown={teclas}
      aria-label={`Fotos: ${titulo}`}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-[#10201E] p-0 text-white backdrop:bg-[#10201E]"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
          <span className="text-small font-semibold">
            {i + 1} / {total}
          </span>
          <button type="button" onClick={() => janela.current?.close()} aria-label="Fechar as fotos" className={botao}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={seta}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
          {endereco ? (
            <img key={foto.id} src={endereco} alt={rotulo(i)} className="max-h-full max-w-full object-contain" />
          ) : (
            <p className="text-small">Esta foto não abriu.</p>
          )}
        </div>
        {total > 1 && (
          <div className="flex items-center justify-center gap-6 px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-3">
            <button type="button" onClick={anterior} aria-label="Foto anterior" className={botao}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className={seta}>
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button type="button" onClick={proxima} aria-label="Próxima foto" className={botao}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className={seta}>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}


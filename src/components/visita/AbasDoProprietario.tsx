import Link from "next/link";

// Abas de Meus imóveis (.tabs do pauta.css). A aba Visitas não existe no protótipo:
// veio da decisão de 04/11/2026. São links, para cada aba ter o próprio endereço.
export function AbasDoProprietario({ aba, paraConfirmar }: { aba: "imoveis" | "visitas"; paraConfirmar: number }) {
  const classes = (ligada: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center gap-2 border-b-[3px] text-small font-bold no-underline md:flex-none md:px-5 ${
      ligada ? "border-mar text-ink" : "border-transparent text-ink2"
    }`;
  return (
    <nav aria-label="Meus imóveis" className="flex gap-1 border-b border-line">
      <Link href="/proprietario" aria-current={aba === "imoveis" ? "page" : undefined} className={classes(aba === "imoveis")}>
        Imóveis
      </Link>
      <Link href="/proprietario/visitas" aria-current={aba === "visitas" ? "page" : undefined} className={classes(aba === "visitas")}>
        Visitas
        {paraConfirmar > 0 && (
          <span aria-label={`${paraConfirmar} para confirmar`} className="rounded-full bg-mar px-1.5 text-tiny text-white">
            {paraConfirmar}
          </span>
        )}
      </Link>
    </nav>
  );
}

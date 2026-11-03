import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// Campo de formulário do protótipo (.field em docs/prototipo/pauta.css):
// rótulo, caixa de texto, dica e mensagem de erro. A dica e o erro ficam ligados
// à caixa (aria-describedby), para o leitor de tela ler junto.
// Campo é a caixa de uma linha; CampoSelecao, a lista de opções; CampoTextoLongo,
// a caixa de várias linhas (ex.: descrição do imóvel).

type Moldura = {
  name: string;
  rotulo: string;
  dica?: string;
  erro?: string;
};

const classesCaixa = (erro?: string) =>
  `min-h-12 w-full rounded-botao border bg-card px-3.5 text-ink read-only:bg-cinza-soft read-only:text-ink2 focus:outline-2 focus:outline-offset-1 focus:outline-mar ${
    erro ? "border-erro" : "border-line"
  }`;

// Liga a dica e o erro à caixa e devolve as propriedades que a caixa recebe.
function ligacoes({ name, dica, erro, id }: Moldura & { id?: string }) {
  const idCampo = id ?? name;
  const descricao = [dica && `${idCampo}-dica`, erro && `${idCampo}-erro`].filter(Boolean).join(" ");
  return {
    idCampo,
    caixa: {
      id: idCampo,
      name,
      "aria-invalid": erro ? true : undefined,
      "aria-describedby": descricao || undefined,
    },
  };
}

function Envoltorio({
  idCampo,
  rotulo,
  dica,
  erro,
  className,
  children,
}: Omit<Moldura, "name"> & { idCampo: string; className: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={idCampo} className="text-small font-bold">
        {rotulo}
      </label>
      {children}
      {dica && (
        <span id={`${idCampo}-dica`} className="text-tiny text-ink2">
          {dica}
        </span>
      )}
      {erro && (
        <span id={`${idCampo}-erro`} className="text-tiny font-semibold text-erro">
          {erro}
        </span>
      )}
    </div>
  );
}

type CampoProps = InputHTMLAttributes<HTMLInputElement> & Moldura;

export function Campo({ name, rotulo, dica, erro, id, className = "", ...input }: CampoProps) {
  const { idCampo, caixa } = ligacoes({ name, rotulo, dica, erro, id });
  return (
    <Envoltorio idCampo={idCampo} rotulo={rotulo} dica={dica} erro={erro} className={className}>
      <input {...caixa} className={classesCaixa(erro)} {...input} />
    </Envoltorio>
  );
}

type CampoSelecaoProps = SelectHTMLAttributes<HTMLSelectElement> &
  Moldura & { opcoes: { valor: string; rotulo: string }[]; vazio?: string };

// vazio: texto da primeira opção, sem valor (ex.: "Escolha o bairro").
export function CampoSelecao({ name, rotulo, dica, erro, id, className = "", opcoes, vazio, ...select }: CampoSelecaoProps) {
  const { idCampo, caixa } = ligacoes({ name, rotulo, dica, erro, id });
  return (
    <Envoltorio idCampo={idCampo} rotulo={rotulo} dica={dica} erro={erro} className={className}>
      <select {...caixa} className={classesCaixa(erro)} {...select}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>
    </Envoltorio>
  );
}

type CampoTextoLongoProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Moldura;

export function CampoTextoLongo({ name, rotulo, dica, erro, id, className = "", ...area }: CampoTextoLongoProps) {
  const { idCampo, caixa } = ligacoes({ name, rotulo, dica, erro, id });
  return (
    <Envoltorio idCampo={idCampo} rotulo={rotulo} dica={dica} erro={erro} className={className}>
      <textarea {...caixa} className={`${classesCaixa(erro)} min-h-24 resize-none py-3`} {...area} />
    </Envoltorio>
  );
}

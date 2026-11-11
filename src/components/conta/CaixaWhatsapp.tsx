// A caixa "Receber avisos no WhatsApp" do cadastro e do convite (decisão de 09/11/2026):
// começa desmarcada, porque o WhatsApp só vai para quem aceitou. A lista de avisos no app
// vale sempre. Depois, a pessoa muda na chave de Minha conta.
export function CaixaWhatsapp({ marcada }: { marcada: boolean }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        // A chave refaz a caixa quando o servidor devolve o formulário com erro.
        key={String(marcada)}
        type="checkbox"
        name="whatsapp"
        value="sim"
        defaultChecked={marcada}
        className="mt-px size-[22px] shrink-0 accent-mar"
      />
      <span>
        Receber avisos no WhatsApp
        <span className="block text-tiny text-ink2">Visitas, propostas e contratos, no celular acima. Você muda em Minha conta.</span>
      </span>
    </label>
  );
}

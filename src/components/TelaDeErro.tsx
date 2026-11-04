import { Botao } from "@/components/ui/Botao";

// Tela de quando uma página falha ao carregar (ex.: Supabase fora do ar ou conexão
// caindo), em português (RNF10). Sem detalhes do erro: em produção o Next nem os
// manda ao navegador, e eles só interessam nos logs do servidor.
export function TelaDeErro({ tentarDeNovo }: { tentarDeNovo: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-4 px-5 pb-7 pt-[46px] md:px-10 md:pt-8">
      <h1 className="font-display text-t1 font-bold leading-[1.1] tracking-[-0.02em]">Não foi possível abrir esta página</h1>
      <p className="text-ink2">Confira sua conexão e tente de novo. Se continuar, tente daqui a alguns minutos.</p>
      <Botao variante="secundario" className="self-start" onClick={tentarDeNovo}>
        Tentar de novo
      </Botao>
    </div>
  );
}

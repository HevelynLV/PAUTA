// Regras do convite usadas pela tela do convite e pela action de aceitar
// (passo 5.4). Sem leitura de sessão: serve no servidor e no navegador.

// O código que criar_convite() sorteia: dois uuid sem traços (64 letras e números).
export const CODIGO_DO_CONVITE = /^[0-9a-f]{64}$/;

// Situação devolvida por dados_do_convite() (sem linha: undefined).
export function textoDaSituacao(situacao: string | undefined) {
  switch (situacao) {
    case "usado":
      return "Este convite já foi usado. Peça um convite novo ao responsável pela imobiliária.";
    case "vencido":
      return "Este convite venceu (vale 7 dias). Peça um convite novo ao responsável pela imobiliária.";
    case "sem_acesso":
      return "A imobiliária deste convite está sem acesso ao PAUTA agora. Fale com o responsável por ela.";
    default:
      return "Convite inválido ou cancelado. Peça um convite novo ao responsável pela imobiliária.";
  }
}

// Chama uma Server Action a partir de um botão. Se a conexão cair no meio, a
// chamada dá erro no navegador; sem isto, o erro sobe até a página de erro e a
// tela inteira some. Assim, a pessoa vê a mensagem e tenta de novo.
//
// Action que redireciona (ex.: exigirTipo de quem perdeu o acesso) também rejeita a
// promessa, de propósito: quem faz a navegação é o Next, e esse erro passa direto.

import { unstable_rethrow } from "next/navigation";

export const SEM_CONEXAO = "Não foi possível falar com o PAUTA. Confira a internet e tente de novo.";

export async function chamarAcao<T extends { erro?: string }>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch (erro) {
    unstable_rethrow(erro);
    return { erro: SEM_CONEXAO } as T;
  }
}

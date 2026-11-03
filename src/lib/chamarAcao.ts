// Chama uma Server Action a partir de um botão. Se a conexão cair no meio, a
// chamada dá erro no navegador; sem isto, o erro sobe até a página de erro e a
// tela inteira some. Assim, a pessoa vê a mensagem e tenta de novo.

export const SEM_CONEXAO = "Não foi possível falar com o PAUTA. Confira a internet e tente de novo.";

export async function chamarAcao<T extends { erro?: string }>(acao: () => Promise<T>): Promise<T> {
  try {
    return await acao();
  } catch {
    return { erro: SEM_CONEXAO } as T;
  }
}

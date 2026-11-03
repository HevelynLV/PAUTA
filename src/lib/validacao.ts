// Limpeza e conferência dos dados de cadastro, com as mesmas regras do banco
// (supabase/migrations). O banco confere de novo: aqui é só para a pessoa ver
// uma mensagem clara no campo certo, em vez do erro genérico do Supabase.

export type PerfilCadastro = "proprietario" | "imobiliaria" | "autonomo";

export const PERFIS_CADASTRO: readonly PerfilCadastro[] = ["proprietario", "imobiliaria", "autonomo"];

// Só números e sem o 0 da frente: "0 (48) 99812-4410" vira "48998124410".
export function limparTelefone(telefone: string) {
  return telefone.replace(/\D/g, "").replace(/^0+/, "");
}

// DDD (dois dígitos de 1 a 9) + número de 8 ou 9 dígitos (perfis_telefone_formato).
export function telefoneValido(telefone: string) {
  return /^[1-9]{2}[0-9]{8,9}$/.test(telefone);
}

// O cadastro pede só o número do CRECI; a UF é sempre SC (decisão de 22/10/2026).
// Tira espaços e pontos, e "CRECI" ou "SC" se a pessoa digitar mesmo assim:
// "creci/sc 12.345-j" vira "12345-J".
export function limparCreci(creci: string) {
  return creci
    .toUpperCase()
    .replace(/[\s.]/g, "")
    .replace(/^CRECI\/?/, "")
    .replace(/^SC[/-]?/, "")
    .replace(/[/-]?SC$/, "");
}

// Número (3 a 7 dígitos) com a letra obrigatória: J (empresa) ou F (pessoa física).
// Imobiliária só com J; autônomo com J ou F (decisão de 28/10/2026; no banco,
// assinantes_creci_com_letra e assinantes_imobiliaria_creci_j).
export function creciValido(creci: string, perfil: "imobiliaria" | "autonomo") {
  const letras = perfil === "imobiliaria" ? "J" : "JF";
  return new RegExp(`^\\d{3,7}-?[${letras}]$`).test(creci);
}

// Mensagem do campo CRECI que explica o que faltou.
export function erroDoCreci(creci: string, perfil: "imobiliaria" | "autonomo") {
  if (perfil === "imobiliaria" && /^\d{3,7}-?F$/.test(creci)) {
    return "Use o CRECI da imobiliária, com a letra J (ex.: 12345-J). CRECI com F é de pessoa física.";
  }
  if (/^\d{3,7}$/.test(creci)) {
    return perfil === "imobiliaria"
      ? "Falta a letra: escreva o CRECI com o J, ex.: 12345-J."
      : "Falta a letra: escreva o CRECI com o F ou o J, ex.: 12345-F.";
  }
  return perfil === "imobiliaria"
    ? "Escreva o número do CRECI com a letra J, ex.: 12345-J."
    : "Escreva o número do CRECI com a letra F ou J, ex.: 12345-F.";
}

// Ids (uuid) que vêm do endereço ou de um campo que a pessoa pode alterar:
// confere o formato antes de perguntar ao banco.
export function idValido(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function emailValido(email: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// perfis_nome_tamanho e assinantes_nome_tamanho.
export function nomeValido(nome: string) {
  return nome.length >= 2 && nome.length <= 120;
}

// Mínimo do protótipo; o máximo é o limite do Supabase Auth.
export function senhaValida(senha: string) {
  return senha.length >= 8 && senha.length <= 72;
}

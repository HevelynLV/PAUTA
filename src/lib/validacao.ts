// Limpeza e conferência dos dados de cadastro, com as mesmas regras do banco
// (supabase/migrations). O banco confere de novo: aqui é só para a pessoa ver
// uma mensagem clara no campo certo, em vez do erro genérico do Supabase.

export type PerfilCadastro = "proprietario" | "imobiliaria" | "autonomo";

export const PERFIS_CADASTRO: readonly PerfilCadastro[] = ["proprietario", "imobiliaria", "autonomo"];

// Só números, sem o 0 da frente e sem o 55 do Brasil: "0 (48) 99812-4410" e
// "+55 48 99812-4410" viram "48998124410". O 55 só sai com um número inteiro depois
// dele, para não confundir com o DDD 55 ("55 99812-4410").
export function limparTelefone(telefone: string) {
  return telefone
    .replace(/\D/g, "")
    .replace(/^0+/, "")
    .replace(/^55(?=\d{10,11}$)/, "");
}

// Celular: DDD (dois dígitos de 1 a 9), 9 e mais 8 dígitos (perfis_telefone_celular).
// Só celular porque os avisos vão por WhatsApp (decisão de 05/11/2026).
export function telefoneValido(telefone: string) {
  return /^[1-9]{2}9[0-9]{8}$/.test(telefone);
}

export const ERRO_TELEFONE = "Escreva um celular com DDD, ex.: (48) 99812-4410.";

// Máscara do campo, enquanto a pessoa digita: "4899812" vira "(48) 99812". Os
// separadores só aparecem com um dígito depois deles, para o apagar funcionar.
export function mascararTelefone(telefone: string) {
  const digitos = limparTelefone(telefone).slice(0, 11);
  if (digitos.length === 0) return "";
  const ddd = digitos.slice(0, 2);
  const inicio = digitos.slice(2, 7);
  const fim = digitos.slice(7);
  if (!inicio) return `(${ddd}`;
  return `(${ddd}) ${inicio}${fim && `-${fim}`}`;
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

// CPF ou CNPJ de quem paga a mensalidade (o Asaas exige; decisão de 19/11/2026). Só
// letras maiúsculas e números: "12.345.678/0001-95" vira "12345678000195". O CNPJ tem
// letras nas 12 primeiras posições desde julho de 2026. Mesmas regras de
// normalizar_documento() e documento_valido() no banco.
export function limparDocumento(documento: string) {
  return documento.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// Dígitos verificadores: cada posição vale o código do caractere menos 48 (o próprio
// número para os algarismos, como manda a regra do CNPJ alfanumérico).
export function documentoValido(documento: string) {
  const v = limparDocumento(documento);
  if (/^(.)\1*$/.test(v)) return false;
  const valor = (posicao: number) => v.charCodeAt(posicao) - 48;

  if (/^\d{11}$/.test(v)) {
    for (const d of [0, 1]) {
      let soma = 0;
      for (let i = 0; i < 9 + d; i++) soma += valor(i) * (10 + d - i);
      const dv = (soma * 10) % 11 === 10 ? 0 : (soma * 10) % 11;
      if (dv !== valor(9 + d)) return false;
    }
    return true;
  }

  if (/^[0-9A-Z]{12}\d{2}$/.test(v)) {
    for (const d of [0, 1]) {
      let soma = 0;
      // Pesos da direita para a esquerda: 2, 3, ..., 9, e de novo 2, 3, ...
      for (let i = 0; i < 12 + d; i++) soma += valor(i) * (2 + ((11 + d - i) % 8));
      const resto = soma % 11;
      if ((resto < 2 ? 0 : 11 - resto) !== valor(12 + d)) return false;
    }
    return true;
  }

  return false;
}

// Imobiliária só com CNPJ; autônomo com CPF ou CNPJ (documento_serve_para no banco).
export function documentoServePara(documento: string, perfil: "imobiliaria" | "autonomo") {
  return documentoValido(documento) && (perfil === "autonomo" || limparDocumento(documento).length === 14);
}

// Para mostrar: "CPF 123.456.789-09" ou "CNPJ 12.ABC.345/01DE-35".
export function formatarDocumento(documento: string) {
  const v = limparDocumento(documento);
  if (v.length === 11) return `CPF ${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  if (v.length === 14) return `CNPJ ${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  return v;
}

export function erroDoDocumento(documento: string, perfil: "imobiliaria" | "autonomo") {
  if (perfil === "imobiliaria" && /^\d{11}$/.test(limparDocumento(documento)) && documentoValido(documento)) {
    return "Use o CNPJ da imobiliária. CPF é de pessoa física.";
  }
  return perfil === "imobiliaria"
    ? "Confira o CNPJ, ex.: 12.345.678/0001-95."
    : "Confira o CPF ou o CNPJ, ex.: 123.456.789-09.";
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

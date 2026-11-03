"use server";

import { redirect } from "next/navigation";

import { criarClienteServidor } from "@/lib/supabase/server";
import {
  creciValido,
  emailValido,
  erroDoCreci,
  limparCreci,
  limparTelefone,
  nomeValido,
  PERFIS_CADASTRO,
  senhaValida,
  telefoneValido,
  type PerfilCadastro,
} from "@/lib/validacao";

// Cadastro pelo app (RF01, RF02). Exceção do exigirTipo() no CLAUDE.md: quem se
// cadastra ainda não está logado.
//
// Quem cria o perfil e o assinante é o gatilho do banco, a partir do que vai em
// options.data. O banco não aceita admin nem corretor sem convite, e ignora
// status ou assinante_id mandados por alguém que altere a requisição (RNF03).

export type CampoCadastro = "nome" | "email" | "telefone" | "senha" | "creci" | "nome_imobiliaria";

export type EstadoCadastro = {
  erros: Partial<Record<CampoCadastro, string>>;
  erroGeral?: string;
  // O que a pessoa digitou (menos a senha), para não perder ao mostrar um erro.
  valores: Partial<Record<CampoCadastro, string>>;
  // Com a confirmação de e-mail ligada (Etapa 13), a conta nasce sem sessão.
  confirmarEmail?: string;
};

const MENSAGEM_CRECI_REPETIDO =
  "Este CRECI já está cadastrado no PAUTA. Se ele é seu, fale com a equipe PAUTA.";

export async function cadastrar(_anterior: EstadoCadastro, formData: FormData): Promise<EstadoCadastro> {
  const texto = (campo: string) => String(formData.get(campo) ?? "").trim();

  const perfil = texto("perfil") as PerfilCadastro;
  if (!PERFIS_CADASTRO.includes(perfil)) {
    return { erros: {}, valores: {}, erroGeral: "Escolha o tipo de conta." };
  }
  const assinante = perfil !== "proprietario";

  const valores = {
    nome: texto("nome"),
    email: texto("email").toLowerCase(),
    telefone: texto("telefone"),
    creci: assinante ? texto("creci") : "",
    nome_imobiliaria: perfil === "imobiliaria" ? texto("nome_imobiliaria") : "",
  };
  const senha = String(formData.get("senha") ?? "");
  const telefone = limparTelefone(valores.telefone);
  const creci = limparCreci(valores.creci);

  const erros: EstadoCadastro["erros"] = {};
  if (!nomeValido(valores.nome)) erros.nome = "Escreva o nome (de 2 a 120 letras).";
  if (!emailValido(valores.email)) erros.email = "Confira o e-mail.";
  if (!telefoneValido(telefone)) erros.telefone = "Escreva o telefone com DDD, ex.: (48) 99812-4410.";
  if (!senhaValida(senha)) erros.senha = "A senha precisa ter pelo menos 8 caracteres.";
  if (perfil === "imobiliaria" && !nomeValido(valores.nome_imobiliaria)) {
    erros.nome_imobiliaria = "Escreva o nome da imobiliária.";
  }
  if (perfil !== "proprietario" && !creciValido(creci, perfil)) erros.creci = erroDoCreci(creci, perfil);
  if (Object.keys(erros).length > 0) return { erros, valores };

  const supabase = await criarClienteServidor();

  // O Supabase Auth não diz ao app por que o banco recusou o cadastro (passo
  // 3.2a). Por isso a pergunta vem antes; o unique do banco continua valendo.
  if (assinante && !(await creciLivre(supabase, creci))) {
    return { erros: { creci: MENSAGEM_CRECI_REPETIDO }, valores };
  }

  const { data, error } = await supabase.auth.signUp({
    email: valores.email,
    password: senha,
    options: {
      data: {
        tipo: perfil,
        nome: valores.nome,
        telefone,
        ...(assinante && { creci }),
        ...(perfil === "imobiliaria" && { nome_imobiliaria: valores.nome_imobiliaria }),
      },
    },
  });

  if (error) {
    switch (error.code) {
      case "user_already_exists":
      case "email_exists":
        return { erros: { email: "Já existe uma conta com este e-mail. Entre ou recupere a senha." }, valores };
      case "email_address_invalid":
        return { erros: { email: "Este e-mail não é aceito. Use outro." }, valores };
      case "weak_password":
        return { erros: { senha: "Senha fraca. Use letras e números, com pelo menos 8 caracteres." }, valores };
      case "over_request_rate_limit":
      case "over_email_send_rate_limit":
        return { erros: {}, valores, erroGeral: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo." };
    }
    // Erro do banco (chega sem código). O caso mais provável é outra pessoa ter
    // cadastrado o mesmo CRECI entre a pergunta e o cadastro.
    if (assinante && !(await creciLivre(supabase, creci))) {
      return { erros: { creci: MENSAGEM_CRECI_REPETIDO }, valores };
    }
    return { erros: {}, valores, erroGeral: "Não foi possível criar a conta. Confira os dados e tente de novo." };
  }

  if (!data.session) {
    return { erros: {}, valores, confirmarEmail: valores.email };
  }

  // Imobiliária e autônomo entram pendentes até o admin ativar.
  redirect(assinante ? "/aguardando-ativacao" : "/proprietario");
}

async function creciLivre(supabase: Awaited<ReturnType<typeof criarClienteServidor>>, creci: string) {
  const { data, error } = await supabase.rpc("creci_disponivel", { p_creci: creci });
  // Na dúvida (erro de rede), deixa seguir: o unique do banco barra o repetido.
  return error ? true : data === true;
}

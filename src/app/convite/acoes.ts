"use server";

import { redirect } from "next/navigation";

import { usuarioAtual } from "@/lib/auth";
import { CODIGO_DO_CONVITE, textoDaSituacao } from "@/lib/convite";
import { criarClienteServidor } from "@/lib/supabase/server";
import { emailValido, limparTelefone, nomeValido, senhaValida, telefoneValido } from "@/lib/validacao";

// Aceitar o convite: o corretor cria a conta e já entra vinculado e ativo (RF05).
// Exceção do exigirTipo() no CLAUDE.md: quem aceita ainda não tem conta.
//
// Quem confere o convite de verdade é o gatilho de cadastro do banco (existe, não
// foi usado, está na validade, a imobiliária tem acesso e, se o convite tem
// e-mail, é o mesmo). Ele trava o convite e o marca como usado na mesma operação.
// O app pergunta antes (convite_valido e dados_do_convite) só para mostrar a
// mensagem certa: o Supabase Auth não repassa o motivo do erro do gatilho.

export type CampoConvite = "nome" | "email" | "telefone" | "senha";

export type EstadoConvite = {
  erros: Partial<Record<CampoConvite, string>>;
  erroGeral?: string;
  valores: Partial<Record<CampoConvite, string>>;
};

export async function aceitarConvite(_anterior: EstadoConvite, formData: FormData): Promise<EstadoConvite> {
  const texto = (campo: string) => String(formData.get(campo) ?? "").trim();
  const codigo = texto("codigo");
  const valores = { nome: texto("nome"), email: texto("email").toLowerCase(), telefone: texto("telefone") };
  const senha = String(formData.get("senha") ?? "");
  const telefone = limparTelefone(valores.telefone);

  if (!CODIGO_DO_CONVITE.test(codigo)) {
    return { erros: {}, valores, erroGeral: "Convite inválido. Peça um link novo ao responsável pela imobiliária." };
  }

  const erros: EstadoConvite["erros"] = {};
  if (!nomeValido(valores.nome)) erros.nome = "Escreva o nome (de 2 a 120 letras).";
  if (!emailValido(valores.email)) erros.email = "Confira o e-mail.";
  if (!telefoneValido(telefone)) erros.telefone = "Escreva o telefone com DDD, ex.: (48) 99812-4410.";
  if (!senhaValida(senha)) erros.senha = "A senha precisa ter pelo menos 8 caracteres.";
  if (Object.keys(erros).length > 0) return { erros, valores };

  // A tela já avisa quem está logado; chamada direto, a action trocaria a sessão.
  if (await usuarioAtual()) {
    return { erros: {}, valores, erroGeral: "Você já está conectado. Saia e abra o link do convite de novo." };
  }

  const supabase = await criarClienteServidor();
  const motivo = await motivoDoConviteNaoValer(supabase, codigo, valores.email);
  if (motivo) return motivo.campo ? { erros: { email: motivo.texto }, valores } : { erros: {}, valores, erroGeral: motivo.texto };

  const { error } = await supabase.auth.signUp({
    email: valores.email,
    password: senha,
    options: { data: { tipo: "corretor", nome: valores.nome, telefone, convite: codigo } },
  });

  if (error) {
    switch (error.code) {
      case "user_already_exists":
      case "email_exists":
        return {
          erros: { email: "Já existe uma conta com este e-mail. Use outro e-mail para entrar na equipe." },
          valores,
        };
      case "email_address_invalid":
        return { erros: { email: "Este e-mail não é aceito. Use outro." }, valores };
      case "weak_password":
        return { erros: { senha: "Senha fraca. Use letras e números, com pelo menos 8 caracteres." }, valores };
      case "over_request_rate_limit":
      case "over_email_send_rate_limit":
        return { erros: {}, valores, erroGeral: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo." };
    }
    // Erro do banco (chega sem código): o mais provável é o convite ter sido usado
    // ou cancelado entre a pergunta e o cadastro.
    const depois = await motivoDoConviteNaoValer(supabase, codigo, valores.email);
    return { erros: {}, valores, erroGeral: depois?.texto ?? "Não foi possível criar a conta. Tente de novo." };
  }

  // Sem sessão (confirmação de e-mail ligada, Etapa 13), o /assinante manda para /entrar.
  redirect("/assinante");
}

async function motivoDoConviteNaoValer(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  codigo: string,
  email: string,
): Promise<{ texto: string; campo?: boolean } | null> {
  const { data: valido } = await supabase.rpc("convite_valido", { p_codigo: codigo, p_email: email });
  if (valido === true) return null;

  const { data } = await supabase.rpc("dados_do_convite", { p_codigo: codigo });
  const convite = (data as { situacao: string; email: string | null }[] | null)?.[0];
  if (convite?.situacao === "valido" && convite.email) {
    return { texto: `Este convite é para ${convite.email}. Use esse e-mail.`, campo: true };
  }
  return { texto: textoDaSituacao(convite?.situacao) };
}

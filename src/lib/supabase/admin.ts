import "server-only";

import { createClient } from "@supabase/supabase-js";

// Cliente do Supabase com a chave secreta: passa por cima do RLS e mexe no
// Supabase Auth. Só para as ações do admin que precisam disso (decisão de
// 22/10/2026), e sempre DEPOIS de exigirTipo("admin"):
//   - excluir imobiliária ou corretor autônomo pendente com o usuário (RF16)
//
// Leituras e as outras mudanças continuam com criarClienteServidor(), para o
// RLS valer. O "server-only" faz o build falhar se este arquivo for parar no
// navegador, e a chave nunca tem o prefixo NEXT_PUBLIC_.
//
// NUNCA use este cliente para editar imóvel, foto ou status/bloqueio de
// assinante: os gatilhos confiam em current_user = 'authenticated' e em
// auth.uid(), e com a chave secreta eles são pulados (a regra de mudança de
// status do assinante, a data do aceite do termo e o registro de edições).
//
// Em desenvolvimento, SUPABASE_SECRET_KEY é a chave pessoal de cada um (a mesma
// dos testes). Na Vercel (Etapa 13), é uma chave de produção só do app.
export function criarClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !chave) {
    throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.local");
  }
  // Sem sessão: cada chamada usa só a chave, nunca o login de alguém.
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

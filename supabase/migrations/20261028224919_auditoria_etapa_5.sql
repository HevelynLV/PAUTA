-- Etapa 5, passo 5.6: correções da auditoria da Etapa 5.
--
-- - Limite de 20 convites por hora por imobiliária (decisão de 28/10/2026). Conta
--   toda chamada do criar_convite(), inclusive a de e-mail que já tem conta: sem
--   isso, uma imobiliária testaria e-mails em série para saber quem tem conta.
--   Por isso o e-mail com conta deixa de ser erro (o erro desfaria o registro da
--   tentativa) e passa a devolver null.
-- - CRECI com 3 a 7 dígitos também no banco, como na tela. Conferido em
--   28/10/2026 que nenhum assinante tinha CRECI fora disso.
-- - O responsável de imobiliária sem acesso (pendente, vencida ou bloqueada) não
--   lê a equipe pela API.

-- ---------------------------------------------------------------
-- 1. Limite de convites
-- ---------------------------------------------------------------
-- Só o criar_convite() lê e grava (security definer): ninguém lê pela API.

create table public.tentativas_de_convite (
  id           bigint generated always as identity primary key,
  assinante_id uuid not null references public.assinantes (id) on delete cascade,
  criado_em    timestamptz not null default now()
);

create index tentativas_de_convite_assinante_criado_em
  on public.tentativas_de_convite (assinante_id, criado_em);

alter table public.tentativas_de_convite enable row level security;
revoke all on table public.tentativas_de_convite from anon, authenticated;

comment on table public.tentativas_de_convite is
  'Cada chamada do criar_convite() na última hora, para o limite de 20 por hora por imobiliária.';

-- Devolve o código do convite (só desta vez: o banco guarda o hash), ou null se
-- o e-mail já tem conta no PAUTA. Sem e-mail, é um convite por link, para uma
-- pessoa só. Validade: o padrão da coluna (7 dias).
-- Erros que o app reconhece pelo hint: email_invalido, limite_de_convites.
create or replace function public.criar_convite(p_email text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email     text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_assinante uuid := (select public.meu_assinante_id());
  v_codigo    text;
begin
  if (select public.meu_tipo()) is distinct from 'imobiliaria' or not (select public.eh_assinante_ativo()) then
    raise exception 'Só o responsável de imobiliária com acesso ao catálogo cria convite'
      using errcode = '42501';
  end if;

  -- Trava a imobiliária: duas chamadas ao mesmo tempo não passam juntas do limite.
  perform 1 from public.assinantes where id = v_assinante for update;
  delete from public.tentativas_de_convite
  where assinante_id = v_assinante
    and criado_em <= now() - interval '1 hour';
  if (select count(*) from public.tentativas_de_convite where assinante_id = v_assinante) >= 20 then
    raise exception 'Limite de 20 convites por hora' using errcode = 'P0001', hint = 'limite_de_convites';
  end if;
  insert into public.tentativas_de_convite (assinante_id) values (v_assinante);

  if v_email is not null then
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'E-mail inválido' using errcode = 'P0001', hint = 'email_invalido';
    end if;
    if exists (select 1 from auth.users u where lower(u.email) = v_email) then
      return null;
    end if;
    -- O novo substitui o que estava aguardando para o mesmo e-mail.
    delete from public.convites
    where assinante_id = v_assinante
      and lower(email) = v_email
      and usado_em is null;
  end if;

  -- Dois uuid v4 sem traços: 64 letras e números, 244 bits aleatórios do gerador
  -- seguro do Postgres.
  v_codigo := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.convites (assinante_id, email, token_hash, criado_por)
  values (v_assinante, v_email, encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex'), (select auth.uid()));

  return v_codigo;
end;
$$;

-- create or replace mantém as permissões da função (só authenticated).

-- ---------------------------------------------------------------
-- 2. CRECI com 3 a 7 dígitos
-- ---------------------------------------------------------------

alter table public.assinantes
  drop constraint assinantes_creci_com_letra,
  add constraint assinantes_creci_com_letra
    check (creci_normalizado ~ '^[0-9]{3,7}[JF]$');

create or replace function public.creci_disponivel(p_creci text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalizar_creci(p_creci) ~ '^[0-9]{3,7}[JF]$'
     and not exists (
       select 1 from public.assinantes a
       where a.creci_normalizado = public.normalizar_creci(p_creci)
     );
$$;

-- ---------------------------------------------------------------
-- 3. Equipe só para quem tem acesso
-- ---------------------------------------------------------------

drop policy "perfis: responsavel le a equipe" on public.perfis;

create policy "perfis: responsavel le a equipe"
  on public.perfis
  for select
  to authenticated
  using (
    (select public.meu_tipo()) = 'imobiliaria'
    and (select public.eh_assinante_ativo())
    and assinante_id = (select public.meu_assinante_id())
  );

-- ---------------------------------------------------------------
-- 4. Corretor removido lê a imobiliária (de propósito)
-- ---------------------------------------------------------------

comment on policy "assinantes: ler o proprio ou admin" on public.assinantes is
  'Lê o próprio assinante (responsável, autônomo e corretores, inclusive o removido) e o admin lê todos. O corretor removido continua lendo nome, CRECI e status da imobiliária de propósito: a tela /acesso-suspenso mostra de qual equipe ele saiu.';

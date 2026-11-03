-- Etapa 5, passo 5.4: convites gerados pelo banco e corretor removido da equipe.
--
-- Decisões de 28/10/2026 (plano da Etapa 5 e passo 5.4, docs/visao-geral.md):
-- - O código do convite é sorteado pelo banco (mais de 200 bits aleatórios), que
--   guarda só o hash e devolve o código uma vez. Antes, quem criava o convite
--   escolhia o código (auditoria da Etapa 2). Inserir direto em convites passa a
--   ser barrado: o caminho é criar_convite().
-- - Convite por e-mail para um e-mail que já tem conta é recusado com mensagem
--   clara. Um novo convite para o mesmo e-mail substitui o que estava aguardando
--   (o link só aparece uma vez: assim o responsável que perdeu o link gera outro).
-- - O responsável remove corretores da equipe: o corretor perde o acesso na hora,
--   a conta e o vínculo ficam como histórico (perfis.removido_em). O responsável
--   não remove a si mesmo.
-- - O responsável lê nome, telefone e data de entrada dos corretores da equipe.

-- ---------------------------------------------------------------
-- 1. Corretor removido
-- ---------------------------------------------------------------

alter table public.perfis
  add column removido_em timestamptz,
  add constraint perfis_removido_so_corretor
    check (removido_em is null or tipo = 'corretor');

comment on column public.perfis.removido_em is
  'Quando o responsável removeu o corretor da equipe. Removido não tem acesso; a conta e o vínculo ficam como histórico.';

-- Acesso: status ativo, não bloqueado e, para o corretor, não removido.
create or replace function public.eh_assinante_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfis p
    join public.assinantes a on a.id = p.assinante_id
    where p.id = (select auth.uid())
      and a.status = 'ativo'
      and not a.bloqueado_pelo_admin
      and p.removido_em is null
  );
$$;

-- Só o responsável remove, só corretor da própria imobiliária e só uma vez. O
-- responsável é do tipo imobiliaria, então nunca é removido por aqui.
create function public.remover_corretor(p_corretor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.meu_tipo()) is distinct from 'imobiliaria' then
    raise exception 'Só o responsável pela imobiliária remove corretores' using errcode = '42501';
  end if;

  update public.perfis
  set removido_em = now()
  where id = p_corretor
    and tipo = 'corretor'
    and assinante_id = (select public.meu_assinante_id())
    and removido_em is null;

  if not found then
    raise exception 'Corretor não encontrado na sua equipe' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.remover_corretor(uuid) from public, anon;
grant execute on function public.remover_corretor(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 2. O responsável vê a equipe
-- ---------------------------------------------------------------
-- Soma-se à política "perfis: ler o proprio ou admin". A permissão por coluna
-- não muda: ele lê, mas não altera, o perfil dos corretores.

create policy "perfis: responsavel le a equipe"
  on public.perfis
  for select
  to authenticated
  using (
    (select public.meu_tipo()) = 'imobiliaria'
    and assinante_id = (select public.meu_assinante_id())
  );

-- ---------------------------------------------------------------
-- 3. Convite criado só pelo banco
-- ---------------------------------------------------------------

drop policy "convites: responsavel de imobiliaria ativa cria" on public.convites;
revoke insert on table public.convites from authenticated;

-- Devolve o código do convite (só desta vez: o banco guarda o hash). Sem e-mail,
-- é um convite por link, para uma pessoa só. Validade: o padrão da coluna (7 dias).
-- Erros que o app reconhece pelo hint: email_invalido, email_com_conta.
create function public.criar_convite(p_email text default null)
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

  if v_email is not null then
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'E-mail inválido' using errcode = 'P0001', hint = 'email_invalido';
    end if;
    if exists (select 1 from auth.users u where lower(u.email) = v_email) then
      raise exception 'Este e-mail já tem conta no PAUTA' using errcode = 'P0001', hint = 'email_com_conta';
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

revoke execute on function public.criar_convite(text) from public, anon;
grant execute on function public.criar_convite(text) to authenticated;

-- ---------------------------------------------------------------
-- 4. Tela do convite (sem login)
-- ---------------------------------------------------------------
-- Para quem tem o código: de qual imobiliária é, quem convidou e, se o convite
-- vale, para qual e-mail. Sem linha: código que não existe.
-- situacao: valido, usado, vencido ou sem_acesso (imobiliária pendente, vencida
-- ou bloqueada). As mesmas condições do convite_valido() e do gatilho de cadastro.
create function public.dados_do_convite(p_codigo text)
returns table (situacao text, imobiliaria text, creci text, convidado_por text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.situacao,
         a.nome,
         a.creci,
         p.nome,
         case when s.situacao = 'valido' then c.email end
  from public.convites c
  join public.assinantes a on a.id = c.assinante_id
  left join public.perfis p on p.id = c.criado_por
  cross join lateral (
    select case
      when c.usado_em is not null then 'usado'
      when c.expira_em <= now() then 'vencido'
      when a.status <> 'ativo' or a.bloqueado_pelo_admin then 'sem_acesso'
      else 'valido'
    end as situacao
  ) s
  where c.token_hash = encode(sha256(convert_to(coalesce(p_codigo, ''), 'UTF8')), 'hex')
    and a.tipo = 'imobiliaria';
$$;

revoke execute on function public.dados_do_convite(text) from public;
grant execute on function public.dados_do_convite(text) to anon, authenticated;

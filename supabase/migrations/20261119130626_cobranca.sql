-- Etapa 11, passo 11.2a: cobrança da mensalidade pelo Asaas (RF27, RF28).
--
-- Decisões de 13/11/2026 e de 19/11/2026 (plano da Etapa 11, docs/visao-geral.md):
-- - Dois preços fixos: um da imobiliária e outro do corretor autônomo, guardados em
--   "planos" (nunca no código). O corretor convidado não paga: segue a imobiliária.
-- - O CPF ou CNPJ de quem paga (o Asaas exige) fica numa tabela à parte,
--   "dados_de_cobranca", que só o responsável e o admin leem. Os corretores leem a
--   linha da imobiliária em "assinantes" e não podem ver o documento: RLS não esconde
--   coluna, por isso a tabela separada (como "vendas" na Etapa 9).
-- - A cobrança só nasce depois de o admin ativar (passo 11.2b). Ativar já libera o acesso.
-- - O acesso cai 3 dias depois do vencimento sem pagamento. O corte é calculado aqui,
--   pela data, e não depende de o aviso do Asaas chegar: mensalidade_atrasada().
-- - O webhook do Asaas (passo 11.3a) grava por registrar_evento_asaas(), que confere
--   um segredo guardado no Vault (pauta_asaas), como a fila do WhatsApp. Sem a chave
--   secreta do Supabase. Cada evento é gravado uma vez só (idempotente).
--
-- Antes de aplicar, o segredo precisa existir no Vault (README, "Segredos no Vault"):
--   select vault.create_secret('<o mesmo valor de ASAAS_SEGREDO>', 'pauta_asaas');

-- 1. Tipos ----------------------------------------------------------------

-- Os avisos "mensalidade_paga" e "mensalidade_vencida" entraram em tipo_aviso na
-- migration anterior (20261119130600_cobranca_tipos_de_aviso).

create type public.status_cobranca as enum (
  'pendente',   -- em aberto, antes do vencimento ou ainda sem o aviso de vencida do Asaas
  'vencida',    -- o Asaas avisou que venceu sem pagamento
  'paga',       -- recebida ou confirmada pelo Asaas
  'cancelada',  -- apagada no Asaas (não conta como atraso)
  'estornada'   -- devolvida depois de paga (não conta como atraso)
);

-- 2. CPF e CNPJ -----------------------------------------------------------

-- Só letras maiúsculas e números: "12.345.678/0001-95" vira "12345678000195". O CNPJ
-- passou a ter letras nas 12 primeiras posições em julho de 2026 (Receita Federal).
create function public.normalizar_documento(p_documento text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(upper(coalesce(p_documento, '')), '[^0-9A-Z]', '', 'g');
$$;

-- Confere os dígitos verificadores do CPF (11 números) ou do CNPJ (14 posições: 12
-- letras ou números e 2 números). Cada posição vale o código ASCII menos 48, o que dá
-- o próprio número para os algarismos (regra do CNPJ alfanumérico). Recusa sequências
-- repetidas, como 000.000.000-00.
create function public.documento_valido(p_documento text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v      text := public.normalizar_documento(p_documento);
  v_soma int;
  v_dv   int;
  i      int;
begin
  if v ~ '^(.)\1*$' then
    return false;
  end if;

  if v ~ '^[0-9]{11}$' then
    for d in 0..1 loop
      v_soma := 0;
      for i in 1..(9 + d) loop
        v_soma := v_soma + substr(v, i, 1)::int * (11 + d - i);
      end loop;
      v_dv := (v_soma * 10) % 11;
      if v_dv = 10 then v_dv := 0; end if;
      if v_dv <> substr(v, 10 + d, 1)::int then
        return false;
      end if;
    end loop;
    return true;
  end if;

  if v ~ '^[0-9A-Z]{12}[0-9]{2}$' then
    for d in 0..1 loop
      v_soma := 0;
      for i in 1..(12 + d) loop
        -- Pesos da direita para a esquerda: 2, 3, ..., 9, e de novo 2, 3, ...
        v_soma := v_soma + (ascii(substr(v, i, 1)) - 48) * (2 + ((12 + d - i) % 8));
      end loop;
      v_dv := v_soma % 11;
      v_dv := case when v_dv < 2 then 0 else 11 - v_dv end;
      if v_dv <> substr(v, 13 + d, 1)::int then
        return false;
      end if;
    end loop;
    return true;
  end if;

  return false;
end;
$$;

comment on function public.documento_valido(text) is
  'CPF ou CNPJ (também o alfanumérico) com os dígitos verificadores certos. Aceita com ou sem pontos, barra e traço.';

-- Imobiliária só com CNPJ; autônomo com CPF ou CNPJ (como o CRECI J ou F).
create function public.documento_serve_para(p_documento text, p_tipo public.tipo_assinante)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.documento_valido(p_documento)
     and (p_tipo = 'autonomo' or length(public.normalizar_documento(p_documento)) = 14);
$$;

-- 3. Planos (os dois preços) ----------------------------------------------

create table public.planos (
  tipo           public.tipo_assinante primary key,
  valor_centavos integer not null,
  -- Valores de teste até o piloto (decisão de 13/11/2026). O real entra com false.
  provisorio     boolean not null default true,
  atualizado_em  timestamptz not null default now(),

  constraint planos_valor_positivo check (valor_centavos > 0)
);

comment on table public.planos is
  'Mensalidade de cada tipo de assinante, em centavos. A migration não traz valor: o admin cadastra. Cada cobrança guarda o próprio valor.';

alter table public.planos enable row level security;

-- O preço aparece no cadastro, antes do login.
revoke all on table public.planos from anon, authenticated;
grant select on table public.planos to anon, authenticated;
grant insert, update on table public.planos to authenticated;

create policy "planos: todos leem"
  on public.planos for select
  to anon, authenticated
  using (true);

create policy "planos: admin cadastra"
  on public.planos for insert
  to authenticated
  with check ((select public.eh_admin()));

create policy "planos: admin altera"
  on public.planos for update
  to authenticated
  using ((select public.eh_admin()))
  with check ((select public.eh_admin()));

create function public.marcar_atualizacao_do_plano()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
revoke execute on function public.marcar_atualizacao_do_plano() from public, anon, authenticated;

create trigger marcar_atualizacao_do_plano
  before update on public.planos
  for each row execute function public.marcar_atualizacao_do_plano();

-- 4. Dados de cobrança do assinante ---------------------------------------

create table public.dados_de_cobranca (
  assinante_id        uuid primary key references public.assinantes (id) on delete cascade,
  -- Normalizado (só letras maiúsculas e números).
  cpf_cnpj            text not null,
  -- Preenchidos pelo servidor depois de criar o cliente e a assinatura no Asaas (11.2b).
  asaas_cliente_id    text,
  asaas_assinatura_id text,
  atualizado_em       timestamptz not null default now(),

  constraint dados_de_cobranca_documento_valido check (public.documento_valido(cpf_cnpj)),
  constraint dados_de_cobranca_documento_normalizado check (cpf_cnpj = public.normalizar_documento(cpf_cnpj)),
  constraint dados_de_cobranca_documento_unico unique (cpf_cnpj),
  constraint dados_de_cobranca_cliente_unico unique (asaas_cliente_id),
  constraint dados_de_cobranca_assinatura_unica unique (asaas_assinatura_id)
);

comment on table public.dados_de_cobranca is
  'CPF ou CNPJ de quem paga e os ids do Asaas. Só o responsável (imobiliária ou autônomo) e o admin leem; ninguém escreve pela API.';

alter table public.dados_de_cobranca enable row level security;

revoke all on table public.dados_de_cobranca from anon, authenticated;
grant select on table public.dados_de_cobranca to authenticated;

create policy "dados_de_cobranca: o responsavel ou admin leem"
  on public.dados_de_cobranca for select
  to authenticated
  using (
    exists (
      select 1 from public.assinantes a
      where a.id = assinante_id and a.responsavel_id = (select auth.uid())
    )
    or (select public.eh_admin())
  );

-- Pergunta do cadastro, antes de criar a conta (como creci_disponivel). Responde só sim
-- ou não. Risco aceito: diz se um documento já tem conta no PAUTA.
create function public.documento_disponivel(p_documento text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.documento_valido(p_documento)
     and not exists (
       select 1 from public.dados_de_cobranca d
       where d.cpf_cnpj = public.normalizar_documento(p_documento)
     );
$$;
revoke execute on function public.documento_disponivel(text) from public;
grant execute on function public.documento_disponivel(text) to anon, authenticated;

-- Contas que já existiam sem o documento: o responsável informa uma vez (na tela de
-- aguardando ativação ou na de pagamento). Depois, só o admin muda (pelo banco).
create function public.informar_documento(p_documento text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assinante uuid;
  v_tipo      public.tipo_assinante;
begin
  select a.id, a.tipo into v_assinante, v_tipo
  from public.assinantes a
  where a.responsavel_id = (select auth.uid())
  for update;

  if v_assinante is null then
    raise exception 'Só o responsável pela assinatura informa o CPF ou CNPJ'
      using errcode = '42501';
  end if;
  if not public.documento_serve_para(p_documento, v_tipo) then
    raise exception 'CPF ou CNPJ inválido' using errcode = 'P0001',
      hint = case when v_tipo = 'imobiliaria' then 'cnpj_invalido' else 'documento_invalido' end;
  end if;
  if exists (select 1 from public.dados_de_cobranca where assinante_id = v_assinante) then
    raise exception 'O CPF ou CNPJ já foi informado' using errcode = 'P0001', hint = 'ja_informado';
  end if;
  if not public.documento_disponivel(p_documento) then
    raise exception 'Este CPF ou CNPJ já está cadastrado no PAUTA' using errcode = 'P0001',
      hint = 'documento_repetido';
  end if;

  insert into public.dados_de_cobranca (assinante_id, cpf_cnpj)
  values (v_assinante, public.normalizar_documento(p_documento));
end;
$$;
revoke execute on function public.informar_documento(text) from public, anon;
grant execute on function public.informar_documento(text) to authenticated;

-- 5. Cobranças (espelho dos pagamentos do Asaas) --------------------------

create table public.cobrancas (
  id                 bigint generated always as identity primary key,
  assinante_id       uuid not null references public.assinantes (id) on delete restrict,
  asaas_pagamento_id text not null,
  valor_centavos     integer not null,
  vencimento         date not null,
  status             public.status_cobranca not null default 'pendente',
  -- Como o Asaas descreve: PIX, BOLETO, CREDIT_CARD ou UNDEFINED (quem paga escolhe).
  forma              text,
  -- Página da fatura no Asaas, onde se paga com Pix, boleto ou cartão.
  link_fatura        text,
  pago_em            timestamptz,
  criada_em          timestamptz not null default now(),
  atualizada_em      timestamptz not null default now(),

  constraint cobrancas_pagamento_unico unique (asaas_pagamento_id),
  constraint cobrancas_valor_positivo check (valor_centavos > 0),
  constraint cobrancas_link_https check (link_fatura is null or link_fatura ~ '^https://'),
  constraint cobrancas_paga_tem_data check ((status = 'paga') = (pago_em is not null) or status = 'estornada')
);

create index cobrancas_assinante_vencimento on public.cobrancas (assinante_id, vencimento desc);

comment on table public.cobrancas is
  'Mensalidades do Asaas, gravadas só pelo webhook (registrar_evento_asaas). Leem o responsável e o admin; o corretor convidado não.';

alter table public.cobrancas enable row level security;

revoke all on table public.cobrancas from anon, authenticated;
grant select on table public.cobrancas to authenticated;

create policy "cobrancas: o responsavel ou admin leem"
  on public.cobrancas for select
  to authenticated
  using (
    exists (
      select 1 from public.assinantes a
      where a.id = assinante_id and a.responsavel_id = (select auth.uid())
    )
    or (select public.eh_admin())
  );

-- 6. Eventos do Asaas já recebidos (idempotência) -------------------------

-- Sem o corpo do evento: ele traz nome, documento e e-mail de quem paga.
create table public.eventos_asaas (
  id                 text primary key,
  tipo               text not null,
  asaas_pagamento_id text,
  -- registrado, ignorado (tipo ou status que não interessa) ou desconhecido (cliente
  -- que não é de nenhum assinante).
  resultado          text not null,
  recebido_em        timestamptz not null default now()
);

alter table public.eventos_asaas enable row level security;
revoke all on table public.eventos_asaas from anon, authenticated;

-- 7. Atraso e acesso --------------------------------------------------------

-- Tem mensalidade em aberto vencida há mais de 3 dias (no dia de Florianópolis)? Vence
-- dia 10: o acesso vale até o fim do dia 13 e cai no dia 14.
create function public.mensalidade_atrasada(p_assinante uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cobrancas c
    where c.assinante_id = p_assinante
      and c.status in ('pendente', 'vencida')
      and c.vencimento < (now() at time zone 'America/Sao_Paulo')::date - 3
  );
$$;
revoke execute on function public.mensalidade_atrasada(uuid) from public, anon, authenticated;

-- A regra do acesso da assinatura, num lugar só: ativa, não bloqueada e sem mensalidade
-- atrasada. Interna: as funções abaixo chamam.
create function public.assinatura_com_acesso(p_assinante uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assinantes a
    where a.id = p_assinante
      and a.status = 'ativo'
      and not a.bloqueado_pelo_admin
      and not public.mensalidade_atrasada(a.id)
  );
$$;
revoke execute on function public.assinatura_com_acesso(uuid) from public, anon, authenticated;

-- Igual à versão da migration 20261028162403_convites_e_equipe, com a regra acima.
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
    where p.id = (select auth.uid())
      and p.removido_em is null
      and public.assinatura_com_acesso(p.assinante_id)
  );
$$;

-- Igual à versão da migration 20261109232807_avisos, com a regra acima.
create or replace function public.inicio_dos_avisos_para_assinantes()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(a.ativado_em, p.criado_em)
  from public.perfis p
  join public.assinantes a on a.id = p.assinante_id
  where p.id = (select auth.uid())
    and p.removido_em is null
    and public.assinatura_com_acesso(a.id);
$$;

-- Igual à versão da migration 20261022231442_cadastro_etapa_3: imobiliária com a
-- mensalidade atrasada não recebe corretor novo.
create or replace function public.convite_valido(p_codigo text, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.convites c
    join public.assinantes a on a.id = c.assinante_id
    where c.token_hash = encode(sha256(convert_to(coalesce(p_codigo, ''), 'UTF8')), 'hex')
      and c.usado_em is null
      and c.expira_em > now()
      and a.tipo = 'imobiliaria'
      and public.assinatura_com_acesso(a.id)
      and (c.email is null or lower(c.email) = lower(coalesce(p_email, '')))
  );
$$;

-- Igual à versão da migration 20261028162403_convites_e_equipe, com a regra acima.
create or replace function public.dados_do_convite(p_codigo text)
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
      when not public.assinatura_com_acesso(a.id) then 'sem_acesso'
      else 'valido'
    end as situacao
  ) s
  where c.token_hash = encode(sha256(convert_to(coalesce(p_codigo, ''), 'UTF8')), 'hex')
    and a.tipo = 'imobiliaria';
$$;

-- 8. Cadastro com o CPF ou CNPJ -------------------------------------------

-- Igual à versão da migration 20261109232807_avisos, mais a chave "cpf_cnpj" para
-- imobiliária e autônomo. O app sempre manda; o banco aceita sem ela para as contas de
-- teste e as que já existiam, que informam depois (informar_documento).
create or replace function public.criar_perfil_no_cadastro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo      text := new.raw_user_meta_data ->> 'tipo';
  v_nome      text := btrim(coalesce(new.raw_user_meta_data ->> 'nome', ''));
  v_telefone  text := coalesce(new.raw_user_meta_data ->> 'telefone', '');
  v_creci     text := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'creci', ''), '\s', '', 'g'));
  v_convite   text := coalesce(new.raw_user_meta_data ->> 'convite', '');
  v_whatsapp  boolean := coalesce(new.raw_user_meta_data ->> 'whatsapp', '') = 'true';
  v_documento text := public.normalizar_documento(new.raw_user_meta_data ->> 'cpf_cnpj');
  v_assinante uuid;
  v_convite_id uuid;
begin
  -- Telefone: só números e sem o 0 da frente (aceita "0 48 9...").
  v_telefone := regexp_replace(v_telefone, '\D', '', 'g');
  v_telefone := regexp_replace(v_telefone, '^0+', '');

  if v_tipo = 'proprietario' then
    null;

  elsif v_tipo = 'imobiliaria' then
    if v_creci = '' then
      raise exception 'O CRECI da imobiliária é obrigatório' using errcode = 'P0001';
    end if;
    insert into public.assinantes (tipo, nome, creci, responsavel_id)
    values ('imobiliaria', btrim(coalesce(new.raw_user_meta_data ->> 'nome_imobiliaria', '')),
            v_creci, new.id)
    returning id into v_assinante;

  elsif v_tipo = 'autonomo' then
    if v_creci = '' then
      raise exception 'O CRECI do corretor autônomo é obrigatório' using errcode = 'P0001';
    end if;
    insert into public.assinantes (tipo, nome, creci, responsavel_id)
    values ('autonomo', v_nome, v_creci, new.id)
    returning id into v_assinante;

  elsif v_tipo = 'corretor' then
    -- O convite tem que existir, não ter sido usado, estar na validade, ser de
    -- imobiliária com acesso e, se tiver e-mail, ser o mesmo e-mail do cadastro.
    -- "for update" trava o convite: dois cadastros ao mesmo tempo não usam o mesmo.
    select c.id, c.assinante_id into v_convite_id, v_assinante
    from public.convites c
    join public.assinantes a on a.id = c.assinante_id
    where c.token_hash = encode(sha256(convert_to(v_convite, 'UTF8')), 'hex')
      and c.usado_em is null
      and c.expira_em > now()
      and a.tipo = 'imobiliaria'
      and public.assinatura_com_acesso(a.id)
      and (c.email is null or lower(c.email) = lower(new.email))
    for update of c;

    if v_convite_id is null then
      raise exception 'Convite inválido, vencido ou já usado' using errcode = 'P0001';
    end if;

  else
    -- admin nunca; qualquer outro valor também não.
    raise exception 'Tipo de cadastro não permitido: %', coalesce(v_tipo, '(vazio)')
      using errcode = 'P0001';
  end if;

  insert into public.perfis (id, tipo, nome, telefone, assinante_id, whatsapp_aceito, whatsapp_aceito_em)
  values (new.id, v_tipo::public.tipo_usuario, v_nome, v_telefone, v_assinante,
          v_whatsapp, case when v_whatsapp then now() end);

  if v_documento <> '' and v_tipo in ('imobiliaria', 'autonomo') then
    if not public.documento_serve_para(v_documento, v_tipo::public.tipo_assinante) then
      raise exception 'CPF ou CNPJ inválido' using errcode = 'P0001', hint = 'documento_invalido';
    end if;
    -- Repetido: o unique barra (23505).
    insert into public.dados_de_cobranca (assinante_id, cpf_cnpj)
    values (v_assinante, v_documento);
  end if;

  if v_convite_id is not null then
    update public.convites
    set usado_em = now(), usado_por = new.id
    where id = v_convite_id;
  end if;

  -- O que foi copiado para perfis, assinantes e dados_de_cobranca sai do metadata.
  update auth.users
  set raw_user_meta_data = raw_user_meta_data
        - array['tipo', 'nome', 'telefone', 'creci', 'nome_imobiliaria', 'convite', 'whatsapp', 'cpf_cnpj']
  where id = new.id;

  return new;
end;
$$;

create or replace function public.limpar_metadata_do_cadastro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.raw_user_meta_data := new.raw_user_meta_data
    - array['tipo', 'nome', 'telefone', 'creci', 'nome_imobiliaria', 'convite', 'whatsapp', 'cpf_cnpj'];
  return new;
end;
$$;

drop trigger limpar_metadata_do_cadastro on auth.users;
create trigger limpar_metadata_do_cadastro
  before update of raw_user_meta_data on auth.users
  for each row
  when (new.raw_user_meta_data ?| array['tipo', 'nome', 'telefone', 'creci', 'nome_imobiliaria', 'convite', 'whatsapp', 'cpf_cnpj'])
  execute function public.limpar_metadata_do_cadastro();

-- 9. Segredo do Asaas -------------------------------------------------------

-- Confere o segredo contra o Vault. Interna: só as funções do Asaas chamam.
create function public.conferir_segredo_asaas(p_segredo text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_segredo text;
begin
  select ds.decrypted_secret into v_segredo
  from vault.decrypted_secrets ds
  where ds.name = 'pauta_asaas';
  if coalesce(v_segredo, '') = '' then
    raise exception 'Falta o segredo pauta_asaas no Vault' using errcode = 'P0001', hint = 'segredo_ausente';
  end if;
  if p_segredo is null or p_segredo <> v_segredo then
    raise exception 'Segredo do Asaas errado' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.conferir_segredo_asaas(text) from public, anon, authenticated;

-- 10. O que o servidor lê e grava (só com o segredo) -----------------------

-- Para criar o cliente e a assinatura no Asaas (11.2b): quem paga, o documento, o valor
-- do plano e os ids que já existem (para refazer sem duplicar). O e-mail e o telefone
-- saem da conta do responsável. valor_centavos null = o admin ainda não cadastrou o plano.
create function public.dados_para_cobrar(p_segredo text, p_assinante uuid)
returns table (
  tipo                public.tipo_assinante,
  status              public.status_assinatura,
  nome                text,
  email               text,
  telefone            text,
  cpf_cnpj            text,
  valor_centavos      integer,
  ativado_em          timestamptz,
  asaas_cliente_id    text,
  asaas_assinatura_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.conferir_segredo_asaas(p_segredo);
  return query
  select a.tipo, a.status, a.nome, u.email::text, p.telefone, d.cpf_cnpj, pl.valor_centavos,
         a.ativado_em, d.asaas_cliente_id, d.asaas_assinatura_id
  from public.assinantes a
  join public.perfis p on p.id = a.responsavel_id
  join auth.users u on u.id = a.responsavel_id
  left join public.dados_de_cobranca d on d.assinante_id = a.id
  left join public.planos pl on pl.tipo = a.tipo
  where a.id = p_assinante;
end;
$$;
revoke execute on function public.dados_para_cobrar(text, uuid) from public;
grant execute on function public.dados_para_cobrar(text, uuid) to anon, authenticated;

-- Guarda os ids do Asaas depois de criar o cliente e a assinatura. Um id já gravado não
-- é trocado por outro (refazer devolve o mesmo, por externalReference).
create function public.registrar_assinatura_asaas(p_segredo text, p_assinante uuid,
                                                  p_cliente text, p_assinatura text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dados public.dados_de_cobranca%rowtype;
begin
  perform public.conferir_segredo_asaas(p_segredo);

  select * into v_dados from public.dados_de_cobranca where assinante_id = p_assinante for update;
  if not found then
    raise exception 'Assinante sem CPF ou CNPJ' using errcode = 'P0001', hint = 'sem_documento';
  end if;
  if coalesce(btrim(p_cliente), '') = '' then
    raise exception 'Falta o id do cliente no Asaas' using errcode = 'P0001', hint = 'sem_cliente';
  end if;
  if v_dados.asaas_cliente_id is not null and v_dados.asaas_cliente_id <> p_cliente
     or v_dados.asaas_assinatura_id is not null and p_assinatura is not null
        and v_dados.asaas_assinatura_id <> p_assinatura then
    raise exception 'O assinante já tem outro cliente ou outra assinatura no Asaas'
      using errcode = 'P0001', hint = 'ids_diferentes';
  end if;

  update public.dados_de_cobranca
  set asaas_cliente_id = p_cliente,
      asaas_assinatura_id = coalesce(asaas_assinatura_id, p_assinatura),
      atualizado_em = now()
  where assinante_id = p_assinante;
end;
$$;
revoke execute on function public.registrar_assinatura_asaas(text, uuid, text, text) from public;
grant execute on function public.registrar_assinatura_asaas(text, uuid, text, text) to anon, authenticated;

-- Passa o status entre ativo e vencido conforme o atraso. Pendente não muda (só o admin
-- ativa), e o bloqueio do admin fica à parte. Roda como dono do banco: a trava
-- conferir_mudanca_de_status só vale para chamadas do app.
create function public.atualizar_status_pelo_atraso(p_assinante uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.assinantes
  set status = case when public.mensalidade_atrasada(id) then 'vencido' else 'ativo' end::public.status_assinatura
  where id = p_assinante
    and status in ('ativo', 'vencido')
    and status is distinct from
        case when public.mensalidade_atrasada(id) then 'vencido' else 'ativo' end::public.status_assinatura;
end;
$$;
revoke execute on function public.atualizar_status_pelo_atraso(uuid) from public, anon, authenticated;

-- O webhook (11.3a): grava cada evento uma vez só e atualiza a cobrança pelo estado que
-- vem nele (p_pagamento é o objeto "payment" do Asaas). Devolve registrado, repetido,
-- ignorado ou desconhecido; o servidor responde 200 em todos.
--
-- Eventos fora de ordem: uma cobrança paga não volta para pendente ou vencida (só sai de
-- paga por estorno), e uma cancelada só volta se o Asaas mandar o estado de novo.
create function public.registrar_evento_asaas(p_segredo text, p_evento_id text,
                                              p_tipo text, p_pagamento jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pagamento text := nullif(btrim(coalesce(p_pagamento ->> 'id', '')), '');
  v_status    public.status_cobranca;
  v_assinante uuid;
  v_atual     public.cobrancas%rowtype;
  v_valor     integer;
  v_pago_em   timestamptz;
begin
  perform public.conferir_segredo_asaas(p_segredo);

  if coalesce(btrim(p_evento_id), '') = '' or coalesce(btrim(p_tipo), '') = '' then
    raise exception 'Evento sem id ou sem tipo' using errcode = 'P0001', hint = 'evento_invalido';
  end if;

  -- Idempotência: o mesmo evento chegando de novo não muda nada.
  insert into public.eventos_asaas (id, tipo, asaas_pagamento_id, resultado)
  values (p_evento_id, p_tipo, v_pagamento, 'registrado')
  on conflict (id) do nothing;
  if not found then
    return 'repetido';
  end if;

  v_status := case
    when p_tipo = 'PAYMENT_DELETED' then 'cancelada'
    else case p_pagamento ->> 'status'
      when 'PENDING' then 'pendente'
      when 'AWAITING_RISK_ANALYSIS' then 'pendente'
      when 'OVERDUE' then 'vencida'
      when 'RECEIVED' then 'paga'
      when 'CONFIRMED' then 'paga'
      when 'RECEIVED_IN_CASH' then 'paga'
      when 'REFUNDED' then 'estornada'
      when 'CHARGEBACK_REQUESTED' then 'estornada'
      when 'CHARGEBACK_DISPUTE' then 'estornada'
      else null
    end
  end::public.status_cobranca;

  if v_pagamento is null or v_status is null or p_tipo not like 'PAYMENT\_%' then
    update public.eventos_asaas set resultado = 'ignorado' where id = p_evento_id;
    return 'ignorado';
  end if;

  -- De quem é: pelo cliente do Asaas guardado no 11.2b. Trava o assinante para dois
  -- eventos do mesmo assinante não recalcularem o status ao mesmo tempo.
  select d.assinante_id into v_assinante
  from public.dados_de_cobranca d
  where d.asaas_cliente_id = p_pagamento ->> 'customer';
  if v_assinante is null then
    update public.eventos_asaas set resultado = 'desconhecido' where id = p_evento_id;
    return 'desconhecido';
  end if;
  perform 1 from public.assinantes where id = v_assinante for update;

  v_valor := round((p_pagamento ->> 'value')::numeric * 100)::integer;
  v_pago_em := case when v_status = 'paga' then
    coalesce((p_pagamento ->> 'clientPaymentDate')::date, (p_pagamento ->> 'paymentDate')::date,
             (p_pagamento ->> 'confirmedDate')::date)::timestamp at time zone 'America/Sao_Paulo'
  end;
  if v_status = 'paga' then
    v_pago_em := coalesce(v_pago_em, now());
  end if;

  select * into v_atual from public.cobrancas where asaas_pagamento_id = v_pagamento for update;

  if not found then
    insert into public.cobrancas (assinante_id, asaas_pagamento_id, valor_centavos, vencimento,
                                  status, forma, link_fatura, pago_em)
    values (v_assinante, v_pagamento, v_valor, (p_pagamento ->> 'dueDate')::date,
            v_status, p_pagamento ->> 'billingType', p_pagamento ->> 'invoiceUrl', v_pago_em);
  else
    if v_atual.assinante_id <> v_assinante then
      raise exception 'A cobrança é de outro assinante' using errcode = 'P0001', hint = 'outro_assinante';
    end if;
    -- Paga só sai de paga por estorno.
    if v_atual.status = 'paga' and v_status in ('pendente', 'vencida') then
      v_status := 'paga';
      v_pago_em := v_atual.pago_em;
    end if;
    update public.cobrancas
    set valor_centavos = coalesce(v_valor, valor_centavos),
        vencimento = coalesce((p_pagamento ->> 'dueDate')::date, vencimento),
        status = v_status,
        forma = coalesce(p_pagamento ->> 'billingType', forma),
        link_fatura = coalesce(p_pagamento ->> 'invoiceUrl', link_fatura),
        pago_em = case when v_status = 'paga' then coalesce(v_pago_em, pago_em)
                       when v_status = 'estornada' then pago_em
                       else null end,
        atualizada_em = now()
    where id = v_atual.id;
  end if;

  perform public.atualizar_status_pelo_atraso(v_assinante);
  return 'registrado';
end;
$$;
revoke execute on function public.registrar_evento_asaas(text, text, text, jsonb) from public;
grant execute on function public.registrar_evento_asaas(text, text, text, jsonb) to anon, authenticated;

-- 11. Avisos da mensalidade ------------------------------------------------

-- Para o responsável (imobiliária ou autônomo), pelo criar_aviso() da Etapa 10:
-- "mensalidade paga" quando passa a paga, e "mensalidade vencida" quando o Asaas avisa
-- que venceu (um dia depois do vencimento), com o último dia de acesso.
create function public.avisar_mudanca_de_cobranca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_responsavel uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('paga', 'vencida') then
    return new;
  end if;

  select a.responsavel_id into v_responsavel from public.assinantes a where a.id = new.assinante_id;

  perform public.criar_aviso(
    v_responsavel,
    case new.status when 'paga' then 'mensalidade_paga' else 'mensalidade_vencida' end::public.tipo_aviso,
    null,
    jsonb_build_object(
      'valor_centavos', new.valor_centavos,
      'vencimento', new.vencimento,
      'acesso_ate', new.vencimento + 3),
    '/assinante/pagamento');
  return new;
end;
$$;
revoke execute on function public.avisar_mudanca_de_cobranca() from public, anon, authenticated;

create trigger avisar_mudanca_de_cobranca
  after insert or update of status on public.cobrancas
  for each row execute function public.avisar_mudanca_de_cobranca();

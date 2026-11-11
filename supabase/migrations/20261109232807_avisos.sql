-- Etapa 10, passo 10.2a: tabela de avisos, leitura pelo app e aceite do WhatsApp.
--
-- Plano aprovado em 09/11/2026 (Visão geral, "Decisões tomadas em 09/11/2026 (plano da
-- Etapa 10)"):
--   - O aviso nasce no banco, por gatilhos (passo 10.2b), que chamam criar_aviso(). Esta
--     migration só cria a tabela, a função interna e as leituras. Ainda nenhum evento
--     gera aviso.
--   - Cada aviso é de uma pessoa (destinatario_id), menos "imóvel novo no catálogo", que é
--     uma linha só para todos os assinantes ativos (para_assinantes), sem WhatsApp.
--   - "Visto" é uma data por pessoa (perfis.avisos_vistos_ate): tudo o que foi criado até
--     ela já foi visto. Por isso a linha para todos não precisa de uma marca por assinante.
--   - Ninguém grava em avisos pela API: só criar_aviso(), que não pode ser chamada de fora.
--   - O WhatsApp só vai para quem aceitou (perfis.whatsapp_aceito). Contas que já existem
--     começam desligadas. O envio (fila) é do passo 10.3b; até lá, os avisos ficam
--     'pendente' e a fila do 10.3b ignora os antigos ('expirado').

-- 1. Tipos ----------------------------------------------------------

-- Todos os eventos do plano (P1 a P10, C1 a C13, R1 e R2). Os da Etapa 11 (mensalidade
-- paga) e da Etapa 12 (exclusividade vencendo) entram nelas, com "alter type ... add value".
create type public.tipo_aviso as enum (
  -- Proprietário
  'imovel_aprovado',
  'imovel_reprovado',
  'imovel_captado',
  'visita_pedida',
  'visita_cancelada_pelo_corretor',
  'visita_cancelada_corretor_saiu',
  'proposta_recebida',
  'proposta_retirada',
  'proposta_cancelada_corretor_saiu',
  'contrato_enviado',
  'imovel_vendido',
  -- Corretor
  'visita_confirmada',
  'visita_recusada',
  'visita_horario_ocupado',
  'visita_cancelada_pelo_proprietario',
  'visita_cancelada_pela_venda',
  'proposta_aceita',
  'proposta_recusada',
  'aceite_desfeito',
  'proposta_recusada_pela_venda',
  'contrato_aprovado',
  'contrato_recusado',
  'contrato_recusado_pela_venda',
  'imovel_novo',
  -- Responsável da imobiliária ou autônomo
  'assinatura_ativada',
  'corretor_entrou'
);

create type public.status_whatsapp as enum (
  'pendente',       -- espera a fila do servidor
  'enviando',       -- reservado pela fila (10.3b)
  'enviado',
  'falhou',         -- a Meta recusou ou não respondeu (até 3 tentativas)
  'desligado',      -- a pessoa não aceitou receber pelo WhatsApp
  'nao_se_aplica',  -- aviso só do app (imóvel novo)
  'expirado'        -- ficou pendente tempo demais e não sai mais
);

-- 2. Colunas novas --------------------------------------------------

-- Nada visto ainda (null): todos os avisos contam como novos.
alter table public.perfis
  add column avisos_vistos_ate  timestamptz,
  add column whatsapp_aceito    boolean not null default false,
  add column whatsapp_aceito_em timestamptz,
  add constraint perfis_whatsapp_aceito_em
    check (whatsapp_aceito = (whatsapp_aceito_em is not null));

-- Quando o assinante foi ativado pela primeira vez: "imóvel novo" aparece só a partir daí.
-- Os que já estão ativos ou vencidos ficam com a data do cadastro.
alter table public.assinantes add column ativado_em timestamptz;
update public.assinantes set ativado_em = criado_em where status <> 'pendente';

create function public.marcar_ativacao_do_assinante()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'ativo' and new.ativado_em is null then
    new.ativado_em := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.marcar_ativacao_do_assinante() from public, anon, authenticated;

create trigger marcar_ativacao_do_assinante
  before update of status on public.assinantes
  for each row
  execute function public.marcar_ativacao_do_assinante();

-- 3. Tabela ---------------------------------------------------------

create table public.avisos (
  id                  bigint generated always as identity primary key,
  -- Apagar a conta apaga os avisos dela.
  destinatario_id     uuid references public.perfis (id) on delete cascade,
  para_assinantes     boolean not null default false,
  tipo                public.tipo_aviso not null,
  -- O imóvel pode ser apagado (rascunho, reprovado); o aviso fica com o retrato em dados.
  imovel_id           uuid references public.imoveis (id) on delete set null,
  -- Retrato do momento (título do imóvel, nome do corretor, valor, horário, motivo). Os
  -- textos são montados no app, num único arquivo (src/lib/avisos.ts).
  dados               jsonb not null default '{}',
  -- Caminho dentro do app que o aviso abre.
  link                text not null,
  criado_em           timestamptz not null default now(),
  whatsapp            public.status_whatsapp not null,
  whatsapp_tentativas smallint not null default 0,
  whatsapp_enviado_em timestamptz,
  whatsapp_erro       text,
  whatsapp_id         text,

  -- Ou é de uma pessoa, ou é para todos os assinantes.
  constraint avisos_destino check ((destinatario_id is not null) <> para_assinantes),
  -- Só "imóvel novo" vai para todos.
  constraint avisos_para_todos check (para_assinantes = (tipo = 'imovel_novo')),
  constraint avisos_dados_objeto check (jsonb_typeof(dados) = 'object'),
  -- Caminho interno: começa com uma barra só (nada de "//site" nem "https://").
  constraint avisos_link_interno check (link ~ '^/[a-z]' and char_length(link) <= 300),
  constraint avisos_tentativas check (whatsapp_tentativas between 0 and 3)
);

create index avisos_destinatario_idx on public.avisos (destinatario_id, id desc)
  where destinatario_id is not null;
create index avisos_para_assinantes_idx on public.avisos (id desc)
  where para_assinantes;
create index avisos_whatsapp_pendente_idx on public.avisos (id)
  where whatsapp in ('pendente', 'enviando', 'falhou');

alter table public.avisos enable row level security;

-- 4. Quem lê --------------------------------------------------------

-- Desde quando o usuário logado vê os avisos "para todos os assinantes": o mais tarde entre
-- a ativação da assinatura e a criação da conta (o corretor convidado entra depois). Null
-- para quem não tem acesso ao catálogo agora (pendente, bloqueado, vencido, removido,
-- proprietário e admin): aí ele não vê nenhum.
create function public.inicio_dos_avisos_para_assinantes()
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
    and a.status = 'ativo'
    and not a.bloqueado_pelo_admin
    and p.removido_em is null;
$$;
revoke execute on function public.inicio_dos_avisos_para_assinantes() from public, anon;
grant execute on function public.inicio_dos_avisos_para_assinantes() to authenticated;

-- Cada um lê os próprios avisos, e o assinante com acesso lê os "para todos" criados
-- depois que ele passou a ter acesso. O admin não tem lista de avisos (decisão de 09/11).
create policy "avisos: ler os proprios e os para assinantes"
  on public.avisos for select
  to authenticated
  using (
    destinatario_id = (select auth.uid())
    or (para_assinantes and criado_em >= (select public.inicio_dos_avisos_para_assinantes()))
  );

-- Ninguém grava pela API (sem política de insert, update ou delete). As colunas do
-- WhatsApp não são lidas pelo app: só o servidor, pela fila do 10.3b.
revoke all on table public.avisos from anon, authenticated;
grant select (id, destinatario_id, para_assinantes, tipo, imovel_id, dados, link, criado_em)
  on table public.avisos to authenticated;

-- 5. O ponto único que cria o aviso -----------------------------------

-- Chamada só pelos gatilhos dos eventos (passo 10.2b), nunca pela API.
--   p_destinatario null = "imóvel novo", para todos os assinantes ativos.
--   Quem agiu não recebe aviso da própria ação.
-- Devolve o id do aviso, ou null se não criou.
create function public.criar_aviso(p_destinatario uuid, p_tipo public.tipo_aviso,
                                   p_imovel uuid, p_dados jsonb, p_link text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       bigint;
  v_whatsapp public.status_whatsapp;
begin
  if p_destinatario is not null and p_destinatario = (select auth.uid()) then
    return null;
  end if;

  if p_destinatario is null then
    v_whatsapp := 'nao_se_aplica';
  else
    select case when p.whatsapp_aceito then 'pendente' else 'desligado' end::public.status_whatsapp
      into v_whatsapp
    from public.perfis p
    where p.id = p_destinatario;

    -- Conta que não existe (apagada no meio): nada a avisar.
    if v_whatsapp is null then
      return null;
    end if;
  end if;

  insert into public.avisos (destinatario_id, para_assinantes, tipo, imovel_id, dados, link, whatsapp)
  values (p_destinatario, p_destinatario is null, p_tipo, p_imovel,
          coalesce(p_dados, '{}'), p_link, v_whatsapp)
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.criar_aviso(uuid, public.tipo_aviso, uuid, jsonb, text)
  from public, anon, authenticated;

-- 6. Leituras e ações do app -----------------------------------------

-- Lista do app, dos mais novos para os mais antigos, em páginas (p_antes = id do último
-- aviso da página anterior). "novo" = criado depois do último "visto".
-- security invoker: quem filtra é a política de leitura acima.
create function public.meus_avisos(p_antes bigint default null, p_limite int default 30)
returns table (
  id        bigint,
  tipo      public.tipo_aviso,
  imovel_id uuid,
  dados     jsonb,
  link      text,
  criado_em timestamptz,
  novo      boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.tipo, a.imovel_id, a.dados, a.link, a.criado_em,
         a.criado_em > coalesce((select p.avisos_vistos_ate from public.perfis p
                                 where p.id = (select auth.uid())), '-infinity')
  from public.avisos a
  where (p_antes is null or a.id < p_antes)
  order by a.id desc
  limit least(greatest(coalesce(p_limite, 30), 1), 100);
$$;
revoke execute on function public.meus_avisos(bigint, int) from public, anon;
grant execute on function public.meus_avisos(bigint, int) to authenticated;

-- O número no menu. Para em 100 (a tela mostra "99+").
create function public.avisos_nao_vistos()
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from (
    select 1
    from public.avisos a
    where a.criado_em > coalesce((select p.avisos_vistos_ate from public.perfis p
                                  where p.id = (select auth.uid())), '-infinity')
    limit 100
  ) x;
$$;
revoke execute on function public.avisos_nao_vistos() from public, anon;
grant execute on function public.avisos_nao_vistos() to authenticated;

-- Marca como visto tudo o que foi criado até p_ate (a data do aviso mais novo que a tela
-- mostrou). Nunca volta para trás e nunca passa de agora.
create function public.marcar_avisos_vistos(p_ate timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ate is null or (select auth.uid()) is null then
    return;
  end if;
  update public.perfis
  set avisos_vistos_ate = greatest(coalesce(avisos_vistos_ate, '-infinity'), least(p_ate, now()))
  where id = (select auth.uid());
end;
$$;
revoke execute on function public.marcar_avisos_vistos(timestamptz) from public, anon;
grant execute on function public.marcar_avisos_vistos(timestamptz) to authenticated;

-- Liga ou desliga os avisos pelo WhatsApp da própria conta. Guarda quando aceitou.
create function public.mudar_whatsapp(p_aceito boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_aceito is null or (select auth.uid()) is null then
    raise exception 'Escolha ligar ou desligar' using errcode = 'P0001';
  end if;
  update public.perfis
  set whatsapp_aceito = p_aceito,
      whatsapp_aceito_em = case
        when not p_aceito then null
        when whatsapp_aceito then whatsapp_aceito_em
        else now()
      end
  where id = (select auth.uid());
end;
$$;
revoke execute on function public.mudar_whatsapp(boolean) from public, anon;
grant execute on function public.mudar_whatsapp(boolean) to authenticated;

-- 7. Aceite do WhatsApp no cadastro e no convite -------------------------

-- Igual à versão da migration 20261022231442_cadastro_etapa_3, mais a chave "whatsapp"
-- (o app manda "true" quando a caixa está marcada). Qualquer outro valor = não aceitou.
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
    -- imobiliária ativa e não bloqueada e, se tiver e-mail, ser o mesmo e-mail do cadastro.
    -- "for update" trava o convite: dois cadastros ao mesmo tempo não usam o mesmo.
    select c.id, c.assinante_id into v_convite_id, v_assinante
    from public.convites c
    join public.assinantes a on a.id = c.assinante_id
    where c.token_hash = encode(sha256(convert_to(v_convite, 'UTF8')), 'hex')
      and c.usado_em is null
      and c.expira_em > now()
      and a.tipo = 'imobiliaria'
      and a.status = 'ativo'
      and not a.bloqueado_pelo_admin
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

  if v_convite_id is not null then
    update public.convites
    set usado_em = now(), usado_por = new.id
    where id = v_convite_id;
  end if;

  -- O que foi copiado para perfis e assinantes sai do metadata (e do token).
  update auth.users
  set raw_user_meta_data = raw_user_meta_data
        - array['tipo', 'nome', 'telefone', 'creci', 'nome_imobiliaria', 'convite', 'whatsapp']
  where id = new.id;

  return new;
end;
$$;

-- A limpeza de antes de toda gravação em auth.users também tira a chave nova.
create or replace function public.limpar_metadata_do_cadastro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.raw_user_meta_data := new.raw_user_meta_data
    - array['tipo', 'nome', 'telefone', 'creci', 'nome_imobiliaria', 'convite', 'whatsapp'];
  return new;
end;
$$;

drop trigger limpar_metadata_do_cadastro on auth.users;
create trigger limpar_metadata_do_cadastro
  before update of raw_user_meta_data on auth.users
  for each row
  when (new.raw_user_meta_data ?| array['tipo', 'nome', 'telefone', 'creci', 'nome_imobiliaria', 'convite', 'whatsapp'])
  execute function public.limpar_metadata_do_cadastro();

-- Etapa 8, propostas (RF20, RF23, RF24, RNF07). Decisões de 05/11/2026 (plano da Etapa 8).
--
-- O corretor envia a proposta e o proprietário aceita ou recusa cada uma; ele pode ter
-- várias aceitas ao mesmo tempo. Cada corretor tem no máximo uma proposta em aberto
-- por imóvel. Depois de recusada ou retirada, pode mandar outra, sem limite.
--
-- Quem escreve: ninguém grava direto na tabela, só pelas funções abaixo, para que
-- nenhuma regra possa ser pulada chamando a API.
-- Quem lê: o corretor, as próprias; o proprietário, as dos próprios imóveis; o admin,
-- todas. Isso inclui o nome do comprador, que é dado pessoal de outra pessoa: nenhuma
-- outra função devolve esse campo. Outro corretor só vê o selo do catálogo.
--
-- "Em negociação" deixa de ser uma coluna guardada: é calculado das propostas aceitas
-- em imovel_em_negociacao(). Assim aceitar, desfazer, a recusa em massa da Etapa 9 e
-- excluir uma conta não têm como deixar o status errado.
--
-- Etapa 9: desfazer_aceite() e cancelar_proposta() ainda não conferem contrato, porque
-- a tabela não existe. Ela precisa acrescentar "só sem contrato enviado" nas duas, e
-- remover_corretor() precisa decidir o que faz com a proposta de contrato em análise.
--
-- Erros que o app reconhece pelo hint: imovel_fora_do_catalogo, valor_invalido,
-- forma_invalida, condicoes_invalidas, comprador_invalido, proposta_em_aberto,
-- proposta_nao_encontrada, proposta_ja_respondida e proposta_encerrada.

-- ---------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------

create type public.status_proposta as enum (
  'aguardando',
  'aceita',
  'recusada',
  'cancelada'
);

create type public.forma_pagamento as enum (
  'a_vista',
  'financiamento',
  'permuta'
);

create table public.propostas (
  id              uuid primary key default gen_random_uuid(),
  -- O imóvel só é apagado antes de entrar no catálogo; a conta do corretor, pelo
  -- admin ou nos testes. A exclusão de dados (LGPD) é da Etapa 13.
  imovel_id       uuid not null references public.imoveis (id) on delete cascade,
  corretor_id     uuid not null references public.perfis (id) on delete cascade,
  valor           numeric(14, 2) not null,
  forma_pagamento public.forma_pagamento not null,
  condicoes       text not null,
  -- Opcional. Dado pessoal do comprador: entra na exclusão da LGPD (passo 13.4).
  nome_comprador  text,
  status          public.status_proposta not null default 'aguardando',
  criada_em       timestamptz not null default now(),
  -- Quando foi aceita ou recusada. Desfazer o aceite volta a ficar em branco.
  respondida_em   timestamptz,
  -- Para os avisos da Etapa 10 saberem quem avisar.
  cancelada_em    timestamptz,
  cancelada_por   uuid references public.perfis (id) on delete set null,

  -- 'NaN' é aceito por uma coluna numeric e passa em "valor > 0".
  constraint propostas_valor_positivo check (valor > 0 and valor <> 'NaN'),
  constraint propostas_condicoes_tamanho check (char_length(btrim(condicoes)) between 1 and 1000),
  constraint propostas_comprador_tamanho check (char_length(btrim(nome_comprador)) between 1 and 120)
);

comment on table public.propostas is
  'Propostas dos corretores. Escrita só pelas funções enviar_proposta, aceitar_proposta, recusar_proposta, desfazer_aceite e cancelar_proposta.';

-- Uma proposta em aberto por corretor em cada imóvel. Recusada ou cancelada não conta.
create unique index propostas_uma_em_aberto
  on public.propostas (imovel_id, corretor_id)
  where status in ('aguardando', 'aceita');

-- O cálculo de "em negociação" passa aqui a cada imóvel do catálogo.
create index propostas_aceitas_idx on public.propostas (imovel_id) where status = 'aceita';

create index propostas_corretor_idx on public.propostas (corretor_id, criada_em desc);
create index propostas_imovel_idx on public.propostas (imovel_id, criada_em desc);

alter table public.propostas enable row level security;

revoke all on table public.propostas from anon, authenticated;
grant select on table public.propostas to authenticated;

-- O corretor sem acesso (bloqueado, vencido ou removido) não lê as próprias, como no
-- catálogo. O proprietário continua lendo as propostas dele nesses casos.
create policy "propostas: corretor le as proprias, dono as do imovel, admin todas"
  on public.propostas
  for select
  to authenticated
  using (
    (select public.eh_admin())
    or (corretor_id = (select auth.uid()) and (select public.eh_assinante_ativo()))
    or imovel_id in (select i.id from public.imoveis i where i.proprietario_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------
-- 2. Status que o corretor vê (RF20)
-- ---------------------------------------------------------------

-- O ÚNICO lugar que diz se um imóvel está em negociação: há pelo menos uma proposta
-- aceita. Uso interno, chamada pelas funções do banco: ninguém chama pela API.
create function public.imovel_em_negociacao(p_imovel uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.propostas p
                 where p.imovel_id = p_imovel and p.status = 'aceita');
$$;

revoke execute on function public.imovel_em_negociacao(uuid) from public, anon, authenticated;

-- create or replace mantém as permissões da função (ninguém chama pela API).
create or replace function public.status_no_catalogo(p_imovel public.imoveis)
returns text
language sql
stable
set search_path = ''
as $$
  select case when public.imovel_em_negociacao(p_imovel.id) then 'em_negociacao' else 'disponivel' end;
$$;

-- Só depois de trocar o cálculo: nenhum instante com o catálogo lendo uma coluna apagada.
alter table public.imoveis drop column tem_proposta_aceita;

create or replace function public.subir_versao_do_imovel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'motivo_reprovacao', 'termo_versao', 'termo_aceito_em',
                             'exclusividade_inicio', 'exclusividade_fim',
                             'versao', 'atualizado_em'])
     is distinct from
     (to_jsonb(old) - array['status', 'motivo_reprovacao', 'termo_versao', 'termo_aceito_em',
                             'exclusividade_inicio', 'exclusividade_fim',
                             'versao', 'atualizado_em'])
  then
    new.versao := old.versao + 1;
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- 3. Enviar
-- ---------------------------------------------------------------

-- Assinante com acesso e imóvel no catálogo (disponível ou em negociação). A trava na
-- linha do imóvel impede que uma proposta entre no instante da venda (Etapa 9).
create function public.enviar_proposta(
  p_imovel    uuid,
  p_valor     numeric,
  p_forma     public.forma_pagamento,
  p_condicoes text,
  p_comprador text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid;
  v_valor     numeric;
  v_condicoes text := btrim(coalesce(p_condicoes, ''));
  v_comprador text := nullif(btrim(coalesce(p_comprador, '')), '');
begin
  if not (select public.eh_assinante_ativo()) then
    raise exception 'Só assinante com acesso ao catálogo envia proposta' using errcode = '42501';
  end if;

  perform 1 from public.imoveis i
  where i.id = p_imovel and i.status = 'disponivel'
  for share;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  -- O teto é o que cabe na coluna; 'Infinity' cai nele. round(NaN) continua NaN.
  v_valor := round(p_valor, 2);
  if v_valor is null or v_valor = 'NaN' or v_valor <= 0 or v_valor >= 1000000000000 then
    raise exception 'Informe um valor válido' using errcode = 'P0001', hint = 'valor_invalido';
  end if;
  if p_forma is null then
    raise exception 'Escolha a forma de pagamento' using errcode = 'P0001', hint = 'forma_invalida';
  end if;
  if char_length(v_condicoes) not between 1 and 1000 then
    raise exception 'Escreva as condições, com até 1.000 caracteres' using errcode = 'P0001', hint = 'condicoes_invalidas';
  end if;
  if char_length(v_comprador) > 120 then
    raise exception 'O nome do comprador pode ter até 120 caracteres' using errcode = 'P0001', hint = 'comprador_invalido';
  end if;

  begin
    insert into public.propostas (imovel_id, corretor_id, valor, forma_pagamento, condicoes, nome_comprador)
    values (p_imovel, (select auth.uid()), v_valor, p_forma, v_condicoes, v_comprador)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Você já tem uma proposta em aberto neste imóvel' using errcode = 'P0001', hint = 'proposta_em_aberto';
  end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------
-- 4. Responder
-- ---------------------------------------------------------------

-- Só o dono do imóvel, só proposta aguardando e imóvel no catálogo. Pode haver várias
-- aceitas no mesmo imóvel. Quem não é o dono recebe o mesmo erro de quem pediu uma
-- proposta que não existe, sem revelar nada. A resposta vale também para corretor
-- bloqueado ou vencido: o bloqueio é temporário e as propostas não mudam.
create function public.aceitar_proposta(p_proposta uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imovel uuid;
  v_status public.status_proposta;
begin
  select p.imovel_id into v_imovel
  from public.propostas p
  join public.imoveis i on i.id = p.imovel_id
  where p.id = p_proposta and i.proprietario_id = (select auth.uid());
  if not found then
    raise exception 'Proposta não encontrada' using errcode = 'P0001', hint = 'proposta_nao_encontrada';
  end if;

  -- O status só é lido depois das travas: outra resposta pode ter chegado antes.
  perform 1 from public.imoveis i
  where i.id = v_imovel and i.status = 'disponivel'
  for share;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  select p.status into v_status
  from public.propostas p
  where p.id = p_proposta
  for update;

  if v_status <> 'aguardando' then
    raise exception 'Esta proposta já foi respondida' using errcode = 'P0001', hint = 'proposta_ja_respondida';
  end if;

  update public.propostas
  set status = 'aceita', respondida_em = now()
  where id = p_proposta;
end;
$$;

-- Só o dono do imóvel e só proposta aguardando, em qualquer status do imóvel (para ele
-- limpar a lista). Depois de recusada, o corretor pode mandar outra.
create function public.recusar_proposta(p_proposta uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.status_proposta;
begin
  select p.status into v_status
  from public.propostas p
  join public.imoveis i on i.id = p.imovel_id
  where p.id = p_proposta and i.proprietario_id = (select auth.uid())
  for update of p;
  if not found then
    raise exception 'Proposta não encontrada' using errcode = 'P0001', hint = 'proposta_nao_encontrada';
  end if;

  if v_status <> 'aguardando' then
    raise exception 'Esta proposta já foi respondida' using errcode = 'P0001', hint = 'proposta_ja_respondida';
  end if;

  update public.propostas
  set status = 'recusada', respondida_em = now()
  where id = p_proposta;
end;
$$;

-- Só o dono do imóvel, só proposta aceita e imóvel no catálogo (a proposta da venda não
-- volta atrás). Devolve a proposta para "aguardando": ele ainda pode aceitar ou recusar.
create function public.desfazer_aceite(p_proposta uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imovel uuid;
  v_status public.status_proposta;
begin
  select p.imovel_id into v_imovel
  from public.propostas p
  join public.imoveis i on i.id = p.imovel_id
  where p.id = p_proposta and i.proprietario_id = (select auth.uid());
  if not found then
    raise exception 'Proposta não encontrada' using errcode = 'P0001', hint = 'proposta_nao_encontrada';
  end if;

  perform 1 from public.imoveis i
  where i.id = v_imovel and i.status = 'disponivel'
  for share;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  select p.status into v_status
  from public.propostas p
  where p.id = p_proposta
  for update;

  if v_status <> 'aceita' then
    raise exception 'Esta proposta não está aceita' using errcode = 'P0001', hint = 'proposta_encerrada';
  end if;

  update public.propostas
  set status = 'aguardando', respondida_em = null
  where id = p_proposta;
end;
$$;

-- ---------------------------------------------------------------
-- 5. Retirar
-- ---------------------------------------------------------------

-- O corretor com acesso retira a própria proposta, aguardando ou aceita, com o imóvel
-- no catálogo (a proposta da venda não volta atrás). Depois, pode mandar outra.
create function public.cancelar_proposta(p_proposta uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imovel uuid;
  v_status public.status_proposta;
  v_eu     uuid := (select auth.uid());
begin
  select p.imovel_id into v_imovel
  from public.propostas p
  where p.id = p_proposta and p.corretor_id = v_eu;

  if not found or not (select public.eh_assinante_ativo()) then
    raise exception 'Proposta não encontrada' using errcode = 'P0001', hint = 'proposta_nao_encontrada';
  end if;

  perform 1 from public.imoveis i
  where i.id = v_imovel and i.status = 'disponivel'
  for share;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  select p.status into v_status
  from public.propostas p
  where p.id = p_proposta
  for update;

  if v_status not in ('aguardando', 'aceita') then
    raise exception 'Esta proposta não pode ser retirada' using errcode = 'P0001', hint = 'proposta_encerrada';
  end if;

  update public.propostas
  set status = 'cancelada', cancelada_em = now(), cancelada_por = v_eu
  where id = p_proposta;
end;
$$;

-- ---------------------------------------------------------------
-- 6. Leituras
-- ---------------------------------------------------------------

-- As propostas do corretor logado, com os dados do imóvel. O corretor não lê a tabela
-- de imóveis: esta função é o caminho, e continua mostrando o título e o endereço
-- depois que o imóvel sai do catálogo. Nada do proprietário vem por aqui.
create function public.minhas_propostas(p_imovel uuid default null)
returns table (
  id              uuid,
  imovel_id       uuid,
  titulo          text,
  endereco        text,
  bairro          text,
  no_catalogo     boolean,
  valor           numeric,
  forma_pagamento public.forma_pagamento,
  condicoes       text,
  nome_comprador  text,
  status          public.status_proposta,
  criada_em       timestamptz,
  respondida_em   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.imovel_id, i.titulo, i.endereco, b.nome, i.status = 'disponivel',
         p.valor, p.forma_pagamento, p.condicoes, p.nome_comprador, p.status,
         p.criada_em, p.respondida_em
  from public.propostas p
  join public.imoveis i on i.id = p.imovel_id
  join public.bairros b on b.id = i.bairro_id
  where p.corretor_id = (select auth.uid())
    and (select public.eh_assinante_ativo())
    and (p_imovel is null or p.imovel_id = p_imovel)
  order by p.criada_em desc, p.id
  limit 200;
$$;

-- As propostas dos imóveis do proprietário logado, de todos ou de um só, com os dados
-- do corretor (RNF07). O proprietário não lê perfis de corretores nem assinantes: esta
-- função é o caminho. "imobiliaria" vem vazio para o corretor autônomo.
create function public.propostas_recebidas(p_imovel uuid default null)
returns table (
  id              uuid,
  imovel_id       uuid,
  imovel_titulo   text,
  valor           numeric,
  forma_pagamento public.forma_pagamento,
  condicoes       text,
  nome_comprador  text,
  status          public.status_proposta,
  criada_em       timestamptz,
  respondida_em   timestamptz,
  corretor_nome   text,
  imobiliaria     text,
  creci           text,
  telefone        text,
  email           text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.imovel_id, i.titulo, p.valor, p.forma_pagamento, p.condicoes, p.nome_comprador,
         p.status, p.criada_em, p.respondida_em,
         c.nome,
         case when a.tipo = 'imobiliaria' then a.nome end,
         a.creci, c.telefone, u.email::text
  from public.propostas p
  join public.imoveis i on i.id = p.imovel_id
  join public.perfis c on c.id = p.corretor_id
  join public.assinantes a on a.id = c.assinante_id
  join auth.users u on u.id = c.id
  where i.proprietario_id = (select auth.uid())
    and (p_imovel is null or p.imovel_id = p_imovel)
  order by p.criada_em desc, p.id
  limit 500;
$$;

-- Para o selo e o contador do proprietário, sem repetir o cálculo: "Em negociação" e
-- quantas propostas estão aguardando ou aceitas, nos imóveis dele que têm proposta.
create function public.resumo_de_propostas(p_imovel uuid default null)
returns table (
  imovel_id     uuid,
  em_negociacao boolean,
  em_aberto     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         i.status = 'disponivel' and public.imovel_em_negociacao(i.id),
         (select count(*) from public.propostas p
          where p.imovel_id = i.id and p.status in ('aguardando', 'aceita'))::integer
  from public.imoveis i
  where i.proprietario_id = (select auth.uid())
    and (p_imovel is null or i.id = p_imovel)
    and exists (select 1 from public.propostas p where p.imovel_id = i.id);
$$;

-- minhas_visitas ganha no_catalogo: o "Enviar proposta" da visita confirmada só aparece
-- com o imóvel no catálogo. Mudar as colunas de uma função exige apagá-la e recriá-la.
drop function public.minhas_visitas(uuid);

create function public.minhas_visitas(p_imovel uuid default null)
returns table (
  id            uuid,
  imovel_id     uuid,
  titulo        text,
  endereco      text,
  bairro        text,
  no_catalogo   boolean,
  horario       timestamptz,
  recado        text,
  status        public.status_visita,
  criada_em     timestamptz,
  respondida_em timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.imovel_id, i.titulo, i.endereco, b.nome, i.status = 'disponivel',
         v.horario, v.recado, v.status, v.criada_em, v.respondida_em
  from public.visitas v
  join public.imoveis i on i.id = v.imovel_id
  join public.bairros b on b.id = i.bairro_id
  where v.corretor_id = (select auth.uid())
    and (select public.eh_assinante_ativo())
    and (p_imovel is null or v.imovel_id = p_imovel)
  order by v.horario desc, v.id
  limit 200;
$$;

-- ---------------------------------------------------------------
-- 7. Corretor removido
-- ---------------------------------------------------------------

-- A remoção é definitiva: as visitas futuras em aberto dele são canceladas, e também
-- as propostas em aberto. Se uma delas estava aceita, o imóvel sai de "em negociação"
-- sozinho. A imobiliária continua a negociação mandando outra por outro corretor.
create or replace function public.remover_corretor(p_corretor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.meu_tipo()) is distinct from 'imobiliaria' or not (select public.eh_assinante_ativo()) then
    raise exception 'Só o responsável de imobiliária com acesso ao catálogo remove corretores' using errcode = '42501';
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

  update public.visitas
  set status = 'cancelada', cancelada_em = now(), cancelada_por = (select auth.uid())
  where corretor_id = p_corretor
    and status in ('pendente', 'confirmada')
    and horario > now();

  update public.propostas
  set status = 'cancelada', cancelada_em = now(), cancelada_por = (select auth.uid())
  where corretor_id = p_corretor
    and status in ('aguardando', 'aceita');
end;
$$;
-- create or replace mantém as permissões da função (só authenticated).

-- ---------------------------------------------------------------
-- 8. Permissões
-- ---------------------------------------------------------------

revoke execute on function public.enviar_proposta(uuid, numeric, public.forma_pagamento, text, text) from public, anon;
revoke execute on function public.aceitar_proposta(uuid) from public, anon;
revoke execute on function public.recusar_proposta(uuid) from public, anon;
revoke execute on function public.desfazer_aceite(uuid) from public, anon;
revoke execute on function public.cancelar_proposta(uuid) from public, anon;
revoke execute on function public.minhas_propostas(uuid) from public, anon;
revoke execute on function public.propostas_recebidas(uuid) from public, anon;
revoke execute on function public.resumo_de_propostas(uuid) from public, anon;
revoke execute on function public.minhas_visitas(uuid) from public, anon;

grant execute on function public.enviar_proposta(uuid, numeric, public.forma_pagamento, text, text) to authenticated;
grant execute on function public.aceitar_proposta(uuid) to authenticated;
grant execute on function public.recusar_proposta(uuid) to authenticated;
grant execute on function public.desfazer_aceite(uuid) to authenticated;
grant execute on function public.cancelar_proposta(uuid) to authenticated;
grant execute on function public.minhas_propostas(uuid) to authenticated;
grant execute on function public.propostas_recebidas(uuid) to authenticated;
grant execute on function public.resumo_de_propostas(uuid) to authenticated;
grant execute on function public.minhas_visitas(uuid) to authenticated;

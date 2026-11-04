-- Etapa 7, visitas (RF21, RF22, RNF07). Decisões de 04/11/2026 (plano da Etapa 7).
--
-- O corretor pede a visita sugerindo um horário e o proprietário confirma ou recusa.
-- Só a visita confirmada fecha o horário; vários corretores podem pedir o mesmo
-- horário e, ao confirmar um, os outros pedidos são recusados na mesma operação.
--
-- Quem escreve: ninguém grava direto na tabela, só pelas funções abaixo, para que
-- nenhuma regra possa ser pulada chamando a API.
-- Quem lê: o corretor, as próprias; o proprietário, as dos próprios imóveis; o admin,
-- todas. Outro corretor só sabe que um horário está fechado, por horarios_ocupados(),
-- que não diz quem marcou.
--
-- Erros que o app reconhece pelo hint: imovel_fora_do_catalogo, horario_passado,
-- horario_ocupado, pedido_repetido, visita_nao_encontrada, visita_ja_respondida
-- e visita_encerrada.

-- ---------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------

create type public.status_visita as enum (
  'pendente',
  'confirmada',
  'recusada',
  'cancelada'
);

create table public.visitas (
  id            uuid primary key default gen_random_uuid(),
  -- O imóvel só é apagado antes de entrar no catálogo; a conta do corretor, pelo
  -- admin ou nos testes. A exclusão de dados (LGPD) é da Etapa 13.
  imovel_id     uuid not null references public.imoveis (id) on delete cascade,
  corretor_id   uuid not null references public.perfis (id) on delete cascade,
  -- Instante exato (UTC no banco). O horário de Florianópolis é assunto da tela.
  horario       timestamptz not null,
  recado        text,
  status        public.status_visita not null default 'pendente',
  criada_em     timestamptz not null default now(),
  respondida_em timestamptz,

  constraint visitas_recado_tamanho check (char_length(recado) between 1 and 500)
);

comment on table public.visitas is
  'Pedidos de visita. Escrita só pelas funções pedir_visita, confirmar_visita, recusar_visita e cancelar_visita.';

-- Um horário só tem uma visita confirmada por imóvel.
create unique index visitas_um_confirmado_por_horario
  on public.visitas (imovel_id, horario)
  where status = 'confirmada';

-- O corretor pode ter várias visitas no imóvel, mas não o mesmo horário duas vezes.
create unique index visitas_sem_pedido_repetido
  on public.visitas (imovel_id, corretor_id, horario)
  where status in ('pendente', 'confirmada');

create index visitas_corretor_idx on public.visitas (corretor_id, horario desc);
create index visitas_imovel_idx on public.visitas (imovel_id, horario);

alter table public.visitas enable row level security;

revoke all on table public.visitas from anon, authenticated;
grant select on table public.visitas to authenticated;

-- O corretor sem acesso (bloqueado, vencido ou removido) não lê as próprias, como
-- no catálogo. O proprietário continua lendo as visitas dele nesses casos.
create policy "visitas: corretor le as proprias, dono as do imovel, admin todas"
  on public.visitas
  for select
  to authenticated
  using (
    (select public.eh_admin())
    or (corretor_id = (select auth.uid()) and (select public.eh_assinante_ativo()))
    or imovel_id in (select i.id from public.imoveis i where i.proprietario_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------
-- 2. Pedir
-- ---------------------------------------------------------------

-- Assinante com acesso, imóvel no catálogo (disponível ou em negociação) e horário
-- futuro e não confirmado para outra visita. A trava em comum com confirmar_visita
-- impede que um pedido entre no instante em que o horário está sendo fechado.
create function public.pedir_visita(p_imovel uuid, p_horario timestamptz, p_recado text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select public.eh_assinante_ativo()) then
    raise exception 'Só assinante com acesso ao catálogo pede visita' using errcode = '42501';
  end if;

  perform 1 from public.imoveis i
  where i.id = p_imovel and i.status = 'disponivel'
  for share;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  if p_horario is null or p_horario <= now() then
    raise exception 'Escolha um horário futuro' using errcode = 'P0001', hint = 'horario_passado';
  end if;

  if exists (select 1 from public.visitas v
             where v.imovel_id = p_imovel and v.horario = p_horario and v.status = 'confirmada') then
    raise exception 'Horário já ocupado' using errcode = 'P0001', hint = 'horario_ocupado';
  end if;

  begin
    insert into public.visitas (imovel_id, corretor_id, horario, recado)
    values (p_imovel, (select auth.uid()), p_horario, nullif(btrim(coalesce(p_recado, '')), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Você já pediu visita neste horário' using errcode = 'P0001', hint = 'pedido_repetido';
  end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------
-- 3. Responder
-- ---------------------------------------------------------------

-- Só o dono do imóvel, só pedido pendente, com horário futuro e imóvel no catálogo.
-- Numa operação só: a visita é confirmada e os outros pedidos daquele imóvel e
-- horário são recusados. Quem não é o dono recebe o mesmo erro de quem pediu uma
-- visita que não existe, sem revelar nada.
create function public.confirmar_visita(p_visita uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imovel  uuid;
  v_horario timestamptz;
  v_status  public.status_visita;
begin
  select v.imovel_id into v_imovel
  from public.visitas v
  join public.imoveis i on i.id = v.imovel_id
  where v.id = p_visita and i.proprietario_id = (select auth.uid());
  if not found then
    raise exception 'Visita não encontrada' using errcode = 'P0001', hint = 'visita_nao_encontrada';
  end if;

  -- A mesma trava de pedir_visita, agora exclusiva. O status e o horário só são
  -- lidos depois dela: outra resposta pode ter chegado antes.
  perform 1 from public.imoveis i
  where i.id = v_imovel and i.status = 'disponivel'
  for update;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  select v.horario, v.status into v_horario, v_status
  from public.visitas v
  where v.id = p_visita
  for update;

  if v_status <> 'pendente' then
    raise exception 'Esta visita já foi respondida' using errcode = 'P0001', hint = 'visita_ja_respondida';
  end if;
  if v_horario <= now() then
    raise exception 'O horário desta visita já passou' using errcode = 'P0001', hint = 'horario_passado';
  end if;

  update public.visitas
  set status = 'confirmada', respondida_em = now()
  where id = p_visita;

  update public.visitas
  set status = 'recusada', respondida_em = now()
  where imovel_id = v_imovel
    and horario = v_horario
    and status = 'pendente';
end;
$$;

-- Só o dono do imóvel e só pedido pendente, mesmo com o horário já passado (para
-- ele limpar a lista). Recusar não muda o horário: ele continua livre.
create function public.recusar_visita(p_visita uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.status_visita;
begin
  select v.status into v_status
  from public.visitas v
  join public.imoveis i on i.id = v.imovel_id
  where v.id = p_visita and i.proprietario_id = (select auth.uid())
  for update of v;
  if not found then
    raise exception 'Visita não encontrada' using errcode = 'P0001', hint = 'visita_nao_encontrada';
  end if;

  if v_status <> 'pendente' then
    raise exception 'Esta visita já foi respondida' using errcode = 'P0001', hint = 'visita_ja_respondida';
  end if;

  update public.visitas
  set status = 'recusada', respondida_em = now()
  where id = p_visita;
end;
$$;

-- ---------------------------------------------------------------
-- 4. Cancelar
-- ---------------------------------------------------------------

-- O corretor com acesso cancela a própria visita pendente ou confirmada. O dono
-- cancela a confirmada (a pendente ele recusa). Só antes do horário: visita que já
-- passou fica como histórico. Cancelar a confirmada reabre o horário; os pedidos
-- já recusados não voltam.
create function public.cancelar_visita(p_visita uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_corretor uuid;
  v_dono     uuid;
  v_horario  timestamptz;
  v_status   public.status_visita;
  v_eu       uuid := (select auth.uid());
begin
  select v.corretor_id, i.proprietario_id, v.horario, v.status
  into v_corretor, v_dono, v_horario, v_status
  from public.visitas v
  join public.imoveis i on i.id = v.imovel_id
  where v.id = p_visita
  for update of v;

  if not found
     or not (v_dono = v_eu or (v_corretor = v_eu and (select public.eh_assinante_ativo()))) then
    raise exception 'Visita não encontrada' using errcode = 'P0001', hint = 'visita_nao_encontrada';
  end if;

  if v_status not in ('pendente', 'confirmada') or (v_dono = v_eu and v_status <> 'confirmada') then
    raise exception 'Esta visita não pode ser cancelada' using errcode = 'P0001', hint = 'visita_encerrada';
  end if;
  if v_horario <= now() then
    raise exception 'O horário desta visita já passou' using errcode = 'P0001', hint = 'horario_passado';
  end if;

  update public.visitas
  set status = 'cancelada'
  where id = p_visita;
end;
$$;

-- ---------------------------------------------------------------
-- 5. Leituras
-- ---------------------------------------------------------------

-- Horários futuros já fechados de um imóvel do catálogo, para qualquer assinante
-- com acesso. Devolve só o horário: nada de quem marcou.
create function public.horarios_ocupados(p_imovel uuid)
returns table (horario timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select v.horario
  from public.visitas v
  where v.imovel_id = p_imovel
    and v.status = 'confirmada'
    and v.horario > now()
    and public.imovel_no_catalogo(p_imovel)
  order by v.horario;
$$;

-- As visitas do corretor logado, com os dados do imóvel. O corretor não lê a tabela
-- de imóveis: esta função é o caminho, e continua mostrando o título e o endereço
-- depois que o imóvel sai do catálogo. Nada do proprietário vem por aqui.
create function public.minhas_visitas(p_imovel uuid default null)
returns table (
  id            uuid,
  imovel_id     uuid,
  titulo        text,
  endereco      text,
  bairro        text,
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
  select v.id, v.imovel_id, i.titulo, i.endereco, b.nome, v.horario, v.recado, v.status,
         v.criada_em, v.respondida_em
  from public.visitas v
  join public.imoveis i on i.id = v.imovel_id
  join public.bairros b on b.id = i.bairro_id
  where v.corretor_id = (select auth.uid())
    and (select public.eh_assinante_ativo())
    and (p_imovel is null or v.imovel_id = p_imovel)
  order by v.horario desc, v.id
  limit 200;
$$;

-- A agenda do proprietário logado: as visitas dos imóveis dele, de todos ou de um
-- só, no período pedido, com os dados do corretor (RNF07). O proprietário não lê
-- perfis de corretores nem assinantes: esta função é o caminho. "imobiliaria" vem
-- vazio para o corretor autônomo.
create function public.agenda_de_visitas(
  p_de     timestamptz default null,
  p_ate    timestamptz default null,
  p_imovel uuid        default null
)
returns table (
  id             uuid,
  imovel_id      uuid,
  imovel_titulo  text,
  horario        timestamptz,
  recado         text,
  status         public.status_visita,
  criada_em      timestamptz,
  corretor_nome  text,
  imobiliaria    text,
  creci          text,
  telefone       text,
  email          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.imovel_id, i.titulo, v.horario, v.recado, v.status, v.criada_em,
         p.nome,
         case when a.tipo = 'imobiliaria' then a.nome end,
         a.creci, p.telefone, u.email::text
  from public.visitas v
  join public.imoveis i on i.id = v.imovel_id
  join public.perfis p on p.id = v.corretor_id
  join public.assinantes a on a.id = p.assinante_id
  join auth.users u on u.id = p.id
  where i.proprietario_id = (select auth.uid())
    and (p_imovel is null or v.imovel_id = p_imovel)
    and (p_de is null or v.horario >= p_de)
    and (p_ate is null or v.horario < p_ate)
  order by v.horario, v.id
  limit 500;
$$;

-- ---------------------------------------------------------------
-- 6. Corretor removido
-- ---------------------------------------------------------------

-- A remoção é definitiva: as visitas futuras em aberto dele são canceladas, e o
-- proprietário não fica esperando quem não trabalha mais ali.
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
  set status = 'cancelada'
  where corretor_id = p_corretor
    and status in ('pendente', 'confirmada')
    and horario > now();
end;
$$;
-- create or replace mantém as permissões da função (só authenticated).

-- ---------------------------------------------------------------
-- 7. Permissões
-- ---------------------------------------------------------------

revoke execute on function public.pedir_visita(uuid, timestamptz, text) from public, anon;
revoke execute on function public.confirmar_visita(uuid) from public, anon;
revoke execute on function public.recusar_visita(uuid) from public, anon;
revoke execute on function public.cancelar_visita(uuid) from public, anon;
revoke execute on function public.horarios_ocupados(uuid) from public, anon;
revoke execute on function public.minhas_visitas(uuid) from public, anon;
revoke execute on function public.agenda_de_visitas(timestamptz, timestamptz, uuid) from public, anon;

grant execute on function public.pedir_visita(uuid, timestamptz, text) to authenticated;
grant execute on function public.confirmar_visita(uuid) to authenticated;
grant execute on function public.recusar_visita(uuid) to authenticated;
grant execute on function public.cancelar_visita(uuid) to authenticated;
grant execute on function public.horarios_ocupados(uuid) to authenticated;
grant execute on function public.minhas_visitas(uuid) to authenticated;
grant execute on function public.agenda_de_visitas(timestamptz, timestamptz, uuid) to authenticated;

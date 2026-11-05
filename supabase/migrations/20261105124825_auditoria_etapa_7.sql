-- Auditoria da Etapa 7. Decisão de 05/11/2026, que muda a de 04/11/2026 ("o banco só
-- exige horário futuro").
--
-- 1. pedir_visita passa a recusar horário a mais de 15 dias ou fora do minuto cheio.
--    Antes, pela API, entravam 'infinity', 2099 e 09:00:01 com 09:00 confirmado. Os
--    14 dias e a lista de horários continuam sendo regra de tela: o teto do banco é
--    um pouco maior que a janela da tela e não precisa mudar se a lista mudar.
-- 2. Cancelar agora guarda quando e quem cancelou (cancelada_em e cancelada_por),
--    para os avisos da Etapa 10 saberem quem avisar.
--
-- Erro novo que o app reconhece pelo hint: horario_invalido.

alter table public.visitas
  add column cancelada_em  timestamptz,
  add column cancelada_por uuid references public.perfis (id) on delete set null;

create or replace function public.pedir_visita(p_imovel uuid, p_horario timestamptz, p_recado text default null)
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

  -- 'infinity' cai no teto; date_trunc também não aceitaria.
  if p_horario > now() + interval '15 days' or date_trunc('minute', p_horario) <> p_horario then
    raise exception 'Escolha um horário da lista' using errcode = 'P0001', hint = 'horario_invalido';
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

create or replace function public.cancelar_visita(p_visita uuid)
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
  set status = 'cancelada', cancelada_em = now(), cancelada_por = v_eu
  where id = p_visita;
end;
$$;

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
end;
$$;
-- create or replace mantém as permissões das funções (só authenticated).

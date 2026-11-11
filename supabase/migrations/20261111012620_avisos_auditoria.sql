-- Etapa 10, passo 10.5: correções da auditoria dos avisos (10/11/2026).
--
-- 1. A venda é reconhecida pela própria operação, não pelo texto do motivo nem por quem
--    agiu. aprovar_contrato() marca, só dentro da transação dela, o imóvel que está sendo
--    vendido (set_config local, que some no fim da transação). Os gatilhos das propostas e
--    dos contratos perguntam a imovel_em_venda(). Antes:
--      - contrato recusado era "pela venda" se o motivo fosse igual ao texto automático,
--        e o admin podia digitar o mesmo texto numa recusa normal;
--      - proposta recusada era "pela venda" se quem agiu fosse admin, e uma recusa sem
--        usuário (o cron da Etapa 12) sairia como "o proprietário recusou".
--    Conferir o status do imóvel no gatilho não serve: dentro de aprovar_contrato, as
--    propostas e os contratos mudam antes de o imóvel virar vendido.
-- 2. Fila do WhatsApp:
--      - nova tentativa só depois de uma espera que cresce (5 min depois da 1ª falha, 10
--        depois da 2ª): uma queda curta da Meta não gasta mais as 3 tentativas de uma vez;
--      - uma fila por vez (trava do Postgres no começo da reserva): duas chamadas ao mesmo
--        tempo não se travam nas limpezas do começo;
--      - filtro opcional por destinatário (p_destinatarios), usado só pelo e2e, para o
--        teste não mexer nos avisos de outras pessoas no banco compartilhado.
-- 3. Limite por hora: dois envios ao mesmo tempo do mesmo corretor não passam mais juntos
--    do limite (trava por corretor antes de contar).
-- 4. Índice em avisos.criado_em, para o número de não vistos do menu, que roda em toda
--    página.

-- 1. A venda em andamento ---------------------------------------------------

-- O imóvel que aprovar_contrato() está vendendo nesta transação? Lê a marca local que só
-- ela grava. Interna: só os gatilhos chamam.
create function public.imovel_em_venda(p_imovel uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('pauta.imovel_em_venda', true), '') = p_imovel::text;
$$;
revoke execute on function public.imovel_em_venda(uuid) from public, anon, authenticated;

-- Igual à da migration 20261106221451_contratos, mais a marca da venda depois da trava do
-- imóvel. "create or replace" mantém as permissões.
create or replace function public.aprovar_contrato(
  p_contrato      uuid,
  p_valor_final   numeric,
  p_comissao      numeric,
  p_comissao_paga boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu       uuid := (select auth.uid());
  v_imovel   uuid;
  v_proposta uuid;
  v_status   public.status_contrato;
  v_aceita   public.status_proposta;
  v_valor    numeric;
  v_comissao numeric;
  v_venda    uuid;
begin
  if not (select public.eh_admin()) then
    raise exception 'Só o admin aprova contrato' using errcode = '42501';
  end if;

  select c.imovel_id, c.proposta_id into v_imovel, v_proposta
  from public.contratos c
  where c.id = p_contrato;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0001', hint = 'contrato_nao_encontrado';
  end if;

  -- Esta trava fila dois contratos do mesmo imóvel, e também aceitar, desfazer, retirar,
  -- enviar proposta, pedir visita e enviar contrato, que pegam a linha com "for share".
  perform 1 from public.imoveis i
  where i.id = v_imovel and i.status = 'disponivel'
  for update;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  -- Os gatilhos dos avisos reconhecem o que esta venda encerra (migration
  -- 20261111012620_avisos_auditoria). Vale só até o fim desta transação.
  perform set_config('pauta.imovel_em_venda', v_imovel::text, true);

  select c.status into v_status
  from public.contratos c
  where c.id = p_contrato
  for update;

  if v_status <> 'em_analise' then
    raise exception 'Este contrato já foi conferido' using errcode = 'P0001', hint = 'contrato_ja_conferido';
  end if;

  -- O teto é o que cabe na coluna; 'Infinity' cai nele. round(NaN) continua NaN.
  v_valor := round(p_valor_final, 2);
  if v_valor is null or v_valor = 'NaN' or v_valor <= 0 or v_valor >= 1000000000000 then
    raise exception 'Informe o valor final do contrato' using errcode = 'P0001', hint = 'valor_invalido';
  end if;
  v_comissao := round(p_comissao, 2);
  if v_comissao is null or v_comissao = 'NaN' or v_comissao <= 0 or v_comissao > v_valor then
    raise exception 'A comissão precisa ser maior que zero e não passar do valor final'
      using errcode = 'P0001', hint = 'comissao_invalida';
  end if;

  perform 1 from public.visitas v
  where v.imovel_id = v_imovel
    and (v.status = 'pendente' or (v.status = 'confirmada' and v.horario > now()))
  order by v.id
  for update;

  update public.visitas v
  set status = 'cancelada', cancelada_em = now(), cancelada_por = v_eu
  where v.imovel_id = v_imovel
    and (v.status = 'pendente' or (v.status = 'confirmada' and v.horario > now()));

  perform 1 from public.propostas p
  where p.imovel_id = v_imovel and p.status in ('aguardando', 'aceita')
  order by p.id
  for update;

  select p.status into v_aceita
  from public.propostas p
  where p.id = v_proposta;

  if v_aceita <> 'aceita' then
    raise exception 'A proposta deste contrato não está mais aceita' using errcode = 'P0001', hint = 'proposta_encerrada';
  end if;

  update public.propostas p
  set status = 'recusada', respondida_em = now()
  where p.imovel_id = v_imovel
    and p.id <> v_proposta
    and p.status in ('aguardando', 'aceita');

  update public.contratos c
  set status = 'recusado', motivo_recusa = 'Imóvel vendido por outra proposta',
      respondido_em = now(), respondido_por = v_eu
  where c.imovel_id = v_imovel and c.id <> p_contrato and c.status = 'em_analise';

  update public.contratos c
  set status = 'aprovado', respondido_em = now(), respondido_por = v_eu
  where c.id = p_contrato;

  update public.imoveis i
  set status = 'vendido'
  where i.id = v_imovel;

  insert into public.vendas (imovel_id, contrato_id, valor_final, comissao_valor,
                             comissao_paga_em, comissao_marcada_por, registrada_por)
  values (v_imovel, p_contrato, v_valor, v_comissao,
          case when p_comissao_paga then now() end,
          case when p_comissao_paga then v_eu end,
          v_eu)
  returning id into v_venda;

  return v_venda;
end;
$$;

-- Igual à da migration 20261109234543_avisos_nos_eventos, com a recusa pela venda
-- reconhecida por imovel_em_venda().
create or replace function public.avisar_proposta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono   uuid;
  v_dados  jsonb;
  v_dono_link     text := '/proprietario/imoveis/' || new.imovel_id || '?aba=propostas';
  v_corretor_link text := '/assinante/negociacoes';
begin
  select i.proprietario_id, jsonb_build_object('titulo', i.titulo, 'valor', new.valor)
    into v_dono, v_dados
  from public.imoveis i where i.id = new.imovel_id;

  if tg_op = 'INSERT' then
    if new.status = 'aguardando' then
      perform public.criar_aviso(v_dono, 'proposta_recebida', new.imovel_id,
        v_dados || coalesce(public.dados_do_corretor(new.corretor_id), '{}'), v_dono_link);
    end if;
    return null;
  end if;

  if new.status = 'aceita' and old.status = 'aguardando' then
    perform public.criar_aviso(new.corretor_id, 'proposta_aceita', new.imovel_id, v_dados, v_corretor_link);

  elsif new.status = 'aguardando' and old.status = 'aceita' then
    perform public.criar_aviso(new.corretor_id, 'aceite_desfeito', new.imovel_id, v_dados, v_corretor_link);

  elsif new.status = 'recusada' and old.status in ('aguardando', 'aceita') then
    if public.imovel_em_venda(new.imovel_id) then
      perform public.criar_aviso(new.corretor_id, 'proposta_recusada_pela_venda', new.imovel_id, v_dados, v_corretor_link);
    else
      perform public.criar_aviso(new.corretor_id, 'proposta_recusada', new.imovel_id, v_dados, v_corretor_link);
    end if;

  elsif new.status = 'cancelada' and old.status in ('aguardando', 'aceita') then
    if new.cancelada_por = new.corretor_id then
      perform public.criar_aviso(v_dono, 'proposta_retirada', new.imovel_id,
        v_dados || coalesce(public.dados_do_corretor(new.corretor_id), '{}'), v_dono_link);
    elsif new.cancelada_por is not null then
      perform public.criar_aviso(v_dono, 'proposta_cancelada_corretor_saiu', new.imovel_id,
        v_dados || coalesce(public.dados_do_corretor(new.corretor_id), '{}'), v_dono_link);
    end if;
  end if;

  return null;
end;
$$;

-- Igual à da migration 20261109234543_avisos_nos_eventos, com a recusa pela venda
-- reconhecida por imovel_em_venda() em vez do texto do motivo.
create or replace function public.avisar_contrato()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono   uuid;
  v_titulo text;
begin
  select i.proprietario_id, i.titulo into v_dono, v_titulo
  from public.imoveis i where i.id = new.imovel_id;

  if tg_op = 'INSERT' then
    if new.status = 'em_analise' then
      perform public.criar_aviso(v_dono, 'contrato_enviado', new.imovel_id,
        jsonb_build_object('titulo', v_titulo) || coalesce(public.dados_do_corretor(new.enviado_por), '{}'),
        '/proprietario/imoveis/' || new.imovel_id || '?aba=propostas');
    end if;
    return null;
  end if;

  if new.status = 'recusado' and old.status = 'em_analise' then
    if public.imovel_em_venda(new.imovel_id) then
      perform public.criar_aviso(new.enviado_por, 'contrato_recusado_pela_venda', new.imovel_id,
        jsonb_build_object('titulo', v_titulo), '/assinante/negociacoes');
    else
      perform public.criar_aviso(new.enviado_por, 'contrato_recusado', new.imovel_id,
        jsonb_build_object('titulo', v_titulo, 'motivo', new.motivo_recusa), '/assinante/negociacoes');
    end if;
  end if;

  return null;
end;
$$;

-- 2. Fila do WhatsApp -------------------------------------------------------

-- A assinatura muda (p_destinatarios), então a função antiga sai.
drop function public.reservar_avisos_whatsapp(text, int);

create function public.reservar_avisos_whatsapp(p_segredo text, p_limite int default 20,
                                                p_destinatarios uuid[] default null)
returns table (id bigint, tipo public.tipo_aviso, dados jsonb, telefone text, tentativa smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.conferir_segredo_da_fila(p_segredo);
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'Limite da fila entre 1 e 50' using errcode = 'P0001', hint = 'limite_invalido';
  end if;

  -- Uma reserva por vez: a outra espera a primeira terminar (é rápida; o envio à Meta
  -- acontece fora daqui). Sem isto, as limpezas abaixo, de duas filas ao mesmo tempo,
  -- podiam se travar uma à outra.
  perform pg_advisory_xact_lock(hashtext('pauta_whatsapp_fila'));

  -- Velho demais: não sai mais (a última falha, com 3 tentativas, fica como está).
  update public.avisos a
  set whatsapp = 'expirado'
  where a.whatsapp in ('pendente', 'enviando', 'falhou')
    and a.whatsapp_tentativas < 3
    and a.criado_em < now() - interval '1 day';

  -- Reservado e sem resultado, já sem tentativa: fica como falha.
  update public.avisos a
  set whatsapp = 'falhou',
      whatsapp_erro = 'Sem resultado do servidor depois de reservado'
  where a.whatsapp = 'enviando'
    and a.whatsapp_tentativas >= 3
    and a.whatsapp_reservado_em < now() - interval '10 minutes';

  -- Desligou o WhatsApp ou saiu da imobiliária depois do aviso.
  update public.avisos a
  set whatsapp = 'desligado'
  from public.perfis p
  where p.id = a.destinatario_id
    and a.whatsapp in ('pendente', 'falhou')
    and a.whatsapp_tentativas < 3
    and (not p.whatsapp_aceito or p.removido_em is not null);

  return query
  with escolhidos as (
    select a.id
    from public.avisos a
    where a.destinatario_id is not null
      and (p_destinatarios is null or a.destinatario_id = any (p_destinatarios))
      and a.whatsapp_tentativas < 3
      and (a.whatsapp = 'pendente'
           -- Nova tentativa só depois de 5 minutos por tentativa já feita.
           or (a.whatsapp = 'falhou'
               and a.whatsapp_reservado_em < now() - interval '5 minutes' * a.whatsapp_tentativas)
           or (a.whatsapp = 'enviando' and a.whatsapp_reservado_em < now() - interval '10 minutes'))
    order by a.id
    limit p_limite
    for update of a skip locked
  ),
  reservados as (
    update public.avisos a
    set whatsapp = 'enviando',
        whatsapp_tentativas = a.whatsapp_tentativas + 1,
        whatsapp_reservado_em = now()
    from escolhidos e
    where a.id = e.id
    returning a.id, a.tipo, a.dados, a.destinatario_id, a.whatsapp_tentativas
  )
  -- Telefone com o código do Brasil, só dígitos (perfis_telefone_celular: DDD + 9 + 8).
  select r.id, r.tipo, r.dados, '55' || p.telefone, r.whatsapp_tentativas
  from reservados r
  join public.perfis p on p.id = r.destinatario_id
  order by r.id;
end;
$$;

-- O segredo é a proteção: a função é chamada pelo servidor sem sessão (anon).
revoke execute on function public.reservar_avisos_whatsapp(text, int, uuid[]) from public;
grant execute on function public.reservar_avisos_whatsapp(text, int, uuid[]) to anon, authenticated;

-- 3. Limite por hora --------------------------------------------------------

-- Igual à da migration 20261109234543_avisos_nos_eventos, com a trava por corretor antes
-- de contar: sem ela, dois envios ao mesmo tempo contavam os mesmos 9 e passavam os dois.
create or replace function public.limitar_envios_por_hora()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
begin
  -- Só o próprio corretor conta (o roteiro de testes e o admin gravam sem limite).
  if new.corretor_id is distinct from (select auth.uid()) then
    return new;
  end if;

  -- Vale até o fim da transação: o segundo envio espera o primeiro gravar e já o conta.
  perform pg_advisory_xact_lock(hashtext('pauta_limite_' || tg_table_name || '_' || new.corretor_id::text));

  if tg_table_name = 'propostas' then
    select count(*) into v_total from public.propostas p
    where p.corretor_id = new.corretor_id and p.criada_em > now() - interval '1 hour';
    if v_total >= 10 then
      raise exception 'Você enviou muitas propostas na última hora. Tente de novo mais tarde.'
        using errcode = 'P0001', hint = 'limite_por_hora';
    end if;
  else
    select count(*) into v_total from public.visitas v
    where v.corretor_id = new.corretor_id and v.criada_em > now() - interval '1 hour';
    if v_total >= 20 then
      raise exception 'Você pediu muitas visitas na última hora. Tente de novo mais tarde.'
        using errcode = 'P0001', hint = 'limite_por_hora';
    end if;
  end if;

  return new;
end;
$$;

-- 4. Índice do número de não vistos -------------------------------------------

create index avisos_criado_em_idx on public.avisos (criado_em);

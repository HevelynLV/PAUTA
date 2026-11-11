-- Etapa 10, passo 10.2b: cada evento do fluxo gera aviso, e o limite por hora.
--
-- Plano aprovado em 09/11/2026: o aviso nasce em gatilhos (triggers) nas tabelas, que
-- chamam criar_aviso() (migration 20261109232807_avisos) na mesma operação do evento.
-- Nenhuma função já auditada é reescrita: o gatilho só observa a mudança de status.
-- Assim os efeitos em massa (recusa dos outros pedidos do horário, venda, corretor
-- removido) e as chamadas diretas pela API também avisam. Quem agiu não recebe.
--
-- Como o gatilho sabe o motivo:
--   - Visita recusada com outra visita confirmada no mesmo imóvel e horário: o dono
--     confirmou o horário para outro corretor (confirmar_visita confirma antes de recusar).
--   - Visita cancelada: cancelada_por diz quem foi. O corretor avisa o dono; o dono avisa
--     o corretor; o admin só cancela visita na venda (aprovar_contrato); qualquer outra
--     pessoa é o responsável que removeu o corretor da equipe (remover_corretor).
--   - Proposta recusada pelo admin: só acontece na venda. Proposta cancelada por alguém
--     que não é o corretor: ele saiu da imobiliária (remover_corretor, ou o admin recusando
--     o contrato de um corretor removido).
--   - Contrato recusado com o motivo automático de aprovar_contrato: recusado pela venda.
--   - Dentro de aprovar_contrato, visitas e propostas mudam ANTES de o imóvel virar
--     vendido. Por isso o aviso da venda sai da linha nova em vendas, que já tem o valor
--     final.
--
-- Sem aviso (decisão de 09/11/2026): contrato recusado para o proprietário, bloqueio pelo
-- admin, corretor removido e os eventos que só o admin acompanha (pelo painel).
--
-- Limite por hora (decisão de 09/11/2026): cada corretor envia no máximo 10 propostas e
-- 20 pedidos de visita por hora. Vale só para o próprio corretor (auth.uid()), como pelo
-- app e pela API; o hint é limite_por_hora.

-- 1. Ajudantes -------------------------------------------------------

-- Nome do corretor e da imobiliária dele (null para o autônomo), para o aviso do dono
-- (RNF07). Nunca leva telefone nem e-mail.
create function public.dados_do_corretor(p_corretor uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'corretor', p.nome,
    'imobiliaria', case when a.tipo = 'imobiliaria' then a.nome end
  )
  from public.perfis p
  left join public.assinantes a on a.id = p.assinante_id
  where p.id = p_corretor;
$$;
revoke execute on function public.dados_do_corretor(uuid) from public, anon, authenticated;

-- Quem agiu é admin? (pelo tipo da conta, para os gatilhos)
create function public.perfil_eh_admin(p_perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.tipo = 'admin' from public.perfis p where p.id = p_perfil), false);
$$;
revoke execute on function public.perfil_eh_admin(uuid) from public, anon, authenticated;

-- 2. Imóvel ------------------------------------------------------------
--   P1 aprovado e C13 imóvel novo · P2 reprovado · P3 captado · C13 captado aceito

create function public.avisar_imovel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novo jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status = 'captado' then
      perform public.criar_aviso(new.proprietario_id, 'imovel_captado', new.id,
        jsonb_build_object('titulo', new.titulo),
        '/proprietario/imoveis/' || new.id || '/aceitar');
    end if;
    return null;
  end if;

  if new.status = 'disponivel' and old.status in ('pendente', 'captado') then
    if old.status = 'pendente' then
      perform public.criar_aviso(new.proprietario_id, 'imovel_aprovado', new.id,
        jsonb_build_object('titulo', new.titulo, 'exclusividade_fim', new.exclusividade_fim),
        '/proprietario/imoveis/' || new.id);
    end if;

    select jsonb_build_object('titulo', new.titulo, 'preco', new.preco, 'bairro', b.nome)
      into v_novo
    from public.bairros b where b.id = new.bairro_id;
    perform public.criar_aviso(null, 'imovel_novo', new.id,
      coalesce(v_novo, jsonb_build_object('titulo', new.titulo, 'preco', new.preco)),
      '/assinante/imoveis/' || new.id);

  elsif new.status = 'reprovado' and old.status = 'pendente' then
    perform public.criar_aviso(new.proprietario_id, 'imovel_reprovado', new.id,
      jsonb_build_object('titulo', new.titulo, 'motivo', new.motivo_reprovacao),
      '/proprietario/imoveis/' || new.id);
  end if;

  return null;
end;
$$;
revoke execute on function public.avisar_imovel() from public, anon, authenticated;

create trigger avisar_imovel_novo
  after insert on public.imoveis
  for each row
  when (new.status = 'captado')
  execute function public.avisar_imovel();

create trigger avisar_imovel_status
  after update of status on public.imoveis
  for each row
  when (old.status is distinct from new.status)
  execute function public.avisar_imovel();

-- 3. Visita -------------------------------------------------------------
--   P4 pedido · C1 confirmada · C2 recusada · C3 horário de outro · P5 cancelada pelo
--   corretor · C4 cancelada pelo dono · C5 cancelada pela venda · P6 corretor saiu

create function public.avisar_visita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono     uuid;
  v_titulo   text;
  v_endereco text;
  v_dados    jsonb;
  v_por      uuid;
  v_dono_link     text;
  v_corretor_link text := '/assinante/negociacoes?aba=visitas';
begin
  select i.proprietario_id, i.titulo, i.endereco into v_dono, v_titulo, v_endereco
  from public.imoveis i where i.id = new.imovel_id;
  v_dados := jsonb_build_object('titulo', v_titulo, 'horario', new.horario);
  v_dono_link := '/proprietario/imoveis/' || new.imovel_id;

  if tg_op = 'INSERT' then
    if new.status = 'pendente' then
      perform public.criar_aviso(v_dono, 'visita_pedida', new.imovel_id,
        v_dados || coalesce(public.dados_do_corretor(new.corretor_id), '{}'), v_dono_link);
    end if;
    return null;
  end if;

  if new.status = 'confirmada' and old.status = 'pendente' then
    perform public.criar_aviso(new.corretor_id, 'visita_confirmada', new.imovel_id,
      v_dados || jsonb_build_object('endereco', v_endereco), v_corretor_link);

  elsif new.status = 'recusada' and old.status = 'pendente' then
    if exists (select 1 from public.visitas o
               where o.imovel_id = new.imovel_id and o.horario = new.horario
                 and o.status = 'confirmada' and o.id <> new.id) then
      perform public.criar_aviso(new.corretor_id, 'visita_horario_ocupado', new.imovel_id, v_dados, v_corretor_link);
    else
      perform public.criar_aviso(new.corretor_id, 'visita_recusada', new.imovel_id, v_dados, v_corretor_link);
    end if;

  elsif new.status = 'cancelada' and old.status in ('pendente', 'confirmada') then
    v_por := new.cancelada_por;
    if v_por is null then
      null;
    elsif v_por = new.corretor_id then
      perform public.criar_aviso(v_dono, 'visita_cancelada_pelo_corretor', new.imovel_id,
        v_dados || coalesce(public.dados_do_corretor(new.corretor_id), '{}'), v_dono_link);
    elsif v_por = v_dono then
      perform public.criar_aviso(new.corretor_id, 'visita_cancelada_pelo_proprietario', new.imovel_id,
        v_dados, v_corretor_link);
    elsif public.perfil_eh_admin(v_por) then
      perform public.criar_aviso(new.corretor_id, 'visita_cancelada_pela_venda', new.imovel_id,
        v_dados, v_corretor_link);
    else
      perform public.criar_aviso(v_dono, 'visita_cancelada_corretor_saiu', new.imovel_id,
        v_dados || coalesce(public.dados_do_corretor(new.corretor_id), '{}'), v_dono_link);
    end if;
  end if;

  return null;
end;
$$;
revoke execute on function public.avisar_visita() from public, anon, authenticated;

create trigger avisar_visita_nova
  after insert on public.visitas
  for each row
  execute function public.avisar_visita();

create trigger avisar_visita_status
  after update of status on public.visitas
  for each row
  when (old.status is distinct from new.status)
  execute function public.avisar_visita();

-- 4. Proposta -----------------------------------------------------------
--   P7 nova · C6 aceita · C8 aceite desfeito · C7 recusada · C9 recusada pela venda ·
--   P8 retirada · P6 corretor saiu

create function public.avisar_proposta()
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
    if public.perfil_eh_admin((select auth.uid())) then
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
revoke execute on function public.avisar_proposta() from public, anon, authenticated;

create trigger avisar_proposta_nova
  after insert on public.propostas
  for each row
  execute function public.avisar_proposta();

create trigger avisar_proposta_status
  after update of status on public.propostas
  for each row
  when (old.status is distinct from new.status)
  execute function public.avisar_proposta();

-- 5. Contrato e venda ------------------------------------------------------
--   P9 enviado · C11 recusado · C12 recusado pela venda · P10 e C10 venda

create function public.avisar_contrato()
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
    -- O texto é o motivo automático de aprovar_contrato (migration 20261106221451_contratos).
    if new.motivo_recusa = 'Imóvel vendido por outra proposta' then
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
revoke execute on function public.avisar_contrato() from public, anon, authenticated;

create trigger avisar_contrato_novo
  after insert on public.contratos
  for each row
  execute function public.avisar_contrato();

create trigger avisar_contrato_status
  after update of status on public.contratos
  for each row
  when (old.status is distinct from new.status)
  execute function public.avisar_contrato();

-- A venda nasce no fim de aprovar_contrato, com o imóvel já vendido. O dono e o corretor
-- veem o valor final; a comissão nunca entra no aviso.
create function public.avisar_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dono     uuid;
  v_titulo   text;
  v_corretor uuid;
  v_dados    jsonb;
begin
  select i.proprietario_id, i.titulo into v_dono, v_titulo
  from public.imoveis i where i.id = new.imovel_id;
  select c.enviado_por into v_corretor from public.contratos c where c.id = new.contrato_id;
  v_dados := jsonb_build_object('titulo', v_titulo, 'valor_final', new.valor_final);

  perform public.criar_aviso(v_dono, 'imovel_vendido', new.imovel_id, v_dados,
    '/proprietario/imoveis/' || new.imovel_id);
  perform public.criar_aviso(v_corretor, 'contrato_aprovado', new.imovel_id, v_dados,
    '/assinante/negociacoes');
  return null;
end;
$$;
revoke execute on function public.avisar_venda() from public, anon, authenticated;

create trigger avisar_venda
  after insert on public.vendas
  for each row
  execute function public.avisar_venda();

-- 6. Conta ----------------------------------------------------------------
--   R1 assinatura ativada (a primeira vez) · R2 corretor entrou pelo convite

create function public.avisar_ativacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.criar_aviso(new.responsavel_id, 'assinatura_ativada', null,
    jsonb_build_object('nome', new.nome), '/assinante');
  return null;
end;
$$;
revoke execute on function public.avisar_ativacao() from public, anon, authenticated;

-- ativado_em é preenchida pelo gatilho marcar_ativacao_do_assinante, antes da gravação.
create trigger avisar_ativacao
  after update of status on public.assinantes
  for each row
  when (old.ativado_em is null and new.ativado_em is not null)
  execute function public.avisar_ativacao();

create function public.avisar_corretor_novo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_responsavel uuid;
begin
  select a.responsavel_id into v_responsavel
  from public.assinantes a where a.id = new.assinante_id;
  perform public.criar_aviso(v_responsavel, 'corretor_entrou', null,
    jsonb_build_object('corretor', new.nome), '/assinante/equipe');
  return null;
end;
$$;
revoke execute on function public.avisar_corretor_novo() from public, anon, authenticated;

create trigger avisar_corretor_novo
  after insert on public.perfis
  for each row
  when (new.tipo = 'corretor' and new.assinante_id is not null)
  execute function public.avisar_corretor_novo();

-- 7. Limite por hora --------------------------------------------------------

create function public.limitar_envios_por_hora()
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
revoke execute on function public.limitar_envios_por_hora() from public, anon, authenticated;

create index propostas_corretor_criada_idx on public.propostas (corretor_id, criada_em);
create index visitas_corretor_criada_idx on public.visitas (corretor_id, criada_em);

create trigger limitar_propostas_por_hora
  before insert on public.propostas
  for each row
  execute function public.limitar_envios_por_hora();

create trigger limitar_visitas_por_hora
  before insert on public.visitas
  for each row
  execute function public.limitar_envios_por_hora();

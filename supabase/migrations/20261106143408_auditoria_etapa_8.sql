-- Auditoria da Etapa 8.
--
-- 1. Corretor removido com proposta ou visita em aberto. enviar_proposta e pedir_visita
--    conferiam o acesso antes de qualquer trava, e nada disputava com remover_corretor:
--    se a remoção terminasse entre a conferência e o insert, a linha nova nascia depois
--    do cancelamento e ficava em aberto, com o corretor sem poder retirá-la. Agora as
--    duas funções travam a linha do perfil depois da trava do imóvel.
--    Quem chega primeiro decide: se a remoção veio antes, a função espera e vê
--    removido_em preenchido; se a função veio antes, a remoção espera e o cancelamento
--    enxerga a linha nova. "for share" não atrapalha dois envios do mesmo corretor.
--    Provado à mão no passo 8.5, segurando a linha do imóvel com uma terceira conexão.
--
-- 2. subir_versao_do_imovel volta a usar campos_de_conteudo_do_imovel(), a lista única
--    da Etapa 4. A migration de propostas a trocou sem querer por uma lista de exclusão:
--    qualquer coluna nova de imoveis subiria a versão e faria aprovar_imovel e
--    aceitar_termo_captado falharem com "o imóvel mudou".

-- create or replace mantém as permissões das três funções.

create or replace function public.enviar_proposta(
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

  -- Disputa com remover_corretor: ver o cabeçalho desta migration.
  perform 1 from public.perfis p
  where p.id = (select auth.uid()) and p.removido_em is null
  for share;
  if not found then
    raise exception 'Só assinante com acesso ao catálogo envia proposta' using errcode = '42501';
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

  -- Disputa com remover_corretor: ver o cabeçalho desta migration.
  perform 1 from public.perfis p
  where p.id = (select auth.uid()) and p.removido_em is null
  for share;
  if not found then
    raise exception 'Só assinante com acesso ao catálogo pede visita' using errcode = '42501';
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

create or replace function public.subir_versao_do_imovel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_campo text;
begin
  foreach v_campo in array public.campos_de_conteudo_do_imovel()
  loop
    if (to_jsonb(old) -> v_campo) is distinct from (to_jsonb(new) -> v_campo) then
      new.versao := old.versao + 1;
      new.atualizado_em := now();
      exit;
    end if;
  end loop;
  return new;
end;
$$;

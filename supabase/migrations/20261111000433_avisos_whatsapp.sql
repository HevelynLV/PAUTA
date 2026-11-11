-- Etapa 10, passo 10.3b: a fila do WhatsApp (RF29).
--
-- O aviso já nasce com whatsapp = 'pendente' para quem aceitou receber (migration
-- 20261109232807_avisos). Agora o servidor do app tira os pendentes da fila, manda para a
-- Meta e grava o resultado, sempre por duas funções:
--   - reservar_avisos_whatsapp(p_segredo, p_limite): pega até p_limite avisos e devolve o
--     telefone de quem recebe. Quem gerou o aviso (ex.: o corretor) não pode ler o
--     telefone do proprietário, por isso as duas funções só funcionam com o segredo
--     pauta_whatsapp_fila, guardado no Vault do Supabase e, com o mesmo valor, em
--     WHATSAPP_FILA_SEGREDO no .env.local. Sem a chave secreta do Supabase (decisão de
--     09/11/2026, plano da Etapa 10). Antes de aplicar, o segredo precisa existir no Vault
--     (passo no "Atenção" do ROADMAP).
--   - registrar_envio_whatsapp(p_segredo, p_aviso, p_enviado, p_whatsapp_id, p_erro):
--     'enviado' (com o id da mensagem da Meta) ou 'falhou' (com o erro). Até 3 tentativas;
--     na terceira falha o aviso fica 'falhou' de vez.
--
-- Regras da fila:
--   - Aviso com mais de 1 dia que não saiu vira 'expirado': quando as chaves da Meta forem
--     ligadas, o app não manda de uma vez tudo o que se acumulou.
--   - Quem desligou o WhatsApp (ou foi removido da imobiliária) depois do aviso não recebe:
--     o aviso vira 'desligado'.
--   - Reservado e sem resultado por 10 minutos (o servidor caiu no meio): volta para a fila,
--     se ainda tiver tentativa; senão, fica 'falhou'.
--   - "for update skip locked": dois servidores ao mesmo tempo nunca pegam o mesmo aviso.
--
-- A Meta só é chamada pelo app (src/lib/whatsapp.ts). Decidido em 10/11/2026: o número de
-- teste não entrega para celulares do Brasil, então a Etapa 10 testa o envio com a Meta
-- simulada; a entrega real fica para o piloto.

-- 1. Quando o aviso foi reservado ---------------------------------------

alter table public.avisos
  add column whatsapp_reservado_em timestamptz;

-- 2. O segredo da fila -------------------------------------------------------

-- Confere o segredo contra o Vault. Interna: só as duas funções da fila chamam.
create function public.conferir_segredo_da_fila(p_segredo text)
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
  where ds.name = 'pauta_whatsapp_fila';
  if coalesce(v_segredo, '') = '' then
    raise exception 'Falta o segredo pauta_whatsapp_fila no Vault' using errcode = 'P0001', hint = 'segredo_ausente';
  end if;
  if p_segredo is null or p_segredo <> v_segredo then
    raise exception 'Segredo da fila do WhatsApp inválido' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.conferir_segredo_da_fila(text) from public, anon, authenticated;

-- 3. Reservar --------------------------------------------------------------

create function public.reservar_avisos_whatsapp(p_segredo text, p_limite int default 20)
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
      and a.whatsapp_tentativas < 3
      and (a.whatsapp = 'pendente'
           or a.whatsapp = 'falhou'
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
revoke execute on function public.reservar_avisos_whatsapp(text, int) from public;
grant execute on function public.reservar_avisos_whatsapp(text, int) to anon, authenticated;

-- 4. Registrar o resultado ------------------------------------------------------

create function public.registrar_envio_whatsapp(p_segredo text, p_aviso bigint, p_enviado boolean,
                                                p_whatsapp_id text default null, p_erro text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.conferir_segredo_da_fila(p_segredo);
  if p_enviado is null then
    raise exception 'Diga se o envio deu certo' using errcode = 'P0001', hint = 'resultado_invalido';
  end if;

  -- Só o aviso reservado: o resultado de um envio antigo não passa por cima de outro.
  update public.avisos a
  set whatsapp = case when p_enviado then 'enviado' else 'falhou' end::public.status_whatsapp,
      whatsapp_enviado_em = case when p_enviado then now() end,
      whatsapp_id = case when p_enviado then left(p_whatsapp_id, 200) end,
      whatsapp_erro = case when p_enviado then null
                           else left(coalesce(nullif(btrim(p_erro), ''), 'Erro desconhecido'), 500) end
  where a.id = p_aviso and a.whatsapp = 'enviando';
  if not found then
    raise exception 'Aviso não está reservado para envio' using errcode = 'P0001', hint = 'aviso_nao_reservado';
  end if;
end;
$$;

revoke execute on function public.registrar_envio_whatsapp(text, bigint, boolean, text, text) from public;
grant execute on function public.registrar_envio_whatsapp(text, bigint, boolean, text, text) to anon, authenticated;

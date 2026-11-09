-- Auditoria da Etapa 9.
--
-- 1. Só PDF vira contrato, mesmo chamando o banco direto pela API. O banco não lê o
--    conteúdo do arquivo no Storage; quem lê é a action do servidor (confere o começo,
--    "%PDF-"). Agora enviar_contrato exige uma assinatura (HMAC-SHA256) que só o servidor
--    sabe fazer, com o segredo pauta_contrato_pdf, guardado no Vault do Supabase e, com o
--    mesmo valor, em CONTRATO_PDF_SEGREDO no .env.local. A versão antiga, sem assinatura,
--    sai do banco. Decidido em 09/11/2026: só PDF é aceito.
--    Antes de aplicar, o segredo precisa existir no Vault (passo no "Atenção" do ROADMAP).
--
-- 2. Arquivos sem registro tinham limite só de tamanho. Agora o bucket recusa o quarto
--    arquivo sem registro na pasta da mesma proposta.
--
-- 3. Proposta aceita de novo depois de um contrato recusado mostrava o motivo antigo.
--    minhas_propostas e propostas_recebidas ignoram o contrato recusado enviado antes
--    do aceite atual. "create or replace" mantém o retorno e as permissões.

-- 1. Envio com assinatura ------------------------------------------

drop function public.enviar_contrato(uuid, text, text);

create function public.enviar_contrato(p_proposta uuid, p_caminho text, p_nome text, p_assinatura text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu      uuid := (select auth.uid());
  v_id      uuid;
  v_imovel  uuid;
  v_status  public.status_proposta;
  v_tamanho bigint;
  v_etag    text;
  v_segredo text;
  v_nome    text := left(btrim(regexp_replace(coalesce(p_nome, ''), '[[:cntrl:]]', '', 'g')), 200);
begin
  if not (select public.eh_assinante_ativo()) then
    raise exception 'Só assinante com acesso ao catálogo envia contrato' using errcode = '42501';
  end if;

  select p.imovel_id into v_imovel
  from public.propostas p
  where p.id = p_proposta and p.corretor_id = v_eu;
  if not found then
    raise exception 'Proposta não encontrada' using errcode = 'P0001', hint = 'proposta_nao_encontrada';
  end if;

  perform 1 from public.imoveis i
  where i.id = v_imovel and i.status = 'disponivel'
  for share;
  if not found then
    raise exception 'Imóvel fora do catálogo' using errcode = 'P0001', hint = 'imovel_fora_do_catalogo';
  end if;

  -- Disputa com remover_corretor: ver o cabeçalho desta migration.
  perform 1 from public.perfis p
  where p.id = v_eu and p.removido_em is null
  for share;
  if not found then
    raise exception 'Só assinante com acesso ao catálogo envia contrato' using errcode = '42501';
  end if;

  -- O status só é lido depois das travas. Esta trava disputa com desfazer e retirar.
  select p.status into v_status
  from public.propostas p
  where p.id = p_proposta
  for update;

  if v_status <> 'aceita' then
    raise exception 'Esta proposta não está aceita' using errcode = 'P0001', hint = 'proposta_nao_aceita';
  end if;

  if exists (select 1 from public.contratos c where c.proposta_id = p_proposta and c.status = 'em_analise') then
    raise exception 'Já há um contrato em análise nesta proposta' using errcode = 'P0001', hint = 'contrato_em_analise';
  end if;

  -- O arquivo precisa ser dele e estar na pasta desta proposta. O tamanho vem do Storage.
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'eTag' into v_tamanho, v_etag
  from storage.objects o
  where o.bucket_id = 'contratos'
    and o.name = p_caminho
    and p_caminho ~ ('^' || p_proposta::text || '/[0-9a-f-]{36}\.pdf$')
    and o.owner_id = v_eu::text;

  if v_tamanho is null or v_tamanho not between 1 and 20971520 then
    raise exception 'Arquivo do contrato inválido' using errcode = 'P0001', hint = 'arquivo_invalido';
  end if;

  -- Só o servidor do PAUTA, depois de ler o começo do arquivo e ver que é PDF, sabe
  -- assinar. A assinatura cobre a proposta, o caminho, o corretor e o eTag do arquivo:
  -- trocar o arquivo depois da conferência muda o eTag e invalida a assinatura.
  select ds.decrypted_secret into v_segredo
  from vault.decrypted_secrets ds
  where ds.name = 'pauta_contrato_pdf';
  if coalesce(v_segredo, '') = '' then
    raise exception 'Falta o segredo pauta_contrato_pdf no Vault' using errcode = 'P0001', hint = 'segredo_ausente';
  end if;

  if v_etag is null or p_assinatura is null
     or p_assinatura <> encode(extensions.hmac(p_proposta::text || ':' || p_caminho || ':' || v_eu::text || ':' || v_etag,
                                               v_segredo, 'sha256'), 'hex') then
    raise exception 'Arquivo do contrato não conferido' using errcode = 'P0001', hint = 'arquivo_invalido';
  end if;

  begin
    insert into public.contratos (proposta_id, imovel_id, enviado_por, caminho, nome_arquivo, tamanho_bytes)
    values (p_proposta, v_imovel, v_eu, p_caminho, coalesce(nullif(v_nome, ''), 'contrato.pdf'), v_tamanho)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Arquivo do contrato inválido' using errcode = 'P0001', hint = 'arquivo_invalido';
  end;

  return v_id;
end;
$$;

revoke execute on function public.enviar_contrato(uuid, text, text, text) from public, anon;
grant execute on function public.enviar_contrato(uuid, text, text, text) to authenticated;

-- 2. Limite de arquivos sem registro --------------------------------

create or replace function public.pode_enviar_contrato(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.eh_assinante_ativo()) and exists (
    select 1
    from public.propostas p
    join public.imoveis i on i.id = p.imovel_id
    where p.id::text = (storage.foldername(p_nome))[1]
      and p.corretor_id = (select auth.uid())
      and p.status = 'aceita'
      and i.status = 'disponivel'
      and not exists (select 1 from public.contratos c
                      where c.proposta_id = p.id and c.status = 'em_analise')
      -- No máximo 3 arquivos ainda sem registro na pasta da proposta. O arquivo que está
      -- entrando ainda não está na tabela quando a regra do bucket chama esta função.
      and (select count(*)
           from storage.objects o
           where o.bucket_id = 'contratos'
             and (storage.foldername(o.name))[1] = p.id::text
             and not exists (select 1 from public.contratos c2 where c2.caminho = o.name)) < 3
  );
$$;

-- 3. Contrato recusado antes do aceite atual -----------------------

create or replace function public.minhas_propostas(p_imovel uuid default null)
returns table (
  id                  uuid,
  imovel_id           uuid,
  titulo              text,
  endereco            text,
  bairro              text,
  no_catalogo         boolean,
  valor               numeric,
  forma_pagamento     public.forma_pagamento,
  condicoes           text,
  nome_comprador      text,
  status              public.status_proposta,
  criada_em           timestamptz,
  respondida_em       timestamptz,
  contrato_id         uuid,
  contrato_status     public.status_contrato,
  contrato_motivo     text,
  contrato_enviado_em timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.imovel_id, i.titulo, i.endereco, b.nome, i.status = 'disponivel',
         p.valor, p.forma_pagamento, p.condicoes, p.nome_comprador, p.status,
         p.criada_em, p.respondida_em,
         c.id, c.status, c.motivo_recusa, c.enviado_em
  from public.propostas p
  join public.imoveis i on i.id = p.imovel_id
  join public.bairros b on b.id = i.bairro_id
  left join lateral (
    select x.id, x.status, x.motivo_recusa, x.enviado_em
    from public.contratos x
    where x.proposta_id = p.id
      -- Aceita de novo depois de um contrato recusado: o motivo antigo não vale mais.
      and not (p.status = 'aceita' and x.status = 'recusado' and x.enviado_em < coalesce(p.respondida_em, '-infinity'))
    order by x.enviado_em desc, x.id
    limit 1
  ) c on true
  where p.corretor_id = (select auth.uid())
    and (select public.eh_assinante_ativo())
    and (p_imovel is null or p.imovel_id = p_imovel)
  order by p.criada_em desc, p.id
  limit 200;
$$;

create or replace function public.propostas_recebidas(p_imovel uuid default null)
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
  email           text,
  contrato_id     uuid,
  contrato_status public.status_contrato
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
         a.creci, c.telefone, u.email::text,
         ct.id, ct.status
  from public.propostas p
  join public.imoveis i on i.id = p.imovel_id
  join public.perfis c on c.id = p.corretor_id
  join public.assinantes a on a.id = c.assinante_id
  join auth.users u on u.id = c.id
  left join lateral (
    select x.id, x.status
    from public.contratos x
    where x.proposta_id = p.id
      -- Aceita de novo depois de um contrato recusado: o motivo antigo não vale mais.
      and not (p.status = 'aceita' and x.status = 'recusado' and x.enviado_em < coalesce(p.respondida_em, '-infinity'))
    order by x.enviado_em desc, x.id
    limit 1
  ) ct on true
  where i.proprietario_id = (select auth.uid())
    and (p_imovel is null or p.imovel_id = p_imovel)
  order by p.criada_em desc, p.id
  limit 500;
$$;

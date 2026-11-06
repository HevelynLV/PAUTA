-- Etapa 9, contrato e venda (RF25, RF26, RF32, RNF05, RNF08). Decisões de 06/11/2026
-- (plano da Etapa 9).
--
-- O corretor envia o PDF do contrato assinado a partir de uma proposta dele já aceita.
-- O admin confere: ao aprovar, o imóvel vira vendido e, na mesma operação, as outras
-- propostas em aberto são recusadas e as visitas são canceladas. Ao recusar, escreve o
-- motivo, e o corretor pode reenviar. Cada envio é uma linha nova: reenviar não apaga o
-- contrato recusado, e o contrato registrado não é trocado nem apagado.
--
-- Quem escreve: ninguém grava direto nas tabelas, só pelas funções abaixo.
-- Quem lê contratos: o admin; quem enviou, com acesso; o dono do imóvel (RNF08). O
-- responsável da imobiliária não lê o contrato do corretor dele.
-- Quem lê vendas: só o admin. A tabela é separada de contratos porque RLS não esconde
-- coluna: quem lê contratos leria a comissão. O proprietário recebe o valor final e a
-- data da venda por resumo_de_propostas(), sem a comissão.
--
-- A proposta vencedora continua 'aceita': é o contrato aprovado que diz quem vendeu.
--
-- Ordem das travas, a mesma em todas as funções, para não haver deadlock:
--   imóvel -> perfil -> contrato -> visitas -> propostas
-- A proposta vencedora é travada junto com as outras, depois das visitas. Travá-la
-- antes daria deadlock com remover_corretor() do mesmo corretor, que pega as visitas
-- dele e depois as propostas dele. Nas atualizações de várias linhas, a trava vem antes,
-- em ordem de id, porque um update não garante em que ordem pega as linhas.
--
-- enviar_contrato() e recusar_contrato() travam o perfil do corretor com "for share"
-- para disputar com remover_corretor(), que começa atualizando esse perfil. Sem isso, o
-- corretor removido poderia ficar com uma proposta aceita que ninguém mais encerra.
--
-- Erros que o app reconhece pelo hint: arquivo_invalido, comissao_invalida,
-- contrato_em_analise, contrato_ja_conferido, contrato_nao_encontrado,
-- imovel_fora_do_catalogo, motivo_invalido, proposta_encerrada, proposta_nao_aceita,
-- proposta_nao_encontrada, valor_invalido e venda_nao_encontrada.

-- ---------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------

create type public.status_contrato as enum (
  'em_analise',
  'aprovado',
  'recusado'
);

create table public.contratos (
  id             uuid primary key default gen_random_uuid(),
  -- restrict: a venda não some ao apagar uma conta ou um imóvel. A exclusão de dados
  -- (LGPD) é da Etapa 13. Quem limpa dados de teste apaga vendas e contratos antes.
  proposta_id    uuid not null references public.propostas (id) on delete restrict,
  imovel_id      uuid not null references public.imoveis (id) on delete restrict,
  enviado_por    uuid not null references public.perfis (id) on delete restrict,
  caminho        text not null unique,
  nome_arquivo   text not null,
  -- Lido do Storage por enviar_contrato(), nunca informado pelo navegador.
  tamanho_bytes  bigint not null,
  status         public.status_contrato not null default 'em_analise',
  motivo_recusa  text,
  enviado_em     timestamptz not null default now(),
  respondido_em  timestamptz,
  respondido_por uuid references public.perfis (id) on delete set null,

  constraint contratos_nome_tamanho check (char_length(nome_arquivo) between 1 and 200),
  constraint contratos_arquivo_tamanho check (tamanho_bytes between 1 and 20971520),
  -- Recusado sempre tem motivo com caractere visível; os outros, nunca.
  constraint contratos_motivo_coerente check (
    case when status = 'recusado'
         then motivo_recusa is not null and motivo_recusa ~ '\S' and char_length(motivo_recusa) <= 1000
         else motivo_recusa is null
    end
  ),
  constraint contratos_resposta_coerente check ((status = 'em_analise') = (respondido_em is null))
);

comment on table public.contratos is
  'Contratos assinados enviados pelos corretores. Escrita só pelas funções enviar_contrato, aprovar_contrato e recusar_contrato.';

-- Um contrato em conferência por proposta.
create unique index contratos_um_em_analise_por_proposta
  on public.contratos (proposta_id)
  where status = 'em_analise';

-- A última garantia contra vender o mesmo imóvel duas vezes.
create unique index contratos_um_aprovado_por_imovel
  on public.contratos (imovel_id)
  where status = 'aprovado';

create index contratos_fila_idx on public.contratos (enviado_em) where status = 'em_analise';
create index contratos_imovel_idx on public.contratos (imovel_id, enviado_em desc);
create index contratos_proposta_idx on public.contratos (proposta_id, enviado_em desc);
create index contratos_enviado_por_idx on public.contratos (enviado_por);

alter table public.contratos enable row level security;

revoke all on table public.contratos from anon, authenticated;
grant select on table public.contratos to authenticated;

create policy "contratos: admin, quem enviou com acesso e o dono do imovel leem"
  on public.contratos
  for select
  to authenticated
  using (
    (select public.eh_admin())
    or (enviado_por = (select auth.uid()) and (select public.eh_assinante_ativo()))
    or imovel_id in (select i.id from public.imoveis i where i.proprietario_id = (select auth.uid()))
  );

create table public.vendas (
  id                   uuid primary key default gen_random_uuid(),
  imovel_id            uuid not null unique references public.imoveis (id) on delete restrict,
  contrato_id          uuid not null unique references public.contratos (id) on delete restrict,
  -- Vale o valor do contrato; a proposta fica guardada como estava.
  valor_final          numeric(14, 2) not null,
  -- O valor em R$ que consta no contrato (RF32). A % não é calculada pelo app.
  comissao_valor       numeric(14, 2) not null,
  comissao_paga_em     timestamptz,
  comissao_marcada_por uuid references public.perfis (id) on delete set null,
  registrada_em        timestamptz not null default now(),
  registrada_por       uuid references public.perfis (id) on delete set null,

  -- 'NaN' é aceito por uma coluna numeric e passa em "valor > 0".
  constraint vendas_valor_positivo check (valor_final > 0 and valor_final <> 'NaN'),
  constraint vendas_comissao_valida check (
    comissao_valor > 0 and comissao_valor <> 'NaN' and comissao_valor <= valor_final
  )
);

comment on table public.vendas is
  'Venda e comissão do PAUTA (RF32). Só o admin lê. Escrita só por aprovar_contrato e definir_comissao_paga.';

create index vendas_comissao_a_receber_idx on public.vendas (registrada_em desc)
  where comissao_paga_em is null;

alter table public.vendas enable row level security;

revoke all on table public.vendas from anon, authenticated;
grant select on table public.vendas to authenticated;

create policy "vendas: so o admin le"
  on public.vendas
  for select
  to authenticated
  using ((select public.eh_admin()));

-- ---------------------------------------------------------------
-- 2. Bucket dos PDFs
-- ---------------------------------------------------------------

-- Privado, até 20 MB e só PDF. O arquivo fica em {proposta_id}/{uuid}.pdf, com o nome
-- escolhido pelo servidor. Sem regra de update: ninguém troca um arquivo. O bucket só
-- olha o tipo declarado: a action do envio confere os primeiros bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 20971520, array['application/pdf']);

-- As regras do Storage rodam com o papel de quem chama, que não lê imóveis nem propostas
-- de outra pessoa. Estas funções só respondem sim ou não.
create function public.pode_enviar_contrato(p_nome text)
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
  );
$$;

create function public.pode_ler_contrato(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contratos c
    join public.imoveis i on i.id = c.imovel_id
    where c.caminho = p_nome
      and ((select public.eh_admin())
           or (c.enviado_por = (select auth.uid()) and (select public.eh_assinante_ativo()))
           or i.proprietario_id = (select auth.uid()))
  );
$$;

create function public.arquivo_sem_contrato(p_nome text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.contratos c where c.caminho = p_nome);
$$;

revoke execute on function public.pode_enviar_contrato(text) from public, anon;
revoke execute on function public.pode_ler_contrato(text) from public, anon;
revoke execute on function public.arquivo_sem_contrato(text) from public, anon;
grant execute on function public.pode_enviar_contrato(text) to authenticated;
grant execute on function public.pode_ler_contrato(text) to authenticated;
grant execute on function public.arquivo_sem_contrato(text) to authenticated;

create policy "contratos: corretor com proposta aceita envia"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contratos'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
    and owner_id = (select auth.uid())::text
    and public.pode_enviar_contrato(name)
  );

create policy "contratos: quem pode ver o contrato le o arquivo"
  on storage.objects for select to authenticated
  using (bucket_id = 'contratos' and public.pode_ler_contrato(name));

-- Entre o envio e o registro em enviar_contrato(), o arquivo é só de quem enviou: o
-- servidor confere os primeiros bytes e apaga o que não for PDF. O Storage lê o arquivo
-- antes de apagar (o delete usa returning), por isso as duas regras.
create policy "contratos: quem enviou le o arquivo ainda sem registro"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'contratos'
    and owner_id = (select auth.uid())::text
    and public.arquivo_sem_contrato(name)
  );

create policy "contratos: quem enviou apaga o arquivo ainda sem registro"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'contratos'
    and owner_id = (select auth.uid())::text
    and public.arquivo_sem_contrato(name)
  );

-- ---------------------------------------------------------------
-- 3. Enviar
-- ---------------------------------------------------------------

-- O corretor com acesso envia a partir da própria proposta aceita, com o imóvel no
-- catálogo. O arquivo já precisa estar no bucket, enviado por ele, na pasta da proposta.
-- Serve também para reenviar depois de uma recusa.
create function public.enviar_contrato(p_proposta uuid, p_caminho text, p_nome text)
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
  select (o.metadata ->> 'size')::bigint into v_tamanho
  from storage.objects o
  where o.bucket_id = 'contratos'
    and o.name = p_caminho
    and p_caminho ~ ('^' || p_proposta::text || '/[0-9a-f-]{36}\.pdf$')
    and o.owner_id = v_eu::text;

  if v_tamanho is null or v_tamanho not between 1 and 20971520 then
    raise exception 'Arquivo do contrato inválido' using errcode = 'P0001', hint = 'arquivo_invalido';
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

-- ---------------------------------------------------------------
-- 4. Conferir
-- ---------------------------------------------------------------

-- A operação atômica do RNF05: ou tudo vale, ou nada muda. Com a vencedora "aceita" e o
-- contrato em análise, o imóvel vira vendido, as outras propostas em aberto são recusadas,
-- outro contrato em análise é recusado com motivo automático e as visitas pendentes de
-- qualquer data e as confirmadas futuras são canceladas. A confirmada que já passou fica
-- como está: a visita aconteceu. Vale também com o corretor bloqueado ou vencido.
create function public.aprovar_contrato(
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

-- O motivo é obrigatório. A proposta continua aceita e o corretor pode reenviar, exceto
-- se ele foi removido: como não pode mais reenviar, a proposta é cancelada junto.
create function public.recusar_contrato(p_contrato uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu       uuid := (select auth.uid());
  v_imovel   uuid;
  v_proposta uuid;
  v_corretor uuid;
  v_status   public.status_contrato;
  v_removido timestamptz;
  v_motivo   text := btrim(coalesce(p_motivo, ''), E' \t\r\n');
begin
  if not (select public.eh_admin()) then
    raise exception 'Só o admin recusa contrato' using errcode = '42501';
  end if;

  select c.imovel_id, c.proposta_id, c.enviado_por into v_imovel, v_proposta, v_corretor
  from public.contratos c
  where c.id = p_contrato;
  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0001', hint = 'contrato_nao_encontrado';
  end if;

  perform 1 from public.imoveis i where i.id = v_imovel for share;

  -- Disputa com remover_corretor: ver o cabeçalho desta migration.
  select p.removido_em into v_removido
  from public.perfis p
  where p.id = v_corretor
  for share;

  select c.status into v_status
  from public.contratos c
  where c.id = p_contrato
  for update;

  if v_status <> 'em_analise' then
    raise exception 'Este contrato já foi conferido' using errcode = 'P0001', hint = 'contrato_ja_conferido';
  end if;

  if char_length(v_motivo) not between 1 and 1000 then
    raise exception 'Escreva o motivo, com até 1.000 caracteres' using errcode = 'P0001', hint = 'motivo_invalido';
  end if;

  update public.contratos c
  set status = 'recusado', motivo_recusa = v_motivo, respondido_em = now(), respondido_por = v_eu
  where c.id = p_contrato;

  if v_removido is not null then
    update public.propostas p
    set status = 'cancelada', cancelada_em = now(), cancelada_por = v_eu
    where p.id = v_proposta and p.status = 'aceita';
  end if;
end;
$$;

-- Marcar errado tem volta: a comissão é paga fora do app.
create function public.definir_comissao_paga(p_venda uuid, p_paga boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu uuid := (select auth.uid());
begin
  if not (select public.eh_admin()) then
    raise exception 'Só o admin marca a comissão' using errcode = '42501';
  end if;

  update public.vendas v
  set comissao_paga_em = case when p_paga then coalesce(v.comissao_paga_em, now()) end,
      comissao_marcada_por = case when p_paga then v_eu end
  where v.id = p_venda;

  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0001', hint = 'venda_nao_encontrada';
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- 5. Proposta com contrato em análise
-- ---------------------------------------------------------------

-- Só o contrato em análise trava: depois de recusado, desfazer e retirar voltam a valer,
-- para um corretor que some não deixar o imóvel preso em negociação.
create or replace function public.desfazer_aceite(p_proposta uuid)
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

  if exists (select 1 from public.contratos c where c.proposta_id = p_proposta and c.status = 'em_analise') then
    raise exception 'Há um contrato em análise nesta proposta' using errcode = 'P0001', hint = 'contrato_em_analise';
  end if;

  update public.propostas
  set status = 'aguardando', respondida_em = null
  where id = p_proposta;
end;
$$;

create or replace function public.cancelar_proposta(p_proposta uuid)
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

  if exists (select 1 from public.contratos c where c.proposta_id = p_proposta and c.status = 'em_analise') then
    raise exception 'Há um contrato em análise nesta proposta' using errcode = 'P0001', hint = 'contrato_em_analise';
  end if;

  update public.propostas
  set status = 'cancelada', cancelada_em = now(), cancelada_por = v_eu
  where id = p_proposta;
end;
$$;

-- A proposta com contrato em análise fica, porque o contrato assinado é uma venda real,
-- e o admin decide (recusar_contrato() a cancela). A da venda também fica. O caso
-- 'expirado' segue cancelando: a Etapa 12 confirma.
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

  perform 1 from public.visitas v
  where v.corretor_id = p_corretor
    and v.status in ('pendente', 'confirmada')
    and v.horario > now()
  order by v.id
  for update;

  update public.visitas
  set status = 'cancelada', cancelada_em = now(), cancelada_por = (select auth.uid())
  where corretor_id = p_corretor
    and status in ('pendente', 'confirmada')
    and horario > now();

  perform 1 from public.propostas p
  where p.corretor_id = p_corretor
    and p.status in ('aguardando', 'aceita')
  order by p.id
  for update;

  update public.propostas p
  set status = 'cancelada', cancelada_em = now(), cancelada_por = (select auth.uid())
  where p.corretor_id = p_corretor
    and p.status in ('aguardando', 'aceita')
    and not exists (select 1 from public.contratos c
                    where c.proposta_id = p.id and c.status in ('em_analise', 'aprovado'));
end;
$$;

-- ---------------------------------------------------------------
-- 6. Leituras
-- ---------------------------------------------------------------

-- Mudar as colunas de uma função exige apagá-la, recriá-la e refazer as permissões.
drop function public.minhas_propostas(uuid);
drop function public.propostas_recebidas(uuid);
drop function public.resumo_de_propostas(uuid);

-- Ganha o contrato mais recente da proposta. Nada do proprietário vem por aqui.
create function public.minhas_propostas(p_imovel uuid default null)
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
    order by x.enviado_em desc, x.id
    limit 1
  ) c on true
  where p.corretor_id = (select auth.uid())
    and (select public.eh_assinante_ativo())
    and (p_imovel is null or p.imovel_id = p_imovel)
  order by p.criada_em desc, p.id
  limit 200;
$$;

-- Ganha o contrato mais recente da proposta, para o "Ver contrato" do proprietário.
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
    order by x.enviado_em desc, x.id
    limit 1
  ) ct on true
  where i.proprietario_id = (select auth.uid())
    and (p_imovel is null or p.imovel_id = p_imovel)
  order by p.criada_em desc, p.id
  limit 500;
$$;

-- Ganha o "Contrato em análise" e a venda de Meus imóveis. Nunca a comissão.
create function public.resumo_de_propostas(p_imovel uuid default null)
returns table (
  imovel_id           uuid,
  em_negociacao       boolean,
  em_aberto           integer,
  contrato_corretor   text,
  contrato_enviado_em timestamptz,
  venda_valor         numeric,
  venda_em            timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         i.status = 'disponivel' and public.imovel_em_negociacao(i.id),
         (select count(*) from public.propostas p
          where p.imovel_id = i.id and p.status in ('aguardando', 'aceita'))::integer,
         ca.nome, ca.enviado_em,
         v.valor_final, v.registrada_em
  from public.imoveis i
  left join lateral (
    select pf.nome, c.enviado_em
    from public.contratos c
    join public.perfis pf on pf.id = c.enviado_por
    where c.imovel_id = i.id and c.status = 'em_analise'
    order by c.enviado_em, c.id
    limit 1
  ) ca on true
  left join public.vendas v on v.imovel_id = i.id
  where i.proprietario_id = (select auth.uid())
    and (p_imovel is null or i.id = p_imovel)
    and exists (select 1 from public.propostas p where p.imovel_id = i.id);
$$;

-- A fila do admin, ou um contrato só, com o que ele precisa para conferir. Sem p_contrato,
-- só os em análise, do mais antigo para o mais novo. corretor_com_acesso alerta a tela:
-- o contrato de bloqueado, vencido ou removido segue na fila.
create function public.contratos_para_conferir(p_contrato uuid default null)
returns table (
  id                  uuid,
  status              public.status_contrato,
  motivo_recusa       text,
  caminho             text,
  nome_arquivo        text,
  tamanho_bytes       bigint,
  enviado_em          timestamptz,
  imovel_id           uuid,
  imovel_titulo       text,
  proprietario_nome   text,
  proposta_id         uuid,
  proposta_valor      numeric,
  forma_pagamento     public.forma_pagamento,
  condicoes           text,
  nome_comprador      text,
  corretor_nome       text,
  imobiliaria         text,
  creci               text,
  corretor_com_acesso boolean,
  outras_em_aberto    jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.status, c.motivo_recusa, c.caminho, c.nome_arquivo, c.tamanho_bytes, c.enviado_em,
         i.id, i.titulo, dono.nome,
         p.id, p.valor, p.forma_pagamento, p.condicoes, p.nome_comprador,
         corretor.nome,
         case when a.tipo = 'imobiliaria' then a.nome end,
         a.creci,
         a.status = 'ativo' and not a.bloqueado_pelo_admin and corretor.removido_em is null,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'corretor', o_c.nome,
                    'imobiliaria', case when o_a.tipo = 'imobiliaria' then o_a.nome end,
                    'valor', o.valor,
                    'status', o.status) order by o.criada_em, o.id)
           from public.propostas o
           join public.perfis o_c on o_c.id = o.corretor_id
           join public.assinantes o_a on o_a.id = o_c.assinante_id
           where o.imovel_id = i.id and o.id <> p.id and o.status in ('aguardando', 'aceita')
         ), '[]'::jsonb)
  from public.contratos c
  join public.propostas p on p.id = c.proposta_id
  join public.imoveis i on i.id = c.imovel_id
  join public.perfis dono on dono.id = i.proprietario_id
  join public.perfis corretor on corretor.id = c.enviado_por
  join public.assinantes a on a.id = corretor.assinante_id
  where (select public.eh_admin())
    and (case when p_contrato is null then c.status = 'em_analise' else c.id = p_contrato end)
  order by c.enviado_em, c.id
  limit 200;
$$;

-- As vendas do painel do admin, com a comissão, da mais recente para a mais antiga.
create function public.vendas_registradas()
returns table (
  id               uuid,
  imovel_id        uuid,
  imovel_titulo    text,
  contrato_id      uuid,
  corretor_nome    text,
  imobiliaria      text,
  valor_final      numeric,
  comissao_valor   numeric,
  comissao_paga_em timestamptz,
  registrada_em    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, i.id, i.titulo, c.id, corretor.nome,
         case when a.tipo = 'imobiliaria' then a.nome end,
         v.valor_final, v.comissao_valor, v.comissao_paga_em, v.registrada_em
  from public.vendas v
  join public.imoveis i on i.id = v.imovel_id
  join public.contratos c on c.id = v.contrato_id
  join public.perfis corretor on corretor.id = c.enviado_por
  join public.assinantes a on a.id = corretor.assinante_id
  where (select public.eh_admin())
  order by v.registrada_em desc, v.id
  limit 200;
$$;

-- ---------------------------------------------------------------
-- 7. Permissões
-- ---------------------------------------------------------------

revoke execute on function public.enviar_contrato(uuid, text, text) from public, anon;
revoke execute on function public.aprovar_contrato(uuid, numeric, numeric, boolean) from public, anon;
revoke execute on function public.recusar_contrato(uuid, text) from public, anon;
revoke execute on function public.definir_comissao_paga(uuid, boolean) from public, anon;
revoke execute on function public.minhas_propostas(uuid) from public, anon;
revoke execute on function public.propostas_recebidas(uuid) from public, anon;
revoke execute on function public.resumo_de_propostas(uuid) from public, anon;
revoke execute on function public.contratos_para_conferir(uuid) from public, anon;
revoke execute on function public.vendas_registradas() from public, anon;

grant execute on function public.enviar_contrato(uuid, text, text) to authenticated;
grant execute on function public.aprovar_contrato(uuid, numeric, numeric, boolean) to authenticated;
grant execute on function public.recusar_contrato(uuid, text) to authenticated;
grant execute on function public.definir_comissao_paga(uuid, boolean) to authenticated;
grant execute on function public.minhas_propostas(uuid) to authenticated;
grant execute on function public.propostas_recebidas(uuid) to authenticated;
grant execute on function public.resumo_de_propostas(uuid) to authenticated;
grant execute on function public.contratos_para_conferir(uuid) to authenticated;
grant execute on function public.vendas_registradas() to authenticated;

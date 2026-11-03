-- Etapa 6, passo 6.2: catálogo do assinante (RF18, RF19, RF20, RNF06).
-- Decisões de 03/11/2026 (plano da Etapa 6), na Visão geral.
--
-- Por que funções e não a tabela: o RLS escolhe LINHAS, não colunas. Com a regra
-- "assinante ativo lê os disponíveis", o corretor lia pela API todas as colunas do
-- imóvel, inclusive proprietario_id, exclusividade_fim, termo_versao,
-- captado_pelo_admin e versao (pendência da auditoria da Etapa 2). Agora:
-- - o assinante não lê mais a tabela imoveis direto;
-- - o catálogo vem de catalogo() e o detalhe de imovel_do_catalogo(), que devolvem
--   só as colunas do corretor;
-- - as fotos continuam visíveis para ele por imovel_no_catalogo(), usada nas regras
--   de fotos_imovel e do Storage.
-- O contato do proprietário continua saindo só por contato_do_proprietario().

-- ---------------------------------------------------------------
-- 1. Status que o corretor vê (RF20)
-- ---------------------------------------------------------------
-- O ÚNICO lugar que decide entre "disponível" e "em negociação". Hoje lê a coluna
-- tem_proposta_aceita, que ninguém liga ainda; na Etapa 8 basta trocar esta função.
-- Uso interno (chamada pelas funções do catálogo): ninguém chama pela API.
create function public.status_no_catalogo(p_imovel public.imoveis)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_imovel.tem_proposta_aceita then 'em_negociacao' else 'disponivel' end;
$$;

revoke execute on function public.status_no_catalogo(public.imoveis) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 2. O imóvel está no catálogo para quem pergunta?
-- ---------------------------------------------------------------
-- Sim se quem pergunta é assinante ativo e o imóvel está disponível (vendido,
-- captado aguardando o aceite, pendente, reprovado, rascunho e expirado não estão).
-- security definer: lê o imóvel sem passar pelo RLS, mas devolve só sim ou não.
create function public.imovel_no_catalogo(p_imovel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.eh_assinante_ativo()
     and exists (select 1 from public.imoveis i where i.id = p_imovel and i.status = 'disponivel');
$$;

revoke execute on function public.imovel_no_catalogo(uuid) from public, anon;
grant execute on function public.imovel_no_catalogo(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 3. Lista do catálogo, com os filtros (RF19)
-- ---------------------------------------------------------------
-- Filtros (null = sem filtro): tipo, bairros (vários), preço mínimo e máximo,
-- quartos mínimos (imóvel sem quartos sai quando escolhido) e status
-- ('disponivel' ou 'em_negociacao'). Página de p_limite imóveis (até 48), pulando
-- p_deslocamento. "total" é o número de imóveis com esses filtros, em todas as
-- páginas. Ordem fixa: o que entrou no catálogo mais recentemente primeiro.
-- capa = caminho da foto 1 (o app troca pela miniatura).
-- Quem não é assinante ativo recebe a lista vazia.
create function public.catalogo(
  p_tipo         bigint   default null,
  p_bairros      bigint[] default null,
  p_preco_min    numeric  default null,
  p_preco_max    numeric  default null,
  p_quartos_min  integer  default null,
  p_status       text     default null,
  p_limite       integer  default 12,
  p_deslocamento integer  default 0
)
returns table (
  id          uuid,
  titulo      text,
  tipo        text,
  bairro      text,
  preco       numeric,
  quartos     smallint,
  banheiros   smallint,
  vagas       smallint,
  area        numeric,
  status      text,
  capa        text,
  total_fotos integer,
  total       bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with no_catalogo as (
    select i.id, i.titulo, i.tipo_id, i.bairro_id, i.preco, i.quartos, i.banheiros,
           i.vagas, i.area, i.exclusividade_inicio,
           public.status_no_catalogo(i) as status
    from public.imoveis i
    where public.eh_assinante_ativo()
      and i.status = 'disponivel'
      and (p_tipo is null or i.tipo_id = p_tipo)
      and (p_bairros is null or cardinality(p_bairros) = 0 or i.bairro_id = any (p_bairros))
      and (p_preco_min is null or i.preco >= p_preco_min)
      and (p_preco_max is null or i.preco <= p_preco_max)
      and (p_quartos_min is null or i.quartos >= p_quartos_min)
  )
  select c.id, c.titulo, t.nome, b.nome, c.preco, c.quartos, c.banheiros, c.vagas, c.area,
         c.status,
         (select f.caminho from public.fotos_imovel f
          where f.imovel_id = c.id order by f.ordem limit 1),
         (select count(*) from public.fotos_imovel f where f.imovel_id = c.id)::integer,
         count(*) over ()
  from no_catalogo c
  join public.tipos_imovel t on t.id = c.tipo_id
  join public.bairros b on b.id = c.bairro_id
  where p_status is null or c.status = p_status
  order by c.exclusividade_inicio desc nulls last, c.id
  limit least(greatest(coalesce(p_limite, 12), 1), 48)
  offset greatest(coalesce(p_deslocamento, 0), 0);
$$;

revoke execute on function public.catalogo(bigint, bigint[], numeric, numeric, integer, text, integer, integer)
  from public, anon;
grant execute on function public.catalogo(bigint, bigint[], numeric, numeric, integer, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------
-- 4. Detalhe do imóvel no catálogo
-- ---------------------------------------------------------------
-- As mesmas colunas da lista, mais descrição e endereço (visível a qualquer
-- assinante ativo, decisão tomada). Sem linha quando o imóvel não está no catálogo
-- ou quem pergunta não é assinante ativo.
create function public.imovel_do_catalogo(p_imovel uuid)
returns table (
  id        uuid,
  titulo    text,
  descricao text,
  tipo      text,
  bairro    text,
  endereco  text,
  preco     numeric,
  quartos   smallint,
  banheiros smallint,
  vagas     smallint,
  area      numeric,
  status    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.titulo, i.descricao, t.nome, b.nome, i.endereco, i.preco, i.quartos,
         i.banheiros, i.vagas, i.area, public.status_no_catalogo(i)
  from public.imoveis i
  join public.tipos_imovel t on t.id = i.tipo_id
  join public.bairros b on b.id = i.bairro_id
  where i.id = p_imovel
    and i.status = 'disponivel'
    and public.eh_assinante_ativo();
$$;

revoke execute on function public.imovel_do_catalogo(uuid) from public, anon;
grant execute on function public.imovel_do_catalogo(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 5. O assinante deixa de ler a tabela imoveis direto
-- ---------------------------------------------------------------
drop policy "imoveis: assinante ativo le os disponiveis" on public.imoveis;

-- ---------------------------------------------------------------
-- 6. Fotos: o assinante continua vendo as do imóvel do catálogo
-- ---------------------------------------------------------------
-- Antes, "quem vê o imóvel" incluía o assinante pela regra apagada acima. Agora:
-- quem vê o imóvel pela tabela (dono e admin) ou, no catálogo, o assinante ativo.
drop policy "fotos_imovel: le quem ve o imovel" on public.fotos_imovel;

create policy "fotos_imovel: le quem ve o imovel"
  on public.fotos_imovel for select to authenticated
  using (
    exists (select 1 from public.imoveis i where i.id = imovel_id)
    or public.imovel_no_catalogo(imovel_id)
  );

-- No Storage, a pasta é o id do imóvel. O case garante que só um nome de pasta com
-- cara de uuid chega à conversão (um nome qualquer daria erro em vez de "não").
drop policy "fotos-imoveis: le quem ve o imovel" on storage.objects;

create policy "fotos-imoveis: le quem ve o imovel"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fotos-imoveis'
    and (
      exists (select 1 from public.imoveis i where i.id::text = (storage.foldername(name))[1])
      or case
           when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then public.imovel_no_catalogo(((storage.foldername(name))[1])::uuid)
           else false
         end
    )
  );

-- ---------------------------------------------------------------
-- 7. Índice do catálogo (RNF14)
-- ---------------------------------------------------------------
-- Só os imóveis disponíveis, já na ordem da lista.
create index imoveis_catalogo_idx on public.imoveis (exclusividade_inicio desc)
  where status = 'disponivel';

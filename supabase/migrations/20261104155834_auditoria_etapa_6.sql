-- Auditoria da Etapa 6: desempenho do catálogo (RNF14). Nada muda no que o assinante
-- vê: mesmas colunas, mesma ordem, mesmas regras e mesmas permissões (create or
-- replace mantém os grants da migration 20261103144204_catalogo).
--
-- - eh_assinante_ativo() entre parênteses com select roda uma vez por consulta, e
--   não uma vez por imóvel, como no resto do projeto
-- - "nulls last" saiu da ordem: imóvel disponível sempre tem exclusividade_inicio
--   (regra da tabela), e sem ele a ordem é igual à do índice
-- - o índice agora tem a mesma ordem da lista, com o id do desempate

create or replace function public.catalogo(
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
    where (select public.eh_assinante_ativo())
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
  order by c.exclusividade_inicio desc, c.id
  limit least(greatest(coalesce(p_limite, 12), 1), 48)
  offset greatest(coalesce(p_deslocamento, 0), 0);
$$;

drop index public.imoveis_catalogo_idx;
create index imoveis_catalogo_idx on public.imoveis (exclusividade_inicio desc, id)
  where status = 'disponivel';

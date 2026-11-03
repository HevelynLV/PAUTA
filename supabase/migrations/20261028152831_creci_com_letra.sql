-- Etapa 5, passo 5.2: CRECI com a letra obrigatória.
--
-- Decisão de 28/10/2026 (plano da Etapa 5, docs/visao-geral.md): o CRECI vem
-- sempre com a letra, J (empresa) ou F (pessoa física). Sem a letra, "12345" e
-- "12345-J" entravam como dois CRECIs diferentes.
-- - Imobiliária só com J. Corretor autônomo com J ou F (o autônomo que abriu
--   empresa tem CRECI J). O corretor convidado não tem CRECI: vale o da imobiliária.
-- - A regra fica no CRECI normalizado ("12.345-j SC" vira "12345J"), então pontos,
--   traços, espaços e "CRECI/SC" continuam não contando.
--
-- Antes de aplicar: as regras novas conferem as linhas que já existem. Se houver
-- assinante sem letra, a migration inteira falha e nada muda. Conferido em
-- 28/10/2026 (ROADMAP, "Onde paramos"): nenhum.

-- ---------------------------------------------------------------
-- 1. Regras na tabela
-- ---------------------------------------------------------------
-- Um check, e não o gatilho de cadastro: vale também para qualquer outro caminho
-- que grave o CRECI (o webhook da Etapa 11, um ajuste feito pelo painel).

alter table public.assinantes
  add constraint assinantes_creci_com_letra
    check (creci_normalizado ~ '^[0-9]+[JF]$'),
  add constraint assinantes_imobiliaria_creci_j
    check (tipo <> 'imobiliaria' or creci_normalizado ~ 'J$');

comment on column public.assinantes.creci is
  'O CRECI como foi digitado, com a letra J (empresa) ou F (pessoa física). Imobiliária só com J.';

-- ---------------------------------------------------------------
-- 2. Pergunta do cadastro
-- ---------------------------------------------------------------
-- CRECI sem a letra não está "disponível": a tela recusa antes de perguntar, e
-- esta resposta impede que alguém use a pergunta para sondar números sem letra.
-- O tipo (J só para imobiliária) é conferido pela tela e pelo check acima.

create or replace function public.creci_disponivel(p_creci text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalizar_creci(p_creci) ~ '^[0-9]+[JF]$'
     and not exists (
       select 1 from public.assinantes a
       where a.creci_normalizado = public.normalizar_creci(p_creci)
     );
$$;

-- create or replace mantém as permissões da função (anon e authenticated).

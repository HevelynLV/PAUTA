-- Etapa 5: revisão do Pull Request (29/10/2026). Convites e remoção de corretor
-- só para o responsável de imobiliária com acesso.
--
-- A auditoria da Etapa 5 (migration 20261028224919_auditoria_etapa_5) passou a
-- exigir acesso (eh_assinante_ativo) para o responsável ler a equipe, e o
-- criar_convite() já exigia. Faltavam:
-- - ler e cancelar convites (políticas da migration 20261022171933): o responsável
--   de imobiliária bloqueada ou vencida lia os convites, com os e-mails, e
--   cancelava convites pela API
-- - remover_corretor(): a imobiliária bloqueada ou vencida removia corretores
--   chamando a função direto (a remoção não pode ser desfeita)
-- O admin continua lendo todos os convites.

-- ---------------------------------------------------------------
-- 1. Convites
-- ---------------------------------------------------------------

drop policy "convites: responsavel ou admin le" on public.convites;
create policy "convites: responsavel ou admin le"
  on public.convites
  for select
  to authenticated
  using (
    (select public.eh_admin())
    or ((select public.meu_tipo()) = 'imobiliaria'
        and (select public.eh_assinante_ativo())
        and assinante_id = (select public.meu_assinante_id()))
  );
drop policy "convites: responsavel cancela convite nao usado" on public.convites;
create policy "convites: responsavel cancela convite nao usado"
  on public.convites
  for delete
  to authenticated
  using (
    (select public.meu_tipo()) = 'imobiliaria'
    and (select public.eh_assinante_ativo())
    and assinante_id = (select public.meu_assinante_id())
    and usado_em is null
  );
-- ---------------------------------------------------------------
-- 2. Remover corretor
-- ---------------------------------------------------------------
-- Igual à função da migration 20261028162403_convites_e_equipe, com o acesso
-- conferido junto com o tipo (o mesmo erro do criar_convite()).

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
end;
$$;
-- create or replace mantém as permissões da função (só authenticated).

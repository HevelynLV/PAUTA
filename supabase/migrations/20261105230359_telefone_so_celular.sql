-- Telefone só de celular (decisão de 05/11/2026): os avisos vão por WhatsApp, então
-- o número precisa ser DDD + 9 + 8 dígitos. A regra antiga aceitava também telefone
-- fixo (DDD + 8 dígitos) e qualquer número de 9 dígitos que não começasse com 9.
--
-- Esta migration falha se ainda houver conta com telefone fora do padrão: corrija
-- essas contas antes de aplicar. Para conferir:
--   select id from public.perfis where telefone !~ '^[1-9]{2}9[0-9]{8}$';

alter table public.perfis drop constraint perfis_telefone_formato;

alter table public.perfis
  add constraint perfis_telefone_celular check (telefone ~ '^[1-9]{2}9[0-9]{8}$');

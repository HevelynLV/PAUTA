-- Etapa 11, passo 11.2a: os dois avisos novos da mensalidade (decisão de 19/11/2026).
--
-- Numa migration à parte, aplicada antes da 20261119130626_cobranca: o Postgres não deixa
-- usar um valor novo de enum na mesma transação em que ele foi criado, e a cobranca é
-- ensaiada com o testar_rls.sql inteiro numa transação desfeita.
alter type public.tipo_aviso add value if not exists 'mensalidade_paga';
alter type public.tipo_aviso add value if not exists 'mensalidade_vencida';

-- Roteiro de teste do RLS do PAUTA
--
-- Como rodar (escolha um):
--   - Terminal: npx supabase db query --linked -f supabase/testes/testar_rls.sql
--   - Painel do Supabase: cole o arquivo inteiro no SQL Editor e clique em Run
-- O resultado é uma tabela: toda linha deve mostrar "✅ passou".
--
-- Regras do roteiro (valem para todas as migrations):
--   - Cada teste é um bloco independente: cria os próprios dados, testa e, no
--     fim, desfaz tudo (o bloco termina com o erro de propósito TR001, que o
--     banco desfaz). Nada fica no banco e um teste não depende do outro.
--   - Os resultados ficam numa tabela temporária, que some quando a conexão
--     fecha. Nenhum schema ou função de teste fica no banco.
--   - Testa também o que deve ser BARRADO, conferindo o código do erro:
--       42501 = RLS ou falta de permissão · P0001 = regra do banco (raise)
--       23514 = regra de formato (check)  · 23505 = valor repetido (unique)
--     Qualquer outro erro aparece como "erro inesperado" e o teste falha.
--   - Usuários de teste usam e-mails @exemplo.com.

-- ---------------------------------------------------------------
-- 0. Preparação (tudo temporário, em pg_temp)
-- ---------------------------------------------------------------
drop table if exists pg_temp.resultado;
create temp table resultado (
  ordem    serial,
  teste    text,
  esperado text,
  obtido   text
);

-- Traduz o código do erro no texto que os testes esperam.
create or replace function pg_temp.bloqueio(p_estado text, p_msg text)
returns text
language sql
as $$
  select case
    when p_estado in ('42501', 'P0001', '23514', '23505') then 'bloqueado (' || p_estado || ')'
    else 'erro inesperado: ' || p_estado || ' ' || p_msg
  end;
$$;

-- Cria uma conta de teste como o Supabase Auth faria. O gatilho do banco
-- cria o perfil a partir de p_dados (tipo, nome, telefone).
create or replace function pg_temp.criar_conta(p_id uuid, p_dados jsonb)
returns void
language sql
as $$
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          'teste-' || p_id || '@exemplo.com', p_dados);
$$;

-- Cria uma conta de proprietário válida.
create or replace function pg_temp.criar_proprietario(p_id uuid)
returns void
language sql
as $$
  select pg_temp.criar_conta(p_id,
    '{"tipo":"proprietario","nome":"Proprietário de Teste","telefone":"48999990000"}');
$$;

-- Passa a agir como o usuário p_id, logado (como o app faria).
create or replace function pg_temp.entrar_como(p_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- Passa a agir como um visitante sem login.
create or replace function pg_temp.entrar_como_visitante()
returns void
language sql
as $$
  select set_config('request.jwt.claims', '', true);
  select set_config('role', 'anon', true);
$$;

-- Cria uma imobiliária (conta do responsável + assinante pendente).
create or replace function pg_temp.criar_imobiliaria(p_id uuid, p_creci text)
returns void
language sql
as $$
  select pg_temp.criar_conta(p_id, json_build_object(
    'tipo', 'imobiliaria', 'nome', 'Responsável de Teste', 'telefone', '48999990000',
    'nome_imobiliaria', 'Imobiliária de Teste', 'creci', p_creci)::jsonb);
$$;

-- Cria um corretor autônomo (conta + assinante pendente).
create or replace function pg_temp.criar_autonomo(p_id uuid, p_creci text)
returns void
language sql
as $$
  select pg_temp.criar_conta(p_id, json_build_object(
    'tipo', 'autonomo', 'nome', 'Autônomo de Teste', 'telefone', '48999990000',
    'creci', p_creci)::jsonb);
$$;

-- Muda o status do assinante de um usuário, como o admin ou o webhook fariam.
-- 'bloqueado' não é um status (passo 2.7): vira status ativo com o bloqueio do admin
-- ligado, para o teste conferir o bloqueio e não um pendente.
create or replace function pg_temp.mudar_status_do_assinante_de(p_perfil uuid, p_status text)
returns void
language sql
as $$
  update public.assinantes
  set status = case when p_status = 'bloqueado' then 'ativo' else p_status end::public.status_assinatura,
      bloqueado_pelo_admin = (p_status = 'bloqueado')
  where id = (select assinante_id from public.perfis where id = p_perfil);
$$;

-- Cria um convite da imobiliária do responsável p_responsavel, com o código p_codigo.
create or replace function pg_temp.criar_convite(p_responsavel uuid, p_codigo text,
                                                 p_email text, p_expira_em timestamptz)
returns void
language sql
as $$
  insert into public.convites (assinante_id, email, token_hash, criado_por, expira_em)
  select assinante_id, p_email, encode(sha256(convert_to(p_codigo, 'UTF8')), 'hex'),
         p_responsavel, p_expira_em
  from public.perfis where id = p_responsavel;
$$;

-- Cria um corretor pelo convite p_codigo.
create or replace function pg_temp.criar_corretor(p_id uuid, p_codigo text)
returns void
language sql
as $$
  select pg_temp.criar_conta(p_id, json_build_object(
    'tipo', 'corretor', 'nome', 'Corretor de Teste', 'telefone', '48999990000',
    'convite', p_codigo)::jsonb);
$$;

-- Lista de tipos e de bairros de teste (as listas reais ficam vazias até a Etapa 4).
create or replace function pg_temp.tipo_teste()
returns bigint
language sql
as $$
  insert into public.tipos_imovel (nome) values ('Tipo de Teste (roteiro)') on conflict (nome) do nothing;
  select id from public.tipos_imovel where nome = 'Tipo de Teste (roteiro)';
$$;

create or replace function pg_temp.bairro_teste()
returns bigint
language sql
as $$
  insert into public.bairros (nome) values ('Bairro de Teste (roteiro)') on conflict (nome) do nothing;
  select id from public.bairros where nome = 'Bairro de Teste (roteiro)';
$$;

-- Cria um imóvel do dono p_dono já no status p_status (como o banco ficaria
-- depois do cadastro e da aprovação). Devolve o id. Fora do rascunho, com o termo
-- vigente aceito (a versão provisória da Etapa 4).
create or replace function pg_temp.criar_imovel(p_dono uuid, p_status text, p_mostrar_contato boolean default false)
returns uuid
language sql
as $$
  insert into public.imoveis (proprietario_id, titulo, descricao, tipo_id, endereco, bairro_id,
                              preco, quartos, banheiros, vagas, area, mostrar_contato, status,
                              motivo_reprovacao, termo_versao, termo_aceito_em,
                              exclusividade_inicio, exclusividade_fim)
  values (p_dono, 'Imóvel de teste', 'Descrição', pg_temp.tipo_teste(), 'Rua de Teste, 100',
          pg_temp.bairro_teste(), 500000, 2, 1, 1, 70, p_mostrar_contato,
          p_status::public.status_imovel,
          case when p_status = 'reprovado' then 'Faltam fotos' end,
          case when p_status <> 'rascunho' then '2026-10-provisorio' end,
          case when p_status <> 'rascunho' then now() end,
          case when p_status not in ('rascunho', 'pendente', 'reprovado') then now() end,
          case when p_status not in ('rascunho', 'pendente', 'reprovado') then now() + interval '6 months' end)
  returning id;
$$;

-- Põe uma foto no imóvel p_imovel, na posição p_ordem, com o papel de quem está
-- agindo (dono, admin ou o próprio roteiro).
create or replace function pg_temp.criar_foto(p_imovel uuid, p_ordem int)
returns void
language sql
as $$
  insert into public.fotos_imovel (imovel_id, caminho, ordem)
  values (p_imovel, p_imovel || '/foto-' || p_ordem || '.jpg', p_ordem);
$$;

-- Corretor autônomo com a assinatura no status p_status.
create or replace function pg_temp.criar_assinante(p_id uuid, p_status text)
returns void
language plpgsql
as $$
begin
  -- CRECI só com números e a letra F (migration 20261028152831_creci_com_letra).
  perform pg_temp.criar_autonomo(p_id, '9' || right(p_id::text, 4) || '-F');
  if p_status <> 'pendente' then
    perform pg_temp.mudar_status_do_assinante_de(p_id, p_status);
  end if;
end;
$$;

-- Torna p_id admin (criado como proprietário e trocado à mão, como no criar_admin.sql).
create or replace function pg_temp.criar_admin(p_id uuid)
returns void
language sql
as $$
  select pg_temp.criar_proprietario(p_id);
  update public.perfis set tipo = 'admin' where id = p_id;
$$;

-- IDs fixos usados nos testes (cada teste desfaz o que cria, então podem repetir)
--   ...0001 usuário principal do teste · ...0002 outro usuário · ...0009 admin
--   ...0011 responsável da imobiliária A · ...0012 responsável da imobiliária B
--   ...0021 corretor da imobiliária A · ...0031 corretor autônomo

-- ---------------------------------------------------------------
-- 1. Perfis (migration 20261022171241_perfis)
-- ---------------------------------------------------------------

-- Cadastro ---------------------------------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    select tipo::text into v from public.perfis where id = '00000000-0000-4000-a000-000000000001';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro de proprietário cria o perfil', 'proprietario', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000001',
      '{"tipo":"proprietario","nome":"Proprietário de Teste","telefone":"0 (48) 99999-0001"}');
    select telefone into v from public.perfis where id = '00000000-0000-4000-a000-000000000001';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Telefone com 0 na frente e máscara é guardado só com números', '48999990001', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000001',
        '{"tipo":"admin","nome":"Quero Ser Admin","telefone":"48999990001"}');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro pedindo o tipo admin é barrado', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000001',
        '{"tipo":"corretor","nome":"Corretor Sem Convite","telefone":"48999990001"}');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro como corretor sem convite é barrado', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000001',
        '{"nome":"Sem Tipo","telefone":"48999990001"}');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro sem tipo é barrado', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000001',
        '{"tipo":"proprietario","nome":"Sem DDD","telefone":"99999-0001"}');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro com telefone sem DDD é barrado', 'bloqueado (23514)', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000001',
        '{"tipo":"proprietario","nome":"  ","telefone":"48999990001"}');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro com nome vazio é barrado', 'bloqueado (23514)', v);
end $$;

-- Leitura -----------------------------------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select count(*)::text into v from public.perfis;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário lê o próprio perfil', '1', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select count(*)::text into v from public.perfis
    where id = '00000000-0000-4000-a000-000000000002';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não lê o perfil (nem o telefone) de outro', '0', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.entrar_como_visitante();
      select count(*)::text into v from public.perfis;
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não lê perfis', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000009');
    -- O admin é criado à mão no banco (como o supabase/scripts/criar_admin.sql fará)
    update public.perfis set tipo = 'admin' where id = '00000000-0000-4000-a000-000000000009';
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    select count(*)::text into v from public.perfis
    where id in ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002');
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin lê o perfil dos outros', '2', v);
end $$;

-- Alteração --------------------------------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.perfis set nome = 'Nome Novo', telefone = '48988887777'
    where id = '00000000-0000-4000-a000-000000000001';
    select nome || ' / ' || telefone into v from public.perfis
    where id = '00000000-0000-4000-a000-000000000001';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário altera o próprio nome e telefone', 'Nome Novo / 48988887777', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      update public.perfis set tipo = 'admin' where id = '00000000-0000-4000-a000-000000000001';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não muda o próprio tipo para admin', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.perfis set nome = 'Invadido' where id = '00000000-0000-4000-a000-000000000002';
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não altera o perfil de outro (0 linhas alteradas)', '0', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      update public.perfis set telefone = '12345' where id = '00000000-0000-4000-a000-000000000001';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não troca o telefone por um inválido', 'bloqueado (23514)', v);
end $$;

-- Criar e apagar ----------------------------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.perfis (id, tipo, nome, telefone)
      values (gen_random_uuid(), 'admin', 'Admin Falso', '48999990001');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não cria perfil direto (nem como admin)', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      delete from public.perfis where id = '00000000-0000-4000-a000-000000000001';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não apaga o próprio perfil', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    delete from auth.users where id = '00000000-0000-4000-a000-000000000001';
    select count(*)::text into v from public.perfis where id = '00000000-0000-4000-a000-000000000001';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Apagar a conta de login apaga o perfil junto', '0', v);
end $$;

-- Funções auxiliares -----------------------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    v := public.meu_tipo()::text || ' / admin: ' || public.eh_admin()::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('meu_tipo() e eh_admin() de um proprietário', 'proprietario / admin: false', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000009');
    update public.perfis set tipo = 'admin' where id = '00000000-0000-4000-a000-000000000009';
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    v := public.eh_admin()::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('eh_admin() de um admin', 'true', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.entrar_como_visitante();
      v := public.eh_admin()::text;
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não chama eh_admin()', 'bloqueado (42501)', v);
end $$;

-- ---------------------------------------------------------------
-- 2. Assinantes e convites (migration 20261022171933_assinantes_e_convites)
-- ---------------------------------------------------------------

-- Cadastro ---------------------------------------------------------

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    set constraints all immediate;  -- confere as ligações agora, como no fim do cadastro
    select p.tipo || ' / ' || a.tipo || ' / ' || a.status into v
    from public.perfis p join public.assinantes a on a.id = p.assinante_id
    where p.id = '00000000-0000-4000-a000-000000000011' and a.responsavel_id = '00000000-0000-4000-a000-000000000011';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro de imobiliária cria o perfil e o assinante pendente', 'imobiliaria / imobiliaria / pendente', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', ' creci/sc 12345-j ');
    select a.creci into v from public.assinantes a where a.responsavel_id = '00000000-0000-4000-a000-000000000011';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI é guardado em maiúsculas e sem espaços', 'CRECI/SC12345-J', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '54321-F');
    set constraints all immediate;
    select p.tipo || ' / ' || a.tipo || ' / ' || a.status into v
    from public.perfis p join public.assinantes a on a.id = p.assinante_id
    where p.id = '00000000-0000-4000-a000-000000000031';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro de corretor autônomo cria o assinante pendente', 'autonomo / autonomo / pendente', v);
end $$;

do $$ declare v text; begin
  begin
    null;
    begin
      perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro de imobiliária sem CRECI é barrado', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    null;
    begin
      perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '  ');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro de autônomo sem CRECI é barrado', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    begin
      perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '12345-j');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI repetido é barrado (imobiliária e autônomo)', 'bloqueado (23505)', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    v := public.eh_assinante_ativo()::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante pendente não tem acesso liberado', 'false', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    v := public.eh_assinante_ativo()::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante ativado pelo admin tem acesso liberado', 'true', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    v := public.eh_assinante_ativo()::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não é assinante', 'false', v);
end $$;

-- Convites e corretores ---------------------------------------------

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    -- guarda a imobiliária A antes de entrar como corretor (ele não lê o perfil do responsável)
    perform set_config('teste.imobiliaria', (select assinante_id::text from public.perfis
                                             where id = '00000000-0000-4000-a000-000000000011'), true);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    select p.tipo || ' / '
           || case when p.assinante_id = current_setting('teste.imobiliaria')::uuid
                   then 'mesma imobiliária' else 'outra' end
           || ' / ativo: ' || public.eh_assinante_ativo()::text
      into v
    from public.perfis p where p.id = '00000000-0000-4000-a000-000000000021';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor com convite válido entra vinculado e ativo', 'corretor / mesma imobiliária / ativo: true', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    select case when usado_em is not null and usado_por = '00000000-0000-4000-a000-000000000021'
                then 'usado por quem se cadastrou' else 'não marcado' end
      into v from public.convites;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Convite usado fica marcado com quem usou', 'usado por quem se cadastrou', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    begin
      perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000022', 'codigo-de-teste');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Convite já usado não serve de novo', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() - interval '1 minute');
    begin
      perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Convite vencido não serve', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    begin
      perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-errado');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Convite com código errado não serve', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', 'outra.pessoa@exemplo.com', now() + interval '1 day');
    begin
      perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Convite para outro e-mail não serve', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'bloqueado');
    begin
      perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Convite de imobiliária bloqueada não serve', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    v := public.eh_assinante_ativo()::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor perde o acesso na hora quando a imobiliária é bloqueada', 'false', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'vencido');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    v := public.eh_assinante_ativo()::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor perde o acesso quando o pagamento da imobiliária vence', 'false', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    -- Desde o 5.4, o convite é criado só pela função do banco.
    perform public.criar_convite('novo.corretor@exemplo.com');
    select count(*)::text into v from public.convites;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável de imobiliária ativa cria convite', '1', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      perform public.criar_convite();
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável de imobiliária pendente não cria convite', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    begin
      perform public.criar_convite();
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor não cria convite', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '67890-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000012', 'ativo');
    -- guarda o id da imobiliária B antes de entrar como A (A não consegue ler B)
    perform set_config('teste.outra', (select assinante_id::text from public.perfis where id = '00000000-0000-4000-a000-000000000012'), true);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      insert into public.convites (assinante_id, token_hash)
      values (current_setting('teste.outra')::uuid, repeat('e', 64));
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável não grava convite direto na tabela, nem para outra imobiliária', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      update public.convites set usado_em = now();
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável não marca convite como usado', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '67890-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000012');
    select count(*)::text into v from public.convites;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Outra imobiliária não vê os convites', '0', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'outro-codigo', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    select count(*)::text into v from public.convites;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor não vê os convites da imobiliária', '0', v);
end $$;

-- Leitura e status do assinante -------------------------------------

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '67890-J');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    select count(*)::text into v from public.assinantes;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imobiliária lê o próprio assinante e não o de outra', '1', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    select count(*)::text into v from public.assinantes;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor lê o assinante da própria imobiliária', '1', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select count(*)::text into v from public.assinantes;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não lê nenhum assinante', '0', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    update public.assinantes set status = 'ativo';
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imobiliária não ativa a própria assinatura (0 linhas alteradas)', '0', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      update public.assinantes set creci = '99999-J';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imobiliária não troca o próprio CRECI', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '67890-J');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      update public.perfis set assinante_id = (select assinante_id from public.perfis where id = '00000000-0000-4000-a000-000000000012') where id = '00000000-0000-4000-a000-000000000011';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não troca de imobiliária (assinante_id)', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000009');
    update public.perfis set tipo = 'admin' where id = '00000000-0000-4000-a000-000000000009';
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    update public.assinantes set status = 'ativo' where responsavel_id = '00000000-0000-4000-a000-000000000011';
    select status::text into v from public.assinantes where responsavel_id = '00000000-0000-4000-a000-000000000011';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin ativa a imobiliária', 'ativo', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000009');
    update public.perfis set tipo = 'admin' where id = '00000000-0000-4000-a000-000000000009';
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      update public.assinantes set status = 'vencido' where responsavel_id = '00000000-0000-4000-a000-000000000011';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin não marca assinante como vencido pelo app', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'vencido');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000009');
    update public.perfis set tipo = 'admin' where id = '00000000-0000-4000-a000-000000000009';
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      update public.assinantes set status = 'ativo' where responsavel_id = '00000000-0000-4000-a000-000000000011';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin não libera assinante vencido sem pagamento', 'bloqueado (P0001)', v);
end $$;

-- Bloqueio do admin, separado do pagamento (passo 2.7) ----------------

do $$ declare v text; a text; b text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    update public.assinantes set bloqueado_pelo_admin = true
    where responsavel_id = '00000000-0000-4000-a000-000000000011';
    select status::text into v from public.assinantes
    where responsavel_id = '00000000-0000-4000-a000-000000000011';
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    a := public.eh_assinante_ativo()::text;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    update public.assinantes set bloqueado_pelo_admin = false
    where responsavel_id = '00000000-0000-4000-a000-000000000011';
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    b := public.eh_assinante_ativo()::text;
    v := v || ' / ' || a || ' / ' || b;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin bloqueia e desbloqueia sem mexer no status (status / acesso bloqueado / acesso desbloqueado)',
          'ativo / false / true', v);
end $$;

do $$ declare v text; a text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'vencido');
    update public.assinantes set bloqueado_pelo_admin = true
    where responsavel_id = '00000000-0000-4000-a000-000000000011';
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    -- O caminho que a auditoria achou: desbloquear e depois ativar.
    update public.assinantes set bloqueado_pelo_admin = false
    where responsavel_id = '00000000-0000-4000-a000-000000000011';
    begin
      update public.assinantes set status = 'ativo'
      where responsavel_id = '00000000-0000-4000-a000-000000000011';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    a := public.eh_assinante_ativo()::text;
    v := v || ' / ' || a;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Vencido e bloqueado: desbloquear não libera, e o admin não ativa sem pagamento',
          'bloqueado (P0001) / false', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      update public.assinantes set status = 'pendente'
      where responsavel_id = '00000000-0000-4000-a000-000000000011';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin não volta o assinante para pendente', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    update public.assinantes set bloqueado_pelo_admin = false;
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imobiliária não se desbloqueia (0 linhas alteradas)', '0', v);
end $$;

-- Excluir imobiliária pendente (RF16) --------------------------------

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    delete from auth.users where id = '00000000-0000-4000-a000-000000000011';
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '12345-J');
    select case when count(*) = 1 then 'CRECI livre: novo cadastro aceito' else 'não liberou' end
      into v from public.assinantes where creci = '12345-J' and responsavel_id = '00000000-0000-4000-a000-000000000012';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Excluir a conta da imobiliária pendente libera o CRECI', 'CRECI livre: novo cadastro aceito', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    begin
      delete from auth.users where id = '00000000-0000-4000-a000-000000000011';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imobiliária ativa não é excluída', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      delete from public.assinantes;
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário não apaga assinante direto', 'bloqueado (42501)', v);
end $$;

-- ---------------------------------------------------------------
-- 3. Imóveis, fotos e edições (migration 20261022221614_imoveis)
-- ---------------------------------------------------------------

-- Cadastro ---------------------------------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area)
    values ('Casa nova', (select id from public.tipos_imovel where nome = 'Tipo de Teste (roteiro)'), 'Rua Nova, 1', (select id from public.bairros where nome = 'Bairro de Teste (roteiro)'), 800000, 120)
    returning status || ' / ' || case when termo_aceito_em is not null then 'termo aceito' else 'sem termo' end
           || ' / ' || case when exclusividade_inicio is null then 'sem exclusividade' else 'com exclusividade' end
           || ' / versão ' || versao
      into v;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário cadastra imóvel e ele nasce rascunho, ainda sem termo', 'rascunho / sem termo / sem exclusividade / versão 1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area, termo_versao)
      values ('Casa nova', (select id from public.tipos_imovel where nome = 'Tipo de Teste (roteiro)'), 'Rua Nova, 1', (select id from public.bairros where nome = 'Bairro de Teste (roteiro)'), 800000, 120, '2026-10-provisorio');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não manda o termo no cadastro (o termo só entra pelo envio)', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area, status)
      values ('Casa nova', (select id from public.tipos_imovel where nome = 'Tipo de Teste (roteiro)'), 'Rua Nova, 1', (select id from public.bairros where nome = 'Bairro de Teste (roteiro)'), 800000, 120, 'disponivel');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não cadastra imóvel já disponível', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.imoveis (proprietario_id, titulo, tipo_id, endereco, bairro_id, preco, area)
      values ('00000000-0000-4000-a000-000000000002', 'Casa nova', (select id from public.tipos_imovel where nome = 'Tipo de Teste (roteiro)'), 'Rua Nova, 1', (select id from public.bairros where nome = 'Bairro de Teste (roteiro)'), 800000, 120);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não cadastra imóvel no nome de outro', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    begin
      insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area)
    values ('Casa nova', (select id from public.tipos_imovel where nome = 'Tipo de Teste (roteiro)'), 'Rua Nova, 1', (select id from public.bairros where nome = 'Bairro de Teste (roteiro)'), 800000, 120);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante não cadastra imóvel', 'bloqueado (42501)', v);
end $$;

-- Quem vê os imóveis (o critério da Etapa 2) ------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'expirado');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.imoveis;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante ativo vê só o imóvel disponível (de 5 status diferentes)', '1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'expirado');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'pendente');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.imoveis;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante pendente não vê nenhum imóvel', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'expirado');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.imoveis;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante bloqueado não vê nenhum imóvel', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'expirado');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'vencido');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.imoveis;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante com pagamento vencido não vê nenhum imóvel', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'expirado');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    select count(*)::text into v from public.imoveis;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor de imobiliária bloqueada não vê nenhum imóvel', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select count(*)::text into v from public.imoveis;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário vê só os próprios imóveis', '2', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'expirado');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    select count(*)::text into v from public.imoveis where proprietario_id = '00000000-0000-4000-a000-000000000001';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin vê os imóveis de todos os status', '5', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como_visitante();
    begin
      select count(*)::text into v from public.imoveis;
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não lê imóveis', 'bloqueado (42501)', v);
end $$;

-- Contato do proprietário (RNF06) -----------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel', false);
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.contato_do_proprietario(i);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Contato escondido: o corretor não recebe nada', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel', true);
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select c.telefone || ' / ' || case when c.email like '%@exemplo.com' then 'com e-mail' else 'sem e-mail' end
      into v from public.contato_do_proprietario(i) c;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Contato mostrado: o corretor ativo recebe telefone e e-mail', '48999990000 / com e-mail', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel', true);
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.contato_do_proprietario(i);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Contato mostrado não chega a assinante bloqueado', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente', true);
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.contato_do_proprietario(i);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Contato de imóvel pendente não chega ao corretor (mesmo marcado para mostrar)', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel', true);
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.perfis where id = '00000000-0000-4000-a000-000000000001';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor não lê o perfil do proprietário direto (nem com contato mostrado)', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel', true);
    perform pg_temp.entrar_como_visitante();
    begin
      perform public.contato_do_proprietario(i);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não chama contato_do_proprietario()', 'bloqueado (42501)', v);
end $$;

-- Edição e registro (RF10, RNF11) -----------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 550000 where id = i;
    reset role;
    select e.campo || ': ' || e.valor_antigo || ' -> ' || e.valor_novo
           || ' / versão ' || (select versao from public.imoveis where id = i)
      into v from public.edicoes_imovel e where e.imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Edição do proprietário em imóvel disponível fica registrada, com valor antigo e novo', 'preco: 500000.00 -> 550000.00 / versão 2', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    update public.imoveis set preco = 550000 where id = i;
    reset role;
    select count(*)::text into v from public.edicoes_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Edição feita pelo admin não é registrada', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set titulo = 'Título corrigido' where id = i;
    reset role;
    select count(*)::text into v from public.edicoes_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Edição de imóvel reprovado não vai para o registro (não está no catálogo)', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 1 where id = i;
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não edita imóvel de outro (0 linhas alteradas)', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 1 where id = i;
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário edita imóvel pendente (decisão de 26/10/2026: 1 linha alterada)', '1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      update public.imoveis set status = 'disponivel' where id = i;
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não muda o status direto', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      update public.imoveis set exclusividade_fim = now() + interval '10 years' where id = i;
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não mexe na data da exclusividade', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    update public.imoveis set preco = 1 where id = i;
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante não edita imóvel do catálogo (0 linhas alteradas)', '0', v);
end $$;

-- Apagar (RF12) ------------------------------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := case when n = 1 then 'apagado' else 'não apagou' end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário apaga imóvel pendente', 'apagado', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não apaga imóvel disponível (0 linhas apagadas)', '0', v);
end $$;

-- Aprovar, reprovar e reenviar (RF11, RF14) --------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    perform public.aprovar_imovel(i, 1);
    select status || ' / ' || case when exclusividade_fim = exclusividade_inicio + interval '6 months'
                                   then '6 meses' else 'prazo errado' end
      into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin aprova: o imóvel fica disponível com 6 meses de exclusividade', 'disponivel / 6 meses', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');  -- versão 1
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    -- O imóvel muda pelo caminho que o dono tem num pendente: uma foto nova.
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    insert into public.fotos_imovel (imovel_id, caminho, ordem)
    values (i, i || '/foto-nova.jpg', 1);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    select 'versão ' || versao into v from public.imoveis where id = i;
    begin
      perform public.aprovar_imovel(i, 1);  -- o admin viu a versão 1
      v := v || ' / permitido';
    exception when others then
      -- Confere a mensagem também: "Só o admin aprova" é o mesmo código P0001.
      v := v || ' / ' || case when sqlerrm like 'O imóvel mudou%' then pg_temp.bloqueio(sqlstate, sqlerrm)
                              else 'erro inesperado: ' || sqlstate || ' ' || sqlerrm end;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Aprovação falha se o dono mudou o imóvel (foto nova) depois que o admin abriu a tela',
          'versão 2 / bloqueado (P0001)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.aprovar_imovel(i, 1);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não aprova o próprio imóvel', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    perform public.reprovar_imovel(i, '  Fotos escuras ');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select status || ' / ' || motivo_reprovacao into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin reprova com motivo e o proprietário vê o motivo', 'reprovado / Fotos escuras', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      perform public.reprovar_imovel(i, '   ');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Reprovar sem motivo é barrado', 'bloqueado (P0001)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    perform public.reenviar_imovel(i);
    select status || ' / ' || coalesce(motivo_reprovacao, 'sem motivo') into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário reenvia o imóvel reprovado e ele volta a pendente', 'pendente / sem motivo', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'reprovado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.reenviar_imovel(i);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não reenvia imóvel de outro', 'bloqueado (P0001)', v);
end $$;

-- Fotos (RF09) e registro de edições (RF17) -------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    insert into public.fotos_imovel (imovel_id, caminho, ordem) values (i, i || '/disponivel.jpg', 1);
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    insert into public.fotos_imovel (imovel_id, caminho, ordem) values (i, i || '/pendente.jpg', 1);
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.fotos_imovel;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante ativo vê foto de imóvel disponível e não de pendente', '1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    insert into public.fotos_imovel (imovel_id, caminho, ordem) values (i, i || '/nova.jpg', 1);
    reset role;
    select e.campo || ' / versão ' || (select versao from public.imoveis where id = i)
      into v from public.edicoes_imovel e where e.imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Foto nova em imóvel disponível fica registrada e sobe a versão', 'fotos / versão 2', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.fotos_imovel (imovel_id, caminho, ordem) values (i, i || '/intrusa.jpg', 1);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não põe foto no imóvel de outro', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 550000 where id = i;
    select count(*)::text into v from public.edicoes_imovel;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não lê o registro de edições', '0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      insert into public.edicoes_imovel (imovel_id, campo) values (i, 'preco');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Ninguém grava direto no registro de edições', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 550000 where id = i;
    reset role;
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    update public.edicoes_imovel set revisado_em = now() where imovel_id = i;
    select count(*) || ' revisada' into v from public.edicoes_imovel where imovel_id = i and revisado_em is not null;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin lê e marca a edição como revisada', '1 revisada', v);
end $$;

-- Listas fixas -------------------------------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select count(*)::text into v from public.bairros where nome = 'Bairro de Teste (roteiro)';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Usuário logado lê a lista de bairros', '1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.bairros (nome) values ('Bairro Inventado');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não cria bairro', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    insert into public.tipos_imovel (nome) values ('Tipo Criado pelo Admin (roteiro)');
    select count(*)::text into v from public.tipos_imovel where nome = 'Tipo Criado pelo Admin (roteiro)';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin cria tipo de imóvel', '1', v);
end $$;

-- ---------------------------------------------------------------
-- 4. Cadastro pela tela (migration 20261022231442_cadastro_etapa_3)
-- ---------------------------------------------------------------

-- CRECI normalizado --------------------------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12.345-J');
    begin
      perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '12345J');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI com outra pontuação conta como repetido', 'bloqueado (23505)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    begin
      perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', 'CRECI/SC 12345-J');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI com "CRECI/SC" na frente conta como repetido', 'bloqueado (23505)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J SC');
    select a.creci || ' / ' || a.creci_normalizado into v
    from public.assinantes a where a.responsavel_id = '00000000-0000-4000-a000-000000000011';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI guarda o que foi digitado e o normalizado', '12345-JSC / 12345J', v);
end $$;

-- Perguntas do cadastro, sem login -----------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.entrar_como_visitante();
    v := public.creci_disponivel('creci/sc 12.345-j')::text || ' / '
      || public.creci_disponivel('54321-F')::text || ' / '
      || public.creci_disponivel('  ')::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante pergunta creci_disponivel (cadastrado / livre / vazio)', 'false / true / false', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-bom', null, now() + interval '1 day');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-vencido', null, now() - interval '1 minute');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-com-email', 'certo@exemplo.com', now() + interval '1 day');
    perform pg_temp.entrar_como_visitante();
    v := public.convite_valido('codigo-bom', 'qualquer@exemplo.com')::text || ' / '
      || public.convite_valido('codigo-errado', 'qualquer@exemplo.com')::text || ' / '
      || public.convite_valido('codigo-vencido', 'qualquer@exemplo.com')::text || ' / '
      || public.convite_valido('codigo-com-email', 'outro@exemplo.com')::text || ' / '
      || public.convite_valido('codigo-com-email', 'CERTO@exemplo.com')::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante pergunta convite_valido (bom / errado / vencido / outro e-mail / e-mail certo)',
          'true / false / false / false / true', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-bom', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-bom');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-dois', null, now() + interval '1 day');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'bloqueado');
    perform pg_temp.entrar_como_visitante();
    v := public.convite_valido('codigo-bom', null)::text || ' / '
      || public.convite_valido('codigo-dois', null)::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('convite_valido diz não para convite usado e de imobiliária bloqueada', 'false / false', v);
end $$;

-- Metadata do cadastro -----------------------------------------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    select coalesce(string_agg(k, ','), 'nenhuma') into v
    from auth.users u, jsonb_object_keys(u.raw_user_meta_data) k
    where u.id = '00000000-0000-4000-a000-000000000011'
      and k in ('tipo', 'nome', 'telefone', 'creci', 'nome_imobiliaria', 'convite');
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro apaga do metadata os dados copiados', 'nenhuma', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-bom', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-bom');
    select coalesce(string_agg(k, ','), 'nenhuma') into v
    from auth.users u, jsonb_object_keys(u.raw_user_meta_data) k
    where u.id = '00000000-0000-4000-a000-000000000021';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro de corretor apaga o código do convite do metadata', 'nenhuma', v);
end $$;

-- O Supabase Auth regrava o metadata depois do cadastro (migration 20261022232122).
do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    update auth.users
    set raw_user_meta_data = raw_user_meta_data || '{"tipo":"admin","nome":"X","creci":"1J","sub":"abc","email_verified":true}'
    where id = '00000000-0000-4000-a000-000000000011';
    select string_agg(k, ',' order by k) into v
    from auth.users u, jsonb_object_keys(u.raw_user_meta_data) k
    where u.id = '00000000-0000-4000-a000-000000000011';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Regravar o metadata depois do cadastro tira os dados copiados e mantém o resto', 'email_verified,sub', v);
end $$;

-- Metadata forjado (auditoria da Etapa 2) ------------------------------

do $$ declare v text; b uuid; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '99999-J');
    select assinante_id into b from public.perfis where id = '00000000-0000-4000-a000-000000000012';
    perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000031', json_build_object(
      'tipo', 'autonomo', 'nome', 'Autônomo Forjado', 'telefone', '48999990000', 'creci', '54321-F',
      'status', 'ativo', 'bloqueado_pelo_admin', false, 'assinante_id', b)::jsonb);
    set constraints all immediate;
    select a.status || ' / ' || case when p.assinante_id = b then 'assinante da outra' else 'assinante próprio' end
      into v
    from public.perfis p join public.assinantes a on a.id = p.assinante_id
    where p.id = '00000000-0000-4000-a000-000000000031';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cadastro ignora status e assinante_id forjados no metadata', 'pendente / assinante próprio', v);
end $$;

do $$ declare v text; b uuid; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '99999-J');
    select assinante_id into b from public.perfis where id = '00000000-0000-4000-a000-000000000012';
    perform pg_temp.criar_conta('00000000-0000-4000-a000-000000000001', json_build_object(
      'tipo', 'proprietario', 'nome', 'Proprietário Forjado', 'telefone', '48999990000',
      'assinante_id', b)::jsonb);
    select coalesce(assinante_id::text, 'sem assinante') into v
    from public.perfis where id = '00000000-0000-4000-a000-000000000001';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário com assinante_id forjado fica sem assinante', 'sem assinante', v);
end $$;

-- Funções do imóvel só para quem pode (auditoria da Etapa 2) ----------

do $$ declare v text := ''; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    begin
      perform pg_temp.entrar_como_visitante();
      perform public.aprovar_imovel(i, 1);
      v := v || 'permitido';
    exception when others then v := v || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform pg_temp.entrar_como_visitante();
      perform public.reprovar_imovel(i, 'motivo');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform pg_temp.entrar_como_visitante();
      perform public.reenviar_imovel(i);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante não chama aprovar, reprovar nem reenviar imóvel',
          'bloqueado (42501) / bloqueado (42501) / bloqueado (42501)', v);
end $$;

do $$ declare v text := ''; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    begin
      perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
      perform public.reprovar_imovel(i, 'motivo');
      v := v || 'permitido';
    exception when others then v := v || sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
      perform public.reprovar_imovel(i, 'motivo');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário e assinante não reprovam imóvel (código e mensagem)',
          'P0001 Só o admin reprova imóveis / P0001 Só o admin reprova imóveis', v);
end $$;

-- ---------------------------------------------------------------
-- 4. Cadastro do imóvel da Etapa 4 (migrations 20261026200718_imoveis_rascunho
--    e 20261026200726_imoveis_etapa_4)
-- ---------------------------------------------------------------

-- Termo de exclusividade -------------------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select versao || ' / ' || case when provisorio then 'provisório' else 'final' end
      into v from public.termos_exclusividade where vigente;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário lê o termo vigente, marcado como provisório', '2026-10-provisorio / provisório', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      insert into public.termos_exclusividade (versao, texto, provisorio) values ('versao-falsa', 'texto', false);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      update public.termos_exclusividade set texto = 'outro texto' where vigente;
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Ninguém grava o termo pelo app, nem o admin', 'bloqueado (42501) / bloqueado (42501)', v);
end $$;

-- Enviar o rascunho para a aprovação ---------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_foto(i, 1);
    perform public.enviar_imovel(i, '2026-10-provisorio');
    select status || ' / ' || termo_versao || ' / '
           || case when termo_aceito_em > now() - interval '1 minute' then 'aceito agora' else 'sem data' end
      into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário envia o rascunho com foto e termo: fica pendente, com versão e data do aceite',
          'pendente / 2026-10-provisorio / aceito agora', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.enviar_imovel(i, '2026-10-provisorio');
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Rascunho sem foto não vai para a aprovação (código e mensagem)',
          'P0001 Envie pelo menos uma foto antes de mandar para a aprovação', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.criar_foto(i, 1);
    insert into public.termos_exclusividade (versao, texto, provisorio, vigente)
    values ('teste-antiga', 'Versão antiga de teste', true, false);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.enviar_imovel(i, 'teste-antiga');
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform public.enviar_imovel(i, '');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Envio com versão do termo que não é a vigente, ou sem termo, é barrado',
          'P0001 Só a versão vigente do termo de exclusividade pode ser aceita / P0001 Aceite o termo de exclusividade para enviar', v);
end $$;

do $$ declare v text := ''; n int; i uuid; j uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'rascunho');
    perform pg_temp.criar_foto(i, 1);
    j := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_foto(j, 1);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.enviar_imovel(i, '2026-10-provisorio');
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform public.enviar_imovel(j, '2026-10-provisorio');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não envia rascunho de outro nem imóvel que não é rascunho',
          'P0001 Só o proprietário envia, e só imóvel em rascunho / P0001 Só o proprietário envia, e só imóvel em rascunho', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como_visitante();
    begin
      perform public.enviar_imovel(i, '2026-10-provisorio');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não chama enviar_imovel()', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.reenviar_imovel(i);
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Reprovado sem foto não é reenviado (código e mensagem)',
          'P0001 Envie pelo menos uma foto antes de mandar para a aprovação', v);
end $$;

-- Quem vê, edita e apaga o rascunho -----------------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    select count(*)::text into v from public.imoveis where id = i;
    select v || ' / ' || count(*) into v from public.fotos_imovel where imovel_id = i;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000002');
    select v || ' / ' || count(*) into v from public.imoveis where id = i;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select v || ' / ' || count(*) into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Rascunho: admin não vê o imóvel nem as fotos, outro proprietário não vê, o dono vê',
          '0 / 0 / 0 / 1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    update public.imoveis set preco = 1 where id = i;
    get diagnostics n = row_count;
    v := n::text;
    begin
      perform pg_temp.criar_foto(i, 1);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin não edita rascunho nem põe foto nele', '0 / bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set titulo = 'Título do rascunho', mostrar_contato = true where id = i;
    get diagnostics n = row_count;
    v := n::text;
    perform pg_temp.criar_foto(i, 1);
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := v || ' / ' || case when n = 1 then 'apagado' else 'não apagou' end;
    reset role;
    select v || ' / ' || count(*) || ' fotos' into v from public.fotos_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Dono edita o rascunho e o apaga com as fotos', '1 / apagado / 0 fotos', v);
end $$;

-- Edição de pendente (decisão de 26/10/2026) ---------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 550000, mostrar_contato = true where id = i;
    reset role;
    select count(*) || ' registros / versão ' || (select versao from public.imoveis where id = i)
           || ' / ' || (select status from public.imoveis where id = i)
      into v from public.edicoes_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Edição de imóvel pendente não vai para o registro, sobe a versão e continua pendente',
          '0 registros / versão 2 / pendente', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');  -- versão 1
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 450000 where id = i;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      perform public.aprovar_imovel(i, 1);  -- o admin viu a versão 1
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Aprovação falha se o dono mudou o preço do pendente depois que o admin abriu a tela',
          'P0001 O imóvel mudou depois que a tela foi aberta, ou não está pendente. Abra de novo e confira.', v);
end $$;

-- Fotos: caminho e limite ------------------------------------------------

do $$ declare v text; n int; i uuid; j uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    j := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.fotos_imovel (imovel_id, caminho, ordem) values (i, j || '/foto.jpg', 1);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      insert into public.fotos_imovel (imovel_id, caminho, ordem) values (i, i || '/../foto.jpg', 1);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      insert into public.fotos_imovel (imovel_id, caminho, ordem) values (i, i || '/foto.exe', 1);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Foto com caminho de outro imóvel, com "..", ou que não é imagem é barrada',
          'bloqueado (23514) / bloqueado (23514) / bloqueado (23514)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    for n in 1..20 loop
      perform pg_temp.criar_foto(i, n);
    end loop;
    begin
      perform pg_temp.criar_foto(i, 21);
      v := '21 fotos';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('A 21ª foto do imóvel é barrada (código e mensagem)', 'P0001 Cada imóvel tem no máximo 20 fotos', v);
end $$;

-- Listas e revisão (auditoria da Etapa 2) ---------------------------------

do $$ declare v text := ''; n int; i uuid; b bigint; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    b := pg_temp.bairro_teste();
    insert into public.tipos_imovel (nome, ativo) values ('Tipo fora de uso (roteiro)', false);
    insert into public.bairros (nome, ativo) values ('Bairro fora de uso (roteiro)', false);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area)
      values ('Casa nova', (select id from public.tipos_imovel where nome = 'Tipo fora de uso (roteiro)'),
              'Rua Nova, 1', b, 800000, 120);
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    begin
      update public.imoveis set bairro_id = (select id from public.bairros where nome = 'Bairro fora de uso (roteiro)')
      where id = i;
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Tipo ou bairro fora de uso não entra no imóvel (cadastro e troca)',
          'P0001 Este tipo de imóvel não está em uso. Escolha outro. / P0001 Este bairro não está em uso. Escolha outro.', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 550000 where id = i;
    reset role;
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    -- O admin manda uma data qualquer: o banco grava a de agora e o revisor certo.
    update public.edicoes_imovel set revisado_em = '2000-01-01' where imovel_id = i;
    select case when revisado_por = '00000000-0000-4000-a000-000000000009' then 'revisor certo' else 'revisor errado' end
           || ' / ' || case when revisado_em > now() - interval '1 minute' then 'agora' else 'data forjada' end
      into v from public.edicoes_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Revisão da edição: o banco grava a data de agora e quem revisou', 'revisor certo / agora', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 550000 where id = i;
    reset role;
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      update public.edicoes_imovel set revisado_por = '00000000-0000-4000-a000-000000000001' where imovel_id = i;
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin não escolhe quem revisou', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select count(*) || ' tipos / ' || (select count(*) from public.bairros where nome in ('Campeche', 'Jardim Capoeiras', 'Tapera da Base'))
           || ' bairros conferidos'
      into v from public.tipos_imovel
      where nome in ('Casa', 'Apartamento', 'Cobertura', 'Terreno', 'Sala comercial') and ativo;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('As listas de tipos e bairros estão carregadas', '5 tipos / 3 bairros conferidos', v);
end $$;

-- Testes que faltavam da auditoria da Etapa 2 ---------------------------

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.criar_foto(i, 2);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := case when n = 1 then 'apagado' else 'não apagou' end;
    reset role;
    select v || ' / ' || count(*) || ' fotos' into v from public.fotos_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário apaga imóvel reprovado e as fotos vão junto', 'apagado / 0 fotos', v);
end $$;

do $$ declare v text; n int; i uuid; j uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    j := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'expirado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := n::text;
    delete from public.imoveis where id = j;
    get diagnostics n = row_count;
    v := v || ' / ' || n;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não apaga imóvel vendido nem expirado (0 linhas apagadas)', '0 / 0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'reprovado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set titulo = 'Título corrigido' where id = i;
    select status::text into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Editar imóvel reprovado não o reenvia (continua reprovado)', 'reprovado', v);
end $$;

do $$ declare v text := ''; n int; i uuid; t bigint; b bigint; begin
  begin
    t := pg_temp.tipo_teste(); b := pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    -- Sem os campos proibidos, o mesmo cadastro passa (o bloqueio abaixo é por eles).
    insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area)
    values ('Casa nova', t, 'Rua Nova, 1', b, 800000, 120);
    begin
      insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area, termo_aceito_em)
      values ('Casa nova', t, 'Rua Nova, 1', b, 800000, 120, now());
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      insert into public.imoveis (titulo, tipo_id, endereco, bairro_id, preco, area, captado_pelo_admin)
      values ('Casa nova', t, 'Rua Nova, 1', b, 800000, 120, true);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não manda data do aceite nem "captado pelo admin" no cadastro',
          'bloqueado (42501) / bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      update public.imoveis set termo_versao = null where id = i;
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não muda a versão do termo depois do aceite', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select count(*)::text into v from public.fotos_imovel;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante bloqueado não vê foto de imóvel disponível', '0', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 550000 where id = i;
    reset role;
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    begin
      insert into public.tipos_imovel (nome) values ('Tipo do assinante');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      insert into public.bairros (nome) values ('Bairro do assinante');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    select v || ' / ' || count(*) into v from public.edicoes_imovel;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Assinante não grava em tipos nem em bairros e não lê o registro de edições',
          'bloqueado (42501) / bloqueado (42501) / 0', v);
end $$;

-- ---------------------------------------------------------------
-- 5. Fotos no Storage e ordem (migration 20261026221116_fotos_storage)
-- ---------------------------------------------------------------
-- Os testes gravam direto em storage.objects, que é o que o Supabase Storage faz
-- ao receber um arquivo, com as mesmas regras (nenhum arquivo de verdade é criado).

create or replace function pg_temp.criar_arquivo(p_imovel uuid, p_nome text)
returns void
language sql
as $$
  insert into storage.objects (bucket_id, name) values ('fotos-imoveis', p_imovel || '/' || p_nome);
$$;

create or replace function pg_temp.arquivos_visiveis()
returns text
language sql
as $$
  select count(*)::text from storage.objects where bucket_id = 'fotos-imoveis';
$$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_arquivo(i, 'casa.jpg');
    perform pg_temp.criar_arquivo(i, 'casa-mini.jpg');
    v := pg_temp.arquivos_visiveis();
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Dono envia a foto e a miniatura para a pasta do próprio rascunho e as vê', '2', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'pendente');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform pg_temp.criar_arquivo(i, 'intrusa.jpg');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    reset role;
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'vendido');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform pg_temp.criar_arquivo(i, 'depois.jpg');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Proprietário não envia arquivo para imóvel de outro nem para imóvel vendido',
          'bloqueado (42501) / bloqueado (42501)', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform pg_temp.criar_arquivo(i, 'programa.exe');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform pg_temp.criar_arquivo(i, 'pasta/foto.jpg');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      insert into storage.objects (bucket_id, name) values ('fotos-imoveis', 'solta.jpg');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Arquivo com nome fora do formato, em subpasta ou fora da pasta de um imóvel é barrado',
          'bloqueado (42501) / bloqueado (42501) / bloqueado (42501)', v);
end $$;

do $$ declare v text := ''; n int; i uuid; j uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    j := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      perform pg_temp.criar_arquivo(i, 'do-admin.jpg');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    perform pg_temp.criar_arquivo(j, 'do-admin.jpg');
    v := v || ' / ' || pg_temp.arquivos_visiveis();
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin não envia arquivo para rascunho; envia para pendente', 'bloqueado (42501) / 1', v);
end $$;

do $$ declare v text := ''; n int; i uuid; j uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    j := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_arquivo(i, 'disponivel.jpg');
    perform pg_temp.criar_arquivo(j, 'pendente.jpg');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    v := pg_temp.arquivos_visiveis();
    reset role;
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000031', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    v := v || ' / ' || pg_temp.arquivos_visiveis();
    reset role;
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000031', 'vencido');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    v := v || ' / ' || pg_temp.arquivos_visiveis();
    perform pg_temp.entrar_como_visitante();
    v := v || ' / ' || pg_temp.arquivos_visiveis();
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Arquivo: assinante ativo vê só o de disponível; bloqueado, vencido e visitante não veem nada',
          '1 / 0 / 0 / 0', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_arquivo(i, 'foto.jpg');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    update storage.objects set name = i || '/trocada.jpg' where bucket_id = 'fotos-imoveis';
    get diagnostics n = row_count;
    v := n::text;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update storage.objects set name = i || '/trocada.jpg' where bucket_id = 'fotos-imoveis';
    get diagnostics n = row_count;
    v := v || ' / ' || n;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  -- Apagar arquivo não dá para testar aqui: o Supabase barra todo delete direto em
  -- storage.objects (gatilho storage.protect_delete). Quem apaga e quem não apaga
  -- está no e2e/imovel-fotos.spec.ts, pela API do Storage.
  insert into resultado (teste, esperado, obtido)
  values ('Arquivo: nem assinante nem dono sobrescrevem ou renomeiam (0 linhas)', '0 / 0', v);
end $$;

-- Ordem das fotos ---------------------------------------------------------

do $$ declare v text; n int; i uuid; a uuid; b uuid; c uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.criar_foto(i, 1); perform pg_temp.criar_foto(i, 2); perform pg_temp.criar_foto(i, 3);
    select id into a from public.fotos_imovel where imovel_id = i and ordem = 1;
    select id into b from public.fotos_imovel where imovel_id = i and ordem = 2;
    select id into c from public.fotos_imovel where imovel_id = i and ordem = 3;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    perform public.reordenar_fotos(i, array[c, a, b]);
    select string_agg(regexp_replace(caminho, '^.*/', ''), ' ' order by ordem) into v
      from public.fotos_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Dono muda a ordem das fotos (a terceira vira a capa)', 'foto-3.jpg foto-1.jpg foto-2.jpg', v);
end $$;

do $$ declare v text := ''; n int; i uuid; a uuid; b uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'rascunho');
    perform pg_temp.criar_foto(i, 1); perform pg_temp.criar_foto(i, 2);
    select id into a from public.fotos_imovel where imovel_id = i and ordem = 1;
    select id into b from public.fotos_imovel where imovel_id = i and ordem = 2;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.reordenar_fotos(i, array[b]);
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform public.reordenar_fotos(i, array[b, b, a]);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Ordem com foto faltando ou repetida é barrada (código e mensagem)',
          'P0001 A lista de fotos não confere com as fotos do imóvel. Abra de novo e confira. / P0001 A lista de fotos não confere com as fotos do imóvel. Abra de novo e confira.', v);
end $$;

do $$ declare v text := ''; n int; i uuid; a uuid; b uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'disponivel');
    perform pg_temp.criar_foto(i, 1); perform pg_temp.criar_foto(i, 2);
    select id into a from public.fotos_imovel where imovel_id = i and ordem = 1;
    select id into b from public.fotos_imovel where imovel_id = i and ordem = 2;
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    foreach n in array array[1, 31] loop
      perform pg_temp.entrar_como(('00000000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid);
      begin
        perform public.reordenar_fotos(i, array[b, a]);
        v := v || ' / permitido';
      exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
      end;
    end loop;
    v := substr(v, 4);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Outro proprietário e assinante não mudam a ordem das fotos',
          'P0001 Só o dono ou o admin muda a ordem das fotos / P0001 Só o dono ou o admin muda a ordem das fotos', v);
end $$;

do $$ declare v text; n int; i uuid; a uuid; b uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_foto(i, 1); perform pg_temp.criar_foto(i, 2);
    select id into a from public.fotos_imovel where imovel_id = i and ordem = 1;
    select id into b from public.fotos_imovel where imovel_id = i and ordem = 2;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    perform public.reordenar_fotos(i, array[b, a]);
    reset role;
    select count(*) || ' registros' into v from public.edicoes_imovel where imovel_id = i and campo = 'fotos';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Nova ordem das fotos de imóvel disponível vai para o registro de edições', '2 registros', v);
end $$;

-- ---------------------------------------------------------------
-- 6. Arquivos de imóvel apagado (migration 20261026225310_apagar_imovel_com_fotos)
-- ---------------------------------------------------------------
-- owner_id é quem enviou o arquivo (o Storage grava sozinho; aqui o teste grava).

create or replace function pg_temp.criar_arquivo_de(p_imovel uuid, p_nome text, p_quem uuid)
returns void
language sql
as $$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('fotos-imoveis', p_imovel || '/' || p_nome, p_quem::text);
$$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_arquivo_de(i, 'do-dono.jpg', '00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_arquivo_de(i, 'do-admin.jpg', '00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from public.imoveis where id = i;
    v := pg_temp.arquivos_visiveis();
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000002');
    v := v || ' / ' || pg_temp.arquivos_visiveis();
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    v := v || ' / ' || pg_temp.arquivos_visiveis();
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imóvel apagado: cada um vê só o arquivo que enviou (dono / outro proprietário / admin)',
          '1 / 0 / 1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    -- Arquivo com owner_id da 0001 na pasta de um imóvel (que existe) da 0002.
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000002', 'pendente');
    perform pg_temp.criar_arquivo_de(i, 'foto.jpg', '00000000-0000-4000-a000-000000000001');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    v := pg_temp.arquivos_visiveis();
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Enquanto o imóvel existe, ter enviado o arquivo não dá acesso a ele (vale a regra do imóvel)', '0', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.entrar_como_visitante();
    begin
      perform public.pasta_sem_imovel('00000000-0000-4000-a000-000000000000/foto.jpg');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não chama pasta_sem_imovel()', 'bloqueado (42501)', v);
end $$;

-- ---------------------------------------------------------------
-- 7. Última foto (migration 20261026235505_foto_minima)
-- ---------------------------------------------------------------

do $$ declare v text := ''; n int; s text; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    foreach s in array array['pendente', 'disponivel'] loop
      i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', s);
      perform pg_temp.criar_foto(i, 1);
      perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
      begin
        delete from public.fotos_imovel where imovel_id = i;
        v := v || ' / permitido';
      exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
      end;
      reset role;
    end loop;
    v := substr(v, 4);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Dono não tira a última foto de imóvel pendente nem de disponível (código e mensagem)',
          'P0001 O imóvel precisa de pelo menos uma foto / P0001 O imóvel precisa de pelo menos uma foto', v);
end $$;

do $$ declare v text := ''; n int; s text; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    foreach s in array array['rascunho', 'reprovado'] loop
      i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', s);
      perform pg_temp.criar_foto(i, 1);
      perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
      delete from public.fotos_imovel where imovel_id = i;
      get diagnostics n = row_count;
      v := v || ' / ' || n;
      reset role;
    end loop;
    v := substr(v, 4);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Rascunho e reprovado podem ficar sem foto (linhas tiradas)', '1 / 1', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.criar_foto(i, 2);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from public.fotos_imovel where imovel_id = i and ordem = 2;
    get diagnostics n = row_count;
    v := n::text;
    reset role;
    select v || ' / ' || count(*) || ' foto' into v from public.fotos_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Disponível com duas fotos: o dono tira uma e fica a outra', '1 / 1 foto', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.criar_foto(i, 2);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := case when n = 1 then 'apagado' else 'não apagou' end;
    reset role;
    select v || ' / ' || count(*) || ' fotos' into v from public.fotos_imovel where imovel_id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Apagar imóvel pendente com fotos continua funcionando (as fotos saem em cascata)', 'apagado / 0 fotos', v);
end $$;

-- ---------------------------------------------------------------
-- 8. Captação pelo admin (migrations 20261027160122_imoveis_captado e
--    20261027160130_captacao)
-- ---------------------------------------------------------------

-- Capta, como o admin, um imóvel para o dono p_dono. Devolve o id.
create or replace function pg_temp.captar(p_dono uuid)
returns uuid
language sql
as $$
  -- Só lê o tipo e o bairro de teste (criados antes pelo roteiro): quem chama pode
  -- não ter permissão de gravar nas listas.
  select public.captar_imovel(p_dono, 'Cobertura captada', 'Descrição',
                              (select id from public.tipos_imovel where nome = 'Tipo de Teste (roteiro)'), 'Rua Captada, 1',
                              (select id from public.bairros where nome = 'Bairro de Teste (roteiro)'),
                              2500000, 3::smallint, 2::smallint, 2::smallint, 180);
$$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    select status || ' / ' || case when captado_pelo_admin then 'captado pelo admin' else 'do dono' end
           || ' / ' || coalesce(termo_versao, 'sem termo')
           || ' / ' || case when exclusividade_inicio is null then 'sem exclusividade' else 'com exclusividade' end
           || ' / ' || case when proprietario_id = '00000000-0000-4000-a000-000000000001' then 'do dono certo' else 'dono errado' end
      into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin capta imóvel para o dono: fica captado, sem termo e sem exclusividade',
          'captado / captado pelo admin / sem termo / sem exclusividade / do dono certo', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    -- Proprietário e assinante não captam.
    foreach n in array array[2, 31] loop
      perform pg_temp.entrar_como(('00000000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid);
      begin
        perform pg_temp.captar('00000000-0000-4000-a000-000000000001');
        v := v || ' / permitido';
      exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
      end;
    end loop;
    -- O admin não capta para quem não é proprietário (ex.: um assinante).
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    begin
      perform pg_temp.captar('00000000-0000-4000-a000-000000000031');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    v := substr(v, 4);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Só o admin capta, e só para conta de proprietário',
          'P0001 Só o admin capta imóveis / P0001 Só o admin capta imóveis / P0001 O dono precisa ter conta de proprietário no PAUTA', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_foto(i, 1);
    select count(*)::text into v from public.imoveis where id = i;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    select v || ' / ' || count(*) into v from public.imoveis where id = i;
    select v || ' / ' || count(*) into v from public.fotos_imovel where imovel_id = i;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select v || ' / ' || count(*) into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Captado fora do catálogo: admin vê, assinante ativo não vê imóvel nem foto, o dono vê',
          '1 / 0 / 0 / 1', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    update public.imoveis set preco = 1 where id = i;
    get diagnostics n = row_count;
    v := n::text;
    begin
      perform pg_temp.criar_foto(i, 2);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := v || ' / ' || n;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Dono do captado não edita, não põe foto e não apaga (só aceita)', '0 / bloqueado (42501) / 0', v);
end $$;

do $$ declare v text; n int; i uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    perform public.aceitar_termo_captado(i, (select versao from public.imoveis where id = i), '2026-10-provisorio', true);
    select status || ' / ' || termo_versao
           || ' / ' || case when termo_aceito_em > now() - interval '1 minute' then 'aceito agora' else 'sem data' end
           || ' / ' || case when exclusividade_inicio > now() - interval '1 minute'
                             and exclusividade_fim = exclusividade_inicio + interval '6 months' then '6 meses a partir do aceite' else 'prazo errado' end
           || ' / ' || case when mostrar_contato then 'contato visível' else 'contato oculto' end
      into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Dono aceita o termo do captado: fica disponível, com 6 meses a partir do aceite',
          'disponivel / 2026-10-provisorio / aceito agora / 6 meses a partir do aceite / contato visível', v);
end $$;

do $$ declare v text := ''; n int; i uuid; j uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000002');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    insert into public.termos_exclusividade (versao, texto, provisorio, vigente)
    values ('teste-antiga', 'Versão antiga de teste', true, false);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');  -- sem foto
    j := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_foto(j, 1);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.aceitar_termo_captado(i, (select versao from public.imoveis where id = i), '2026-10-provisorio', false);
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform public.aceitar_termo_captado(j, (select versao from public.imoveis where id = j), 'teste-antiga', false);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000002');
    begin
      perform public.aceitar_termo_captado(j, (select versao from public.imoveis where id = j), '2026-10-provisorio', false);
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Aceite barrado sem foto, com versão do termo que não é a vigente e por outra pessoa',
          'P0001 O imóvel ainda não tem fotos. Fale com a equipe PAUTA. / P0001 Só a versão vigente do termo de exclusividade pode ser aceita / P0001 Só o dono aceita, e só imóvel captado aguardando o aceite', v);
end $$;

do $$ declare v text; n int; i uuid; j uuid; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_foto(i, 1);
    reset role;
    j := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'pendente');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    delete from public.imoveis where id = i;
    get diagnostics n = row_count;
    v := n::text;
    delete from public.imoveis where id = j;
    get diagnostics n = row_count;
    v := v || ' / ' || n;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin apaga o captado (com foto), mas não apaga imóvel do dono em outro status', '1 / 0', v);
end $$;

do $$ declare v text := ''; n int; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    update public.perfis set nome = 'Marina Buscável' where id = '00000000-0000-4000-a000-000000000001';
    perform pg_temp.criar_assinante('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    select string_agg(nome, ', ') into v from public.buscar_proprietarios('Buscável');
    select v || ' / ' || count(*) into v from public.buscar_proprietarios('Autônomo de Teste');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.buscar_proprietarios('Buscável');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Busca de dono: o admin acha proprietário (e não assinante); proprietário não busca',
          'Marina Buscável / 0 / P0001 Só o admin procura proprietários', v);
end $$;

-- ---------------------------------------------------------------
-- 9. Auditoria da Etapa 4 (migrations 20261027165415_fotos_registradas_protegidas
--    e 20261027165423_aceite_captado_com_versao)
-- ---------------------------------------------------------------
-- Apagar arquivo: o Supabase só deixa apagar direto em storage.objects com
-- storage.allow_delete_query ligado (é o que a API do Storage faz); valem as mesmas
-- regras do bucket. O set_config(..., true) é desfeito junto com o bloco.

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_foto(i, 1);  -- registrada: {i}/foto-1.jpg
    perform pg_temp.criar_foto(i, 2);  -- registrada, sem arquivo (como se ele já tivesse sido apagado)
    perform pg_temp.criar_arquivo(i, 'foto-1.jpg');
    perform pg_temp.criar_arquivo(i, 'foto-1-mini.jpg');
    perform pg_temp.criar_arquivo(i, 'solta.jpg');
    perform set_config('storage.allow_delete_query', 'true', true);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    delete from storage.objects where bucket_id = 'fotos-imoveis' and name = i || '/foto-1.jpg';
    get diagnostics n = row_count;
    v := n::text;
    delete from storage.objects where bucket_id = 'fotos-imoveis' and name = i || '/foto-1-mini.jpg';
    get diagnostics n = row_count;
    v := v || ' / ' || n;
    delete from storage.objects where bucket_id = 'fotos-imoveis' and name = i || '/solta.jpg';
    get diagnostics n = row_count;
    v := v || ' / ' || n;
    begin
      perform pg_temp.criar_arquivo(i, 'foto-2.jpg');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform pg_temp.criar_arquivo(i, 'foto-2-mini.jpg');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Dono não apaga nem reenvia arquivo de foto registrada (foto e miniatura); arquivo solto ele apaga',
          '0 / 0 / 1 / bloqueado (42501) / bloqueado (42501)', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform set_config('storage.allow_delete_query', 'true', true);
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_arquivo(i, 'foto-1.jpg');  -- como o app: o arquivo antes da linha
    perform pg_temp.criar_foto(i, 1);
    delete from storage.objects where bucket_id = 'fotos-imoveis' and name = i || '/foto-1.jpg';
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Admin também não apaga arquivo de foto registrada do captado', '0', v);
end $$;

do $$ declare v text := ''; n int; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_foto(i, 1);
    perform pg_temp.criar_foto(i, 2);
    perform pg_temp.criar_arquivo(i, 'foto-2.jpg');
    perform pg_temp.criar_arquivo(i, 'foto-2-mini.jpg');
    perform set_config('storage.allow_delete_query', 'true', true);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    -- Como o app faz (removerFoto): primeiro a linha, depois os arquivos.
    delete from public.fotos_imovel where imovel_id = i and ordem = 2;
    delete from storage.objects
    where bucket_id = 'fotos-imoveis' and name in (i || '/foto-2.jpg', i || '/foto-2-mini.jpg');
    get diagnostics n = row_count;
    v := n::text;
    -- E envia uma foto nova (nome novo, ainda sem linha).
    perform pg_temp.criar_arquivo(i, 'nova.jpg');
    perform pg_temp.criar_arquivo(i, 'nova-mini.jpg');
    v := v || ' / ' || pg_temp.arquivos_visiveis();
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Fluxo do app: tirar a foto (linha, depois arquivos) e enviar uma nova continua funcionando', '2 / 2', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.entrar_como_visitante();
    begin
      perform public.arquivo_de_foto_registrada('00000000-0000-4000-a000-000000000000/foto.jpg');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não chama arquivo_de_foto_registrada()', 'bloqueado (42501)', v);
end $$;

do $$ declare v text := ''; n int; i uuid; vista int; begin
  begin
    perform pg_temp.tipo_teste(); perform pg_temp.bairro_teste();
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_admin('00000000-0000-4000-a000-000000000009');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    i := pg_temp.captar('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_foto(i, 1);
    -- O dono abre a tela do termo...
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    select versao into vista from public.imoveis where id = i;
    -- ...e o admin muda o preço enquanto ele lê.
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000009');
    update public.imoveis set preco = 2400000 where id = i;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000001');
    begin
      perform public.aceitar_termo_captado(i, vista, '2026-10-provisorio', false);
      v := 'permitido';
    exception when others then v := sqlstate || ' ' || sqlerrm;
    end;
    select v || ' / ' || status into v from public.imoveis where id = i;
    perform public.aceitar_termo_captado(i, (select versao from public.imoveis where id = i), '2026-10-provisorio', false);
    select v || ' / ' || status into v from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Aceite do captado com a versão velha é barrado; com a versão atual, entra',
          'P0001 O imóvel mudou depois que a tela foi aberta / captado / disponivel', v);
end $$;

-- ---------------------------------------------------------------
-- 10. CRECI com letra e exclusão do autônomo pendente
--     (migration 20261028152831_creci_com_letra)
-- ---------------------------------------------------------------

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '54321');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI sem letra é barrado (imobiliária / autônomo)', 'bloqueado (23514) / bloqueado (23514)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-F');
    v := 'permitido';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imobiliária com CRECI F é barrada', 'bloqueado (23514)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '12345-X');
    v := 'permitido';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI com outra letra (nem J nem F) é barrado', 'bloqueado (23514)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '54321-f');
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000032', '67890-J');
    select string_agg(creci_normalizado, ' / ' order by creci_normalizado) into v
    from public.assinantes
    where responsavel_id in ('00000000-0000-4000-a000-000000000031', '00000000-0000-4000-a000-000000000032');
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Autônomo entra com CRECI F ou J', '54321F / 67890J', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.entrar_como_visitante();
    v := public.creci_disponivel('12345')::text || ' / '
      || public.creci_disponivel('12345-J')::text || ' / '
      || public.creci_disponivel('12345-X')::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('creci_disponivel responde não sem a letra (sem letra / com J / outra letra)', 'false / true / false', v);
end $$;

-- Excluir autônomo pendente (RF16 ampliado em 28/10/2026) -------------

do $$ declare v text; begin
  begin
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '54321-F');
    delete from auth.users where id = '00000000-0000-4000-a000-000000000031';
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000032', '54321-F');
    select case when count(*) = 1 then 'CRECI livre: novo cadastro aceito' else 'não liberou' end
      into v from public.assinantes
      where creci_normalizado = '54321F' and responsavel_id = '00000000-0000-4000-a000-000000000032';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Excluir a conta do autônomo pendente libera o CRECI', 'CRECI livre: novo cadastro aceito', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '54321-F');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000031', 'ativo');
    begin
      delete from auth.users where id = '00000000-0000-4000-a000-000000000031';
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000031', 'bloqueado');
    begin
      delete from auth.users where id = '00000000-0000-4000-a000-000000000031';
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Autônomo ativo ou bloqueado não é excluído', 'bloqueado (P0001) / bloqueado (P0001)', v);
end $$;

-- Ativar e bloquear só pelo admin -------------------------------------

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '54321-F');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    update public.assinantes set status = 'ativo', bloqueado_pelo_admin = true
    where responsavel_id = '00000000-0000-4000-a000-000000000031';
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Imobiliária ativa não ativa nem bloqueia outro assinante (0 linhas alteradas)', '0', v);
end $$;

-- ---------------------------------------------------------------
-- 11. Convites gerados pelo banco e equipe
--     (migration 20261028162403_convites_e_equipe)
-- ---------------------------------------------------------------

do $$ declare v text; codigo text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    codigo := public.criar_convite(' Novo@Exemplo.com ');
    select length(codigo)::text
           || ' / ' || (c.token_hash = encode(sha256(convert_to(codigo, 'UTF8')), 'hex'))::text
           || ' / ' || (c.expira_em between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour')::text
           || ' / ' || coalesce(c.usado_em::text, 'não usado')
           || ' / ' || c.email
      into v
    from public.convites c;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('criar_convite: código de 64 letras, só o hash guardado, 7 dias, e-mail em minúsculas',
          '64 / true / true / não usado / novo@exemplo.com', v);
end $$;

do $$ declare v text; a text; b text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    a := public.criar_convite();
    b := public.criar_convite();
    select (a <> b)::text || ' / ' || count(*) into v from public.convites;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Cada convite por link tem um código novo', 'true / 2', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      insert into public.convites (assinante_id, token_hash, expira_em, usado_em)
      values (public.meu_assinante_id(), repeat('a', 64), now() + interval '10 years', null);
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável não grava convite direto (nem escolhe código, validade ou uso)', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; h text; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    -- Desde a auditoria da Etapa 5, e-mail com conta devolve null (sem erro, para a
    -- tentativa contar no limite por hora) e não cria convite.
    begin
      v := coalesce(public.criar_convite(upper('teste-00000000-0000-4000-a000-000000000001@exemplo.com')), 'null')
           || ' ' || (select count(*) from public.convites)::text;
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      v := sqlstate || ' ' || h;
    end;
    begin
      perform public.criar_convite('sem-arroba');
      v := v || ' / permitido';
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      v := v || ' / ' || sqlstate || ' ' || h;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Convite para e-mail que já tem conta ou e-mail inválido é recusado (sem código e 0 convites / motivo)',
          'null 0 / P0001 email_invalido', v);
end $$;

do $$ declare v text; a text; b text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    a := public.criar_convite('X@exemplo.com');
    b := public.criar_convite('x@exemplo.com');
    select count(*)::text
           || ' / ' || public.convite_valido(a, 'x@exemplo.com')::text
           || ' / ' || public.convite_valido(b, 'x@exemplo.com')::text
      into v
    from public.convites where email = 'x@exemplo.com';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Novo convite para o mesmo e-mail substitui o que aguardava (convites / antigo vale / novo vale)',
          '1 / false / true', v);
end $$;

do $$ declare v text; codigo text; i uuid; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    i := pg_temp.criar_imovel('00000000-0000-4000-a000-000000000001', 'disponivel');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    codigo := public.criar_convite();
    reset role;
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', codigo);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    select public.eh_assinante_ativo()::text || ' / ' || count(*) into v
    from public.imoveis where id = i;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor do convite entra ativo e vê o imóvel disponível', 'true / 1', v);
end $$;

-- Tela do convite, sem login -----------------------------------------

do $$ declare v text; codigo text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    codigo := public.criar_convite('novo@exemplo.com');
    perform pg_temp.entrar_como_visitante();
    select situacao || ' / ' || imobiliaria || ' / ' || creci || ' / ' || convidado_por || ' / ' || email
      into v from public.dados_do_convite(codigo);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante com o código vê de quem é o convite',
          'valido / Imobiliária de Teste / 12345-J / Responsável de Teste / novo@exemplo.com', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '67890-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000012', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'c-usado', null, now() + interval '1 day');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'c-vencido', 'v@exemplo.com', now() - interval '1 minute');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000012', 'c-bloqueada', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'c-usado');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000012', 'bloqueado');
    perform pg_temp.entrar_como_visitante();
    v := (select situacao from public.dados_do_convite('c-usado'))
      || ' / ' || (select situacao || ' ' || coalesce(email, 'sem e-mail') from public.dados_do_convite('c-vencido'))
      || ' / ' || (select situacao from public.dados_do_convite('c-bloqueada'))
      || ' / ' || (select count(*) from public.dados_do_convite('nao-existe'));
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('dados_do_convite diz por que não vale (usado / vencido sem o e-mail / imobiliária bloqueada / inexistente)',
          'usado / vencido sem e-mail / sem_acesso / 0', v);
end $$;

-- Remover corretor ------------------------------------------------------

-- Imobiliária A ativa (0011) com os corretores 0021 e 0022; imobiliária B ativa (0012).
create or replace function pg_temp.montar_equipe()
returns void
language plpgsql
as $$
begin
  perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
  perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
  perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '67890-J');
  perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000012', 'ativo');
  perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'c-1', null, now() + interval '1 day');
  perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'c-2', null, now() + interval '1 day');
  perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'c-1');
  perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000022', 'c-2');
end;
$$;

do $$ declare v text; begin
  begin
    perform pg_temp.montar_equipe();
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    perform public.remover_corretor('00000000-0000-4000-a000-000000000021');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    select public.eh_assinante_ativo()::text
           || ' / ' || (removido_em is not null)::text
           || ' / ' || (assinante_id = (select assinante_id from public.perfis where id = '00000000-0000-4000-a000-000000000021'))::text
      into v
    from public.perfis where id = '00000000-0000-4000-a000-000000000021';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável remove o corretor: ele perde o acesso na hora e a conta fica (acesso / removido / vínculo)',
          'false / true / true', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.montar_equipe();
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    perform public.remover_corretor('00000000-0000-4000-a000-000000000021');
    begin
      perform public.remover_corretor('00000000-0000-4000-a000-000000000021');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform public.remover_corretor('00000000-0000-4000-a000-000000000011');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável não remove de novo nem remove a si mesmo', 'bloqueado (P0001) / bloqueado (P0001)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.montar_equipe();
    perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '54321-F');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000031', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000022');
    begin
      perform public.remover_corretor('00000000-0000-4000-a000-000000000021');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000012');
    begin
      perform public.remover_corretor('00000000-0000-4000-a000-000000000021');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000031');
    begin
      perform public.remover_corretor('00000000-0000-4000-a000-000000000021');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    reset role;
    select v || ' / ' || (removido_em is null)::text into v
    from public.perfis where id = '00000000-0000-4000-a000-000000000021';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Corretor, outra imobiliária e autônomo não removem (o corretor continua)',
          'bloqueado (42501) / bloqueado (P0001) / bloqueado (42501) / true', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.montar_equipe();
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    v := (select count(*) from public.perfis)::text;
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000012');
    v := v || ' / ' || (select count(*) from public.perfis);
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000021');
    v := v || ' / ' || (select count(*) from public.perfis);
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável lê a própria equipe; outra imobiliária e o corretor, não (A / B / corretor)', '3 / 1 / 1', v);
end $$;

do $$ declare v text; n int; begin
  begin
    perform pg_temp.montar_equipe();
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    update public.perfis set nome = 'Nome Trocado' where id = '00000000-0000-4000-a000-000000000021';
    get diagnostics n = row_count;
    v := n::text;
    begin
      update public.perfis set removido_em = now() where id = '00000000-0000-4000-a000-000000000021';
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável não altera o perfil do corretor nem marca removido direto (linhas / removido)',
          '0 / bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    update public.perfis set removido_em = now() where id = '00000000-0000-4000-a000-000000000011';
    v := 'permitido';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Só corretor pode ficar marcado como removido', 'bloqueado (23514)', v);
end $$;

-- ---------------------------------------------------------------
-- 12. Auditoria da Etapa 5 (migration 20261028224919_auditoria_etapa_5)
-- ---------------------------------------------------------------

do $$ declare v text; n int; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000012', '67890-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000012', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000012', 'codigo-de-b', null, now() + interval '1 day');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    delete from public.convites;
    get diagnostics n = row_count;
    v := n::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável não cancela convite de outra imobiliária', '0', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      perform public.criar_convite();
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável de imobiliária bloqueada não cria convite', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'vencido');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    begin
      perform public.criar_convite();
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável de imobiliária vencida não cria convite', 'bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.entrar_como_visitante();
    begin
      perform public.criar_convite();
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform public.remover_corretor('00000000-0000-4000-a000-000000000021');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Visitante sem login não chama criar_convite nem remover_corretor',
          'bloqueado (42501) / bloqueado (42501)', v);
end $$;

do $$ declare v text; h text; i int; begin
  begin
    perform pg_temp.criar_proprietario('00000000-0000-4000-a000-000000000001');
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    -- 20 perguntas sobre um e-mail que tem conta passam; a 21ª (mesmo um link) não.
    for i in 1..20 loop
      perform public.criar_convite('teste-00000000-0000-4000-a000-000000000001@exemplo.com');
    end loop;
    v := '20 passaram';
    begin
      perform public.criar_convite();
      v := v || ' / permitido';
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      v := v || ' / ' || sqlstate || ' ' || h;
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Limite de 20 convites por hora, contando e-mail que já tem conta',
          '20 passaram / P0001 limite_de_convites', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    perform public.criar_convite();
    begin
      select count(*)::text into v from public.tentativas_de_convite;
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      delete from public.tentativas_de_convite;
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável não lê nem apaga as tentativas de convite',
          'bloqueado (42501) / bloqueado (42501)', v);
end $$;

do $$ declare v text; begin
  begin
    begin
      perform pg_temp.criar_autonomo('00000000-0000-4000-a000-000000000031', '12345678-F');
      v := 'permitido';
    exception when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    begin
      perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12-J');
      v := v || ' / permitido';
    exception when others then v := v || ' / ' || pg_temp.bloqueio(sqlstate, sqlerrm);
    end;
    v := v || ' / ' || public.creci_disponivel('12345678-F')::text
           || ' / ' || public.creci_disponivel('1234567-F')::text;
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('CRECI com mais de 7 ou menos de 3 dígitos é barrado (8 / 2 / disponível 8 / disponível 7)',
          'bloqueado (23514) / bloqueado (23514) / false / true', v);
end $$;

do $$ declare v text; begin
  begin
    perform pg_temp.criar_imobiliaria('00000000-0000-4000-a000-000000000011', '12345-J');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'ativo');
    perform pg_temp.criar_convite('00000000-0000-4000-a000-000000000011', 'codigo-de-teste', null, now() + interval '1 day');
    perform pg_temp.criar_corretor('00000000-0000-4000-a000-000000000021', 'codigo-de-teste');
    perform pg_temp.mudar_status_do_assinante_de('00000000-0000-4000-a000-000000000011', 'bloqueado');
    perform pg_temp.entrar_como('00000000-0000-4000-a000-000000000011');
    select count(*)::text into v from public.perfis where tipo = 'corretor';
    raise exception using errcode = 'TR001';
  exception when sqlstate 'TR001' then null;
            when others then v := pg_temp.bloqueio(sqlstate, sqlerrm);
  end;
  insert into resultado (teste, esperado, obtido)
  values ('Responsável de imobiliária bloqueada não lê a equipe', '0', v);
end $$;

-- ---------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------
select
  ordem,
  case when obtido is not distinct from esperado then '✅ passou' else '❌ FALHOU' end as situacao,
  teste,
  esperado,
  obtido
from resultado
order by ordem;

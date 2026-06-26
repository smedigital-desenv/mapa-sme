-- ============================================================================
-- MIGRAÇÃO do controle ANTIGO (tabelas `usuarios` e `unidades`, usadas pela
-- tela de Configurações que ficava dentro de avaliacao.html) para o modelo
-- NOVO do controle de acesso central (escolas / perfis / perfil_escola /
-- perfil_tela). Assim a tela única de Configurações já mostra as escolas e os
-- usuários que você tinha cadastrado.
--
-- Pré-requisito: rode antes o sql/07 e o sql/08.
-- Seguro e idempotente: usa NOT EXISTS / ON CONFLICT e não sobrescreve quem já
-- existe. Pode rodar de novo sem duplicar.
--
-- Mapeamento:
--   unidades.nome_unidade            -> escolas.nome
--   usuarios.email_usuario           -> perfis.email
--   usuarios.perfil (SME/SECRET...)  -> perfis.tipo ('secretaria' | 'escola')
--   usuarios.ativo                   -> perfis.ativo
--   usuarios.nome_unidade            -> perfil_escola (vínculo por nome)
--   usuarios.acesso_avaliacoes       -> perfil_tela (tela 'avaliacao')
--
-- OBS: por segurança NINGUÉM é promovido a super admin automaticamente
--      (o antigo "acesso_configuracoes" NÃO vira super admin). Depois, na tela
--      de Configurações, você marca quem é ADM e quais telas cada um acessa.
-- ============================================================================
do $$
begin
  -- 1) ESCOLAS a partir de `unidades`
  if to_regclass('public.unidades') is not null then
    insert into public.escolas (nome)
    select distinct trim(u.nome_unidade)
    from public.unidades u
    where coalesce(trim(u.nome_unidade),'') <> ''
      and not exists (select 1 from public.escolas e
                      where lower(e.nome) = lower(trim(u.nome_unidade)));
  end if;

  if to_regclass('public.usuarios') is not null then
    -- 1b) ESCOLAS que aparecem só em `usuarios.nome_unidade`
    insert into public.escolas (nome)
    select distinct trim(u.nome_unidade)
    from public.usuarios u
    where coalesce(trim(u.nome_unidade),'') <> ''
      and not exists (select 1 from public.escolas e
                      where lower(e.nome) = lower(trim(u.nome_unidade)));

    -- 2) PERFIS (não sobrescreve quem já existe; não promove a super admin)
    insert into public.perfis (email, tipo, ativo, is_super_admin)
    select lower(trim(u.email_usuario)),
           case when upper(coalesce(u.perfil,'')) ~ '(SME|SECRET|ADMIN|CENTRAL)'
                then 'secretaria' else 'escola' end,
           coalesce(u.ativo, true),
           false
    from public.usuarios u
    where position('@' in coalesce(u.email_usuario,'')) > 0
      and not exists (select 1 from public.perfis p
                      where p.email = lower(trim(u.email_usuario)));

    -- 3) VÍNCULO perfil <-> escola (casando pelo nome da unidade)
    insert into public.perfil_escola (perfil_id, escola_id)
    select distinct p.id, e.id
    from public.usuarios u
    join public.perfis  p on p.email = lower(trim(u.email_usuario))
    join public.escolas e on lower(e.nome) = lower(trim(u.nome_unidade))
    where coalesce(trim(u.nome_unidade),'') <> ''
    on conflict do nothing;

    -- 4) TELA de Avaliações para quem tinha acesso (e não é super admin)
    insert into public.perfil_tela (perfil_id, tela_id, pode_ver)
    select distinct p.id, t.id, true
    from public.usuarios u
    join public.perfis   p on p.email = lower(trim(u.email_usuario)) and p.is_super_admin = false
    join public.sistemas s on s.slug = 'mapa'
    join public.telas    t on t.sistema_id = s.id and t.slug = 'avaliacao'
    where coalesce(u.acesso_avaliacoes, true)
    on conflict do nothing;
  end if;
end $$;

-- Conferência rápida (opcional): quantos vieram
-- select (select count(*) from public.escolas) as escolas,
--        (select count(*) from public.perfis)  as perfis,
--        (select count(*) from public.perfil_escola) as vinculos,
--        (select count(*) from public.perfil_tela)   as telas_liberadas;

-- ============================================================================
-- SIMULAR ACESSO + liberação de 1 e-mail fora do domínio.
-- Pré-requisito: rode antes o sql/07 e o sql/08 (cria perfil_tela).
-- Idempotente.
--
-- O que faz:
--   1) permissoes_json(email)  -> função única que monta o "mapa de acesso"
--      de QUALQUER e-mail (sem efeitos colaterais). Fonte única de verdade.
--   2) minhas_permissoes()     -> reescrita p/ usar permissoes_json (mantém a
--      restrição de domínio + grava auth_user_id no 1º acesso).
--   3) permissoes_de(email)    -> super admin obtém as permissões de outro
--      perfil para SIMULAR o acesso dele.
--   4) Libera matheusprospero@gmail.com (fora do domínio) como super admin.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Builder único do mapa de acesso (sem update, sem checagem de domínio)
-- ---------------------------------------------------------------------------
create or replace function public.permissoes_json(p_email text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_perfil public.perfis%rowtype;
  v_result json;
begin
  select * into v_perfil from public.perfis
   where lower(email) = lower(p_email) and ativo = true
   limit 1;

  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;

  select json_build_object(
    'autorizado', true,
    'perfil', json_build_object(
        'id', v_perfil.id, 'nome', v_perfil.nome, 'email', v_perfil.email,
        'tipo', v_perfil.tipo, 'is_super_admin', v_perfil.is_super_admin),
    'escolas', coalesce((
        select json_agg(json_build_object('id', e.id, 'nome', e.nome, 'vinculo', pe.vinculo) order by e.nome)
        from public.perfil_escola pe join public.escolas e on e.id = pe.escola_id
        where pe.perfil_id = v_perfil.id and e.ativo = true), '[]'::json),
    'sistemas', coalesce((
        select json_agg(s_obj order by ordem) from (
          select s.ordem,
            json_build_object(
              'slug', s.slug, 'nome', s.nome, 'url', s.url, 'icone', s.icone, 'cor', s.cor,
              'papel', (case when v_perfil.is_super_admin then 'admin' else coalesce(pp_papel.slug,'perfil') end),
              'telas', coalesce((
                 select json_object_agg(tl.slug, json_build_object(
                          'nome', tl.nome, 'ver', tl.ver, 'editar', tl.editar, 'exportar', tl.exportar))
                 from (
                   select t.slug, max(t.nome) as nome,
                          bool_or(src.ver) as ver, bool_or(src.editar) as editar, bool_or(src.exportar) as exportar
                   from public.telas t
                   join lateral (
                     select true as ver, true as editar, true as exportar where v_perfil.is_super_admin
                     union all
                     select pt.pode_ver, pt.pode_editar, pt.pode_exportar
                     from public.perfil_tela pt where pt.tela_id = t.id and pt.perfil_id = v_perfil.id
                     union all
                     select perm.pode_ver, perm.pode_editar, perm.pode_exportar
                     from public.papel_permissoes perm where perm.tela_id = t.id and perm.papel_id = pp_papel.id
                   ) src on true
                   where t.sistema_id = s.id
                   group by t.slug
                   having bool_or(src.ver)
                 ) tl
                ), '{}'::json)
            ) as s_obj
          from public.sistemas s
          left join lateral (
             select pa.id, pa.slug
             from public.perfil_papeis pp
             join public.papeis pa on pa.id = pp.papel_id and pa.sistema_id = s.id
             where pp.perfil_id = v_perfil.id
             limit 1
          ) pp_papel on true
          where s.ativo = true
            and (
              v_perfil.is_super_admin
              or pp_papel.id is not null
              or exists (
                 select 1 from public.perfil_tela pt
                 join public.telas t on t.id = pt.tela_id
                 where pt.perfil_id = v_perfil.id and t.sistema_id = s.id and pt.pode_ver)
            )
        ) sis
      ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) minhas_permissoes() — usa o builder, mantém domínio + 1º acesso
-- ---------------------------------------------------------------------------
create or replace function public.minhas_permissoes()
returns json language plpgsql volatile security definer set search_path = public as $$
declare v_perfil public.perfis%rowtype;
begin
  select * into v_perfil from public.perfis
   where lower(email) = public.jwt_email() and ativo = true limit 1;

  if v_perfil.id is null then
    return json_build_object('autorizado', false);
  end if;

  -- RESTRIÇÃO DE DOMÍNIO: só @educacao.pmrp.sp.gov.br (super admin é exceção).
  if not v_perfil.is_super_admin
     and lower(v_perfil.email) not like '%@educacao.pmrp.sp.gov.br' then
    return json_build_object('autorizado', false, 'motivo', 'dominio');
  end if;

  -- grava o auth_user_id no 1º acesso
  if v_perfil.auth_user_id is null then
    update public.perfis
       set auth_user_id = (nullif(current_setting('request.jwt.claims', true),'')::json ->> 'sub')::uuid
     where id = v_perfil.id;
  end if;

  return public.permissoes_json(v_perfil.email);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) permissoes_de(email) — para o super admin SIMULAR outro usuário
-- ---------------------------------------------------------------------------
create or replace function public.permissoes_de(p_email text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    return json_build_object('autorizado', false, 'motivo', 'sem_permissao');
  end if;
  return public.permissoes_json(p_email);
end;
$$;

grant execute on function public.minhas_permissoes()      to authenticated, anon;
grant execute on function public.permissoes_de(text)      to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Liberação do e-mail fora do domínio (super admin -> ignora a regra)
-- ---------------------------------------------------------------------------
insert into public.perfis (email, nome, tipo, is_super_admin)
values ('matheusprospero@gmail.com', 'Matheus Prospero', 'secretaria', true)
on conflict (email) do update set is_super_admin = true, ativo = true;
